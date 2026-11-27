const { NotImplementedError, ensurePortImplementation } = require('../Port');

// Outbound port: persistence of the Payment aggregate.
// Adapters live in src/adapters/repositories/ and extend this class.
class PaymentRepository {
  constructor() {
    ensurePortImplementation(this, PaymentRepository);
  }

  // Inserts or updates the payment together with its new transactions (those without
  // an id), atomically; resolves to the persisted Payment (with ids and timestamps).
  // A Session has at most one active (not FAILED) payment: saving a second one rejects
  // with PaymentAlreadyExistsError, atomically, even under concurrent saves.
  async save(payment) {
    throw new NotImplementedError('PaymentRepository.save');
  }

  // Deletes a PENDING payment that has no transactions yet, releasing its Session (the
  // reservation of a payment whose provider call failed). Resolves to true if it was
  // deleted, false if the payment no longer qualifies.
  async discardPending(payment) {
    throw new NotImplementedError('PaymentRepository.discardPending');
  }

  // Resolves to a Payment, or null if it does not exist.
  async findById(id) {
    throw new NotImplementedError('PaymentRepository.findById');
  }

  // Resolves to the most recent Payment of that Session, or null.
  async findBySessionId(sessionId) {
    throw new NotImplementedError('PaymentRepository.findBySessionId');
  }

  // Resolves to the Payment that owns a Transaction with that provider reference
  // (the one the provider sends back in its webhooks), or null.
  async findByProviderReference(providerReference) {
    throw new NotImplementedError('PaymentRepository.findByProviderReference');
  }
}

module.exports = { PaymentRepository };
