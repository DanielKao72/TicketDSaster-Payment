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
