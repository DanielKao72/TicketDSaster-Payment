const { NotImplementedError, ensurePortImplementation } = require('../Port');

// Outbound port: persistence of the Payment aggregate.
// Adapters live in src/adapters/repositories/ and extend this class.
class PaymentRepository {
  constructor() {
    ensurePortImplementation(this, PaymentRepository);
  }

  // Inserts or updates the payment together with its new transactions (those without
  // an id), atomically; resolves to the persisted Payment (with ids and timestamps).
  async save(payment) {
    throw new NotImplementedError('PaymentRepository.save');
  }

  // Resolves to a Payment, or null if it does not exist.
  async findById(id) {
    throw new NotImplementedError('PaymentRepository.findById');
  }

  // Resolves to the most recent Payment of that Session, or null.
  async findBySessionId(sessionId) {
    throw new NotImplementedError('PaymentRepository.findBySessionId');
  }
}

module.exports = { PaymentRepository };
