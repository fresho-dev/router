import assert from 'node:assert';
import { describe, it } from 'node:test';
import { compileSchema, toJsonSchema } from './schema.js';

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

    it('correctly coerces "false" string to false (not truthy)', () => {
      const schema = compileSchema({ active: 'boolean' });
      const result = schema.safeParse({ active: 'false' });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.active, false);
      }
    });

    it('correctly coerces "0" string to false', () => {
      const schema = compileSchema({ active: 'boolean' });
      const result = schema.safeParse({ active: '0' });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.active, false);
      }
    });

    it('correctly coerces "1" string to true', () => {
      const schema = compileSchema({ active: 'boolean' });
      const result = schema.safeParse({ active: '1' });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.active, true);
      }
    });

    it('rejects invalid boolean values', () => {
      const schema = compileSchema({ active: 'boolean' });
      const result = schema.safeParse({ active: 'yes' });
      assert.strictEqual(result.success, false);
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

    it('treats null as missing for optional fields', () => {
      const schema = compileSchema({
        name: 'string?',
        count: 'number?',
        active: 'boolean?',
        tags: 'string[]?',
        extra: 'unknown?',
      });
      const result = schema.safeParse({
        name: null,
        count: null,
        active: null,
        tags: null,
        extra: null,
      });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.data, {});
      }
    });

    it('fails with Required when null is passed for required fields', () => {
      const schema = compileSchema({
        name: 'string',
        count: 'number',
        active: 'boolean',
        tags: 'string[]',
        extra: 'unknown',
      });
      const result = schema.safeParse({
        name: null,
        count: null,
        active: null,
        tags: null,
        extra: null,
      });
      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.deepStrictEqual(result.error.flatten().fieldErrors, {
          name: ['Required'],
          count: ['Required'],
          active: ['Required'],
          tags: ['Required'],
          extra: ['Required'],
        });
      }
    });

    it('handles null root data without throwing', () => {
      const required = compileSchema({ name: 'string' });
      const reqResult = required.safeParse(null as unknown as object);
      assert.strictEqual(reqResult.success, false);

      const optional = compileSchema({ name: 'string?' });
      const optResult = optional.safeParse(null as unknown as object);
      assert.strictEqual(optResult.success, true);
      if (optResult.success) {
        assert.deepStrictEqual(optResult.data, {});
      }
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

    it('throws for invalid type', () => {
      assert.throws(() => compileSchema({ field: 'invalid_type' as 'string' }), /Unknown type/);
    });

    it('validates unknown type', () => {
      const schema = compileSchema({ data: 'unknown' });
      const result = schema.safeParse({ data: { nested: true, value: 123 } });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.data.data, { nested: true, value: 123 });
      }
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

    // Array types
    it('compiles string array type', () => {
      const schema = compileSchema({ tags: 'string[]' });
      const result = schema.safeParse({ tags: ['a', 'b', 'c'] });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.data.tags, ['a', 'b', 'c']);
      }
    });

    it('compiles number array type', () => {
      const schema = compileSchema({ scores: 'number[]' });
      const result = schema.safeParse({ scores: [1, 2, 3] });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.data.scores, [1, 2, 3]);
      }
    });

    it('coerces number array elements from strings', () => {
      const schema = compileSchema({ scores: 'number[]' });
      const result = schema.safeParse({ scores: ['1', '2', '3'] });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.data.scores, [1, 2, 3]);
      }
    });

    it('compiles boolean array type', () => {
      const schema = compileSchema({ flags: 'boolean[]' });
      const result = schema.safeParse({ flags: [true, false, true] });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.data.flags, [true, false, true]);
      }
    });

    it('fails for non-array when array expected', () => {
      const schema = compileSchema({ tags: 'string[]' });
      const result = schema.safeParse({ tags: 'not-an-array' });
      assert.strictEqual(result.success, false);
    });

    it('fails for invalid element in array', () => {
      const schema = compileSchema({ scores: 'number[]' });
      const result = schema.safeParse({ scores: [1, 'not-a-number', 3] });
      assert.strictEqual(result.success, false);
    });

    it('rejects null or non-primitive elements in arrays', () => {
      const strings = compileSchema({ tags: 'string[]' });
      assert.strictEqual(strings.safeParse({ tags: ['a', null] }).success, false);
      assert.strictEqual(strings.safeParse({ tags: ['a', undefined] }).success, false);
      assert.strictEqual(strings.safeParse({ tags: ['a', false] }).success, false);
      assert.strictEqual(strings.safeParse({ tags: ['a', {}] }).success, false);

      const numbers = compileSchema({ scores: 'number[]' });
      assert.strictEqual(numbers.safeParse({ scores: [1, null] }).success, false);
      assert.strictEqual(numbers.safeParse({ scores: [1, undefined] }).success, false);
      assert.strictEqual(numbers.safeParse({ scores: [1, ''] }).success, false);
      assert.strictEqual(numbers.safeParse({ scores: [1, '   '] }).success, false);
      assert.strictEqual(numbers.safeParse({ scores: [1, false] }).success, false);
      assert.strictEqual(
        numbers.safeParse({ scores: [1, Number.POSITIVE_INFINITY] }).success,
        false,
      );
    });

    it('compiles optional array type', () => {
      const schema = compileSchema({ tags: 'string[]?' });

      const withValue = schema.safeParse({ tags: ['a', 'b'] });
      assert.strictEqual(withValue.success, true);

      const withoutValue = schema.safeParse({});
      assert.strictEqual(withoutValue.success, true);
    });

    it('accepts empty array', () => {
      const schema = compileSchema({ tags: 'string[]' });
      const result = schema.safeParse({ tags: [] });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.data.tags, []);
      }
    });

    // Nested object types
    it('compiles nested object schema', () => {
      const schema = compileSchema({
        address: { street: 'string', city: 'string' },
      });
      const result = schema.safeParse({
        address: { street: '123 Main St', city: 'Springfield' },
      });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.data.address, {
          street: '123 Main St',
          city: 'Springfield',
        });
      }
    });

    it('validates nested object fields', () => {
      const schema = compileSchema({
        address: { street: 'string', zip: 'number' },
      });
      const result = schema.safeParse({
        address: { street: '123 Main St' }, // missing zip
      });
      assert.strictEqual(result.success, false);
    });

    it('compiles deeply nested objects', () => {
      const schema = compileSchema({
        user: {
          name: 'string',
          contact: {
            email: 'string',
            phone: 'string?',
          },
        },
      });
      const result = schema.safeParse({
        user: {
          name: 'Alice',
          contact: { email: 'alice@example.com' },
        },
      });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.user.name, 'Alice');
        assert.strictEqual(result.data.user.contact.email, 'alice@example.com');
      }
    });

    it('compiles optional nested object', () => {
      const schema = compileSchema({
        name: 'string',
        metadata: { tags: 'string[]', priority: 'number?' },
      });

      const withMeta = schema.safeParse({
        name: 'test',
        metadata: { tags: ['a'], priority: 1 },
      });
      assert.strictEqual(withMeta.success, true);
    });

    it('fails for non-object when nested object expected', () => {
      const schema = compileSchema({
        address: { street: 'string' },
      });
      const result = schema.safeParse({ address: 'not-an-object' });
      assert.strictEqual(result.success, false);
    });

    it('compiles and infers [type, description] tuple fields', () => {
      const schema = compileSchema({
        name: ['string', 'User full name'],
        age: ['number?', 'Optional age in years'],
        tags: ['string[]?', 'Optional tags'],
        address: {
          city: ['string', 'City of residence'],
        },
      });

      const result = schema.safeParse({
        name: 'Alice',
        age: '30',
        address: { city: 'London' },
      });
      assert.strictEqual(result.success, true);
      if (result.success) {
        const name: string = result.data.name;
        const age: number | undefined = result.data.age;
        const tags: string[] | undefined = result.data.tags;
        const city: string = result.data.address.city;
        assert.strictEqual(name, 'Alice');
        assert.strictEqual(age, 30);
        assert.strictEqual(tags, undefined);
        assert.strictEqual(city, 'London');
      }

      const missingRequired = schema.safeParse({ address: { city: 'London' } });
      assert.strictEqual(missingRequired.success, false);
    });

    it('throws for invalid tuple definitions', () => {
      assert.throws(
        () => compileSchema({ field: ['invalid_type', 'desc'] as unknown as ['string', string] }),
        /Unknown type/,
      );
      assert.throws(
        () => compileSchema({ field: ['string'] as unknown as ['string', string] }),
        /Invalid field definition/,
      );
    });

    it('includes tuple descriptions in toJsonSchema', () => {
      const json = toJsonSchema({
        name: ['string', 'Full name'],
        age: 'number?',
        tags: ['string[]?', 'Labels'],
        address: {
          city: ['string', 'City of residence'],
        },
      });
      assert.deepStrictEqual(json, {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Full name' },
          age: { type: 'number' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Labels' },
          address: {
            type: 'object',
            properties: {
              city: { type: 'string', description: 'City of residence' },
            },
            required: ['city'],
          },
        },
        required: ['name', 'address'],
      });
    });
  });
});
