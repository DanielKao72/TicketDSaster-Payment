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
