/**
 * Server implementation - defines the API with handlers.
 */

import { route, router, createHttpClient } from 'typed-routes';
import { cors, errorHandler, HttpError } from 'typed-routes/middleware';

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
  '/api',
  {
    health: route({
      method: 'get',
      path: '/health',
      handler: async () => ({ status: 'ok', timestamp: new Date().toISOString() }),
    }),

    todos: router('/todos', {
      list: route({
        method: 'get',
        path: '',
        query: { completed: 'boolean?' },
        handler: async (c) => {
          let items = Array.from(todos.values());
          if (c.query.completed !== undefined) {
            items = items.filter((t) => t.completed === c.query.completed);
          }
          return { todos: items, count: items.length };
        },
      }),

      get: route({
        method: 'get',
        path: '/:id',
        handler: async (c) => {
          const todo = todos.get(c.path.id);
          if (!todo) throw new HttpError('Todo not found', 404);
          return todo;
        },
      }),

      create: route({
        method: 'post',
        path: '',
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

      update: route({
        method: 'patch',
        path: '/:id',
        body: { title: 'string?', completed: 'boolean?' },
        handler: async (c) => {
          const todo = todos.get(c.path.id);
          if (!todo) throw new HttpError('Todo not found', 404);
          if (c.body.title !== undefined) todo.title = c.body.title;
          if (c.body.completed !== undefined) todo.completed = c.body.completed;
          return todo;
        },
      }),

      delete: route({
        method: 'delete',
        path: '/:id',
        handler: async (c) => {
          const existed = todos.delete(c.path.id);
          if (!existed) throw new HttpError('Todo not found', 404);
          return { deleted: true };
        },
      }),
    }),
  },
  [cors(), errorHandler()]
);

/** Typed HTTP client - import this on the client side. */
export const client = createHttpClient(api);
