# Code Standards — Payment Service

This document defines the coding conventions for the Payment Service, built with **Node.js + Express**, and containerized with **Docker**.

## General Principles

- Code should reflect the **Ubiquitous Language** defined in [`docs/ddd/domain-model.md`](../ddd/domain-model.md) — variables, functions, and classes related to the domain must use terms like `Payment`, `Transaction`, `Refund`, `PaymentStatus`, `IdempotencyKey`, not generic or ambiguous names.
- Favor **explicit and readable** code over clever one-liners.
- Every module should have a single, clear responsibility (aligned with the Support subdomain boundary: this service does **not** own booking, event, venue, or authentication logic).

## Project Structure

```text
src/
├── config/ # env, db config, provider config
├── controllers/ # HTTP request handlers
├── routes/ # Express route definitions
├── services/ # Business logic (payment creation, status transitions, refunds)
├── models/ # Payment / Transaction schemas/models
├── middlewares/ # JWT validation, role guards, idempotency, error handlers, validators
├── providers/ # Adapter (ACL) to the external payment provider
├── utils/ # Helpers (money formatting, retries, signature verification, etc.)
└── app.js # Express app setup
tests/
Dockerfile
docker-compose.yml
.env.example
```


## Node.js / Express Conventions

- **Node version** pinned via `.nvmrc` and matching the Docker base image.
- Use `async/await` — no mixing with raw `.then()` chains or callbacks.
- All routes go through a centralized **error-handling middleware**; controllers should not `try/catch` every error individually, only cases needing specific handling.
- Input validation on every endpoint (e.g. via `joi` or `zod`) before reaching the service layer.
- Environment variables accessed only through a single `config` module — never `process.env` scattered across the codebase.
- Use **HTTP status codes** correctly:
  - `201` on successful payment creation
  - `200` on payment queries
  - `202` when the payment was accepted but the result is still pending (asynchronous provider)
  - `400` for invalid input
  - `401` for a missing or invalid JWT
  - `403` for a valid JWT but insufficient role/permissions
  - `404` when the payment does not exist
  - `409` for a duplicate payment or an idempotency key reused with a different payload
  - `422` when the provider rejects the payment (e.g. declined card)
  - `502` when the provider fails or does not respond

### Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Files | kebab-case | `payment.controller.js` |
| Classes | PascalCase | `PaymentService` |
| Functions/variables | camelCase | `createPayment`, `refundPayment` |
| Constants | UPPER_SNAKE_CASE | `PAYMENT_TIMEOUT_MS` |
| Env vars | UPPER_SNAKE_CASE | `JWT_SECRET`, `PAYMENT_PROVIDER_API_KEY` |

## Payment & Security Conventions

- **Authentication:** this service does not issue tokens. The JWT issued by the Auth Service is validated in `middlewares/jwt-auth.js` (signature + expiration), using the key provided via environment variables. Expected payload:
```json
  {
    "sub": "userId",
    "role": "Fan | Organizer | VenueOwner",
    "iat": 0,
    "exp": 0
  }
```
- Role-based access control (RBAC) middleware (`middlewares/require-role.js`) must be used to protect role-specific routes rather than checking roles inline in controllers.
- **Money:** amounts are always stored and transported as **integers in the currency's minor unit** (e.g. cents) together with an ISO 4217 `currency` code. Never use `float` for money.
- **Idempotency:** every `POST` that creates a payment or refund must require an `Idempotency-Key` header, handled by `middlewares/idempotency.js` and persisted in the Payment Store.
- **Status transitions** (`PENDING → AUTHORIZED → CAPTURED`, `FAILED`, `REFUNDED`) must be centralized in `services/payment.service.js`, not duplicated across controllers. Invalid transitions must be rejected.
- **External provider:** all communication goes through the adapter in `src/providers/` (`payment-provider.js` defines the interface; each provider has its own implementation). No provider-specific types or statuses may leak outside that folder.
- Calls to the provider must have **timeouts** and **retries with backoff**, always reusing the same idempotency key.
- Provider callbacks/webhooks must **verify their signature** before changing a payment's status.
- **Never** store or log card data (PAN, CVV, expiration date): card capture is delegated to the provider (PCI DSS). Logs must not include secrets or sensitive personal data.
- **Never** hardcode API keys, webhook secrets, JWT keys or callback URLs — always read from environment variables (see `.env.example`).

## Testing

- Unit tests for services (`services/*.test.js`) — mock the database and the provider adapter.
- Integration tests for routes (`routes/*.test.js`) — use a test database or in-memory store.
- Minimum coverage threshold enforced in CI (e.g. 80%), especially on `payment.service.js` and the provider adapter.
- Explicitly test idempotency (same key → same result, no double charge) and invalid status transitions.
- Never commit real credentials, provider keys, or `.env` files — only `.env.example` with placeholder values. Use the provider's **sandbox** environment for tests.

## Docker Conventions

- Use a **multi-stage build**: one stage to install dependencies and build, one minimal stage (`node:20-alpine` or similar) to run.
- `.dockerignore` must exclude `node_modules`, `.env`, tests, and docs.
- The container must run as a **non-root user**.
- Expose only the necessary port (e.g. `3000`) and read it from an environment variable (`PORT`).
- Health check endpoint (`/health`) must be implemented and referenced in `HEALTHCHECK` in the Dockerfile.
- `docker-compose.yml` (for local development) should include the Payment service plus its database (Payment Store), with environment variables loaded from `.env`.

**Example minimal Dockerfile skeleton:**

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Run stage
FROM node:20-alpine
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder /app /app
USER appuser
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK CMD wget --spider -q http://localhost:3000/health || exit 1
CMD ["node", "src/app.js"]
```

## Linting & Formatting

- **ESLint** (Airbnb base or similar) + **Prettier**, enforced via a pre-commit hook (e.g. `husky` + `lint-staged`).
- CI must fail the build if lint errors are present.
