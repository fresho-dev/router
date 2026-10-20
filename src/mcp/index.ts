/**
 * @fileoverview MCP server adapter for @fresho/router.
 *
 * Exposes routes as Model Context Protocol tools over stateless Streamable HTTP. Each tool call
 * is dispatched as a regular HTTP request through the router, so route middleware (auth, rate
 * limits, logging) applies to agents exactly as it does to other clients.
 *
 * Requires the optional peer dependency `@modelcontextprotocol/sdk`.
 *
 * @example
 * ```typescript
 * import { router } from '@fresho/router';
 * import { mcp } from '@fresho/router/mcp';
 * import { bearerAuth } from '@fresho/router/middleware';
 *
 * const api = router({ users, billing });
 *
 * export default {
 *   fetch: router({
 *     ...api.routes,
 *     mcp: mcp({ users }, { name: 'my-api', version: '1.0.0' }, bearerAuth({ verify })),
 *   }).handler(),
 * };
 * ```
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { router } from '../core.js';
import { collectRoutes } from '../docs.js';
import { type Middleware, type MiddlewareContext, runMiddleware } from '../middleware.js';
import { type SchemaDefinition, toJsonSchema } from '../schema.js';
import type { Context, Router, RouterRoutes, ToolAnnotations } from '../types.js';
import { isRouter } from '../types.js';

/** OAuth 2.0 protected resource settings (RFC 9728). */
export interface McpOAuthOptions {
  /** Issuer URLs of the authorization servers that issue tokens for this server. */
  authorizationServers: string[];
  /** Scopes advertised to clients. */
  scopes?: string[];
}

/** MCP server options. */
export interface McpOptions {
  /** Server name reported to clients. */
  name: string;
  /** Server version reported to clients. */
  version: string;
  /** Instructions for agents on how to use the tools. */
  instructions?: string;
  /** Advertise OAuth: 401s gain a `resource_metadata` challenge and metadata is served. */
  oauth?: McpOAuthOptions;
  /** Allow an endpoint without middleware: it is open, or already guarded by parent routers. */
  public?: boolean;
}

/** Where a flat tool argument goes in the HTTP request. */
type ArgumentSource = 'path' | 'query' | 'body';

/** A tool and the route it calls. */
interface ToolRoute {
  tool: Tool;
  method: string;
  path: string;
  sources: Map<string, ArgumentSource>;
  /** Without a body schema, arguments that aren't path or query fields form the body. */
  hasBodySchema: boolean;
}

const METHODS_WITH_BODY = ['post', 'put', 'patch'];
const CONTEXT_KEYS = new Set(['request', 'path', 'query', 'body', 'env', 'executionCtx']);
// Describe the outer MCP request or connection, not the dispatched tool call.
const DROPPED_HEADERS = [
  'Connection',
  'Content-Encoding',
  'Content-Length',
  'Content-Type',
  'Keep-Alive',
  'Mcp-Protocol-Version',
  'Mcp-Session-Id',
  'Proxy-Connection',
  'TE',
  'Trailer',
  'Transfer-Encoding',
  'Upgrade',
];
const STREAMING_TYPES = /^(text\/event-stream|application\/x-ndjson)/i;
const TOOL_NAME = /^[A-Za-z0-9_-]{1,128}$/;
const DEFAULT_ANNOTATIONS: Record<string, ToolAnnotations> = {
  get: { readOnlyHint: true },
  put: { idempotentHint: true },
  delete: { destructiveHint: true, idempotentHint: true },
};
const TOOL_METHODS = new Set(['get', 'delete', ...METHODS_WITH_BODY]);
const METADATA_PATH = '/.well-known/oauth-protected-resource';

/** Parses JSON, returning undefined for invalid input. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Builds a tool name such as `get_users_by_id` from a method and `{param}` path. */
function toolName(method: string, path: string): string {
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((s) => (s.startsWith('{') ? `by_${s.slice(1, -1)}` : s));
  return [method, ...segments].join('_').replace(/[^A-Za-z0-9_-]/g, '_');
}

/** Derives one tool per route in the tree, with path, query and body fields as flat arguments. */
function collectTools(root: Router<RouterRoutes>): Map<string, ToolRoute> {
  const tools = new Map<string, ToolRoute>();
  for (const { path, method, route } of collectRoutes(root)) {
    if (!TOOL_METHODS.has(method)) continue;
    const name = route?.operationId ?? toolName(method, path);
    // MCP allows up to 128 characters; some clients reject other characters.
    if (!TOOL_NAME.test(name)) throw new Error(`Invalid tool name: ${name}`);
    if (tools.has(name)) throw new Error(`Duplicate tool name: ${name}`);

    const properties: Record<string, object> = {};
    const required: string[] = [];
    const sources = new Map<string, ArgumentSource>();
    const add = (source: ArgumentSource, schema: SchemaDefinition) => {
      const json = toJsonSchema(schema, route?.descriptions);
      for (const [key, property] of Object.entries(json.properties)) {
        if (sources.has(key)) throw new Error(`Duplicate argument ${key} in tool ${name}`);
        sources.set(key, source);
        properties[key] = property as object;
      }
      required.push(...(json.required ?? []));
    };
    const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    add('path', Object.fromEntries(params.map((p) => [p, 'string'])));
    if (route?.query) {
      // Query strings only carry scalars.
      const scalars = Object.entries(route.query as SchemaDefinition).filter(
        ([, type]) => typeof type === 'string' && !type.includes('[]'),
      );
      add('query', Object.fromEntries(scalars));
    }
    const hasBodySchema = !!route?.body && METHODS_WITH_BODY.includes(method);
    if (hasBodySchema) add('body', route?.body as SchemaDefinition);

    tools.set(name, {
      tool: {
        name,
        description: route?.description ?? `${method.toUpperCase()} ${path}`,
        inputSchema: { type: 'object', properties, ...(required.length > 0 && { required }) },
        annotations: { ...DEFAULT_ANNOTATIONS[method], ...route?.mcp?.annotations },
      },
      method,
      path,
      sources,
      hasBodySchema,
    });
  }
  return tools;
}

/** Sends a tool's request through the routes on behalf of the MCP request context `c`. */
type Dispatch = (request: Request, c: Context) => Response | Promise<Response>;

/** Runs a tool as an HTTP request through the router, so its middleware applies. */
async function callTool(
  dispatch: Dispatch,
  target: ToolRoute,
  args: Record<string, unknown>,
  c: Context,
): Promise<CallToolResult> {
  const fail = (text: string): CallToolResult => ({
    content: [{ type: 'text', text }],
    isError: true,
  });
  const pathArgs: Record<string, unknown> = {};
  const queryArgs: Record<string, unknown> = {};
  const bodyArgs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const source = target.sources.get(key) ?? (target.hasBodySchema ? undefined : 'body');
    if (source === 'path') pathArgs[key] = value;
    else if (source === 'query') queryArgs[key] = value;
    else if (source === 'body') bodyArgs[key] = value;
  }
  let missing: string | undefined;
  let invalid: string | undefined;
  const path = target.path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = pathArgs[name];
    if (value === undefined || value === null || value === '') missing ??= name;
    // URL parsing resolves dot segments, which would reach a different route.
    if (value === '.' || value === '..') invalid ??= name;
    return encodeURIComponent(String(value ?? ''));
  });
  if (missing) return fail(`Missing path parameter: ${missing}`);
  if (invalid) return fail(`Invalid path parameter: ${invalid}`);

  const url = new URL(path, c.request.url);
  for (const [key, value] of Object.entries(queryArgs)) {
    if (typeof value === 'object' && value !== null) return fail(`Invalid query parameter: ${key}`);
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  // Forward the caller's headers (Authorization, cookies, ...) but describe the new request.
  const headers = new Headers(c.request.headers);
  for (const name of DROPPED_HEADERS) headers.delete(name);
  headers.set('Accept', 'application/json');
  const hasBody = METHODS_WITH_BODY.includes(target.method);
  if (hasBody) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await dispatch(
      new Request(url, {
        method: target.method.toUpperCase(),
        headers,
        body: hasBody ? JSON.stringify(bodyArgs) : undefined,
      }),
      c,
    );
  } catch (error) {
    console.error(`Error in MCP tool ${target.tool.name}:`, error);
    return fail('Internal error');
  }
  if (STREAMING_TYPES.test(response.headers.get('Content-Type') ?? '')) {
    await response.body?.cancel();
    return fail('Streaming responses are not supported');
  }
  const text = await response.text();
  const result: CallToolResult = { content: [{ type: 'text', text }], isError: !response.ok };
  if (/^application\/json/i.test(response.headers.get('Content-Type') ?? '')) {
    const value = parseJson(text);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result.structuredContent = value as Record<string, unknown>;
    }
  }
  return result;
}

/** Handles one MCP request with a fresh stateless server. */
async function serve(
  tools: Map<string, ToolRoute>,
  dispatch: Dispatch,
  options: McpOptions,
  c: Context,
): Promise<Response> {
  const server = new Server(
    { name: options.name, version: options.version },
    { capabilities: { tools: {} }, instructions: options.instructions },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...tools.values()].map((t) => t.tool),
  }));
  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const target = tools.get(request.params.name);
    if (!target) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
    }
    return callTool(dispatch, target, request.params.arguments ?? {}, c);
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(c.request);
}

/** Adds the RFC 9728 `resource_metadata` parameter to a 401's Bearer challenge. */
function challenge(oauth: McpOAuthOptions): Middleware {
  return async (c, next) => {
    const response = await next();
    if (response.status !== 401) return response;
    const url = new URL(c.request.url);
    const params = [`resource_metadata="${url.origin}${url.pathname}${METADATA_PATH}"`];
    if (oauth.scopes?.length) params.push(`scope="${oauth.scopes.join(' ')}"`);
    const existing = response.headers.get('WWW-Authenticate');
    const value = existing?.startsWith('Bearer ')
      ? `${existing}, ${params.join(', ')}`
      : `Bearer ${params.join(', ')}`;
    const challenged = new Response(response.body, response);
    challenged.headers.set('WWW-Authenticate', value);
    return challenged;
  };
}

/** Serves protected resource metadata for the resource named by the request path. */
function metadata(oauth: McpOAuthOptions) {
  return (c: Context) => {
    const url = new URL(c.request.url);
    const resource = url.pathname.replace(METADATA_PATH, '');
    return Response.json({
      resource: `${url.origin}${resource}`,
      authorization_servers: oauth.authorizationServers,
      ...(oauth.scopes && { scopes_supported: oauth.scopes }),
      bearer_methods_supported: ['header'],
    });
  };
}

/**
 * Creates an MCP endpoint exposing routes as tools.
 *
 * Mount the result in a router (e.g. `mcp: mcp({ users }, options, auth)`). Tool names come from
 * `route.operationId` or the method and path (`get_users`, `delete_users_by_id`), descriptions
 * from `route.description`, and flat inputs from the route's path params and query/body schemas.
 *
 * Middleware passed after `options` guards the endpoint itself, and is required unless
 * `options.public` is set; put auth there so unauthenticated
 * clients get an HTTP 401 (with an OAuth challenge when `oauth` is set). Context it adds reaches
 * handlers. Middleware on the given routers runs on every tool call, with the caller's headers
 * forwarded; middleware on their parents elsewhere in the app does not.
 *
 * With `oauth`, metadata is served at `<endpoint>/.well-known/oauth-protected-resource` and
 * referenced from the 401 challenge. Mount {@link oauthProtectedResource} at the origin root as
 * well for clients that probe `/.well-known/oauth-protected-resource/<endpoint>` first.
 *
 * @param routes - A router, or a record of routers mounted under their keys
 * @param options - Server info and optional OAuth settings
 * @param middleware - Middleware for the MCP endpoint
 */
export function mcp(
  routes: Router<RouterRoutes> | Record<string, Router<RouterRoutes>>,
  options: McpOptions,
  ...middleware: Middleware[]
): Router<RouterRoutes> {
  if (middleware.length === 0 && options.public !== true) {
    throw new Error('mcp() needs endpoint middleware such as auth, or public: true');
  }
  const base = isRouter(routes) ? routes : router(routes as RouterRoutes);
  const tools = collectTools(base);

  // Context set by middleware on the endpoint and its parents, keyed by dispatched request.
  const inherited = new WeakMap<Request, Record<string, unknown>>();
  const inherit: Middleware = (c, next) => {
    Object.assign(c, inherited.get(c.request));
    return next();
  };
  const fetchRoute = router(base.routes, inherit, ...(base.middleware ?? [])).handler();
  const dispatch: Dispatch = (request, c) => {
    inherited.set(
      request,
      Object.fromEntries(Object.entries(c).filter(([key]) => !CONTEXT_KEYS.has(key))),
    );
    return fetchRoute(request, c.env, c.executionCtx);
  };

  const chain = options.oauth ? [challenge(options.oauth), ...middleware] : middleware;
  const notAllowed = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });

  return router({
    post: (c) => {
      // The MCP spec requires Origin validation against DNS rebinding.
      const origin = c.request.headers.get('Origin');
      if (origin && origin !== new URL(c.request.url).origin) {
        return new Response('Forbidden origin', { status: 403 });
      }
      return runMiddleware(chain, c as MiddlewareContext, () => serve(tools, dispatch, options, c));
    },
    get: notAllowed,
    delete: notAllowed,
    ...(options.oauth && {
      '.well-known': router({
        'oauth-protected-resource': router({ get: metadata(options.oauth) }),
      }),
    }),
  });
}

/**
 * Creates RFC 9728 protected resource metadata routes to mount as `'.well-known'` at the origin
 * root, serving `/.well-known/oauth-protected-resource` and
 * `/.well-known/oauth-protected-resource/<resource>` for single-segment resource paths like `/mcp`.
 *
 * @example
 * ```typescript
 * router({
 *   mcp: mcp({ users }, { name: 'api', version: '1.0.0', oauth }, jwtAuth({ ... })),
 *   '.well-known': oauthProtectedResource(oauth),
 * });
 * ```
 */
export function oauthProtectedResource(oauth: McpOAuthOptions): Router<RouterRoutes> {
  const get = metadata(oauth);
  return router({ 'oauth-protected-resource': router({ get, $resource: router({ get }) }) });
}
