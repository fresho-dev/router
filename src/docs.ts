/**
 * @fileoverview OpenAPI documentation generation.
 *
 * Generates OpenAPI 3.0 documentation from router definitions.
 */

import type { SchemaDefinition } from './schema.js';
import type { Router, RouterRoutes, RouteDefinition } from './types.js';
import { isRouter, isRoute } from './types.js';

/** Collects all routes from a router tree. */
function collectRoutes(
  routerDef: Router<RouterRoutes>,
  parentPath = ''
): Array<{ path: string; route: RouteDefinition }> {
  const fullBasePath = parentPath + routerDef.basePath;
  const collectedRoutes: Array<{ path: string; route: RouteDefinition }> = [];

  for (const [, entry] of Object.entries(routerDef.routes)) {
    if (isRouter(entry)) {
      collectedRoutes.push(...collectRoutes(entry, fullBasePath));
    } else if (isRoute(entry)) {
      collectedRoutes.push({ path: fullBasePath + entry.path, route: entry });
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

  for (const { path, route } of allRoutes) {
    const pathKey = path.replace(/:(\w+)/g, '{$1}');

    if (!paths[pathKey]) {
      paths[pathKey] = {};
    }

    const operation: Record<string, unknown> = {
      description: route.description,
      responses: {
        200: { description: 'Successful response' },
        400: { description: 'Validation error' },
      },
    };

    // Add query parameters (only primitive types supported in query strings).
    if (route.query) {
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
    if (route.body && ['post', 'put', 'patch'].includes(route.method)) {
      const bodySchema = route.body as SchemaDefinition;
      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: Object.fromEntries(
                Object.entries(bodySchema).map(([name, type]) => {
                  if (typeof type === 'string') {
                    return [name, { type: type.replace('?', '').replace('[]', '') }];
                  }
                  // Nested object - simplified representation.
                  return [name, { type: 'object' }];
                })
              ),
              required: Object.entries(bodySchema)
                .filter(([, type]) => typeof type === 'string' && !type.endsWith('?'))
                .map(([name]) => name),
            },
          },
        },
      };
    }

    paths[pathKey][route.method] = operation;
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
