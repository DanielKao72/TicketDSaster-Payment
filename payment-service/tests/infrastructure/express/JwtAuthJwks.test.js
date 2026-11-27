const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { jwtAuth } = require('../../../src/infrastructure/express/middlewares/JwtAuth');

const ISSUER = 'urn:ticket-dsaster:auth';
const AUDIENCE = 'urn:ticket-dsaster:payments';
const FAN_ID = '00000000-0000-4000-8000-000000000001';

let jwksServer;
let jwksUri;
let privateKey;
let publicKey;
let otherPrivateKey;

function generateRsaKeyPair() {
  return crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
}

before(async () => {
  const keyPair = generateRsaKeyPair();
  publicKey = keyPair.publicKey;
  privateKey = keyPair.privateKey;

  const otherKeyPair = generateRsaKeyPair();
  otherPrivateKey = otherKeyPair.privateKey;

  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'auth-key-1',
    use: 'sig',
    alg: 'RS256',
  };

  jwksServer = http.createServer((req, res) => {
    if (req.url === '/.well-known/jwks.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  jwksUri = `http://127.0.0.1:${jwksServer.address().port}/.well-known/jwks.json`;
});

after(() => {
  jwksServer?.close();
});

function createMiddleware(options = {}) {
  return jwtAuth({
    jwksUri,
    issuer: ISSUER,
    audience: AUDIENCE,
    ...options,
  });
}

function runMiddleware(middleware, authHeader) {
  return new Promise((resolve) => {
    const req = {
      get: (header) => (header.toLowerCase() === 'authorization' ? authHeader : undefined),
    };
    const res = {};
    middleware(req, res, (err) => {
      resolve({ err, req });
    });
  });
}

test('JWKS auth: accepts a valid RS256 token matching JWKS key and claims', async () => {
  const middleware = createMiddleware();
  const token = jwt.sign({ sub: FAN_ID, role: 'Fan' }, privateKey, {
    algorithm: 'RS256',
    keyid: 'auth-key-1',
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  const { err, req } = await runMiddleware(middleware, `Bearer ${token}`);

  assert.strictEqual(err, undefined);
  assert.deepStrictEqual(req.user, { id: FAN_ID, role: 'Fan' });
});

test('JWKS auth: rejects token with invalid issuer with 401', async () => {
  const middleware = createMiddleware();
  const token = jwt.sign({ sub: FAN_ID, role: 'Fan' }, privateKey, {
    algorithm: 'RS256',
    keyid: 'auth-key-1',
    issuer: 'urn:untrusted:auth',
    audience: AUDIENCE,
  });

  const { err } = await runMiddleware(middleware, `Bearer ${token}`);

  assert.ok(err);
  assert.strictEqual(err.status, 401);
  assert.strictEqual(err.code, 'UNAUTHORIZED');
});

test('JWKS auth: rejects token with invalid audience with 401', async () => {
  const middleware = createMiddleware();
  const token = jwt.sign({ sub: FAN_ID, role: 'Fan' }, privateKey, {
    algorithm: 'RS256',
    keyid: 'auth-key-1',
    issuer: ISSUER,
    audience: 'urn:untrusted:payments',
  });

  const { err } = await runMiddleware(middleware, `Bearer ${token}`);

  assert.ok(err);
  assert.strictEqual(err.status, 401);
  assert.strictEqual(err.code, 'UNAUTHORIZED');
});

test('JWKS auth: rejects token signed with an unknown key not in JWKS with 401', async () => {
  const middleware = createMiddleware();
  const token = jwt.sign({ sub: FAN_ID, role: 'Fan' }, otherPrivateKey, {
    algorithm: 'RS256',
    keyid: 'unknown-key-99',
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  const { err } = await runMiddleware(middleware, `Bearer ${token}`);

  assert.ok(err);
  assert.strictEqual(err.status, 401);
  assert.strictEqual(err.code, 'UNAUTHORIZED');
});

test('JWKS auth: rejects symmetric HS256 token to prevent algorithm confusion attack', async () => {
  const middleware = createMiddleware();
  const token = jwt.sign({ sub: FAN_ID, role: 'Fan' }, 'shared-secret', {
    algorithm: 'HS256',
    keyid: 'auth-key-1',
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  const { err } = await runMiddleware(middleware, `Bearer ${token}`);

  assert.ok(err);
  assert.strictEqual(err.status, 401);
  assert.strictEqual(err.code, 'UNAUTHORIZED');
});

test('JWKS auth: rejects token with invalid sub UUID or unsupported role with 401', async () => {
  const middleware = createMiddleware();

  const invalidSubToken = jwt.sign({ sub: 'not-a-uuid', role: 'Fan' }, privateKey, {
    algorithm: 'RS256',
    keyid: 'auth-key-1',
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  const { err: subErr } = await runMiddleware(middleware, `Bearer ${invalidSubToken}`);
  assert.ok(subErr);
  assert.strictEqual(subErr.status, 401);

  const invalidRoleToken = jwt.sign({ sub: FAN_ID, role: 'SuperUser' }, privateKey, {
    algorithm: 'RS256',
    keyid: 'auth-key-1',
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  const { err: roleErr } = await runMiddleware(middleware, `Bearer ${invalidRoleToken}`);
  assert.ok(roleErr);
  assert.strictEqual(roleErr.status, 401);
});

test('JWKS auth: rejects with 401 when JWKS endpoint cannot be reached', async () => {
  const unreachableMiddleware = jwtAuth({
    jwksUri: 'http://127.0.0.1:1/unreachable/.well-known/jwks.json',
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  const token = jwt.sign({ sub: FAN_ID, role: 'Fan' }, privateKey, {
    algorithm: 'RS256',
    keyid: 'auth-key-1',
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  const { err } = await runMiddleware(unreachableMiddleware, `Bearer ${token}`);

  assert.ok(err);
  assert.strictEqual(err.status, 401);
  assert.strictEqual(err.code, 'UNAUTHORIZED');
});
