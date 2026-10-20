/**
 * @fileoverview Tests for JWT utilities.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { createJwks, type JwtAlgorithm, jwtSign, jwtVerify } from './jwt.js';

describe('JWT Utilities', () => {
  const secret = 'test-secret-key';

  describe('jwtSign', () => {
    it('should create a valid JWT with 3 parts', async () => {
      const token = await jwtSign({ uid: 'user-123' }, secret);

      const parts = token.split('.');
      assert.strictEqual(parts.length, 3);
    });

    it('should set expiration with expiresIn string', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await jwtSign({ uid: 'user-123' }, secret, { expiresIn: '1h' });

      const payloadB64 = token.split('.')[1];
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

      assert.ok(payload.exp);
      assert.ok(payload.iat);
      assert.ok(payload.exp >= now + 3600 - 5);
      assert.ok(payload.exp <= now + 3600 + 5);
    });

    it('should set expiration with expiresIn number (seconds)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await jwtSign({ uid: 'user-123' }, secret, { expiresIn: 300 });

      const payloadB64 = token.split('.')[1];
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

      assert.ok(payload.exp >= now + 300 - 5);
      assert.ok(payload.exp <= now + 300 + 5);
    });

    it('should set notBefore claim', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await jwtSign({ uid: 'user-123' }, secret, { notBefore: '5m' });

      const payloadB64 = token.split('.')[1];
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

      assert.ok(payload.nbf);
      assert.ok(payload.nbf >= now + 300 - 5);
      assert.ok(payload.nbf <= now + 300 + 5);
    });

    it('should set issuer claim', async () => {
      const token = await jwtSign({ uid: 'user-123' }, secret, { issuer: 'my-app' });

      const payloadB64 = token.split('.')[1];
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

      assert.strictEqual(payload.iss, 'my-app');
    });

    it('should set audience claim', async () => {
      const token = await jwtSign({ uid: 'user-123' }, secret, { audience: 'my-api' });

      const payloadB64 = token.split('.')[1];
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

      assert.strictEqual(payload.aud, 'my-api');
    });

    it('should set subject claim', async () => {
      const token = await jwtSign({ uid: 'user-123' }, secret, { subject: 'user-123' });

      const payloadB64 = token.split('.')[1];
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

      assert.strictEqual(payload.sub, 'user-123');
    });

    it('should support multiple duration formats', async () => {
      const now = Math.floor(Date.now() / 1000);

      // Test seconds.
      let token = await jwtSign({}, secret, { expiresIn: '60s' });
      let payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      assert.ok(Math.abs(payload.exp - (now + 60)) <= 5);

      // Test minutes.
      token = await jwtSign({}, secret, { expiresIn: '30m' });
      payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      assert.ok(Math.abs(payload.exp - (now + 1800)) <= 5);

      // Test days.
      token = await jwtSign({}, secret, { expiresIn: '7d' });
      payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      assert.ok(Math.abs(payload.exp - (now + 7 * 24 * 3600)) <= 5);

      // Test weeks.
      token = await jwtSign({}, secret, { expiresIn: '2w' });
      payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      assert.ok(Math.abs(payload.exp - (now + 14 * 24 * 3600)) <= 5);
    });

    it('should throw on invalid duration format', async () => {
      await assert.rejects(
        () => jwtSign({}, secret, { expiresIn: 'invalid' }),
        /Invalid duration format/,
      );
    });

    it('should preserve custom payload claims', async () => {
      const token = await jwtSign(
        { uid: 'user-123', role: 'admin', custom: { nested: true } },
        secret,
      );

      const payloadB64 = token.split('.')[1];
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

      assert.strictEqual(payload.uid, 'user-123');
      assert.strictEqual(payload.role, 'admin');
      assert.deepStrictEqual(payload.custom, { nested: true });
    });

    it('should use custom issuedAt timestamp', async () => {
      const customTime = 1700000000;
      const token = await jwtSign({}, secret, { issuedAt: customTime, expiresIn: '1h' });

      const payloadB64 = token.split('.')[1];
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

      assert.strictEqual(payload.iat, customTime);
      assert.strictEqual(payload.exp, customTime + 3600);
    });

    it('should accept Date object for issuedAt', async () => {
      const customDate = new Date('2024-01-01T00:00:00Z');
      const expectedTimestamp = Math.floor(customDate.getTime() / 1000);
      const token = await jwtSign({}, secret, { issuedAt: customDate });

      const payloadB64 = token.split('.')[1];
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

      assert.strictEqual(payload.iat, expectedTimestamp);
    });

    it('should work with ArrayBuffer secret', async () => {
      const encoder = new TextEncoder();
      const secretBuffer = encoder.encode('array-buffer-secret').buffer;

      const token = await jwtSign({ uid: 'user-123' }, secretBuffer);

      const parts = token.split('.');
      assert.strictEqual(parts.length, 3);
    });

    it('should support HS384 algorithm', async () => {
      const token = await jwtSign({ uid: 'user-123' }, secret, { algorithm: 'HS384' });

      const headerB64 = token.split('.')[0];
      const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
      assert.strictEqual(header.alg, 'HS384');
    });

    it('should support HS512 algorithm', async () => {
      const token = await jwtSign({ uid: 'user-123' }, secret, { algorithm: 'HS512' });

      const headerB64 = token.split('.')[0];
      const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
      assert.strictEqual(header.alg, 'HS512');
    });
  });

  describe('jwtVerify', () => {
    it('should verify a valid token and return payload', async () => {
      const token = await jwtSign({ uid: 'user-123', role: 'admin' }, secret, { expiresIn: '1h' });

      const payload = await jwtVerify(token, secret);

      assert.strictEqual(payload.uid, 'user-123');
      assert.strictEqual(payload.role, 'admin');
      assert.ok(payload.iat);
      assert.ok(payload.exp);
    });

    it('should throw on invalid token format', async () => {
      await assert.rejects(
        () => jwtVerify('not.a.valid.token.format', secret),
        /Invalid JWT format/,
      );
    });

    it('should throw on invalid signature', async () => {
      const token = await jwtSign({ uid: 'user-123' }, secret);

      await assert.rejects(() => jwtVerify(token, 'wrong-secret'), /Invalid signature/);
    });

    it('should throw on expired token', async () => {
      const token = await jwtSign({ uid: 'user-123' }, secret, {
        issuedAt: Math.floor(Date.now() / 1000) - 7200,
        expiresIn: '1h',
      });

      await assert.rejects(() => jwtVerify(token, secret), /Token expired/);
    });

    it('should throw on token not yet valid', async () => {
      const token = await jwtSign({ uid: 'user-123' }, secret, {
        notBefore: '1h',
        expiresIn: '2h',
      });

      await assert.rejects(() => jwtVerify(token, secret), /Token not yet valid/);
    });

    it('should verify with specific algorithm', async () => {
      const token = await jwtSign({ uid: 'user-123' }, secret, { algorithm: 'HS384' });

      const payload = await jwtVerify(token, secret, { algorithms: ['HS384'] });

      assert.strictEqual(payload.uid, 'user-123');
    });

    it('should reject when algorithm not in allowed list', async () => {
      const token = await jwtSign({ uid: 'user-123' }, secret, { algorithm: 'HS512' });

      await assert.rejects(
        () => jwtVerify(token, secret, { algorithms: ['HS256'] }),
        /Unsupported algorithm/,
      );
    });

    it('should work with ArrayBuffer secret', async () => {
      const encoder = new TextEncoder();
      const secretBuffer = encoder.encode('buffer-secret').buffer;

      const token = await jwtSign({ uid: 'user-123' }, secretBuffer);
      const payload = await jwtVerify(token, secretBuffer);

      assert.strictEqual(payload.uid, 'user-123');
    });
  });

  describe('jwtSign + jwtVerify roundtrip', () => {
    it('should produce tokens that can be verified', async () => {
      const token = await jwtSign({ uid: 'user-123', email: 'test@example.com' }, secret, {
        expiresIn: '1h',
        issuer: 'test-app',
      });

      const payload = await jwtVerify(token, secret);

      assert.strictEqual(payload.uid, 'user-123');
      assert.strictEqual(payload.email, 'test@example.com');
      assert.strictEqual(payload.iss, 'test-app');
    });

    it('should reject HS512 token when only HS256 is allowed', async () => {
      const token = await jwtSign({ uid: 'user-123' }, secret, { algorithm: 'HS512' });

      await assert.rejects(
        () => jwtVerify(token, secret, { algorithms: ['HS256'] }),
        /Unsupported algorithm/,
      );
    });
  });
});

describe('Asymmetric JWT', () => {
  const b64url = (data: string | Uint8Array) =>
    btoa(String.fromCharCode(...(typeof data === 'string' ? new TextEncoder().encode(data) : data)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  const rsa = (name: string) =>
    crypto.subtle.generateKey(
      { name, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    ) as Promise<CryptoKeyPair>;
  const ec = () =>
    crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]) as Promise<CryptoKeyPair>;

  async function jwk(pair: CryptoKeyPair, kid: string, alg?: string) {
    const key = await crypto.subtle.exportKey('jwk', pair.publicKey);
    return { ...key, kid, use: 'sig', ...(alg && { alg }) };
  }

  // Replaces global fetch with a JWKS endpoint serving `keys`, recording each call.
  function serveJwks(keys: () => object[]) {
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json({ keys: keys() });
    }) as typeof fetch;
    return { calls, restore: () => (globalThis.fetch = original) };
  }

  describe('with CryptoKey', () => {
    it('should sign and verify RS256', async () => {
      const pair = await rsa('RSASSA-PKCS1-v1_5');
      const token = await jwtSign({ uid: 'u1' }, pair.privateKey, { algorithm: 'RS256' });
      const payload = await jwtVerify(token, pair.publicKey, { algorithms: ['RS256'] });
      assert.strictEqual(payload.uid, 'u1');
    });

    it('should sign and verify PS256', async () => {
      const pair = await rsa('RSA-PSS');
      const token = await jwtSign({ uid: 'u1' }, pair.privateKey, { algorithm: 'PS256' });
      const payload = await jwtVerify(token, pair.publicKey, { algorithms: ['PS256'] });
      assert.strictEqual(payload.uid, 'u1');
    });

    it('should sign and verify ES256', async () => {
      const pair = await ec();
      const token = await jwtSign({ uid: 'u1' }, pair.privateKey, { algorithm: 'ES256' });
      const payload = await jwtVerify(token, pair.publicKey, { algorithms: ['ES256'] });
      assert.strictEqual(payload.uid, 'u1');
    });

    it('should default to RS256 for public keys', async () => {
      const pair = await rsa('RSASSA-PKCS1-v1_5');
      const token = await jwtSign({ uid: 'u1' }, pair.privateKey, { algorithm: 'RS256' });
      assert.strictEqual((await jwtVerify(token, pair.publicKey)).uid, 'u1');
    });

    it('should reject a signature from another key', async () => {
      const [a, b] = await Promise.all([ec(), ec()]);
      const token = await jwtSign({ uid: 'u1' }, a.privateKey, { algorithm: 'ES256' });
      await assert.rejects(
        () => jwtVerify(token, b.publicKey, { algorithms: ['ES256'] }),
        /Invalid signature/,
      );
    });

    it('should reject a key that does not match the algorithm', async () => {
      const pair = await ec();
      const token = await jwtSign({ uid: 'u1' }, pair.privateKey, { algorithm: 'ES256' });
      await assert.rejects(
        () => jwtVerify(token, pair.publicKey, { algorithms: ['RS256', 'ES384'] }),
        /Unsupported algorithm|Key does not match/,
      );
      const rs = await rsa('RSASSA-PKCS1-v1_5');
      await assert.rejects(
        () => jwtVerify(token, rs.publicKey, { algorithms: ['ES256'] }),
        /Key does not match/,
      );
    });

    it('should reject asymmetric algorithms with a string secret', async () => {
      const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const token = `${header}.${b64url('{}')}.${b64url('sig')}`;
      await assert.rejects(
        () => jwtVerify(token, 'secret', { algorithms: ['RS256'] }),
        /Key does not match/,
      );
    });

    it('should reject segments that are not JSON objects', async () => {
      const token = `${b64url('null')}.${b64url('{}')}.${b64url('sig')}`;
      await assert.rejects(() => jwtVerify(token, 'secret'), /Invalid JWT format/);
    });

    it('should reject alg none', async () => {
      const pair = await rsa('RSASSA-PKCS1-v1_5');
      const token = `${b64url('{"alg":"none"}')}.${b64url('{"uid":"u1"}')}.`;
      await assert.rejects(
        () => jwtVerify(token, pair.publicKey, { algorithms: ['RS256'] }),
        /Unsupported algorithm/,
      );
    });
  });

  describe('claims', () => {
    const secret = 'claims-secret';

    it('should accept a matching issuer and audience', async () => {
      const token = await jwtSign({}, secret, { issuer: 'https://idp', audience: ['a', 'b'] });
      const payload = await jwtVerify(token, secret, { issuer: 'https://idp', audience: 'b' });
      assert.strictEqual(payload.iss, 'https://idp');
    });

    it('should reject a wrong issuer', async () => {
      const token = await jwtSign({}, secret, { issuer: 'https://evil' });
      await assert.rejects(
        () => jwtVerify(token, secret, { issuer: 'https://idp' }),
        /Invalid issuer/,
      );
    });

    it('should reject a missing or wrong audience', async () => {
      const wrong = await jwtSign({}, secret, { audience: 'other' });
      await assert.rejects(() => jwtVerify(wrong, secret, { audience: 'api' }), /Invalid audience/);
      const missing = await jwtSign({}, secret);
      await assert.rejects(
        () => jwtVerify(missing, secret, { audience: ['api', 'web'] }),
        /Invalid audience/,
      );
    });

    it('should check claims only after the signature', async () => {
      const token = await jwtSign({}, 'other', { issuer: 'https://evil' });
      await assert.rejects(
        () => jwtVerify(token, secret, { issuer: 'https://idp' }),
        /Invalid signature/,
      );
    });
  });

  describe('createJwks', () => {
    const url = 'https://idp.example.com/.well-known/jwks.json';

    it('should verify RS256 and ES256 tokens by kid', async () => {
      const [rs, es] = await Promise.all([rsa('RSASSA-PKCS1-v1_5'), ec()]);
      const keys = [await jwk(rs, 'rs', 'RS256'), await jwk(es, 'es')];
      const server = serveJwks(() => keys);
      try {
        const jwks = createJwks(url);
        const t1 = await jwtSign({ uid: 'a' }, rs.privateKey, { algorithm: 'RS256', keyId: 'rs' });
        const t2 = await jwtSign({ uid: 'b' }, es.privateKey, { algorithm: 'ES256', keyId: 'es' });
        const algorithms: JwtAlgorithm[] = ['RS256', 'ES256'];
        assert.strictEqual((await jwtVerify(t1, jwks, { algorithms })).uid, 'a');
        assert.strictEqual((await jwtVerify(t2, jwks, { algorithms })).uid, 'b');
        assert.deepStrictEqual(server.calls, [url]);
      } finally {
        server.restore();
      }
    });

    it('should refetch once on an unknown kid and pick up rotated keys', async () => {
      const [old, rotated] = await Promise.all([ec(), ec()]);
      let keys = [await jwk(old, 'old')];
      const server = serveJwks(() => keys);
      try {
        const jwks = createJwks(url);
        const opts = { algorithms: ['ES256'] as JwtAlgorithm[] };
        const t1 = await jwtSign({}, old.privateKey, { algorithm: 'ES256', keyId: 'old' });
        await jwtVerify(t1, jwks, opts);
        keys = [await jwk(rotated, 'new')];
        const t2 = await jwtSign({ uid: 'n' }, rotated.privateKey, {
          algorithm: 'ES256',
          keyId: 'new',
        });
        assert.strictEqual((await jwtVerify(t2, jwks, opts)).uid, 'n');
        assert.strictEqual(server.calls.length, 2);
      } finally {
        server.restore();
      }
    });

    it('should rate-limit refetches for unknown kids', async () => {
      const pair = await ec();
      const keys = [await jwk(pair, 'k')];
      const server = serveJwks(() => keys);
      try {
        const jwks = createJwks(url);
        const opts = { algorithms: ['ES256'] as JwtAlgorithm[] };
        for (const kid of ['x', 'y', 'z']) {
          const token = await jwtSign({}, pair.privateKey, { algorithm: 'ES256', keyId: kid });
          await assert.rejects(() => jwtVerify(token, jwks, opts), /No matching key/);
        }
        assert.strictEqual(server.calls.length, 2);
      } finally {
        server.restore();
      }
    });

    it('should reject a key whose alg or kty does not match the token', async () => {
      const pair = await rsa('RSASSA-PKCS1-v1_5');
      const keys = [await jwk(pair, 'k', 'RS512')];
      const server = serveJwks(() => keys);
      try {
        const token = await jwtSign({}, pair.privateKey, { algorithm: 'RS256', keyId: 'k' });
        await assert.rejects(
          () => jwtVerify(token, createJwks(url), { algorithms: ['RS256'] }),
          /No matching key/,
        );
      } finally {
        server.restore();
      }
    });

    it('should reject HMAC tokens signed with the public key', async () => {
      const pair = await rsa('RSASSA-PKCS1-v1_5');
      const key = await jwk(pair, 'k');
      const server = serveJwks(() => [key]);
      try {
        const forged = await jwtSign({ uid: 'admin' }, JSON.stringify(key), {
          algorithm: 'HS256',
          keyId: 'k',
        });
        await assert.rejects(
          () => jwtVerify(forged, createJwks(url), { algorithms: ['RS256', 'HS256'] }),
          /Key does not match/,
        );
      } finally {
        server.restore();
      }
    });

    it('should use the only matching key when the token has no kid', async () => {
      const pair = await ec();
      const keys = [await jwk(pair, 'k')];
      const server = serveJwks(() => keys);
      try {
        const token = await jwtSign({ uid: 'u' }, pair.privateKey, { algorithm: 'ES256' });
        const payload = await jwtVerify(token, createJwks(url), { algorithms: ['ES256'] });
        assert.strictEqual(payload.uid, 'u');
      } finally {
        server.restore();
      }
    });

    it('should reject expired tokens', async () => {
      const pair = await ec();
      const keys = [await jwk(pair, 'k')];
      const server = serveJwks(() => keys);
      try {
        const token = await jwtSign({}, pair.privateKey, {
          algorithm: 'ES256',
          keyId: 'k',
          issuedAt: Math.floor(Date.now() / 1000) - 7200,
          expiresIn: '1h',
        });
        await assert.rejects(
          () => jwtVerify(token, createJwks(url), { algorithms: ['ES256'] }),
          /Token expired/,
        );
      } finally {
        server.restore();
      }
    });

    it('should surface JWKS fetch failures', async () => {
      const original = globalThis.fetch;
      globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;
      try {
        const pair = await ec();
        const token = await jwtSign({}, pair.privateKey, { algorithm: 'ES256', keyId: 'k' });
        await assert.rejects(
          () => jwtVerify(token, createJwks(url), { algorithms: ['ES256'] }),
          /JWKS fetch failed: 500/,
        );
      } finally {
        globalThis.fetch = original;
      }
    });
  });
});
