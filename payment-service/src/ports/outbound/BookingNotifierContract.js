// PROVISIONAL: pendiente de confirmar con Booking (reunión 7 nov).
// Este es el ÚNICO lugar donde se define el contrato de notificación hacia Booking.
// Cambiar aquí afecta a HttpBookingNotifier, los use cases y los tests.

// Ruta del endpoint de Booking que recibe las notificaciones.
const BOOKING_NOTIFY_PATH = '/internal/payments/result';

// Método HTTP del endpoint.
const BOOKING_NOTIFY_METHOD = 'POST';

// Estados de pago que se notifican a Booking.
// Según la reunión del 7 nov, Booking cuenta los intentos con tarjeta rechazada,
// por lo que sólo se notifican los pagos que terminan en FAILED.
// Ampliar esta lista para incluir CAPTURED u otros estados cuando Booking lo confirme.
const NOTIFY_STATUSES = ['FAILED'];

// Construye el payload que se envía a Booking para un payment dado.
// payment: instancia de Payment (aggregate).
function buildNotifyPayload(payment) {
  return {
    paymentId: payment.id,
    providerReference: payment.chargeReference ?? null,
    status: payment.status,
    declineReason: payment.declineReason ?? null,
    occurredAt: new Date().toISOString(),
  };
}

module.exports = {
  BOOKING_NOTIFY_PATH,
  BOOKING_NOTIFY_METHOD,
  NOTIFY_STATUSES,
  buildNotifyPayload,
};
