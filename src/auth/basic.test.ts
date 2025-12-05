/**
 * @fileoverview Tests for Basic authentication utilities.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { encodeBasicAuth, extractBasicAuthToken, parseBasicAuth } from './basic.js';

describe('Basic Auth Utilities', () => {
  describe('parseBasicAuth', () => {
    it('should parse valid Basic auth header', () => {
      const header = 'Basic dXNlcm5hbWU6cGFzc3dvcmQ='; // username:password
      const result = parseBasicAuth(header);

      assert.deepStrictEqual(result, {
        username: 'username',
        password: 'password',
      });
    });

    it('should return null for null header', () => {
      const result = parseBasicAuth(null);
      assert.strictEqual(result, null);
    });

    it('should return null for non-Basic auth header', () => {
      const result = parseBasicAuth('Bearer token123');
      assert.strictEqual(result, null);
    });

    it('should return null for malformed credentials (no colon)', () => {
      const header = `Basic ${btoa('usernamepassword')}`;
      const result = parseBasicAuth(header);
      assert.strictEqual(result, null);
    });

    it('should return null for invalid base64', () => {
      const result = parseBasicAuth('Basic !!!invalid-base64!!!');
      assert.strictEqual(result, null);
    });

    it('should handle empty username', () => {
      const header = `Basic ${btoa(':password')}`;
      const result = parseBasicAuth(header);

      assert.deepStrictEqual(result, {
        username: '',
        password: 'password',
      });
    });

    it('should handle empty password', () => {
      const header = `Basic ${btoa('username:')}`;
      const result = parseBasicAuth(header);

      assert.deepStrictEqual(result, {
        username: 'username',
        password: '',
      });
    });

    it('should handle password containing colons', () => {
      const header = `Basic ${btoa('user:pass:with:colons')}`;
      const result = parseBasicAuth(header);

      assert.deepStrictEqual(result, {
        username: 'user',
        password: 'pass:with:colons',
      });
    });

    it('should handle special characters', () => {
      const header = `Basic ${btoa('user@example.com:p@$$w0rd!')}`;
      const result = parseBasicAuth(header);

      assert.deepStrictEqual(result, {
        username: 'user@example.com',
        password: 'p@$$w0rd!',
      });
    });
  });

  describe('encodeBasicAuth', () => {
    it('should encode credentials to Basic auth header', () => {
      const result = encodeBasicAuth('username', 'password');
      assert.strictEqual(result, 'Basic dXNlcm5hbWU6cGFzc3dvcmQ=');
    });

    it('should handle empty username', () => {
      const result = encodeBasicAuth('', 'password');
      assert.strictEqual(result, `Basic ${btoa(':password')}`);
    });

    it('should handle empty password', () => {
      const result = encodeBasicAuth('username', '');
      assert.strictEqual(result, `Basic ${btoa('username:')}`);
    });

    it('should handle special characters', () => {
      const result = encodeBasicAuth('user@example.com', 'p@$$w0rd!');
      assert.strictEqual(result, `Basic ${btoa('user@example.com:p@$$w0rd!')}`);
    });
  });

  describe('extractBasicAuthToken', () => {
    it('should extract base64 token from Basic auth header', () => {
      const result = extractBasicAuthToken('Basic dXNlcm5hbWU6cGFzc3dvcmQ=');
      assert.strictEqual(result, 'dXNlcm5hbWU6cGFzc3dvcmQ=');
    });

    it('should return null for null header', () => {
      const result = extractBasicAuthToken(null);
      assert.strictEqual(result, null);
    });

    it('should return null for non-Basic auth header', () => {
      const result = extractBasicAuthToken('Bearer token123');
      assert.strictEqual(result, null);
    });

    it('should extract empty token after Basic prefix', () => {
      const result = extractBasicAuthToken('Basic ');
      assert.strictEqual(result, '');
    });
  });

  describe('roundtrip', () => {
    it('should encode and decode credentials correctly', () => {
      const username = 'admin';
      const password = 'secretpassword123';

      const encoded = encodeBasicAuth(username, password);
      const decoded = parseBasicAuth(encoded);

      assert.deepStrictEqual(decoded, { username, password });
    });

    it('should roundtrip special characters', () => {
      const username = 'user+test@example.com';
      const password = 'p@$$:w0rd!#$%';

      const encoded = encodeBasicAuth(username, password);
      const decoded = parseBasicAuth(encoded);

      assert.deepStrictEqual(decoded, { username, password });
    });
  });
});
