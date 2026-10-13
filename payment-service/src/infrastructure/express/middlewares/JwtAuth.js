const jwt = require('jsonwebtoken');
const { HttpError } = require('../HttpError');

const ROLES = ['Fan', 'Organizer', 'VenueOwner'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Validates the JWT issued by the Auth Service (this service never issues tokens) and
// exposes its claims as req.user = { id, role }.
function jwtAuth(secret) {
  return (req, res, next) => {
    const [scheme, token] = (req.get('Authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      next(new HttpError(401, 'UNAUTHORIZED', 'Missing bearer token'));
      return;
    }

    let payload;
    try {
      payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    } catch {
      next(new HttpError(401, 'UNAUTHORIZED', 'Invalid or expired token'));
      return;
    }

    // payments.user_id is a uuid, so sub must be one.
    if (!UUID.test(String(payload.sub)) || !ROLES.includes(payload.role)) {
      next(new HttpError(401, 'UNAUTHORIZED', 'Invalid token claims'));
      return;
    }

    req.user = { id: payload.sub, role: payload.role };
    next();
  };
}

module.exports = { jwtAuth, ROLES };
