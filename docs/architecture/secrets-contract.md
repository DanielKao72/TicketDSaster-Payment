# Contrato de Secretos del Payment Service (Issue #159 / Ref: 4.3)

Este documento define el contrato técnico y la especificación de secretos para el **Payment Service** en coordinación con el issue `#159` (gestión de secretos de la plataforma Ticket D-Saster).

---

## 1. Objetivo
Evitar almacenar credenciales críticas de pago, bases de datos y autenticación en archivos planos `.env` dentro de entornos de producción o imágenes de contenedores, delegando su aprovisionamiento al gestor de secretos de la plataforma (ej. HashiCorp Vault, AWS Secrets Manager, Kubernetes/Docker Secrets).

---

## 2. Modos de Aprovisionamiento (`SECRETS_PROVIDER`)

El servicio implementa el componente `SecretsManager` (`src/infrastructure/secrets/SecretsManager.js`), el cual soporta tres proveedores:

| Proveedor (`SECRETS_PROVIDER`) | Uso recomendado | Descripción |
|---|---|---|
| `env` (default) | Desarrollo local / CI (`npm test`) | Carga directamente de las variables de entorno de la máquina / proceso. |
| `file` | Staging / Producción contenerizada | Lee secretos inyectados en disco por el orquestador (ej. Kubernetes Secret volume montado en `/run/secrets` o archivo JSON en `SECRETS_FILE`). |
| `cloud` | Producción nativa en nube | Conexión remota al SDK del Secret Manager elegido en el ticket `#159`. |

---

## 3. Esquema de Secretos Requeridos

Cuando el Secret Manager o el archivo JSON monte los secretos, debe seguir el siguiente esquema de claves:

```json
{
  "DATABASE_URL": "postgres://payment_user:secure_password@postgres-host:5432/payment_store",
  "STRIPE_SECRET_KEY": "sk_test_51Mz...",
  "STRIPE_WEBHOOK_SECRET": "whsec_...",
  "JWKS_URI": "https://auth.ticketdsaster.com/.well-known/jwks.json",
  "JWT_ISSUER": "ticketdsaster-auth",
  "JWT_AUDIENCE": "ticketdsaster-payment",
  "JWT_SECRET": "only-needed-for-dev-or-local-hs256"
}
```

### Detalle de campos:
1. **`DATABASE_URL`**: Cadena de conexión PostgreSQL (requerida cuando `PAYMENT_STORE=postgres`).
2. **`STRIPE_SECRET_KEY`**: Llave privada de Stripe (requerida cuando `PAYMENT_PROVIDER=stripe`).
3. **`STRIPE_WEBHOOK_SECRET`**: Secreto de firma de webhooks de Stripe (usado para verificar eventos de cobro asíncronos).
4. **`JWKS_URI`**: Endpoint público de llaves del servicio Auth (requerido en producción para RS256/ES256).
5. **`JWT_ISSUER`**: Emisor esperado de los tokens (`iss`).
6. **`JWT_AUDIENCE`**: Audiencia esperada de los tokens (`aud`).

---

## 4. Validación Temprana (Fail-Fast)
Si el proveedor está configurado como `PAYMENT_PROVIDER=stripe` y no se proporciona `STRIPE_SECRET_KEY` (sea por Secret Manager o variables de entorno), el servicio fallará inmediatamente al arrancar con un mensaje descriptivo:
```text
FATAL: STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe.
```
Esto previene que el servicio empiece a aceptar solicitudes que inevitablemente fallarían al procesar pagos.
