// Signs a development JWT with JWT_SECRET, like the Auth Service would, so the
// Booking team (or curl) can call the service locally. Never use it in production.
//
//   npm run token -- --sub <uuid> --role Fan --expires-in 1h
const { parseArgs } = require('node:util');
const jwt = require('jsonwebtoken');
const config = require('../src/infrastructure/config');
const { ROLES } = require('../src/infrastructure/express/middlewares/JwtAuth');

// The user that owns the payments in db/seeds.
const SEED_USER_ID = '00000000-0000-4000-8000-000000000001';

const { values } = parseArgs({
  options: {
    sub: { type: 'string', default: SEED_USER_ID },
    role: { type: 'string', default: 'Fan' },
    'expires-in': { type: 'string', default: '1h' },
  },
});

if (!config.jwt.secret) {
  console.error('JWT_SECRET is not set (see .env.example)');
  process.exit(1);
}
if (!ROLES.includes(values.role)) {
  console.error(`--role must be one of: ${ROLES.join(', ')}`);
  process.exit(1);
}

console.log(
  jwt.sign({ sub: values.sub, role: values.role }, config.jwt.secret, {
    algorithm: 'HS256',
    expiresIn: values['expires-in'],
  }),
);
