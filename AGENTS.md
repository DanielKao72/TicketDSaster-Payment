# CLAUDE.md

This file provides guidance to Coding Agent when working with code in this repository.

## Overview

Payment Service for the Ticket D-Saster platform (Node.js ≥ 20 + Express, CommonJS). The service code lives in `payment-service/`; design docs live in `docs/`. It is at an early scaffold stage: only `GET /health` exists so far.

## Commands

Run from `payment-service/`:

```bash
npm install
npm start                                  # node src/app.js (PORT from env, default 3000)
npm test                                   # node --test (built-in runner, discovers tests/)
node --test tests/health.test.js           # single test file
node --test --test-name-pattern="health"   # tests matching a name
docker build -t payment-service .
```

The contributing docs reference `npm run lint` (ESLint + Prettier), husky/commitlint hooks, `docker-compose.yml`, and a CI commitlint workflow — **none of these exist yet**. Don't assume them; add them if the task calls for it.

## Architecture

- `src/app.js` builds and exports the Express app and only calls `listen()` when run directly (`require.main === module`). Tests import the app and call `app.listen(0)` on an ephemeral port, then hit it with global `fetch`.
- Layering is routes → controllers → services, with the target layout (from `docs/contributing/code-standards.md`): `config/`, `controllers/`, `routes/`, `services/`, `models/`, `middlewares/`, `providers/`, `utils/`. Files are kebab-case with a role suffix (`payment.controller.js`, `health.routes.js`).
- All env access goes through `src/config/index.js`. Don't read `process.env` anywhere else.

### Domain context (see `docs/ddd/domain-model.md`, `docs/architecture/c4-model.md`)

- Payments is a **Support** subdomain. Its only caller is the **Booking Service** (frontends never call it directly), which forwards the user's JWT. The service doesn't own booking, pricing, seats, events, or auth. It references `Session` and `Tickets` by id only.
- It is the only component that talks to the **external payment provider**. That access goes through an Anti-Corruption Layer in `src/providers/`: `payment-provider.js` defines the interface, with one implementation per provider. Provider-specific statuses and types must not leak out of that folder.
- Use the ubiquitous language in code: `Payment` (aggregate root), `PaymentRequest`, `Transaction`, `Refund`, `PaymentStatus`, `IdempotencyKey`.

### Planned conventions

These conventions apply when building payment features:

- **Money**: integer minor units (cents) plus an ISO 4217 `currency`. Never floats.
- **Status transitions** (`PENDING → AUTHORIZED → CAPTURED`, plus `FAILED`, `REFUNDED`) live only in `services/payment.service.js`, which rejects invalid transitions.
- **Idempotency**: every POST that creates a payment or refund requires an `Idempotency-Key` header (`middlewares/idempotency.js`, persisted in the Payment Store). Provider retries reuse the same key, with timeouts and backoff.
- **Auth**: the service validates JWTs and never issues them (`middlewares/jwt-auth.js`; payload `{ sub, role: Fan|Organizer|VenueOwner, iat, exp }`). Role checks go through `middlewares/require-role.js`, never inline in controllers.
- **Webhooks** from the provider must have their signature verified before they change a payment's status.
- Never store or log card data (PAN, CVV, expiry), because card capture is delegated to the provider.
- Use async/await throughout, with a centralized error-handling middleware. Validate input (joi or zod) before the service layer.
- **Status codes**: 201 create, 200 query, 202 accepted but provider result pending, 400, 401, 403, 404, 409 duplicate or idempotency-key payload mismatch, 422 provider declined, 502 provider failure or timeout.
- **Tests**: unit tests for services mock the DB and the provider adapter. Route integration tests use a test or in-memory store. Explicitly cover idempotency (no double charge) and invalid transitions.

## Repository workflow

- Branches: `feature/`, `fix/`, `chore/`, `hotfix/` + kebab-case description.
- Commits and PR titles follow Conventional Commits (`feat(payment): add refund endpoint`). PRs are squash-merged into `main`.
