# Operación del Payment Store

Cómo se migra, se configura, se respalda y se audita la base de datos del Payment Service (PostgreSQL). Cada sección indica qué ya está en el código y qué depende de otros equipos.

## Migraciones y seeds (6.1)

**Regla:** las migraciones son un paso propio del pipeline de despliegue, que corre **antes** de desplegar la imagen nueva. El servicio nunca migra al arrancar, y los seeds nunca corren en producción.

### Qué hay en el código

| Pieza | Qué hace |
|---|---|
| `APP_ENV` (`development`, `test`, `production`) | Entorno de ejecución. La imagen de Docker usa `production` por defecto; `docker-compose.yml` lo fija en `development`. Un valor desconocido detiene el arranque |
| `db/SeedGuard.js` | Todo seed lo llama antes de tocar la base. Con `APP_ENV=production` lanza un error y no borra ni inserta nada |
| `docker-compose.yml` | Tres pasos separados: `migrate` (solo migraciones), `seed` (solo desarrollo local) y `payment-service` |
| `.github/workflows/on_pr.yml`, job `migrations` | En cada PR, contra un Postgres de CI: aplica todas las migraciones, comprueba que los seeds se niegan a correr en producción, revierte todo, vuelve a aplicar y carga los seeds en desarrollo |
| `.github/workflows/migrate.yml` | El paso de migración del despliegue. Se lanza a mano (Actions, elegir tag y entorno) o desde el futuro job de deploy con `uses: ./.github/workflows/migrate.yml`. Lista las migraciones pendientes y las aplica. No corre seeds |

La imagen también puede migrar por sí sola, por ejemplo como un Job de Kubernetes o un paso previo del deploy:

```bash
docker run --rm -e DATABASE_URL=... payment-service:<versión> npm run db:migrate
```

### Pendiente de otros equipos

- **Infraestructura / DevOps:** crear los GitHub Environments `dev` y `prod` con el secreto `DATABASE_URL` (un rol con permisos de DDL, distinto del rol con el que corre el servicio) y revisores obligatorios en `prod`.
- **Infraestructura / DevOps:** dar acceso de red desde el runner de GitHub Actions a la base de cada entorno (por ejemplo, por Tailscale, como el registry). Sin esto `migrate.yml` no puede conectarse.
- **Infraestructura / DevOps:** el job de deploy (pendiente 7.1 y 7.2) debe llamar a `migrate.yml` y desplegar solo si terminó bien.
- **Regla para el equipo:** las migraciones deben ser compatibles hacia atrás con la versión anterior del servicio (primero se agrega, después se usa y al final se borra), porque durante el despliegue conviven ambas versiones.

## Pool de conexiones y timeouts (6.4)

### Qué hay en el código

`src/infrastructure/config/index.js` define los valores por entorno (`APP_ENV`) y `src/infrastructure/database/Knex.js` los aplica al pool de knex y a cada conexión de Postgres. Cualquier valor se puede cambiar con su variable `DB_*`; un valor inválido detiene el arranque.

| Variable | Qué controla | development | test | production |
|---|---|---|---|---|
| `DB_POOL_MIN` | Conexiones que el pool mantiene abiertas | 0 | 0 | 2 |
| `DB_POOL_MAX` | Máximo de conexiones por réplica | 5 | 5 | 10 |
| `DB_ACQUIRE_TIMEOUT_MS` | Espera máxima por una conexión libre del pool | 5000 | 5000 | 5000 |
| `DB_IDLE_TIMEOUT_MS` | Cierra conexiones del pool sin uso | 30000 | 10000 | 30000 |
| `DB_STATEMENT_TIMEOUT_MS` | Postgres cancela una sentencia más lenta (error `57014`) | 10000 | 5000 | 5000 |
| `DB_LOCK_TIMEOUT_MS` | Falla una sentencia que espera un lock más tiempo (error `55P03`) | 5000 | 2000 | 3000 |
| `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` | Cierra una conexión que dejó una transacción abierta | 30000 | 10000 | 10000 |
| `DB_MIGRATION_LOCK_TIMEOUT_MS` | Lock timeout de las migraciones | 10000 | 10000 | 10000 |

Criterios:

- Todas las consultas del servicio son búsquedas por llave o escrituras de una fila. Ninguna debería tardar más de unos milisegundos, así que 5 s en producción solo corta lo que ya es un problema (un lock, una tabla sin índice) en vez de dejar que se acumulen peticiones.
- Las migraciones (`knexfile.js`) usan una sola conexión, **sin** statement timeout (crear un índice puede tardar) y con lock timeout de 10 s: si una migración queda esperando un lock detrás del tráfico, falla en lugar de bloquear todas las consultas que llegan después.
- Hoy un timeout de base de datos responde 500 `INTERNAL_ERROR` al cliente y se registra en el log, igual que cualquier error inesperado.

Las pruebas `tests/infrastructure/database/Knex.test.js` comprueban contra Postgres real que cada conexión recibe estos valores y que Postgres cancela una sentencia lenta y una espera de lock.

### Pendiente de otros equipos

- **Infraestructura / DBA:** confirmar `max_connections` de cada base y cuántas réplicas tendrá el servicio. La regla es `réplicas x DB_POOL_MAX + conexiones de migración y mantenimiento < max_connections` (con margen). Con los valores por defecto, 10 por réplica. Si hay muchas réplicas, conviene PgBouncer en modo transaction.
- **Infraestructura / DBA:** si la base es administrada (RDS, Cloud SQL, etc.), confirmar que el rol del servicio no tiene un `statement_timeout` distinto configurado a nivel de rol o base.

## Respaldos, retención y auditoría (6.3)

### Auditoría: qué hay en el código

La migración `20261106000000_add_payment_audit_log.js` agrega:

| Pieza | Qué hace |
|---|---|
| Tabla `payment_audit_log` | Una fila por cada pago creado, cada cambio de `status` o `decline_reason`, cada transacción nueva y cada borrado. Guarda la fila anterior y la nueva (JSON), el rol de base de datos (`session_user`), `application_name` y la hora exacta. No tiene llave foránea, así que sobrevive al borrado del pago |
| Trigger de auditoría (`SECURITY DEFINER`) | Escribe en la bitácora aunque el rol del servicio no tenga permiso de `INSERT` sobre ella; así el servicio no puede escribir entradas falsas |
| `transactions` solo se agregan | Un `UPDATE` sobre `transactions` siempre falla. Un cambio de estado del proveedor se registra como una transacción nueva, como ya hace el dominio |
| Identidad financiera fija | El `id`, la sesión, el usuario, el monto, la moneda y `created_at` de un pago no pueden cambiar |
| Borrados protegidos | `DELETE` y `TRUNCATE` sobre `payments`, `transactions` y `payment_audit_log` fallan, salvo dentro de una transacción que haga `SET LOCAL payment_store.allow_delete = on`. Hoy solo lo hacen los seeds de desarrollo; lo usará la futura depuración por retención |

Las pruebas `tests/db/PaymentAuditLog.test.js` lo comprueban contra Postgres real.

**Límite honesto:** los triggers evitan errores del código y consultas manuales equivocadas, pero un rol que puede cambiar el flag o borrar triggers puede saltárselos. La otra mitad son los permisos por rol (ver pendientes).

Consulta para revisar la historia de un pago:

```sql
SELECT changed_at, table_name, operation,
       old_data ->> 'status' AS before, new_data ->> 'status' AS after,
       new_data ->> 'type' AS transaction_type, db_user
FROM payment_audit_log
WHERE payment_id = '<paymentId>'
ORDER BY id;
```

### Retención propuesta

| Datos | Retención propuesta | Base |
|---|---|---|
| `payments`, `transactions`, `payment_audit_log` | Al menos 5 años desde la declaración fiscal relacionada. Propuesta operativa: 6 años desde la creación del pago, y no borrar nada sin aprobación de Finanzas/Legal | Código Fiscal de la Federación, art. 30 (plazo general de conservación de la contabilidad y su documentación) |
| Logs de la aplicación y de acceso | Al menos 12 meses, con los últimos 3 meses consultables de inmediato | PCI DSS v4.0, requisito 10.5.1 |
| `idempotency_keys` | Horas (24 a 72 h); son datos técnicos, no registros contables | Pendiente 3.2 / RF-22 |

No hay un job que borre pagos antiguos: hasta que Finanzas/Legal confirme el plazo, no se borra nada. Cuando exista, deberá borrar dentro de una transacción con `payment_store.allow_delete = on`, y los borrados quedan en la bitácora.

### Respaldos: propuesta para Infraestructura

Dónde y cómo se respalda depende de dónde viva la base, que todavía no está definido. Esta es la propuesta mínima:

- **Recuperación a un punto en el tiempo (PITR):** archivado continuo de WAL más un respaldo base diario. Objetivo propuesto: RPO de 5 minutos o menos y RTO de 1 hora o menos (a confirmar con negocio).
- **Retención de respaldos:** 35 días de PITR y un respaldo mensual guardado 12 meses.
- **Seguridad:** cifrados en reposo y en tránsito, en otra región o cuenta distinta de la base, con acceso restringido. Los respaldos no contienen datos de tarjeta (la captura es del proveedor), pero sí ids de usuarios y montos.
- **Prueba de restauración trimestral** en un entorno aislado:
  1. Restaurar el último respaldo y llevarlo a una hora concreta (PITR).
  2. `npx knex migrate:list` no debe mostrar migraciones pendientes respecto a la versión desplegada.
  3. Comparar el conteo de `payments`, `transactions` y `payment_audit_log` con producción a esa hora.
  4. Verificar que todo pago tiene su alta en la bitácora: `SELECT count(*) FROM payments p WHERE NOT EXISTS (SELECT 1 FROM payment_audit_log a WHERE a.payment_id = p.id AND a.table_name = 'payments' AND a.operation = 'INSERT');` debe dar 0 para los pagos creados después de esta migración.
  5. Registrar la fecha, el tiempo que tomó y los problemas encontrados.

### Pendiente de otros equipos

- **Infraestructura / DBA:** definir dónde vive la base y configurar los respaldos según la propuesta (PITR, retención, cifrado, copia fuera de la región) y la prueba de restauración trimestral.
- **Infraestructura / DBA:** crear roles separados. Un rol dueño del esquema para las migraciones (`migrate.yml`). Un rol para el servicio con solo `SELECT, INSERT, UPDATE` en `payments`, `SELECT, INSERT` en `transactions`, `SELECT, INSERT, UPDATE, DELETE` en `idempotency_keys` y nada sobre `payment_audit_log`, sin permisos de DDL ni de `TRUNCATE`. Y un rol de solo lectura para soporte.
- **Finanzas / Legal:** confirmar el plazo de retención de pagos y transacciones (propuesta: 6 años) y qué hacer con una solicitud de cancelación de datos personales (LFPDPPP) frente a la obligación fiscal de conservar.
- **Observabilidad (5.1):** guardar los logs de la aplicación al menos 12 meses, con 3 meses consultables de inmediato.
