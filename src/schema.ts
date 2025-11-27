/**
 * @fileoverview Schema types and compilation utilities.
 *
 * Provides shorthand schema definitions and compiles them to Zod schemas.
 */

import type { ZodObject, ZodRawShape } from 'zod';
import { z } from 'zod';

/** Supported primitive types in schema shorthand. */
export type SchemaType = 'string' | 'number' | 'boolean' | 'string?' | 'number?' | 'boolean?';

/** Schema definition using shorthand syntax. */
export type SchemaDefinition = Record<string, SchemaType>;

/** Maps schema type strings to TypeScript types. */
export type SchemaTypeMap = {
  string: string;
  'string?': string | undefined;
  number: number;
  'number?': number | undefined;
  boolean: boolean;
  'boolean?': boolean | undefined;
};

/** Infers TypeScript type from schema definition. */
export type InferSchema<T extends SchemaDefinition> = {
  [K in keyof T]: SchemaTypeMap[T[K]];
};

/** Compiles schema shorthand to Zod. */
export function compileSchema(schema: SchemaDefinition): ZodObject<ZodRawShape> {
  const shape: ZodRawShape = {};

  for (const [key, type] of Object.entries(schema)) {
    const isOptional = type.endsWith('?');
    const baseType = isOptional ? type.slice(0, -1) : type;

    let zodType: z.ZodType;
    switch (baseType) {
      case 'string':
        zodType = z.string();
        break;
      case 'number':
        zodType = z.coerce.number();
        break;
      case 'boolean':
        zodType = z.coerce.boolean();
        break;
      default:
        throw new Error(`Unknown type: ${type}`);
    }

    shape[key] = isOptional ? zodType.optional() : zodType;
  }

  return z.object(shape);
}

// Re-export Zod for advanced schemas.
export { z } from 'zod';
