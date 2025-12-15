import assert from 'node:assert';
import { describe, it } from 'node:test';
import type { IsAny, RemoveIndex, RequiresProperty } from './client-types.js';

describe('client-types', () => {
  describe('IsAny', () => {
    it('returns true for any', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type T = IsAny<any>;
      const t: T = true;
      assert.strictEqual(t, true);
    });

    it('returns false for unknown', () => {
      type T = IsAny<unknown>;
      const t: T = false;
      assert.strictEqual(t, false);
    });

    it('returns false for primitives', () => {
      type T = IsAny<string>;
      const t: T = false;
      assert.strictEqual(t, false);
    });

    it('returns false for objects', () => {
      type T = IsAny<{ a: 1 }>;
      const t: T = false;
      assert.strictEqual(t, false);
    });
  });

  describe('RemoveIndex', () => {
    it('removes string index signature', () => {
      type WithIndex = { [key: string]: number; a: number };
      type WithoutIndex = RemoveIndex<WithIndex>;

      // Should allow specific keys
      const _t: WithoutIndex = { a: 1 };

      // @ts-expect-error - Should not allow arbitrary keys
      const _fail: WithoutIndex = { b: 2 };

      assert.ok(true);
    });

    it('removes number index signature', () => {
      type WithIndex = { [key: number]: string; 0: string };
      type WithoutIndex = RemoveIndex<WithIndex>;

      const _t: WithoutIndex = { 0: 'a' };

      // @ts-expect-error - Should not allow arbitrary numbers
      const _fail: WithoutIndex = { 1: 'b' };

      assert.ok(true);
    });
  });

  describe('RequiresProperty', () => {
    it('returns false for any', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type T = RequiresProperty<any>;
      const t: T = false;
      assert.strictEqual(t, false);
    });

    it('returns true for schema definitions', () => {
      type T = RequiresProperty<{ a: 'string' }>;
      const t: T = true;
      assert.strictEqual(t, true);
    });
  });
});
