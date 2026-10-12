# TicketDSaster-Payment

Módulo de Pagos del sistema Ticket D-Saster.

El **Payment Service** procesa los cobros de las compras de boletos. Es el único componente de Ticket D-Saster que se comunica con el proveedor de pagos externo. Persiste los pagos, sus transacciones y las llaves de idempotencia en su propia base de datos, el **Payment Store** (PostgreSQL). Lo llama el **Booking Service**, que le reenvía el JWT emitido por el Auth Service. Las reservas, los precios, los eventos y la autenticación no son parte de este servicio.

Más contexto en [`docs/architecture/c4-model.md`](docs/architecture/c4-model.md) y [`docs/ddd/domain-model.md`](docs/ddd/domain-model.md).

## Requisitos

- [Node.js 20](https://nodejs.org) (versión fijada en `payment-service/.nvmrc`; con nvm: `nvm use`)
- [Docker](https://www.docker.com/) con Docker Compose
- [GitHub CLI](https://cli.github.com/) (solo para hacer releases)

## Correr el servicio localmente

### Opción A: todo con Docker Compose (recomendado)

Levanta PostgreSQL, corre las migraciones y los seeds con datos de prueba, y arranca el servicio:

```bash
git clone git@github.com:DanielKao72/TicketDSaster-Payment.git
cd TicketDSaster-Payment/payment-service
cp .env.example .env
docker compose up --build
```

Comprueba que responde:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

Para apagarlo: `docker compose down`. Agrega `-v` para borrar también los datos de la base.

### Opción B: el servicio en tu máquina y la base en Docker

```bash
cd payment-service
cp .env.example .env
npm install                     # también instala los git hooks
docker compose up -d db         # solo PostgreSQL
export DATABASE_URL=postgres://payment:change-me@localhost:5432/payment_store
npm run db:migrate
npm run db:seed
npm start
```

## Comandos

Desde `payment-service/`:

| Comando | Qué hace |
|---|---|
| `npm start` | Arranca el servicio (puerto `PORT`, por defecto 3000) |
| `npm run lint` | ESLint + verificación de formato con Prettier |
| `npm run format` | Formatea el código con Prettier |
| `npm test` | Corre las pruebas unitarias (`node --test`) |
| `npm run openapi` | Genera `openapi.json` a partir del código, sin levantar el servidor |
| `npm run db:migrate` | Aplica las migraciones pendientes (requiere `DATABASE_URL`) |
| `npm run db:rollback` | Revierte el último lote de migraciones |
| `npm run db:seed` | Carga los datos de prueba |

## Cómo contribuir

- `main` está protegida: todo cambio entra por Pull Request con squash merge. Detalles en [`docs/contributing/repository-management.md`](docs/contributing/repository-management.md).
- Los commits siguen [Conventional Commits](https://www.conventionalcommits.org/) (`feat(payment): add refund endpoint`). El hook `commit-msg` rechaza los mensajes que no cumplen, y en el PR también se validan los commits y el título.
- Cada PR corre lint, pruebas y el build de la imagen Docker (`.github/workflows/on_pr.yml`).
- Estándares de código: [`docs/contributing/code-standards.md`](docs/contributing/code-standards.md).

## Releases

Un release es un tag `vM.m.p`. Se crea desde `main` actualizado y con el CI en verde, usando el script de bump:

```bash
cd payment-service && npm ci && cd ..   # el script corre las pruebas
scripts/bump.sh                          # menú: major / minor / patch / alpha / beta
scripts/bump.sh --dry-run                # solo muestra la siguiente versión
scripts/changelog.sh HEAD                # vista previa de las notas del release
```

| Versión | Se despliega en |
|---|---|
| Major (`v2.0.0`) | dev y producción |
| Minor (`v1.5.0`) | solo dev |
| Patch (`v1.4.3`) | no se despliega; solo se publica |

Al subir el tag, `.github/workflows/release.yml` crea el release en GitHub con las notas generadas a partir de los commits y adjunta el `openapi.json` versionado. Un tag publicado no se mueve ni se reutiliza: si algo sale mal, se publica una versión nueva.
