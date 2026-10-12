# Domain-Driven Design — Payments

![DDD Context Domains](/docs/ddd/DDD%20-%20Context%20Domains.png)

## Location in the domain map

| Attribute | Value |
|---|---|
| Subdomain | `Payments` |
| Classification | **Support** |
| Responsibility | Processing of payments for ticket purchases |
| Subdomain entities | `Payment`, `Tickets`, `Session` |

## Ubiquitous Language of the context

| Term | Meaning within this Bounded Context |
|---|---|
| **Payment** | The charge associated with a ticket purchase; the aggregate root of this context |
| **Payment Request** | The request sent to the external provider to collect the amount of a Payment |
| **Transaction** | Each individual operation against the provider for a Payment (charge, capture, refund) |
| **Payment Status** | Lifecycle of a Payment: `PENDING`, `AUTHORIZED`, `CAPTURED`, `FAILED`, `REFUNDED` |
| **Refund** | Partial or total return of a captured Payment |
| **Session** | The purchase/seat-hold session from the Sales domain that originated the Payment; referenced only by its id (not to be confused with the authentication "Session" in Auth) |
| **Tickets** | The tickets being paid for; referenced by id, owned by Sales/Event Management |
| **Payment Provider** | The external system that actually moves the money |
| **Idempotency Key** | Unique key per Payment Request that guarantees a purchase is never charged twice |

## Relationship with other Bounded Contexts

```text
Sales ──(HTTP: payment request)──> Payments
Auth/UserManagement ──(JWT)──> Payments
Payments ──(ACL)──> External Payment Provider
```


- **Sales → Payments (Customer/Supplier):** Sales is the customer; it requests a payment for a Session and its Tickets and only depends on the Payment contract (amount, status, result). It does not need to know which provider is used or how.
- **Auth → Payments (Shared Kernel via JWT):** as in the rest of the contexts, Payments only trusts the signature of the token issued by Auth to identify the user making the purchase.
- **Payments → External Payment Provider (Anti-Corruption Layer):** the provider's model (its statuses, errors and payloads) is translated at the boundary into this context's language. This prevents Payments from becoming a **Conformist** to the provider and allows replacing it without affecting Sales.
