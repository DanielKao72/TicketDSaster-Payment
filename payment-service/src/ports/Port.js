class NotImplementedError extends Error {
  constructor(method) {
    super(`${method} is not implemented`);
    this.name = 'NotImplementedError';
  }
}

/**
 * Called from each port's constructor. It rejects instantiating the port itself and
 * checks that the adapter overrides every port method, so an incomplete adapter fails
 * when it is created (at startup or in tests), not in the middle of a payment.
 */
function ensurePortImplementation(instance, PortClass) {
  const Adapter = instance.constructor;
  if (Adapter === PortClass) {
    throw new TypeError(`${PortClass.name} is abstract and cannot be instantiated`);
  }

  const missing = Object.getOwnPropertyNames(PortClass.prototype)
    .filter((name) => name !== 'constructor')
    .filter((name) => instance[name] === PortClass.prototype[name]);

  if (missing.length > 0) {
    throw new TypeError(`${Adapter.name} must implement ${PortClass.name}: ${missing.join(', ')}`);
  }
}

module.exports = { NotImplementedError, ensurePortImplementation };
