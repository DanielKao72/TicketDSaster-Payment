const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { HttpError } = require('../HttpError');

const ROLES = ['Fan', 'Organizer', 'VenueOwner'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Validates the JWT issued by the Auth Service using JWKS and checks iss/aud claims.
// Exposes its claims as req.user = { id, role }.
function jwtAuth({ jwksUri, issuer, audience }) {
  const client = jwksClient({
    jwksUri: jwksUri,
    cache: true,
    rateLimit: true,
  });

  function getKey(header, callback) {
    client.getSigningKey(header.kid, function (err, key) {
      if (err) {
        return callback(err);
      }
      const signingKey = key.getPublicKey();
      callback(null, signingKey);
    });
  }

  return (req, res, next) => {
    const [scheme, token] = (req.get('Authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      next(new HttpError(401, 'UNAUTHORIZED', 'Missing bearer token'));
      return;
    }

    // jwt.verify is asynchronous when using the getKey callback
    jwt.verify(
      token,
      getKey,
      {
        algorithms: ['RS256', 'ES256'],
        issuer: issuer,
        audience: audience,
      },
      (err, payload) => {
        if (err) {
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
      },
    );
  };
}

module.exports = { jwtAuth, ROLES };
