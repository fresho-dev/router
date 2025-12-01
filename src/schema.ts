/**
 * @fileoverview Schema types and validation utilities.
 *
 * Provides shorthand schema definitions for validating query parameters and request bodies.
 * No external dependencies - uses simple string-based type definitions.
 *
 * Supported types:
 * - Primitives: `'string'`, `'number'`, `'boolean'`
 * - Optional: `'string?'`, `'number?'`, `'boolean?'`
 * - Arrays: `'string[]'`, `'number[]'`, `'boolean[]'`
 * - Optional arrays: `'string[]?'`, `'number[]?'`, `'boolean[]?'`
 * - Nested objects: `{ field: { nested: 'string' } }`
 *
 * @example
 * ```typescript
 * // In route definitions
 * const api = router({
 *   users: router({
 *     post: route({
 *       query: { page: 'number?', limit: 'number?' },
 *       body: {
 *         name: 'string',
 *         age: 'number',
 *         tags: 'string[]?',
 *         address: { city: 'string', zip: 'string?' },
 *       },
 *       handler: async (c) => {
 *         c.query.page;       // number | undefined
 *         c.body.name;        // string
 *         c.body.address.city // string
 *       },
 *     }),
 *   }),
 * });
 * ```
 */

/** Primitive type strings. */
export type PrimitiveType = 'string' | 'number' | 'boolean';

/** Optional primitive type strings. */
export type OptionalPrimitiveType = 'string?' | 'number?' | 'boolean?';

/** Array type strings. */
export type ArrayType = 'string[]' | 'number[]' | 'boolean[]';

/** Optional array type strings. */
export type OptionalArrayType = 'string[]?' | 'number[]?' | 'boolean[]?';

/** All supported type strings. */
export type SchemaType = PrimitiveType | OptionalPrimitiveType | ArrayType | OptionalArrayType;

/** Schema definition using shorthand syntax. Supports nested objects. */
export interface SchemaDefinition {
  [key: string]: SchemaType | SchemaDefinition;
}

/** Maps primitive type strings to TypeScript types. */
export type SchemaTypeMap = {
  string: string;
  'string?': string | undefined;
  number: number;
  'number?': number | undefined;
  boolean: boolean;
  'boolean?': boolean | undefined;
  'string[]': string[];
  'string[]?': string[] | undefined;
  'number[]': number[];
  'number[]?': number[] | undefined;
  'boolean[]': boolean[];
  'boolean[]?': boolean[] | undefined;
};

/** Checks if a schema field type is optional (ends with ?). */
type IsOptionalField<T> = T extends `${string}?` ? true : false;

/** Infers TypeScript type from a schema field (type string or nested object). */
export type InferSchemaField<T> =
  T extends SchemaType
    ? SchemaTypeMap[T]
    : T extends SchemaDefinition
      ? InferSchema<T>
      : never;

/** Gets keys of required fields (non-optional types). */
type RequiredKeys<T extends SchemaDefinition> = {
  [K in keyof T]: IsOptionalField<T[K]> extends true ? never : K;
}[keyof T];

/** Gets keys of optional fields (types ending with ?). */
type OptionalKeys<T extends SchemaDefinition> = {
  [K in keyof T]: IsOptionalField<T[K]> extends true ? K : never;
}[keyof T];

/**
 * Infers TypeScript type from schema definition.
 *
 * Required fields become required properties, optional fields (ending with ?)
 * become optional properties with `| undefined`.
 */
export type InferSchema<T extends SchemaDefinition> = {
  [K in RequiredKeys<T>]: InferSchemaField<T[K]>;
} & {
  [K in OptionalKeys<T>]?: InferSchemaField<T[K]>;
};

/** Error object returned when validation fails. */
export interface ValidationError {
  flatten: () => { fieldErrors: Record<string, string[]> };
}

/** Validation result matching Zod's safeParse API for compatibility. */
export type ValidationResult<T> =
  | { success: true; data: T; error?: undefined }
  | { success: false; data?: undefined; error: ValidationError };

/** Compiled schema with validate method. */
export interface CompiledSchema<T> {
  safeParse: (data: object) => ValidationResult<T>;
}

/** Valid base types for primitives and arrays. */
const PRIMITIVE_TYPES = ['string', 'number', 'boolean'];

/** Checks if a schema field is a nested object (not a type string). */
function isNestedSchema(field: SchemaType | SchemaDefinition): field is SchemaDefinition {
  return typeof field === 'object' && field !== null;
}

/**
 * Validates and coerces a single primitive value.
 * Returns [success, result, errorMessage].
 */
function validatePrimitive(
  value: unknown,
  baseType: string
): [boolean, unknown, string | null] {
  switch (baseType) {
    case 'string':
      return [true, String(value), null];

    case 'number': {
      const num = Number(value);
      if (isNaN(num)) {
        return [false, undefined, 'Expected number'];
      }
      return [true, num, null];
    }

    case 'boolean': {
      if (value === 'true' || value === '1' || value === true) {
        return [true, true, null];
      } else if (value === 'false' || value === '0' || value === false) {
        return [true, false, null];
      }
      return [false, undefined, 'Expected boolean (true/false)'];
    }

    default:
      return [false, undefined, `Unknown type: ${baseType}`];
  }
}

/**
 * Validates a schema field value (primitive, array, or nested object).
 * Returns [success, result, errors].
 */
function validateField(
  key: string,
  field: SchemaType | SchemaDefinition,
  value: unknown,
  parentPath: string = ''
): [boolean, unknown, Record<string, string[]>] {
  const fieldPath = parentPath ? `${parentPath}.${key}` : key;
  const errors: Record<string, string[]> = {};

  // Handle nested object schemas.
  if (isNestedSchema(field)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors[fieldPath] = ['Expected object'];
      return [false, undefined, errors];
    }
    // Recursively validate nested schema.
    const nestedResult = validateSchema(field, value as Record<string, unknown>, fieldPath);
    return [nestedResult.success, nestedResult.data, nestedResult.errors];
  }

  // It's a type string.
  const typeStr = field as string;
  const isOptional = typeStr.endsWith('?');
  const isArray = typeStr.includes('[]');

  // Strip optional marker for base type extraction.
  let baseType = isOptional ? typeStr.slice(0, -1) : typeStr;

  // Strip array marker.
  if (isArray) {
    baseType = baseType.replace('[]', '');
  }

  // Handle missing/empty values.
  if (value === undefined || value === '') {
    if (!isOptional) {
      errors[fieldPath] = ['Required'];
      return [false, undefined, errors];
    }
    return [true, undefined, {}];
  }

  // Handle array types.
  if (isArray) {
    if (!Array.isArray(value)) {
      errors[fieldPath] = ['Expected array'];
      return [false, undefined, errors];
    }

    const resultArray: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const [success, coerced, errorMsg] = validatePrimitive(value[i], baseType);
      if (!success) {
        errors[`${fieldPath}[${i}]`] = [errorMsg!];
        return [false, undefined, errors];
      }
      resultArray.push(coerced);
    }
    return [true, resultArray, {}];
  }

  // Handle primitive types.
  const [success, coerced, errorMsg] = validatePrimitive(value, baseType);
  if (!success) {
    errors[fieldPath] = [errorMsg!];
    return [false, undefined, errors];
  }
  return [true, coerced, {}];
}

/**
 * Validates a full schema against data.
 * Returns { success, data, errors }.
 */
function validateSchema(
  schema: SchemaDefinition,
  data: Record<string, unknown>,
  parentPath: string = ''
): { success: boolean; data: Record<string, unknown>; errors: Record<string, string[]> } {
  const result: Record<string, unknown> = {};
  const allErrors: Record<string, string[]> = {};

  for (const [key, field] of Object.entries(schema)) {
    const value = data[key];
    const [success, coerced, fieldErrors] = validateField(key, field, value, parentPath);

    if (!success) {
      Object.assign(allErrors, fieldErrors);
    } else if (coerced !== undefined) {
      result[key] = coerced;
    }
  }

  return {
    success: Object.keys(allErrors).length === 0,
    data: result,
    errors: allErrors,
  };
}

/** Validates schema definition at compile time. */
function validateSchemaDefinition(schema: SchemaDefinition, path: string = ''): void {
  for (const [key, field] of Object.entries(schema)) {
    const fieldPath = path ? `${path}.${key}` : key;

    if (isNestedSchema(field)) {
      validateSchemaDefinition(field, fieldPath);
    } else {
      const typeStr = field as string;
      const isOptional = typeStr.endsWith('?');
      let baseType = isOptional ? typeStr.slice(0, -1) : typeStr;
      baseType = baseType.replace('[]', '');

      if (!PRIMITIVE_TYPES.includes(baseType)) {
        throw new Error(`Unknown type '${typeStr}' at '${fieldPath}'`);
      }
    }
  }
}

/**
 * Compiles a schema definition into a validator.
 *
 * Used internally by the router to validate query parameters and request bodies.
 * Provides a Zod-compatible `safeParse` API for consistency.
 *
 * @param schema - The schema definition object
 * @returns A compiled schema with `safeParse` method
 *
 * @example
 * ```typescript
 * const userSchema = compileSchema({
 *   name: 'string',
 *   age: 'number',
 *   email: 'string?',
 * });
 *
 * const result = userSchema.safeParse({ name: 'Alice', age: 30 });
 * if (result.success) {
 *   console.log(result.data.name); // 'Alice'
 * } else {
 *   console.log(result.error.flatten().fieldErrors);
 * }
 * ```
 */
export function compileSchema<T extends SchemaDefinition>(
  schema: T
): CompiledSchema<InferSchema<T>> {
  // Validate schema structure at compile time.
  validateSchemaDefinition(schema);

  return {
    safeParse(data: object): ValidationResult<InferSchema<T>> {
      const { success, data: result, errors } = validateSchema(
        schema,
        data as Record<string, unknown>
      );

      if (!success) {
        return {
          success: false,
          error: { flatten: () => ({ fieldErrors: errors }) },
        };
      }

      return { success: true, data: result as InferSchema<T> };
    },
  };
}
