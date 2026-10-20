/**
 * @fileoverview OpenAPI documentation generation.
 *
 * Generates OpenAPI 3.0 documentation from router definitions.
 *
 * **Path Convention:**
 * - Property names = URL path segments
 * - `$param` prefix = dynamic segment (`{param}` in OpenAPI)
 * - `get`, `post`, `put`, `patch`, `delete` = HTTP method handlers
 */

import { type SchemaDefinition, toJsonSchema } from './schema.js';
import type { RouteDefinition, Router, RouterRoutes } from './types.js';
import { HTTP_METHODS, isFunction, isRoute, isRouter } from './types.js';

/** Collected route info for documentation. */
export interface CollectedRoute {
  path: string;
  method: string;
  route: RouteDefinition | null;
}

/** Converts property name to path segment, handling $param convention. */
function propertyToSegment(prop: string): string {
  if (prop.startsWith('$')) {
    return `{${prop.slice(1)}}`;
  }
  return prop;
}

/** Collects all routes from a router tree, with `{param}` path segments. */
export function collectRoutes(routerDef: Router<RouterRoutes>, parentPath = ''): CollectedRoute[] {
  const collectedRoutes: CollectedRoute[] = [];

  for (const [prop, entry] of Object.entries(routerDef.routes)) {
    // Check if this is a method handler.
    if (HTTP_METHODS.has(prop)) {
      const path = parentPath || '/';
      if (isFunction(entry)) {
        collectedRoutes.push({ path, method: prop, route: null });
      } else if (isRoute(entry)) {
        collectedRoutes.push({ path, method: prop, route: entry });
      }
    } else if (isRouter(entry)) {
      // Nested router - recurse with updated path.
      const segment = propertyToSegment(prop);
      const newPath = parentPath ? `${parentPath}/${segment}` : `/${segment}`;
      collectedRoutes.push(...collectRoutes(entry, newPath));
    }
  }

  return collectedRoutes;
}

/** Generates OpenAPI documentation from a router. */
export function generateDocs(config: {
  title: string;
  version: string;
  description?: string;
  router: Router<RouterRoutes>;
}): object {
  const paths: Record<string, Record<string, object>> = {};
  const allRoutes = collectRoutes(config.router);

  for (const { path, method, route } of allRoutes) {
    if (!paths[path]) {
      paths[path] = {};
    }

    const operation: Record<string, unknown> = {
      description: route?.description,
      responses: {
        200: { description: 'Successful response' },
        400: { description: 'Validation error' },
      },
    };

    // Add query parameters (only primitive types supported in query strings).
    if (route?.query) {
      const querySchema = route.query as SchemaDefinition;
      operation.parameters = Object.entries(querySchema)
        .filter(([, type]) => typeof type === 'string')
        .map(([name, type]) => ({
          name,
          in: 'query',
          required: !(type as string).endsWith('?'),
          schema: { type: (type as string).replace('?', '').replace('[]', '') },
        }));
    }

    // Add request body.
    if (route?.body && ['post', 'put', 'patch'].includes(method)) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: toJsonSchema(route.body as SchemaDefinition) } },
      };
    }

    paths[path][method] = operation;
  }

  return {
    openapi: '3.0.0',
    info: {
      title: config.title,
      version: config.version,
      description: config.description,
    },
    paths,
  };
}
