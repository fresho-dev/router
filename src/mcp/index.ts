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
 *
 * const api = router({ users, billing });
 *
 * export default {
 *   fetch: router({
 *     ...api.routes,
 *     mcp: mcp({ users }, { name: 'my-api', version: '1.0.0' }),
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
import type { Context, Router, RouterRoutes } from '../types.js';
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
}

/** A tool and the route it calls. */
interface ToolRoute {
  tool: Tool;
  method: string;
  path: string;
}

const METHODS_WITH_BODY = ['post', 'put', 'patch'];
const TOOL_METHODS = new Set(['get', 'delete', ...METHODS_WITH_BODY]);
const METADATA_PATH = '/.well-known/oauth-protected-resource';

/** Returns `value` if it is a plain object, else an empty one; tool arguments are not validated. */
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Builds a tool name such as `get_users_by_id` from a method and `{param}` path. */
function toolName(method: string, path: string): string {
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((s) => (s.startsWith('{') ? `by_${s.slice(1, -1)}` : s));
  return [method, ...segments].join('_').replace(/[^A-Za-z0-9_.-]/g, '_');
}

/** Derives one tool per route in the tree. */
function collectTools(root: Router<RouterRoutes>): Map<string, ToolRoute> {
  const tools = new Map<string, ToolRoute>();
  for (const { path, method, route } of collectRoutes(root)) {
    if (!TOOL_METHODS.has(method)) continue;
    const name = toolName(method, path);
    if (tools.has(name)) throw new Error(`Duplicate tool name: ${name}`);

    const properties: Record<string, object> = {};
    const required: string[] = [];
    const add = (key: string, schema: ReturnType<typeof toJsonSchema>) => {
      if (Object.keys(schema.properties).length === 0) return;
      properties[key] = schema;
      if (schema.required.length > 0) required.push(key);
    };
    const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    add('path', toJsonSchema(Object.fromEntries(params.map((p) => [p, 'string']))));
    if (route?.query) {
      // Query strings only carry scalars.
      const scalars = Object.entries(route.query as SchemaDefinition).filter(
        ([, type]) => typeof type === 'string' && !type.includes('[]'),
      );
      add('query', toJsonSchema(Object.fromEntries(scalars)));
    }
    if (route?.body && METHODS_WITH_BODY.includes(method)) {
      add('body', toJsonSchema(route.body as SchemaDefinition));
    }

    tools.set(name, {
      tool: {
        name,
        description: route?.description ?? `${method.toUpperCase()} ${path}`,
        inputSchema: { type: 'object', properties, required },
      },
      method,
      path,
    });
  }
  return tools;
}

/** Runs a tool as an HTTP request through the router, so its middleware applies. */
async function callTool(
  fetchRoute: ReturnType<Router<RouterRoutes>['handler']>,
  target: ToolRoute,
  args: Record<string, unknown>,
  c: Context,
): Promise<CallToolResult> {
  const fail = (text: string): CallToolResult => ({
    content: [{ type: 'text', text }],
    isError: true,
  });
  const pathArgs = record(args.path);
  let missing: string | undefined;
  const path = target.path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = pathArgs[name];
    if (value === undefined || value === null || value === '') missing ??= name;
    return encodeURIComponent(String(value ?? ''));
  });
  if (missing) return fail(`Missing path parameter: ${missing}`);

  const url = new URL(path, c.request.url);
  for (const [key, value] of Object.entries(record(args.query))) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  // Forward the caller's headers (Authorization, cookies, ...) but describe the new request.
  const headers = new Headers(c.request.headers);
  for (const name of ['Content-Length', 'Content-Type', 'Mcp-Session-Id', 'Mcp-Protocol-Version']) {
    headers.delete(name);
  }
  headers.set('Accept', 'application/json');
  const hasBody = METHODS_WITH_BODY.includes(target.method);
  if (hasBody) headers.set('Content-Type', 'application/json');

  const response = await fetchRoute(
    new Request(url, {
      method: target.method.toUpperCase(),
      headers,
      body: hasBody ? JSON.stringify(args.body ?? {}) : undefined,
    }),
    c.env,
    c.executionCtx,
  );
  return { content: [{ type: 'text', text: await response.text() }], isError: !response.ok };
}

/** Handles one MCP request with a fresh stateless server. */
async function serve(
  tools: Map<string, ToolRoute>,
  fetchRoute: ReturnType<Router<RouterRoutes>['handler']>,
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
    return callTool(fetchRoute, target, request.params.arguments ?? {}, c);
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
 * Mount the result in a router (e.g. `mcp: mcp({ users }, options)`). Tool names come from the
 * method and path (`get_users`, `delete_users_by_id`), descriptions from `route.description`, and
 * inputs from the route's path params and query/body schemas as `{ path, query, body }`.
 *
 * Middleware passed after `options` guards the endpoint itself; put auth there so unauthenticated
 * clients get an HTTP 401 (with an OAuth challenge when `oauth` is set). Route middleware still
 * runs on every tool call, with the caller's headers forwarded.
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
  const root = isRouter(routes) ? routes : router(routes as RouterRoutes);
  const tools = collectTools(root);
  const fetchRoute = root.handler();
  const chain = options.oauth ? [challenge(options.oauth), ...middleware] : middleware;
  const notAllowed = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });

  return router({
    post: (c) =>
      runMiddleware(chain, c as MiddlewareContext, () => serve(tools, fetchRoute, options, c)),
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
