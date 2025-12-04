/**
 * Server implementation - defines the API with handlers.
 *
 * Uses property-based routing where:
 * - Property names become URL path segments
 * - `$param` prefix creates dynamic segments (`:param`)
 * - HTTP methods (get, post, etc.) are route handlers
 *
 * To add a path prefix like `/api`, wrap routes in a sub-router:
 *   router({ api: router({ ... }) })
 */

import { route, router, createHttpClient } from '@fresho/router';
import { cors, errorHandler, HttpError } from '@fresho/router/middleware';

// Shared types.
export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
}

// In-memory store (replace with KV, D1, or database in production).
const todos = new Map<string, Todo>();
let nextId = 1;

/** Resets the store (used for testing). */
export function resetStore() {
  todos.clear();
  nextId = 1;
}

/** The API router with handlers. */
export const api = router(
  {
    // Wrap in `api` sub-router to get /api/* paths
    api: router({
      // GET /api/health
      health: router({
        get: route({
          handler: async () => ({ status: 'ok', timestamp: new Date().toISOString() }),
        }),
      }),

      // /api/todos routes
      todos: router({
        // GET /api/todos - list all todos
        get: route({
          query: { completed: 'boolean?' },
          handler: async (c) => {
            let items = Array.from(todos.values());
            if (c.query.completed !== undefined) {
              items = items.filter((t) => t.completed === c.query.completed);
            }
            return { todos: items, count: items.length };
          },
        }),

        // POST /api/todos - create a todo
        post: route({
          body: { title: 'string' },
          handler: async (c) => {
            const id = String(nextId++);
            const todo: Todo = {
              id,
              title: c.body.title,
              completed: false,
              createdAt: new Date().toISOString(),
            };
            todos.set(id, todo);
            return todo;
          },
        }),

        // /api/todos/:id routes
        $id: router({
          // GET /api/todos/:id
          get: route.ctx<{ path: { id: string } }>()({
            handler: async (c) => {
              const todo = todos.get(c.path.id);
              if (!todo) throw new HttpError('Todo not found', 404);
              return todo;
            },
          }),

          // PATCH /api/todos/:id
          patch: route.ctx<{ path: { id: string } }>()({
            body: { title: 'string?', completed: 'boolean?' },
            handler: async (c) => {
              const todo = todos.get(c.path.id);
              if (!todo) throw new HttpError('Todo not found', 404);
              if (c.body.title !== undefined) todo.title = c.body.title;
              if (c.body.completed !== undefined) todo.completed = c.body.completed;
              return todo;
            },
          }),

          // DELETE /api/todos/:id
          delete: route.ctx<{ path: { id: string } }>()({
            handler: async (c) => {
              const existed = todos.delete(c.path.id);
              if (!existed) throw new HttpError('Todo not found', 404);
              return { deleted: true };
            },
          }),
        }),
      }),
    }),
  },
  cors(),
  errorHandler()
);

/** Typed HTTP client - import this on the client side. */
export const client = createHttpClient<typeof api>();
