import { describe, it } from 'node:test';
import assert from 'node:assert';
import { compileSchema } from './schema.js';

describe('schema', () => {
  describe('compileSchema()', () => {
    it('compiles string type', () => {
      const schema = compileSchema({ name: 'string' });
      const result = schema.safeParse({ name: 'alice' });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.name, 'alice');
      }
    });

    it('compiles number type with coercion', () => {
      const schema = compileSchema({ count: 'number' });
      const result = schema.safeParse({ count: '42' });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.count, 42);
      }
    });

    it('compiles boolean type with coercion', () => {
      const schema = compileSchema({ active: 'boolean' });
      const result = schema.safeParse({ active: 'true' });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.active, true);
      }
    });

    it('compiles optional string type', () => {
      const schema = compileSchema({ name: 'string?' });

      const withValue = schema.safeParse({ name: 'alice' });
      assert.strictEqual(withValue.success, true);

      const withoutValue = schema.safeParse({});
      assert.strictEqual(withoutValue.success, true);
    });

    it('compiles optional number type', () => {
      const schema = compileSchema({ count: 'number?' });

      const withValue = schema.safeParse({ count: '42' });
      assert.strictEqual(withValue.success, true);

      const withoutValue = schema.safeParse({});
      assert.strictEqual(withoutValue.success, true);
    });

    it('compiles optional boolean type', () => {
      const schema = compileSchema({ active: 'boolean?' });

      const withValue = schema.safeParse({ active: 'true' });
      assert.strictEqual(withValue.success, true);

      const withoutValue = schema.safeParse({});
      assert.strictEqual(withoutValue.success, true);
    });

    it('fails for missing required string', () => {
      const schema = compileSchema({ name: 'string' });
      const result = schema.safeParse({});
      assert.strictEqual(result.success, false);
    });

    it('fails for missing required number', () => {
      const schema = compileSchema({ count: 'number' });
      const result = schema.safeParse({});
      assert.strictEqual(result.success, false);
    });

    it('fails for invalid number', () => {
      const schema = compileSchema({ count: 'number' });
      const result = schema.safeParse({ count: 'not-a-number' });
      assert.strictEqual(result.success, false);
    });

    it('compiles multiple fields', () => {
      const schema = compileSchema({
        name: 'string',
        age: 'number',
        active: 'boolean',
        nickname: 'string?',
      });

      const result = schema.safeParse({
        name: 'alice',
        age: '30',
        active: 'true',
      });

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.name, 'alice');
        assert.strictEqual(result.data.age, 30);
        assert.strictEqual(result.data.active, true);
        assert.strictEqual(result.data.nickname, undefined);
      }
    });

    it('throws for unknown type', () => {
      assert.throws(
        () => compileSchema({ field: 'unknown' as 'string' }),
        /Unknown type/
      );
    });

    it('compiles empty schema', () => {
      const schema = compileSchema({});
      const result = schema.safeParse({});
      assert.strictEqual(result.success, true);
    });

    it('strips unknown fields', () => {
      const schema = compileSchema({ name: 'string' });
      const result = schema.safeParse({ name: 'alice', extra: 'ignored' });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.name, 'alice');
        assert.strictEqual('extra' in result.data, false);
      }
    });
  });
});
