/**
 * Tests using localClient - no HTTP overhead.
 *
 * Run with: npx tsx --test server.test.ts
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { api, resetStore, type Todo } from './server.js';

describe('Todo API', () => {
  const client = api.localClient();

  beforeEach(() => {
    resetStore();
  });

  describe('health', () => {
    it('returns ok status', async () => {
      const result = (await client.health()) as { status: string; timestamp: string };
      assert.strictEqual(result.status, 'ok');
      assert.ok(result.timestamp);
    });
  });

  describe('todos.create', () => {
    it('creates a todo with the given title', async () => {
      const todo = (await client.todos.create({ body: { title: 'Test todo' } })) as Todo;

      assert.strictEqual(todo.title, 'Test todo');
      assert.strictEqual(todo.completed, false);
      assert.ok(todo.id);
      assert.ok(todo.createdAt);
    });

    it('assigns incrementing IDs', async () => {
      const todo1 = (await client.todos.create({ body: { title: 'First' } })) as Todo;
      const todo2 = (await client.todos.create({ body: { title: 'Second' } })) as Todo;

      assert.strictEqual(todo1.id, '1');
      assert.strictEqual(todo2.id, '2');
    });
  });

  describe('todos.list', () => {
    it('returns empty list initially', async () => {
      const result = (await client.todos.list()) as { todos: Todo[]; count: number };

      assert.deepStrictEqual(result.todos, []);
      assert.strictEqual(result.count, 0);
    });

    it('returns all todos', async () => {
      await client.todos.create({ body: { title: 'First' } });
      await client.todos.create({ body: { title: 'Second' } });

      const result = (await client.todos.list()) as { todos: Todo[]; count: number };

      assert.strictEqual(result.count, 2);
      assert.strictEqual(result.todos[0].title, 'First');
      assert.strictEqual(result.todos[1].title, 'Second');
    });

    it('filters by completed status', async () => {
      await client.todos.create({ body: { title: 'Incomplete' } });
      const completed = (await client.todos.create({ body: { title: 'Done' } })) as Todo;
      await client.todos.update({ path: { id: completed.id }, body: { completed: true } });

      const pendingResult = (await client.todos.list({ query: { completed: false } })) as {
        todos: Todo[];
      };
      assert.strictEqual(pendingResult.todos.length, 1);
      assert.strictEqual(pendingResult.todos[0].title, 'Incomplete');

      const completedResult = (await client.todos.list({ query: { completed: true } })) as {
        todos: Todo[];
      };
      assert.strictEqual(completedResult.todos.length, 1);
      assert.strictEqual(completedResult.todos[0].title, 'Done');
    });
  });

  describe('todos.get', () => {
    it('returns a todo by ID', async () => {
      const created = (await client.todos.create({ body: { title: 'Test' } })) as Todo;

      const fetched = (await client.todos.get({ path: { id: created.id } })) as Todo;

      assert.strictEqual(fetched.id, created.id);
      assert.strictEqual(fetched.title, 'Test');
    });
  });

  describe('todos.update', () => {
    it('updates the title', async () => {
      const created = (await client.todos.create({ body: { title: 'Original' } })) as Todo;

      const updated = (await client.todos.update({
        path: { id: created.id },
        body: { title: 'Updated' },
      })) as Todo;

      assert.strictEqual(updated.title, 'Updated');
      assert.strictEqual(updated.completed, false);
    });

    it('updates the completed status', async () => {
      const created = (await client.todos.create({ body: { title: 'Test' } })) as Todo;

      const updated = (await client.todos.update({
        path: { id: created.id },
        body: { completed: true },
      })) as Todo;

      assert.strictEqual(updated.completed, true);
      assert.strictEqual(updated.title, 'Test');
    });

    it('updates both title and completed', async () => {
      const created = (await client.todos.create({ body: { title: 'Original' } })) as Todo;

      const updated = (await client.todos.update({
        path: { id: created.id },
        body: { title: 'New title', completed: true },
      })) as Todo;

      assert.strictEqual(updated.title, 'New title');
      assert.strictEqual(updated.completed, true);
    });
  });

  describe('todos.delete', () => {
    it('deletes a todo', async () => {
      const created = (await client.todos.create({ body: { title: 'To delete' } })) as Todo;

      const result = (await client.todos.delete({ path: { id: created.id } })) as { deleted: boolean };
      assert.strictEqual(result.deleted, true);

      const list = (await client.todos.list()) as { todos: Todo[]; count: number };
      assert.strictEqual(list.count, 0);
    });
  });
});
