import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import {
  buildAuthorizationUrl,
  decodeOAuthState,
  encodeOAuthState,
  exchangeCode,
  OAUTH_PROVIDERS,
  refreshAccessToken,
  revokeToken,
} from './oauth.js';

describe('OAuth State Encoding/Decoding', () => {
  const SECRET = 'test-secret-key-for-oauth-state';

  it('should encode and decode state with arbitrary data', async () => {
    const data = { uid: 'user-123', returnTo: '/dashboard' };
    const state = await encodeOAuthState(data, SECRET);

    assert.ok(typeof state === 'string');
    assert.ok(state.length > 0);

    const decoded = await decodeOAuthState(state, SECRET);
    assert.deepStrictEqual(decoded, data);
  });

  it('should generate different states for the same data (nonce)', async () => {
    const data = { uid: 'user-123' };
    const state1 = await encodeOAuthState(data, SECRET);
    const state2 = await encodeOAuthState(data, SECRET);

    assert.notStrictEqual(state1, state2);

    // But both should decode to the same data.
    const decoded1 = await decodeOAuthState(state1, SECRET);
    const decoded2 = await decodeOAuthState(state2, SECRET);
    assert.deepStrictEqual(decoded1, decoded2);
  });

  it('should return null for tampered state', async () => {
    const data = { uid: 'user-123' };
    const state = await encodeOAuthState(data, SECRET);

    // Tamper with the state.
    const tampered = `${state.slice(0, -1)}X`;
    const decoded = await decodeOAuthState(tampered, SECRET);
    assert.strictEqual(decoded, null);
  });

  it('should return null for wrong secret', async () => {
    const data = { uid: 'user-123' };
    const state = await encodeOAuthState(data, SECRET);

    const decoded = await decodeOAuthState(state, 'wrong-secret');
    assert.strictEqual(decoded, null);
  });

  it('should return null for invalid base64', async () => {
    const decoded = await decodeOAuthState('not-valid-base64!!!', SECRET);
    assert.strictEqual(decoded, null);
  });

  it('should handle complex nested data', async () => {
    const data = {
      uid: 'user-123',
      meta: { source: 'login', timestamp: 1234567890 },
      scopes: ['read', 'write'],
    };
    const state = await encodeOAuthState(data, SECRET);
    const decoded = await decodeOAuthState(state, SECRET);
    assert.deepStrictEqual(decoded, data);
  });

  it('should not expose internal _nonce in decoded data', async () => {
    const data = { uid: 'user-123' };
    const state = await encodeOAuthState(data, SECRET);
    const decoded = await decodeOAuthState(state, SECRET);

    assert.ok(decoded);
    assert.strictEqual('_nonce' in decoded, false);
  });
});

describe('OAUTH_PROVIDERS', () => {
  it('should have Google provider with all endpoints', () => {
    const google = OAUTH_PROVIDERS.google;
    assert.ok(google);
    assert.strictEqual(google.authorizationUrl, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.strictEqual(google.tokenUrl, 'https://oauth2.googleapis.com/token');
    assert.strictEqual(google.revokeUrl, 'https://oauth2.googleapis.com/revoke');
    assert.strictEqual(google.userInfoUrl, 'https://www.googleapis.com/oauth2/v3/userinfo');
  });

  it('should have GitHub provider', () => {
    const github = OAUTH_PROVIDERS.github;
    assert.ok(github);
    assert.strictEqual(github.authorizationUrl, 'https://github.com/login/oauth/authorize');
    assert.strictEqual(github.tokenUrl, 'https://github.com/login/oauth/access_token');
  });

  it('should have Discord provider', () => {
    const discord = OAUTH_PROVIDERS.discord;
    assert.ok(discord);
    assert.strictEqual(discord.authorizationUrl, 'https://discord.com/oauth2/authorize');
  });
});

describe('buildAuthorizationUrl', () => {
  it('should build a valid authorization URL', () => {
    const url = buildAuthorizationUrl({
      authorizationUrl: OAUTH_PROVIDERS.google.authorizationUrl,
      clientId: 'test-client-id',
      redirectUri: 'https://example.com/callback',
      scopes: ['openid', 'email', 'profile'],
      state: 'test-state',
    });

    const parsed = new URL(url);
    assert.strictEqual(parsed.origin + parsed.pathname, OAUTH_PROVIDERS.google.authorizationUrl);
    assert.strictEqual(parsed.searchParams.get('response_type'), 'code');
    assert.strictEqual(parsed.searchParams.get('client_id'), 'test-client-id');
    assert.strictEqual(parsed.searchParams.get('redirect_uri'), 'https://example.com/callback');
    assert.strictEqual(parsed.searchParams.get('scope'), 'openid email profile');
    assert.strictEqual(parsed.searchParams.get('state'), 'test-state');
  });

  it('should include extra params', () => {
    const url = buildAuthorizationUrl({
      authorizationUrl: OAUTH_PROVIDERS.google.authorizationUrl,
      clientId: 'test-client-id',
      redirectUri: 'https://example.com/callback',
      scopes: ['openid'],
      state: 'test-state',
      extraParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    });

    const parsed = new URL(url);
    assert.strictEqual(parsed.searchParams.get('access_type'), 'offline');
    assert.strictEqual(parsed.searchParams.get('prompt'), 'consent');
  });
});

describe('exchangeCode', () => {
  it('should exchange code for tokens with body auth', async () => {
    const originalFetch = global.fetch;
    const mockFetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200 },
      );
    });
    global.fetch = mockFetch;

    try {
      const tokens = await exchangeCode('test-code', {
        tokenUrl: OAUTH_PROVIDERS.google.tokenUrl,
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'https://example.com/callback',
      });

      assert.strictEqual(tokens.access_token, 'test-access-token');
      assert.strictEqual(tokens.refresh_token, 'test-refresh-token');
      assert.strictEqual(tokens.token_type, 'Bearer');
      assert.strictEqual(tokens.expires_in, 3600);

      // Verify fetch was called correctly.
      assert.strictEqual(mockFetch.mock.calls.length, 1);
      const args = mockFetch.mock.calls[0].arguments as unknown as [string, RequestInit];
      const [url, options] = args;
      assert.strictEqual(url, OAUTH_PROVIDERS.google.tokenUrl);
      assert.strictEqual(options.method, 'POST');

      // Verify body contains credentials.
      const body = new URLSearchParams(options.body as string);
      assert.strictEqual(body.get('client_id'), 'test-client-id');
      assert.strictEqual(body.get('client_secret'), 'test-client-secret');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should exchange code with basic auth', async () => {
    const originalFetch = global.fetch;
    const mockFetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'test-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200 },
      );
    });
    global.fetch = mockFetch;

    try {
      await exchangeCode('test-code', {
        tokenUrl: OAUTH_PROVIDERS.github.tokenUrl,
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'https://example.com/callback',
        authMethod: 'basic',
      });

      const args = mockFetch.mock.calls[0].arguments as unknown as [string, RequestInit];
      const options = args[1] as RequestInit & { headers: Record<string, string> };
      assert.ok(options.headers.Authorization);
      assert.ok(options.headers.Authorization.startsWith('Basic '));

      // Body should NOT contain credentials.
      const body = new URLSearchParams(options.body as string);
      assert.strictEqual(body.get('client_id'), null);
      assert.strictEqual(body.get('client_secret'), null);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should throw on error response', async () => {
    const originalFetch = global.fetch;
    global.fetch = mock.fn(async () => {
      return new Response('{"error": "invalid_grant"}', { status: 400 });
    });

    try {
      await assert.rejects(
        () =>
          exchangeCode('test-code', {
            tokenUrl: OAUTH_PROVIDERS.google.tokenUrl,
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
            redirectUri: 'https://example.com/callback',
          }),
        /Token exchange failed: 400/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('refreshAccessToken', () => {
  it('should refresh access token', async () => {
    const originalFetch = global.fetch;
    const mockFetch = mock.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'new-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200 },
      );
    });
    global.fetch = mockFetch;

    try {
      const tokens = await refreshAccessToken('test-refresh-token', {
        tokenUrl: OAUTH_PROVIDERS.google.tokenUrl,
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      });

      assert.strictEqual(tokens.access_token, 'new-access-token');

      const args = mockFetch.mock.calls[0].arguments as unknown as [string, RequestInit];
      const body = new URLSearchParams(args[1].body as string);
      assert.strictEqual(body.get('grant_type'), 'refresh_token');
      assert.strictEqual(body.get('refresh_token'), 'test-refresh-token');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('revokeToken', () => {
  it('should revoke token successfully', async () => {
    const originalFetch = global.fetch;
    global.fetch = mock.fn(async () => new Response(null, { status: 200 }));

    try {
      const result = await revokeToken({
        revokeUrl: OAUTH_PROVIDERS.google.revokeUrl!,
        token: 'test-token',
      });
      assert.strictEqual(result, true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should handle 204 response', async () => {
    const originalFetch = global.fetch;
    global.fetch = mock.fn(async () => new Response(null, { status: 204 }));

    try {
      const result = await revokeToken({
        revokeUrl: OAUTH_PROVIDERS.google.revokeUrl!,
        token: 'test-token',
      });
      assert.strictEqual(result, true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should include token_type_hint when provided', async () => {
    const originalFetch = global.fetch;
    const mockFetch = mock.fn(async () => new Response(null, { status: 200 }));
    global.fetch = mockFetch;

    try {
      await revokeToken({
        revokeUrl: OAUTH_PROVIDERS.google.revokeUrl!,
        token: 'test-token',
        tokenTypeHint: 'refresh_token',
      });

      const args = mockFetch.mock.calls[0].arguments as unknown as [string, RequestInit];
      const body = new URLSearchParams(args[1].body as string);
      assert.strictEqual(body.get('token_type_hint'), 'refresh_token');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
