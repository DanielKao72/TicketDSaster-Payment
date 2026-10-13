const { HttpError } = require('../HttpError');

// Must run after jwtAuth.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      next(new HttpError(403, 'FORBIDDEN', `Requires role: ${roles.join(' or ')}`));
      return;
    }
    next();
  };
}

module.exports = { requireRole };
