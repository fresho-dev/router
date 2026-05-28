/**
 * @fileoverview Tests for cookie parsing/serialization and the cookies() middleware.
 */

import assert from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import type { MiddlewareContext } from '../middleware.js';
import { cookies, parseCookies, serializeCookie } from './cookies.js';

describe('Cookies Middleware', () => {
  describe('parseCookies', () => {
    it('should return an empty object for a missing header', () => {
      assert.deepStrictEqual(parseCookies(null), {});
    });

    it('should return an empty object for an empty header', () => {
      assert.deepStrictEqual(parseCookies(''), {});
    });

    it('should parse a single name=value pair', () => {
      assert.deepStrictEqual(parseCookies('session=abc123'), { session: 'abc123' });
    });

    it('should parse multiple pairs separated by "; "', () => {
      assert.deepStrictEqual(parseCookies('a=1; b=2; c=3'), { a: '1', b: '2', c: '3' });
    });

    it('should tolerate inconsistent whitespace around pairs', () => {
      assert.deepStrictEqual(parseCookies('a=1;b=2;  c=3'), { a: '1', b: '2', c: '3' });
    });

    it('should preserve "=" characters within a value', () => {
      assert.deepStrictEqual(parseCookies('token=a=b=c'), { token: 'a=b=c' });
    });

    it('should URL-decode encoded values', () => {
      assert.deepStrictEqual(parseCookies('name=John%20Doe'), { name: 'John Doe' });
    });

    it('should keep the first value when a name is duplicated', () => {
      assert.deepStrictEqual(parseCookies('a=1; a=2'), { a: '1' });
    });

    it('should skip entries without a value separator', () => {
      assert.deepStrictEqual(parseCookies('a=1; broken; b=2'), { a: '1', b: '2' });
    });
  });

  describe('serializeCookie', () => {
    it('should serialize a basic name=value pair', () => {
      assert.strictEqual(serializeCookie('session', 'abc'), 'session=abc');
    });

    it('should URL-encode the value', () => {
      assert.strictEqual(serializeCookie('name', 'John Doe'), 'name=John%20Doe');
    });

    it('should append Max-Age for maxAge', () => {
      assert.strictEqual(serializeCookie('a', '1', { maxAge: 3600 }), 'a=1; Max-Age=3600');
    });

    it('should append Expires for an expires Date', () => {
      const expires = new Date('2026-01-01T00:00:00Z');
      assert.strictEqual(
        serializeCookie('a', '1', { expires }),
        `a=1; Expires=${expires.toUTCString()}`,
      );
    });

    it('should append Path and Domain', () => {
      assert.strictEqual(
        serializeCookie('a', '1', { path: '/', domain: 'example.com' }),
        'a=1; Domain=example.com; Path=/',
      );
    });

    it('should append Secure and HttpOnly flags when true', () => {
      assert.strictEqual(
        serializeCookie('a', '1', { secure: true, httpOnly: true }),
        'a=1; Secure; HttpOnly',
      );
    });

    it('should not append flags when false', () => {
      assert.strictEqual(serializeCookie('a', '1', { secure: false, httpOnly: false }), 'a=1');
    });

    it('should append SameSite with a capitalized value', () => {
      assert.strictEqual(serializeCookie('a', '1', { sameSite: 'lax' }), 'a=1; SameSite=Lax');
      assert.strictEqual(serializeCookie('a', '1', { sameSite: 'none' }), 'a=1; SameSite=None');
    });
  });

  describe('cookies()', () => {
    let context: MiddlewareContext;
    let nextResponse: Response;
    const next = async () => nextResponse;

    beforeEach(() => {
      nextResponse = new Response('ok', { status: 200, headers: { 'X-Existing': 'kept' } });
      context = {
        request: new Request('http://example.com/test'),
        path: {},
        query: {},
        body: {},
        env: {},
      };
    });

    it('should parse the request Cookie header into context.cookies', async () => {
      context.request = new Request('http://example.com/test', {
        headers: { Cookie: 'session=abc; theme=dark' },
      });

      await cookies()(context, next);

      assert.deepStrictEqual(context.cookies, { session: 'abc', theme: 'dark' });
    });

    it('should expose an empty cookies map when no Cookie header is present', async () => {
      await cookies()(context, next);

      assert.deepStrictEqual(context.cookies, {});
    });

    it('should append a Set-Cookie header for setCookie calls', async () => {
      const middleware = cookies();
      const installNext = async () => {
        (context.setCookie as (n: string, v: string) => void)('session', 'xyz');
        return nextResponse;
      };

      const response = await middleware(context, installNext);

      assert.strictEqual(response.headers.getSetCookie().length, 1);
      assert.strictEqual(response.headers.getSetCookie()[0], 'session=xyz');
    });

    it('should append a separate Set-Cookie header per cookie', async () => {
      const middleware = cookies();
      const installNext = async () => {
        const setCookie = context.setCookie as (n: string, v: string, o?: unknown) => void;
        setCookie('a', '1');
        setCookie('b', '2', { httpOnly: true });
        return nextResponse;
      };

      const response = await middleware(context, installNext);

      assert.deepStrictEqual(response.headers.getSetCookie(), ['a=1', 'b=2; HttpOnly']);
    });

    it('should preserve the downstream response status and existing headers', async () => {
      const middleware = cookies();
      const installNext = async () => {
        (context.setCookie as (n: string, v: string) => void)('a', '1');
        return nextResponse;
      };

      const response = await middleware(context, installNext);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('X-Existing'), 'kept');
      assert.strictEqual(await response.text(), 'ok');
    });

    it('should not modify the response when no cookies are set', async () => {
      const response = await cookies()(context, next);

      assert.strictEqual(response, nextResponse);
      assert.strictEqual(response.headers.getSetCookie().length, 0);
    });
  });
});
