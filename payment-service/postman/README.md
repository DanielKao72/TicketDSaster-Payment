# Pruebas con Postman: Payment Service

Suite de pruebas manuales y automatizables de los endpoints y casos de uso del Payment Service, con el proveedor externo simulado (`FakePaymentProvider`).

| Archivo                                  | Contenido                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `PaymentService.postman_collection.json` | La colección: 51 requests en 9 carpetas, con aserciones en cada una      |
| `Local.postman_environment.json`         | Environment local: `baseUrl`, `jwtSecret`, `fanUserId`, `otherFanUserId` |

## Cómo ejecutarla

1. Levanta el servicio (ver `AGENTS.md`):
   - **Con Postgres:** `docker compose up --build`. Se pueden correr todas las carpetas.
   - **En memoria:** `JWT_SECRET=dev-secret PAYMENT_STORE=memory npm start`. Omite la carpeta **08**, porque no hay seeds.
2. En Postman, **Import** → los dos archivos de esta carpeta → selecciona el environment **Payment Service · Local**.
3. Ajusta `jwtSecret` del environment para que sea **el mismo `JWT_SECRET` del servicio** (el de tu `.env` si usas Docker). Si no coincide, todo responde 401.
4. Ejecuta la colección completa **en orden** con el _Collection Runner_: las carpetas dependen de variables que guardan las anteriores (`paymentId`, `retryPaymentId`…).

Desde la terminal, con [newman](https://www.npmjs.com/package/newman):

```bash
# Desde payment-service/, con el servicio corriendo
npx newman run postman/PaymentService.postman_collection.json \
  -e postman/Local.postman_environment.json \
  --env-var jwtSecret=<tu JWT_SECRET>

# En modo memoria, excluye la carpeta 08 listando las demás con --folder "00 · Preparación" --folder ...
```

## Cómo funciona

- **Entradas en JSON.** Todos los bodies son `raw` con `Content-Type: application/json`. Capture y refund no llevan body: su entrada es el `paymentId` de la ruta.
- **Tokens automáticos.** El _pre-request script_ de la colección firma JWT HS256 con `jwtSecret` antes de cada request, como lo haría el Auth Service:

  | Variable           | Claims                                                                     |
  | ------------------ | -------------------------------------------------------------------------- |
  | `fanToken`         | `{ sub: fanUserId, role: "Fan" }`. Es el token por defecto de la colección |
  | `otherFanToken`    | `{ sub: otherFanUserId, role: "Fan" }`                                     |
  | `organizerToken`   | `{ sub: fanUserId, role: "Organizer" }`                                    |
  | `expiredToken`     | Token de `Fan` con `exp` en el pasado                                      |
  | `wrongSecretToken` | Token de `Fan` firmado con otro secreto                                    |
  | `malformedToken`   | `not-a-jwt`                                                                |

  `fanUserId` es el dueño de los pagos de `db/seeds`.

- **Datos únicos por corrida.** El _Health check_ (carpeta 00) genera un `runId` y un `sessionId` nuevo por escenario. Las `Idempotency-Key` se arman como `{{runId}}-<nombre>`, así que la suite se puede correr muchas veces sobre la misma base de datos.
- **Aserciones comunes.** Cada respuesta se valida como JSON. Las de pagos comprueban la forma del `Payment`, con `amount` entero en centavos.
- **Tokens de prueba del mock** (`paymentMethodToken`): cualquier valor se autoriza, `tok_decline` da 422 y `tok_provider_error` da 502.

## Casos de uso cubiertos

| Caso de uso             | Endpoint                                               | Carpetas               |
| ----------------------- | ------------------------------------------------------ | ---------------------- |
| `CreatePaymentUseCase`  | `POST /payments`                                       | 01, 02, 03, 04, 05, 07 |
| `GetPaymentUseCase`     | `GET /payments/:paymentId`, `GET /payments?sessionId=` | 01, 02, 06, 07, 08     |
| `CapturePaymentUseCase` | `POST /payments/:paymentId/capture`                    | 01, 02, 06             |
| `RefundPaymentUseCase`  | `POST /payments/:paymentId/refund`                     | 01, 03                 |

**Lo que no cubre Postman**, porque las peticiones van una tras otra: las peticiones **concurrentes** con la misma llave. Ese caso está en `tests/infrastructure/express/routes/PaymentRoutes.test.js` (`npm test`).

## Detalle de las pruebas

### 00 · Preparación

Comprueba que el servicio responde y genera los datos únicos de la corrida (runId y sessionIds). Debe ejecutarse primero.

| #   | Prueba       | Request       | Token | Entrada (JSON) | Resultado esperado                      |
| --- | ------------ | ------------- | ----- | -------------- | --------------------------------------- |
| 1   | Health check | `GET /health` | —     | —              | Responde 200<br>El servicio está arriba |

### 01 · Flujo feliz: crear → capturar → reembolsar

Caso de uso completo de Booking: autoriza el pago de una sesión, lo captura cuando se confirman los asientos y lo reembolsa. Incluye reintentos idempotentes.

| #   | Prueba                                  | Request                                                                                | Token    | Entrada (JSON)                                                                                      | Resultado esperado                                                                                                                                                                       |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | Crear pago (autorizar)                  | `POST /payments`<br>Idempotency-Key: `{{runId}}-happy-create`                          | fanToken | `{"sessionId":"{{sessionHappy}}","amount":150000,"currency":"MXN","paymentMethodToken":"tok_visa"}` | Responde 201<br>El cuerpo tiene la forma de un Payment<br>Status del pago = AUTHORIZED<br>userId viene del token (sub), no del body<br>Sin declineReason<br>No es una respuesta repetida |
| 3   | Reintento con la misma Idempotency-Key  | `POST /payments`<br>Idempotency-Key: `{{runId}}-happy-create`                          | fanToken | `{"sessionId":"{{sessionHappy}}","amount":150000,"currency":"MXN","paymentMethodToken":"tok_visa"}` | Responde 201<br>Es una respuesta repetida (Idempotent-Replayed: true)<br>Es el mismo pago (paymentId)                                                                                    |
| 4   | Reintento con los campos en otro orden  | `POST /payments`<br>Idempotency-Key: `{{runId}}-happy-create`                          | fanToken | `{"paymentMethodToken":"tok_visa","currency":"MXN","amount":150000,"sessionId":"{{sessionHappy}}"}` | Responde 201<br>Es una respuesta repetida (Idempotent-Replayed: true)<br>Es el mismo pago (paymentId)                                                                                    |
| 5   | Consultar pago por id                   | `GET /payments/{{paymentId}}`                                                          | fanToken | —                                                                                                   | Responde 200<br>El cuerpo tiene la forma de un Payment<br>Status del pago = AUTHORIZED<br>Es el mismo pago (paymentId)                                                                   |
| 6   | Consultar pago por sesión               | `GET /payments?sessionId={{sessionHappy}}`                                             | fanToken | —                                                                                                   | Responde 200<br>Es el mismo pago (paymentId)                                                                                                                                             |
| 7   | Capturar pago                           | `POST /payments/{{paymentId}}/capture`<br>Idempotency-Key: `{{runId}}-happy-capture`   | fanToken | —                                                                                                   | Responde 200<br>El cuerpo tiene la forma de un Payment<br>Status del pago = CAPTURED<br>Es el mismo pago (paymentId)                                                                     |
| 8   | Reintento de captura con la misma llave | `POST /payments/{{paymentId}}/capture`<br>Idempotency-Key: `{{runId}}-happy-capture`   | fanToken | —                                                                                                   | Responde 200<br>Es una respuesta repetida (Idempotent-Replayed: true)<br>Status del pago = CAPTURED                                                                                      |
| 9   | Capturar otra vez con otra llave        | `POST /payments/{{paymentId}}/capture`<br>Idempotency-Key: `{{runId}}-happy-capture-2` | fanToken | —                                                                                                   | Responde 409<br>Código de error INVALID_PAYMENT_TRANSITION                                                                                                                               |
| 10  | Reembolsar pago                         | `POST /payments/{{paymentId}}/refund`<br>Idempotency-Key: `{{runId}}-happy-refund`     | fanToken | —                                                                                                   | Responde 200<br>Status del pago = REFUNDED<br>Es el mismo pago (paymentId)                                                                                                               |
| 11  | Reembolsar otra vez con otra llave      | `POST /payments/{{paymentId}}/refund`<br>Idempotency-Key: `{{runId}}-happy-refund-2`   | fanToken | —                                                                                                   | Responde 409<br>Código de error INVALID_PAYMENT_TRANSITION                                                                                                                               |
| 12  | Consultar estado final                  | `GET /payments/{{paymentId}}`                                                          | fanToken | —                                                                                                   | Responde 200<br>Status del pago = REFUNDED                                                                                                                                               |

### 02 · Pago declinado y reintento

El proveedor declina el token tok_decline. Un rechazo no es un error del servicio: el pago queda FAILED (422) y la sesión puede volver a intentarlo.

| #   | Prueba                                                | Request                                                                                        | Token    | Entrada (JSON)                                                                                           | Resultado esperado                                                                                                  |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 13  | Crear pago con tarjeta declinada                      | `POST /payments`<br>Idempotency-Key: `{{runId}}-decline-create`                                | fanToken | `{"sessionId":"{{sessionDecline}}","amount":150000,"currency":"MXN","paymentMethodToken":"tok_decline"}` | Responde 422<br>El cuerpo tiene la forma de un Payment<br>Status del pago = FAILED<br>declineReason = card_declined |
| 14  | Reintento del rechazo con la misma llave              | `POST /payments`<br>Idempotency-Key: `{{runId}}-decline-create`                                | fanToken | `{"sessionId":"{{sessionDecline}}","amount":150000,"currency":"MXN","paymentMethodToken":"tok_decline"}` | Responde 422<br>Es una respuesta repetida (Idempotent-Replayed: true)<br>Es el mismo pago (declinedPaymentId)       |
| 15  | Capturar un pago FAILED                               | `POST /payments/{{declinedPaymentId}}/capture`<br>Idempotency-Key: `{{runId}}-decline-capture` | fanToken | —                                                                                                        | Responde 409<br>Código de error INVALID_PAYMENT_TRANSITION                                                          |
| 16  | Nuevo intento para la misma sesión con otra tarjeta   | `POST /payments`<br>Idempotency-Key: `{{runId}}-decline-retry`                                 | fanToken | `{"sessionId":"{{sessionDecline}}","amount":150000,"currency":"MXN","paymentMethodToken":"tok_visa"}`    | Responde 201<br>Status del pago = AUTHORIZED<br>Es un pago nuevo                                                    |
| 17  | Consultar por sesión devuelve el intento más reciente | `GET /payments?sessionId={{sessionDecline}}`                                                   | fanToken | —                                                                                                        | Responde 200<br>Es el mismo pago (retryPaymentId)<br>Status del pago = AUTHORIZED                                   |

### 03 · Reglas de negocio

Una sesión solo puede tener un pago activo y solo se reembolsa lo capturado.

| #   | Prueba                                       | Request                                                                                            | Token    | Entrada (JSON)                                                                                        | Resultado esperado                                         |
| --- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 18  | Segundo pago para una sesión con pago activo | `POST /payments`<br>Idempotency-Key: `{{runId}}-rules-duplicate`                                   | fanToken | `{"sessionId":"{{sessionDecline}}","amount":150000,"currency":"MXN","paymentMethodToken":"tok_visa"}` | Responde 409<br>Código de error PAYMENT_ALREADY_EXISTS     |
| 19  | Reembolsar un pago AUTHORIZED (sin capturar) | `POST /payments/{{retryPaymentId}}/refund`<br>Idempotency-Key: `{{runId}}-rules-refund-authorized` | fanToken | —                                                                                                     | Responde 409<br>Código de error INVALID_PAYMENT_TRANSITION |

### 04 · Idempotencia

Reglas del header Idempotency-Key en los POST.

| #   | Prueba                                   | Request                                                       | Token         | Entrada (JSON)                                                                                           | Resultado esperado                                       |
| --- | ---------------------------------------- | ------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 20  | Misma llave con otro body                | `POST /payments`<br>Idempotency-Key: `{{runId}}-happy-create` | fanToken      | `{"sessionId":"{{sessionHappy}}","amount":999,"currency":"MXN","paymentMethodToken":"tok_visa"}`         | Responde 409<br>Código de error IDEMPOTENCY_KEY_MISMATCH |
| 21  | Misma llave y body desde otro usuario    | `POST /payments`<br>Idempotency-Key: `{{runId}}-happy-create` | otherFanToken | `{"sessionId":"{{sessionHappy}}","amount":150000,"currency":"MXN","paymentMethodToken":"tok_visa"}`      | Responde 409<br>Código de error IDEMPOTENCY_KEY_MISMATCH |
| 22  | POST sin Idempotency-Key                 | `POST /payments`                                              | fanToken      | `{"sessionId":"{{sessionValidation}}","amount":150000,"currency":"MXN","paymentMethodToken":"tok_visa"}` | Responde 400<br>Código de error IDEMPOTENCY_KEY_REQUIRED |
| 23  | Idempotency-Key de más de 255 caracteres | `POST /payments`<br>Idempotency-Key: `{{longKey}}`            | fanToken      | `{"sessionId":"{{sessionValidation}}","amount":150000,"currency":"MXN","paymentMethodToken":"tok_visa"}` | Responde 400<br>Código de error IDEMPOTENCY_KEY_REQUIRED |

### 05 · Validación de entrada (400)

El body se valida con zod antes de llegar al caso de uso. Ningún caso crea un pago.

| #   | Prueba                               | Request                                                               | Token    | Entrada (JSON)                                                                                                                                       | Resultado esperado                                |
| --- | ------------------------------------ | --------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 24  | amount con decimales                 | `POST /payments`<br>Idempotency-Key: `{{runId}}-validation-0`         | fanToken | `{"sessionId":"{{sessionValidation}}","amount":10.5,"currency":"MXN","paymentMethodToken":"tok_visa"}`                                               | Responde 400<br>Código de error VALIDATION_ERROR  |
| 25  | amount en cero                       | `POST /payments`<br>Idempotency-Key: `{{runId}}-validation-1`         | fanToken | `{"sessionId":"{{sessionValidation}}","amount":0,"currency":"MXN","paymentMethodToken":"tok_visa"}`                                                  | Responde 400<br>Código de error VALIDATION_ERROR  |
| 26  | amount negativo                      | `POST /payments`<br>Idempotency-Key: `{{runId}}-validation-2`         | fanToken | `{"sessionId":"{{sessionValidation}}","amount":-100,"currency":"MXN","paymentMethodToken":"tok_visa"}`                                               | Responde 400<br>Código de error VALIDATION_ERROR  |
| 27  | amount como string                   | `POST /payments`<br>Idempotency-Key: `{{runId}}-validation-3`         | fanToken | `{"sessionId":"{{sessionValidation}}","amount":"150000","currency":"MXN","paymentMethodToken":"tok_visa"}`                                           | Responde 400<br>Código de error VALIDATION_ERROR  |
| 28  | currency en minúsculas               | `POST /payments`<br>Idempotency-Key: `{{runId}}-validation-4`         | fanToken | `{"sessionId":"{{sessionValidation}}","amount":150000,"currency":"mxn","paymentMethodToken":"tok_visa"}`                                             | Responde 400<br>Código de error VALIDATION_ERROR  |
| 29  | currency de 4 letras                 | `POST /payments`<br>Idempotency-Key: `{{runId}}-validation-5`         | fanToken | `{"sessionId":"{{sessionValidation}}","amount":150000,"currency":"MXNN","paymentMethodToken":"tok_visa"}`                                            | Responde 400<br>Código de error VALIDATION_ERROR  |
| 30  | sessionId que no es uuid             | `POST /payments`<br>Idempotency-Key: `{{runId}}-validation-6`         | fanToken | `{"sessionId":"not-a-uuid","amount":150000,"currency":"MXN","paymentMethodToken":"tok_visa"}`                                                        | Responde 400<br>Código de error VALIDATION_ERROR  |
| 31  | paymentMethodToken vacío             | `POST /payments`<br>Idempotency-Key: `{{runId}}-validation-7`         | fanToken | `{"sessionId":"{{sessionValidation}}","amount":150000,"currency":"MXN","paymentMethodToken":""}`                                                     | Responde 400<br>Código de error VALIDATION_ERROR  |
| 32  | Campo desconocido (datos de tarjeta) | `POST /payments`<br>Idempotency-Key: `{{runId}}-validation-8`         | fanToken | `{"sessionId":"{{sessionValidation}}","amount":150000,"currency":"MXN","paymentMethodToken":"tok_visa","cardNumber":"4242424242424242","cvv":"123"}` | Responde 400<br>Código de error VALIDATION_ERROR  |
| 33  | Faltan campos obligatorios           | `POST /payments`<br>Idempotency-Key: `{{runId}}-validation-missing`   | fanToken | `{"sessionId":"{{sessionValidation}}"}`                                                                                                              | Responde 400<br>Código de error VALIDATION_ERROR  |
| 34  | JSON malformado                      | `POST /payments`<br>Idempotency-Key: `{{runId}}-validation-malformed` | fanToken | `{ "sessionId": "{{sessionValidation}}", "amount": ` (malformado)                                                                                    | Responde 400                                      |
| 35  | paymentId que no es uuid             | `GET /payments/abc`                                                   | fanToken | —                                                                                                                                                    | Responde 400<br>Código de error VALIDATION_ERROR  |
| 36  | Consultar por sesión sin sessionId   | `GET /payments`                                                       | fanToken | —                                                                                                                                                    | Responde 400<br>Código de error VALIDATION_ERROR  |
| 37  | Ningún intento inválido creó un pago | `GET /payments?sessionId={{sessionValidation}}`                       | fanToken | —                                                                                                                                                    | Responde 404<br>Código de error PAYMENT_NOT_FOUND |

### 06 · Autenticación y autorización

JWT HS256 emitido por el Auth Service (aquí lo firma el pre-request de la colección). Solo el rol Fan opera pagos y solo sobre los suyos.

| #   | Prueba                              | Request                                                                                        | Token            | Entrada (JSON)                                                                                      | Resultado esperado                                    |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 38  | Sin token                           | `GET /payments/{{paymentId}}`                                                                  | —                | —                                                                                                   | Responde 401<br>Código de error UNAUTHORIZED          |
| 39  | Token malformado                    | `GET /payments/{{paymentId}}`                                                                  | malformedToken   | —                                                                                                   | Responde 401<br>Código de error UNAUTHORIZED          |
| 40  | Token firmado con otro secreto      | `GET /payments/{{paymentId}}`                                                                  | wrongSecretToken | —                                                                                                   | Responde 401<br>Código de error UNAUTHORIZED          |
| 41  | Token expirado                      | `GET /payments/{{paymentId}}`                                                                  | expiredToken     | —                                                                                                   | Responde 401<br>Código de error UNAUTHORIZED          |
| 42  | Rol Organizer intenta crear un pago | `POST /payments`<br>Idempotency-Key: `{{runId}}-auth-organizer`                                | organizerToken   | `{"sessionId":"{{sessionEmpty}}","amount":150000,"currency":"MXN","paymentMethodToken":"tok_visa"}` | Responde 403<br>Código de error FORBIDDEN             |
| 43  | Consultar el pago de otro usuario   | `GET /payments/{{paymentId}}`                                                                  | otherFanToken    | —                                                                                                   | Responde 403<br>Código de error PAYMENT_ACCESS_DENIED |
| 44  | Capturar el pago de otro usuario    | `POST /payments/{{retryPaymentId}}/capture`<br>Idempotency-Key: `{{runId}}-auth-other-capture` | otherFanToken    | —                                                                                                   | Responde 403<br>Código de error PAYMENT_ACCESS_DENIED |
| 45  | Pago inexistente                    | `GET /payments/bbbbbbbb-bbbb-4bbb-8bbb-000000000000`                                           | fanToken         | —                                                                                                   | Responde 404<br>Código de error PAYMENT_NOT_FOUND     |
| 46  | Sesión sin pagos                    | `GET /payments?sessionId={{sessionEmpty}}`                                                     | fanToken         | —                                                                                                   | Responde 404<br>Código de error PAYMENT_NOT_FOUND     |

### 07 · Proveedor caído (502)

tok_provider_error simula una caída del proveedor. El servicio reintenta con backoff, responde 502, no guarda nada y libera la llave para que Booking reintente.

| #   | Prueba                                            | Request                                                        | Token    | Entrada (JSON)                                                                                                 | Resultado esperado                                                  |
| --- | ------------------------------------------------- | -------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 47  | Crear pago con el proveedor caído                 | `POST /payments`<br>Idempotency-Key: `{{runId}}-outage-create` | fanToken | `{"sessionId":"{{sessionOutage}}","amount":150000,"currency":"MXN","paymentMethodToken":"tok_provider_error"}` | Responde 502<br>Código de error PROVIDER_UNAVAILABLE                |
| 48  | Reintento con la misma llave se vuelve a ejecutar | `POST /payments`<br>Idempotency-Key: `{{runId}}-outage-create` | fanToken | `{"sessionId":"{{sessionOutage}}","amount":150000,"currency":"MXN","paymentMethodToken":"tok_provider_error"}` | Responde 502<br>No es una respuesta repetida (se volvió a ejecutar) |
| 49  | No quedó ningún pago guardado                     | `GET /payments?sessionId={{sessionOutage}}`                    | fanToken | —                                                                                                              | Responde 404<br>Código de error PAYMENT_NOT_FOUND                   |

### 08 · Solo con Postgres y seeds

Lee los pagos de db/seeds (usuario fanUserId). Solo funciona con docker compose (PAYMENT_STORE=postgres); omite esta carpeta en modo memoria.

| #   | Prueba                         | Request                                              | Token    | Entrada (JSON) | Resultado esperado                                                        |
| --- | ------------------------------ | ---------------------------------------------------- | -------- | -------------- | ------------------------------------------------------------------------- |
| 50  | Pago seed CAPTURED             | `GET /payments/33333333-3333-4333-8333-333333333333` | fanToken | —              | Responde 200<br>Status del pago = CAPTURED                                |
| 51  | Pago seed FAILED con su motivo | `GET /payments/44444444-4444-4444-8444-444444444444` | fanToken | —              | Responde 200<br>Status del pago = FAILED<br>declineReason = card_declined |
