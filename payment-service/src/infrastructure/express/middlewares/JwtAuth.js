const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { HttpError } = require('../HttpError');

const ROLES = ['Fan', 'Organizer', 'VenueOwner'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jwtAuth({ jwksUri, issuer, audience, secret }) {
  // Si no hay secret de pruebas, configuramos el cliente JWKS para producción
  let client;
  if (!secret) {
    client = jwksClient({ jwksUri, cache: true, rateLimit: true });
  }

  function getKey(header, callback) {
    if (secret) {
      return callback(null, secret); // Modo pruebas: llave simétrica
    }
    client.getSigningKey(header.kid, function (err, key) {
      if (err) return callback(err);
      callback(null, key.getPublicKey()); // Modo producción: llave pública
    });
  }

  return (req, res, next) => {
    const [scheme, token] = (req.get('Authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      next(new HttpError(401, 'UNAUTHORIZED', 'Missing bearer token'));
      return;
    }

    // En pruebas usamos HS256 sin validar issuer/audience; en prod RS256/ES256 estricto
    const verifyOptions = secret
      ? { algorithms: ['HS256'] }
      : { algorithms: ['RS256', 'ES256'], issuer, audience };

    jwt.verify(token, getKey, verifyOptions, (err, payload) => {
      if (err) {
        next(new HttpError(401, 'UNAUTHORIZED', 'Invalid or expired token'));
        return;
      }

      if (!UUID.test(String(payload.sub)) || !ROLES.includes(payload.role)) {
        next(new HttpError(401, 'UNAUTHORIZED', 'Invalid token claims'));
        return;
      }

      req.user = { id: payload.sub, role: payload.role };
      next();
    });
  };
}

module.exports = { jwtAuth, ROLES };
