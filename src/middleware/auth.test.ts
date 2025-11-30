/**
 * @fileoverview Tests for authentication middleware.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { basicAuth, jwtAuth, jwtSign, bearerAuth } from './auth.js';
import type { MiddlewareContext } from '../middleware.js';

describe('Authentication Middleware', () => {
  let context: MiddlewareContext;
  let nextCalled: boolean;
  let nextResponse: Response;

  beforeEach(() => {
    nextCalled = false;
    nextResponse = new Response('protected content');
    context = {
      request: new Request('http://example.com/test'),
      path: {}, query: {}, body: {},
      env: {},
    };
  });

  const next = async () => {
    nextCalled = true;
    return nextResponse;
  };

  describe('Basic Auth', () => {
    it('should reject requests without Authorization header', async () => {
      const middleware = basicAuth({
        verify: async () => ({ user: 'test' }),
      });

      const response = await middleware(context, next);

      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.headers.get('WWW-Authenticate'), 'Basic realm="Secure Area", charset="UTF-8"');
      assert.strictEqual(nextCalled, false);
    });

    it('should reject requests with invalid Authorization format', async () => {
      const middleware = basicAuth({
        verify: async () => ({ user: 'test' }),
      });

      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': 'Bearer token',
        },
      });

      const response = await middleware(context, next);

      assert.strictEqual(response.status, 401);
      assert.strictEqual(nextCalled, false);
    });

    it('should verify credentials and merge claims into context', async () => {
      const middleware = basicAuth({
        verify: async (username, password) => {
          if (username === 'admin' && password === 'secret') {
            return { user: { name: username, role: 'admin' } };
          }
          return null;
        },
      });

      const validCredentials = btoa('admin:secret');
      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': `Basic ${validCredentials}`,
        },
      });

      const response = await middleware(context, next);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(response, nextResponse);
      assert.deepStrictEqual(context.user, { name: 'admin', role: 'admin' });
    });

    it('should reject when verify returns null', async () => {
      const middleware = basicAuth({
        verify: async (username, password) => {
          if (username === 'admin' && password === 'secret') {
            return { user: username };
          }
          return null;
        },
      });

      const invalidCredentials = btoa('admin:wrong');
      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': `Basic ${invalidCredentials}`,
        },
      });

      const response = await middleware(context, next);

      assert.strictEqual(response.status, 401);
      assert.strictEqual(nextCalled, false);
    });

    it('should handle custom realm', async () => {
      const middleware = basicAuth({
        realm: 'Admin Area',
        verify: async () => null,
      });

      const response = await middleware(context, next);

      assert.strictEqual(response.headers.get('WWW-Authenticate'), 'Basic realm="Admin Area", charset="UTF-8"');
    });

    it('should handle malformed credentials', async () => {
      const middleware = basicAuth({
        verify: async () => ({ user: 'test' }),
      });

      // Credentials without colon
      const malformedCredentials = btoa('adminpassword');
      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': `Basic ${malformedCredentials}`,
        },
      });

      const response = await middleware(context, next);

      assert.strictEqual(response.status, 401);
      assert.strictEqual(nextCalled, false);
    });

    it('should pass context to verify function', async () => {
      const middleware = basicAuth({
        verify: async (username, password, ctx) => {
          assert.strictEqual(ctx, context);
          assert.strictEqual(ctx.request.url, 'http://example.com/test');
          return { user: username };
        },
      });

      const credentials = btoa('user:pass');
      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': `Basic ${credentials}`,
        },
      });

      await middleware(context, next);
    });
  });

  describe('JWT Auth', () => {
    // Simple JWT creation for testing (HS256)
    async function createTestJwt(payload: any, secret: string): Promise<string> {
      const header = { alg: 'HS256', typ: 'JWT' };
      const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

      const data = `${headerB64}.${payloadB64}`;
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
      const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      return `${data}.${signatureB64}`;
    }

    // Default claims mapper for tests
    const defaultClaims = (payload: { sub?: string }) => ({ user: payload.sub });

    it('should reject requests without token', async () => {
      const middleware = jwtAuth({
        secret: 'test-secret',
        claims: defaultClaims,
      });

      const response = await middleware(context, next);

      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.headers.get('WWW-Authenticate'), 'Bearer');
      assert.strictEqual(await response.text(), 'Missing token');
      assert.strictEqual(nextCalled, false);
    });

    it('should extract token from Authorization header', async () => {
      const middleware = jwtAuth({
        secret: 'test-secret',
        claims: (payload) => ({ user: payload.sub }),
      });

      const payload = { sub: 'user123', exp: Math.floor(Date.now() / 1000) + 3600 };
      const token = await createTestJwt(payload, 'test-secret');

      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const response = await middleware(context, next);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(response, nextResponse);
      assert.strictEqual(context.user, 'user123');
    });

    it('should extract token from cookie', async () => {
      const middleware = jwtAuth({
        secret: 'test-secret',
        claims: defaultClaims,
      });

      const payload = { sub: 'user123', exp: Math.floor(Date.now() / 1000) + 3600 };
      const token = await createTestJwt(payload, 'test-secret');

      context.request = new Request('http://example.com/test', {
        headers: {
          'Cookie': `token=${token}; other=value`,
        },
      });

      const response = await middleware(context, next);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(context.user, 'user123');
    });

    it('should reject invalid tokens', async () => {
      const middleware = jwtAuth({
        secret: 'test-secret',
        claims: defaultClaims,
      });

      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': 'Bearer invalid.token.here',
        },
      });

      const response = await middleware(context, next);

      assert.strictEqual(response.status, 401);
      assert(response.headers.get('WWW-Authenticate')?.includes('invalid_token'));
      assert.strictEqual(nextCalled, false);
    });

    it('should reject expired tokens', async () => {
      const middleware = jwtAuth({
        secret: 'test-secret',
        claims: defaultClaims,
      });

      const payload = { sub: 'user123', exp: Math.floor(Date.now() / 1000) - 3600 }; // Expired
      const token = await createTestJwt(payload, 'test-secret');

      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const response = await middleware(context, next);

      assert.strictEqual(response.status, 401);
      assert(await response.text().then(text => text.includes('expired')));
      assert.strictEqual(nextCalled, false);
    });

    it('should reject tokens with nbf in the future', async () => {
      const middleware = jwtAuth({
        secret: 'test-secret',
        claims: defaultClaims,
      });

      const payload = {
        sub: 'user123',
        nbf: Math.floor(Date.now() / 1000) + 3600, // Not yet valid
        exp: Math.floor(Date.now() / 1000) + 7200,
      };
      const token = await createTestJwt(payload, 'test-secret');

      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const response = await middleware(context, next);

      assert.strictEqual(response.status, 401);
      assert(await response.text().then(text => text.includes('not yet valid')));
      assert.strictEqual(nextCalled, false);
    });

    it('should handle secret as function', async () => {
      const middleware = jwtAuth({
        secret: () => 'dynamic-secret',
        claims: defaultClaims,
      });

      const payload = { sub: 'user123', exp: Math.floor(Date.now() / 1000) + 3600 };
      const token = await createTestJwt(payload, 'dynamic-secret');

      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const response = await middleware(context, next);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(context.user, 'user123');
    });

    it('should pass context to secret function for env access', async () => {
      // Define context type with typed env
      interface AppContext {
        env: { JWT_SECRET: string };
      }

      // Create context with env
      const envContext: MiddlewareContext<AppContext> = {
        request: new Request('http://example.com/test'),
        path: {}, query: {}, body: {},
        env: { JWT_SECRET: 'env-secret' },
      };

      // Use generic to get typed env access - no cast needed
      const middleware = jwtAuth<AppContext>({
        secret: (ctx) => ctx.env.JWT_SECRET,
        claims: defaultClaims,
      });

      const payload = { sub: 'user123', exp: Math.floor(Date.now() / 1000) + 3600 };
      const token = await createTestJwt(payload, 'env-secret');

      envContext.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const response = await middleware(envContext, next);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(envContext.user, 'user123');
    });

    it('should use custom token extractor', async () => {
      const middleware = jwtAuth({
        secret: 'test-secret',
        claims: defaultClaims,
        getToken: (req) => {
          const url = new URL(req.url);
          return url.searchParams.get('token');
        },
      });

      const payload = { sub: 'user123', exp: Math.floor(Date.now() / 1000) + 3600 };
      const token = await createTestJwt(payload, 'test-secret');

      context.request = new Request(`http://example.com/test?token=${token}`);

      const response = await middleware(context, next);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(context.user, 'user123');
    });

    it('should map payload to context via claims', async () => {
      interface AppContext {
        user: { id: string; email: string };
      }

      const middleware = jwtAuth<AppContext>({
        secret: 'test-secret',
        claims: (payload) => ({
          user: {
            id: payload.sub,
            email: payload.email,
          },
        }),
      });

      const payload = { sub: 'user123', email: 'test@example.com', exp: Math.floor(Date.now() / 1000) + 3600 };
      const token = await createTestJwt(payload, 'test-secret');

      const typedContext: MiddlewareContext<AppContext> = {
        ...context,
        request: new Request('http://example.com/test', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }),
      };

      await middleware(typedContext, next);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(typedContext.user?.id, 'user123');
      assert.strictEqual(typedContext.user?.email, 'test@example.com');
    });

    it('should reject when claims function returns null', async () => {
      const middleware = jwtAuth({
        secret: 'test-secret',
        claims: (payload) => {
          // Only allow admin role
          if (payload.role !== 'admin') return null;
          return { user: { id: payload.sub } };
        },
      });

      // Valid token but claims function returns null
      const payload = { sub: 'user123', role: 'user', exp: Math.floor(Date.now() / 1000) + 3600 };
      const token = await createTestJwt(payload, 'test-secret');

      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const response = await middleware(context, next);
      assert.strictEqual(response.status, 401);
      assert.strictEqual(nextCalled, false);
    });
  });

  describe('Bearer Auth', () => {
    it('should reject requests without token', async () => {
      const middleware = bearerAuth({
        verify: async () => ({ token: 'any' }),
      });

      const response = await middleware(context, next);

      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.headers.get('WWW-Authenticate'), 'Bearer');
      assert.strictEqual(nextCalled, false);
    });

    it('should verify bearer tokens and merge claims into context', async () => {
      const middleware = bearerAuth({
        verify: async (token) => {
          if (token === 'valid-token') {
            return { token, apiClient: 'trusted' };
          }
          return null;
        },
      });

      // Valid token
      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': 'Bearer valid-token',
        },
      });

      let response = await middleware(context, next);
      assert.strictEqual(nextCalled, true);
      assert.strictEqual(context.token, 'valid-token');
      assert.strictEqual(context.apiClient, 'trusted');

      // Invalid token
      nextCalled = false;
      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': 'Bearer invalid-token',
        },
      });

      response = await middleware(context, next);
      assert.strictEqual(response.status, 401);
      assert.strictEqual(nextCalled, false);
    });

    it('should pass context to verify function', async () => {
      const middleware = bearerAuth({
        verify: async (token, ctx) => {
          assert.strictEqual(ctx, context);
          assert.strictEqual(token, 'test-token');
          return { token };
        },
      });

      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      await middleware(context, next);
    });
  });

  describe('jwtSign', () => {
    const secret = 'test-secret-key';

    it('should create a valid JWT that can be verified', async () => {
      const token = await jwtSign({ uid: 'user-123' }, secret);

      // Token should have 3 parts.
      const parts = token.split('.');
      assert.strictEqual(parts.length, 3);

      // Verify with jwtAuth.
      let verifiedPayload: Record<string, unknown> | null = null;
      const middleware = jwtAuth({
        secret,
        claims: (payload) => {
          verifiedPayload = payload;
          return { user: payload.uid };
        },
      });

      context.request = new Request('http://example.com/test', {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      await middleware(context, next);
      assert.strictEqual(nextCalled, true);
      assert.strictEqual(verifiedPayload?.['uid'], 'user-123');
    });

    it('should set expiration with expiresIn string', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await jwtSign({ uid: 'user-123' }, secret, { expiresIn: '1h' });

      // Decode payload.
      const payloadB64 = token.split('.')[1];
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

      assert.ok(payload.exp);
      assert.ok(payload.iat);
      // exp should be approximately 1 hour from now.
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
        /Invalid duration format/
      );
    });

    it('should preserve custom payload claims', async () => {
      const token = await jwtSign(
        { uid: 'user-123', role: 'admin', custom: { nested: true } },
        secret
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

      // Verify it can be decoded.
      const parts = token.split('.');
      assert.strictEqual(parts.length, 3);
    });

    it('should produce tokens verifiable by jwtAuth with same secret', async () => {
      // Sign a token.
      const token = await jwtSign(
        { uid: 'user-123', email: 'test@example.com' },
        secret,
        { expiresIn: '1h', issuer: 'test-app' }
      );

      // Verify with jwtAuth middleware.
      const middleware = jwtAuth({
        secret,
        claims: (payload) => ({
          user: { id: payload.uid, email: payload.email },
        }),
      });

      context.request = new Request('http://example.com/test', {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      const response = await middleware(context, next);

      assert.strictEqual(nextCalled, true);
      assert.deepStrictEqual((context as { user?: unknown }).user, {
        id: 'user-123',
        email: 'test@example.com',
      });
    });

    it('should support HS384 algorithm', async () => {
      const token = await jwtSign({ uid: 'user-123' }, secret, { algorithm: 'HS384' });

      // Verify header has correct algorithm.
      const headerB64 = token.split('.')[0];
      const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
      assert.strictEqual(header.alg, 'HS384');

      // Verify with jwtAuth using HS384.
      const middleware = jwtAuth({
        secret,
        algorithms: ['HS384'],
        claims: (payload) => ({ user: payload.uid }),
      });

      context.request = new Request('http://example.com/test', {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      await middleware(context, next);
      assert.strictEqual(nextCalled, true);
      assert.strictEqual(context.user, 'user-123');
    });

    it('should support HS512 algorithm', async () => {
      const token = await jwtSign({ uid: 'user-123' }, secret, { algorithm: 'HS512' });

      // Verify header has correct algorithm.
      const headerB64 = token.split('.')[0];
      const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
      assert.strictEqual(header.alg, 'HS512');

      // Verify with jwtAuth using HS512.
      const middleware = jwtAuth({
        secret,
        algorithms: ['HS512'],
        claims: (payload) => ({ user: payload.uid }),
      });

      context.request = new Request('http://example.com/test', {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      await middleware(context, next);
      assert.strictEqual(nextCalled, true);
      assert.strictEqual(context.user, 'user-123');
    });

    it('should reject token with wrong algorithm', async () => {
      // Sign with HS512.
      const token = await jwtSign({ uid: 'user-123' }, secret, { algorithm: 'HS512' });

      // Try to verify with HS256 only.
      const middleware = jwtAuth({
        secret,
        algorithms: ['HS256'],
        claims: (payload) => ({ user: payload.uid }),
      });

      context.request = new Request('http://example.com/test', {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      const response = await middleware(context, next);
      assert.strictEqual(response.status, 401);
      assert.strictEqual(nextCalled, false);
    });
  });
});