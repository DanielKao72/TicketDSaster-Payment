// Express 4 does not catch rejected promises: forward them to the error handler.
function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { asyncHandler };
