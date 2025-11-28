/**
 * @fileoverview Tests for authentication middleware.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { basicAuth, jwtAuth, bearerAuth } from './auth.js';
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
      params: { path: {}, query: {}, body: {} },
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
        validate: async () => true,
      });

      const response = await middleware(context, next);

      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.headers.get('WWW-Authenticate'), 'Basic realm="Secure Area", charset="UTF-8"');
      assert.strictEqual(nextCalled, false);
    });

    it('should reject requests with invalid Authorization format', async () => {
      const middleware = basicAuth({
        validate: async () => true,
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

    it('should validate credentials and allow valid requests', async () => {
      const middleware = basicAuth({
        validate: async (username, password) => {
          return username === 'admin' && password === 'secret';
        },
      });

      // Valid credentials
      const validCredentials = btoa('admin:secret');
      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': `Basic ${validCredentials}`,
        },
      });

      const response = await middleware(context, next);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(response, nextResponse);
      assert.strictEqual(context.user, 'admin');
    });

    it('should reject invalid credentials', async () => {
      const middleware = basicAuth({
        validate: async (username, password) => {
          return username === 'admin' && password === 'secret';
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
        validate: async () => false,
      });

      const response = await middleware(context, next);

      assert.strictEqual(response.headers.get('WWW-Authenticate'), 'Basic realm="Admin Area", charset="UTF-8"');
    });

    it('should skip authentication for specified paths', async () => {
      const middleware = basicAuth({
        validate: async () => false,
        skipPaths: ['/public/', '/health'],
      });

      // Test skipped path
      context.request = new Request('http://example.com/public/assets');
      let response = await middleware(context, next);
      assert.strictEqual(nextCalled, true);

      // Test protected path
      nextCalled = false;
      context.request = new Request('http://example.com/api/users');
      response = await middleware(context, next);
      assert.strictEqual(response.status, 401);
      assert.strictEqual(nextCalled, false);
    });

    it('should skip authentication for localhost when configured', async () => {
      const middleware = basicAuth({
        validate: async () => false,
        skipLocalhost: true,
      });

      // Test localhost
      context.request = new Request('http://localhost/test');
      let response = await middleware(context, next);
      assert.strictEqual(nextCalled, true);

      // Test 127.0.0.1
      nextCalled = false;
      context.request = new Request('http://127.0.0.1/test');
      response = await middleware(context, next);
      assert.strictEqual(nextCalled, true);

      // Test external host
      nextCalled = false;
      context.request = new Request('http://example.com/test');
      response = await middleware(context, next);
      assert.strictEqual(response.status, 401);
      assert.strictEqual(nextCalled, false);
    });

    it('should handle malformed credentials', async () => {
      const middleware = basicAuth({
        validate: async () => true,
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

    it('should pass context to validate function', async () => {
      const middleware = basicAuth({
        validate: async (username, password, ctx) => {
          assert.strictEqual(ctx, context);
          assert.strictEqual(ctx.request.url, 'http://example.com/test');
          return true;
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

    it('should reject requests without token', async () => {
      const middleware = jwtAuth({
        secret: 'test-secret',
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
      assert.deepStrictEqual(context.jwt, payload);
    });

    it('should extract token from cookie', async () => {
      const middleware = jwtAuth({
        secret: 'test-secret',
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
        secret: async () => 'dynamic-secret',
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

    it('should skip authentication for specified paths', async () => {
      const middleware = jwtAuth({
        secret: 'test-secret',
        skipPaths: ['/api/login', /^\/public\//],
      });

      // Test skipped path (string)
      context.request = new Request('http://example.com/api/login');
      let response = await middleware(context, next);
      assert.strictEqual(nextCalled, true);

      // Test skipped path (regex)
      nextCalled = false;
      context.request = new Request('http://example.com/public/assets');
      response = await middleware(context, next);
      assert.strictEqual(nextCalled, true);

      // Test protected path
      nextCalled = false;
      context.request = new Request('http://example.com/api/users');
      response = await middleware(context, next);
      assert.strictEqual(response.status, 401);
      assert.strictEqual(nextCalled, false);
    });

    it('should use custom token extractor', async () => {
      const middleware = jwtAuth({
        secret: 'test-secret',
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

    it('should run custom validation', async () => {
      const middleware = jwtAuth({
        secret: 'test-secret',
        validate: async (payload, ctx) => {
          assert.strictEqual(ctx, context);
          return payload.role === 'admin';
        },
      });

      // Valid token but fails custom validation
      let payload = { sub: 'user123', role: 'user', exp: Math.floor(Date.now() / 1000) + 3600 };
      let token = await createTestJwt(payload, 'test-secret');

      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      let response = await middleware(context, next);
      assert.strictEqual(response.status, 401);
      assert.strictEqual(nextCalled, false);

      // Valid token and passes custom validation
      payload = { sub: 'admin123', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 };
      token = await createTestJwt(payload, 'test-secret');

      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      response = await middleware(context, next);
      assert.strictEqual(nextCalled, true);
      assert.strictEqual(context.user, 'admin123');
    });
  });

  describe('Bearer Auth', () => {
    it('should reject requests without token', async () => {
      const middleware = bearerAuth({
        validate: async () => true,
      });

      const response = await middleware(context, next);

      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.headers.get('WWW-Authenticate'), 'Bearer');
      assert.strictEqual(nextCalled, false);
    });

    it('should validate bearer tokens', async () => {
      const middleware = bearerAuth({
        validate: async (token) => token === 'valid-token',
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

    it('should pass context to validate function', async () => {
      const middleware = bearerAuth({
        validate: async (token, ctx) => {
          assert.strictEqual(ctx, context);
          assert.strictEqual(token, 'test-token');
          return true;
        },
      });

      context.request = new Request('http://example.com/test', {
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      await middleware(context, next);
    });

    it('should skip authentication for specified paths', async () => {
      const middleware = bearerAuth({
        validate: async () => false,
        skipPaths: ['/health', /^\/public\//],
      });

      // Test skipped path
      context.request = new Request('http://example.com/health');
      const response = await middleware(context, next);
      assert.strictEqual(nextCalled, true);
    });
  });
});