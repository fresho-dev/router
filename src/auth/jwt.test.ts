/**
 * @fileoverview Tests for JWT utilities.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { jwtSign, jwtVerify } from './jwt.js';

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
