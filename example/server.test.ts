/**
 * Tests using localClient - no HTTP overhead.
 *
 * Run with: npx tsx --test server.test.ts
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createLocalClient } from '@fresho/router';
import { api, resetStore } from './server.js';

describe('Todo API', () => {
  const client = createLocalClient(api);

  beforeEach(() => {
    resetStore();
  });

  describe('health', () => {
    it('returns ok status', async () => {
      const result = await client.api.health();
      assert.strictEqual(result.status, 'ok');
      assert.ok(result.timestamp);
    });
  });

  describe('todos.post (create)', () => {
    it('creates a todo with the given title', async () => {
      const todo = await client.api.todos.$post({ body: { title: 'Test todo' } });

      assert.strictEqual(todo.title, 'Test todo');
      assert.strictEqual(todo.completed, false);
      assert.ok(todo.id);
      assert.ok(todo.createdAt);
    });

    it('assigns incrementing IDs', async () => {
      const todo1 = await client.api.todos.$post({ body: { title: 'First' } });
      const todo2 = await client.api.todos.$post({ body: { title: 'Second' } });

      assert.strictEqual(todo1.id, '1');
      assert.strictEqual(todo2.id, '2');
    });
  });

  describe('todos (list)', () => {
    it('returns empty list initially', async () => {
      const result = await client.api.todos();

      assert.deepStrictEqual(result.todos, []);
      assert.strictEqual(result.count, 0);
    });

    it('returns all todos', async () => {
      await client.api.todos.$post({ body: { title: 'First' } });
      await client.api.todos.$post({ body: { title: 'Second' } });

      const result = await client.api.todos();

      assert.strictEqual(result.count, 2);
      assert.strictEqual(result.todos[0].title, 'First');
      assert.strictEqual(result.todos[1].title, 'Second');
    });

    it('filters by completed status', async () => {
      await client.api.todos.$post({ body: { title: 'Incomplete' } });
      const completed = await client.api.todos.$post({ body: { title: 'Done' } });
      await client.api.todos.$id.$patch({ path: { id: completed.id }, body: { completed: true } });

      const pendingResult = await client.api.todos({ query: { completed: false } });
      assert.strictEqual(pendingResult.todos.length, 1);
      assert.strictEqual(pendingResult.todos[0].title, 'Incomplete');

      const completedResult = await client.api.todos({ query: { completed: true } });
      assert.strictEqual(completedResult.todos.length, 1);
      assert.strictEqual(completedResult.todos[0].title, 'Done');
    });
  });

  describe('todos.$id (get by id)', () => {
    it('returns a todo by ID', async () => {
      const created = await client.api.todos.$post({ body: { title: 'Test' } });

      const fetched = await client.api.todos.$id({ path: { id: created.id } });

      assert.strictEqual(fetched.id, created.id);
      assert.strictEqual(fetched.title, 'Test');
    });
  });

  describe('todos.$id.patch (update)', () => {
    it('updates the title', async () => {
      const created = await client.api.todos.$post({ body: { title: 'Original' } });

      const updated = await client.api.todos.$id.$patch({
        path: { id: created.id },
        body: { title: 'Updated' },
      });

      assert.strictEqual(updated.title, 'Updated');
      assert.strictEqual(updated.completed, false);
    });

    it('updates the completed status', async () => {
      const created = await client.api.todos.$post({ body: { title: 'Test' } });

      const updated = await client.api.todos.$id.$patch({
        path: { id: created.id },
        body: { completed: true },
      });

      assert.strictEqual(updated.completed, true);
      assert.strictEqual(updated.title, 'Test');
    });

    it('updates both title and completed', async () => {
      const created = await client.api.todos.$post({ body: { title: 'Original' } });

      const updated = await client.api.todos.$id.$patch({
        path: { id: created.id },
        body: { title: 'New title', completed: true },
      });

      assert.strictEqual(updated.title, 'New title');
      assert.strictEqual(updated.completed, true);
    });
  });

  describe('todos.$id.delete', () => {
    it('deletes a todo', async () => {
      const created = await client.api.todos.$post({ body: { title: 'To delete' } });

      const result = await client.api.todos.$id.$delete({ path: { id: created.id } });
      assert.strictEqual(result.deleted, true);

      const list = await client.api.todos();
      assert.strictEqual(list.count, 0);
    });
  });
});
