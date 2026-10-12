# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Overview

Payment Service for the Ticket D-Saster platform (Node.js 20 + Express, CommonJS, PostgreSQL via knex). The service code and its `package.json` live in `payment-service/`. Design docs are in `docs/`, release scripts in `scripts/`, and CI workflows in `.github/workflows/`. Only `GET /health` exists so far.

## Commands

Run from `payment-service/`:

```bash
npm install                                # also installs the husky git hooks (prepare script)
npm start                                  # node src/index.js (PORT from env, default 3000)
npm run lint                               # eslint + prettier --check
npm run format                             # prettier --write
npm test                                   # node --test (built-in runner, discovers tests/)
node --test tests/health.test.js           # single test file
node --test --test-name-pattern="health"   # tests matching a name
npm run openapi                            # writes openapi.json (APP_VERSION overrides info.version)
npm run db:migrate | db:rollback | db:seed # knex, needs DATABASE_URL
docker compose up --build                  # Postgres + migrations/seeds + service (cp .env.example .env first)
```

From the repo root, `scripts/changelog.sh HEAD` previews the next release notes and `scripts/bump.sh --dry-run` shows the next version.

## Architecture

**Hexagonal architecture** (ports and adapters). The layout of `payment-service/src/` is:

- `core/domain/`: the `Payment` aggregate, `payment-status.js` (statuses and allowed transitions), the `money.js` value object and domain errors.
- `core/use-cases/`: one file per use case (`create-payment.js`…). Each one is a factory that receives its ports as dependencies.
- `ports/outbound/`: JSDoc contracts (`*.port.js`), one per port: `payment-repository`, `payment-provider`, `idempotency-store`.
- `adapters/`: `controllers/` (HTTP → use case), `repositories/` (knex implementations of the ports) and `providers/` (the payment provider ACL).
- `infrastructure/`: `config/`, `database/` (knex instance), and `express/` (`app.js`, `openapi.js`, `routes/`, `middlewares/`).

Rules:

- **Dependency rule:** `src/core/` requires nothing outside itself: no express, knex, pg, adapters or infrastructure. An ESLint `no-restricted-syntax` rule in `eslint.config.js` enforces it.
- **Entrypoint:** `src/index.js` is the composition root. It is the only file that creates adapters, injects them into `buildApp(deps)` (`infrastructure/express/app.js`) and calls `listen()`.
- **Tests:** they call `buildApp().listen(0)` on an ephemeral port and hit it with global `fetch`. Use-case tests inject fakes instead of mocking modules (`adapters/providers/fake-payment-provider.js` is the provider fake).
- **Naming:** files are kebab-case with a role suffix (`payment.controller.js`, `health.routes.js`, `payment-provider.port.js`).
- **Config:** all env access goes through `src/infrastructure/config/index.js` (`port`, `appVersion`, `database.url`). Don't read `process.env` anywhere else.
- **OpenAPI is generated from code.** Every route needs an `@openapi` JSDoc block in `src/infrastructure/express/routes/*.js`, which `src/infrastructure/express/openapi.js` (swagger-jsdoc) collects. `tests/openapi.test.js` checks the spec.
- **Payment Store schema** is in `db/migrations/` (`payments`, `transactions`, `idempotency_keys`, with native Postgres enums for statuses). `db/seeds/` holds dummy data with one payment per status. Change the schema with a new migration; never edit an applied one.

### Domain context (see `docs/ddd/domain-model.md`, `docs/architecture/c4-model.md`)

- Payments is a **Support** subdomain. Its only caller is the **Booking Service** (frontends never call it directly), which forwards the user's JWT. The service doesn't own booking, pricing, seats, events, or auth. It references `Session` and `Tickets` by id only.
- It is the only component that talks to the **external payment provider**. That access goes through an Anti-Corruption Layer: `src/ports/outbound/payment-provider.port.js` defines the contract, with one adapter per provider in `src/adapters/providers/`. Provider-specific statuses and types must not leak out of that folder.
- Use the ubiquitous language in code: `Payment` (aggregate root), `PaymentRequest`, `Transaction`, `Refund`, `PaymentStatus`, `IdempotencyKey`.

### Conventions for payment features

- **Money**: integer minor units (cents) plus an ISO 4217 `currency`. Never floats.
- **Status transitions** (`PENDING → AUTHORIZED → CAPTURED`, plus `FAILED`, `REFUNDED`) live only in the `Payment` aggregate (`core/domain/payment.js`, rules in `payment-status.js`). It throws `InvalidPaymentTransitionError` on an invalid transition, and the error handler maps that to 409.
- **Idempotency**: every POST that creates a payment or refund requires an `Idempotency-Key` header (`infrastructure/express/middlewares/idempotency.js`, persisted in `idempotency_keys` through the `idempotency-store` port). Provider retries reuse the same key, with timeouts and backoff.
- **Auth**: the service validates JWTs and never issues them (`infrastructure/express/middlewares/jwt-auth.js`; payload `{ sub, role: Fan|Organizer|VenueOwner, iat, exp }`). Role checks go through `middlewares/require-role.js`, never inline in controllers.
- **Webhooks** from the provider must have their signature verified before they change a payment's status.
- Never store or log card data (PAN, CVV, expiry), because card capture is delegated to the provider.
- Use async/await throughout, with a centralized error-handling middleware (`infrastructure/express/middlewares/error-handler.js`, which maps `DomainError` subclasses to status codes). Validate input (joi or zod) before the use-case layer.
- **Status codes**: 201 create, 200 query, 202 accepted but provider result pending, 400, 401, 403, 404, 409 duplicate or idempotency-key payload mismatch, 422 provider declined, 502 provider failure or timeout.
- **Tests** mirror `src/` under `tests/` (`tests/core/domain/payment.test.js`). Domain tests need no fakes. Use-case tests inject fake ports (repository, provider, idempotency store). Route integration tests use a test or in-memory store. Explicitly cover idempotency (no double charge) and invalid transitions.

## Repository workflow

- `main` is protected: changes go through a PR and are squash-merged.
- Branches: `feature/`, `fix/`, `chore/`, `hotfix/` + kebab-case description.
- Commits and PR titles follow Conventional Commits (`feat(payment): add refund endpoint`). The husky `commit-msg` hook and `.github/workflows/commitlint.yml` enforce it. The `pre-commit` hook runs lint-staged.
- **CI** (`.github/workflows/on_pr.yml`) runs lint, tests and a Docker build on every PR and on pushes to `main`. Keep that file name: `scripts/bump.sh` looks it up.
- **Releases** are `vM.m.p` tags created with `scripts/bump.sh` from an up-to-date, CI-green `main`. Major deploys to prod and dev, minor to dev only, patch is published but not deployed. A pushed tag triggers `.github/workflows/release.yml`, which creates the GitHub release with notes from `scripts/changelog.sh` and attaches `openapi.json`. The Docker image push job is still a TODO there.
