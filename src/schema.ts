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
 * - Described fields: `['string', 'Description']`, `['number?', 'Optional count']`
 * - Nested objects: `{ field: { nested: 'string' } }`
 *
 * @example
 * ```typescript
 * // In route definitions
 * const api = router({
 *   users: router({
 *     post: route({
 *       query: { page: 'number?', limit: ['number?', 'Max results'] },
 *       body: {
 *         name: ['string', 'Full name'],
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
export type PrimitiveType = 'string' | 'number' | 'boolean' | 'unknown';

/** Optional primitive type strings. */
export type OptionalPrimitiveType = 'string?' | 'number?' | 'boolean?' | 'unknown?';

/** Array type strings. */
export type ArrayType = 'string[]' | 'number[]' | 'boolean[]' | 'unknown[]';

/** Optional array type strings. */
export type OptionalArrayType = 'string[]?' | 'number[]?' | 'boolean[]?' | 'unknown[]?';

/** All supported type strings. */
export type SchemaType = PrimitiveType | OptionalPrimitiveType | ArrayType | OptionalArrayType;

/** A schema field: a type string, or a `[type, description]` tuple. */
export type SchemaField = SchemaType | readonly [type: SchemaType, description: string];

/** Schema definition using shorthand syntax. Supports nested objects. */
export interface SchemaDefinition {
  [key: string]: SchemaField | SchemaDefinition;
}

/** Maps primitive type strings to TypeScript types. */
export type SchemaTypeMap = {
  string: string;
  'string?': string | undefined;
  number: number;
  'number?': number | undefined;
  boolean: boolean;
  'boolean?': boolean | undefined;
  unknown: unknown;
  'unknown?': unknown | undefined;
  'string[]': string[];
  'string[]?': string[] | undefined;
  'number[]': number[];
  'number[]?': number[] | undefined;
  'boolean[]': boolean[];
  'boolean[]?': boolean[] | undefined;
  'unknown[]': unknown[];
  'unknown[]?': unknown[] | undefined;
};

/** Checks if a schema field type is optional (ends with ?). */
type IsOptionalField<T> = T extends `${string}?`
  ? true
  : T extends readonly [`${string}?`, string]
    ? true
    : false;

/** Infers TypeScript type from a schema field (type string, tuple, or nested object). */
export type InferSchemaField<T> = T extends SchemaType
  ? SchemaTypeMap[T]
  : T extends readonly [infer S extends SchemaType, string]
    ? SchemaTypeMap[S]
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
const PRIMITIVE_TYPES = ['string', 'number', 'boolean', 'unknown'];

/** Checks if a schema field is a nested object (not a type string or [type, description] tuple). */
export function isNestedSchema(field: SchemaField | SchemaDefinition): field is SchemaDefinition {
  return typeof field === 'object' && field !== null && !Array.isArray(field);
}

/** Unpacks a schema field into its type string and optional description. */
export function unpackField(field: SchemaField): [type: SchemaType, description?: string] {
  return Array.isArray(field) ? [field[0], field[1]] : [field as SchemaType, undefined];
}

/**
 * Validates and coerces a single primitive value.
 * Returns [success, result, errorMessage].
 */
function validatePrimitive(value: unknown, baseType: string): [boolean, unknown, string | null] {
  switch (baseType) {
    case 'string':
      if (typeof value !== 'string') {
        return [false, undefined, 'Expected string'];
      }
      return [true, value, null];

    case 'number': {
      if (
        (typeof value !== 'number' && typeof value !== 'string') ||
        (typeof value === 'string' && value.trim() === '')
      ) {
        return [false, undefined, 'Expected number'];
      }
      const num = Number(value);
      if (!Number.isFinite(num)) {
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

    case 'unknown':
      // Pass through any value without validation.
      return [true, value, null];

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
  field: SchemaField | SchemaDefinition,
  value: unknown,
  parentPath: string = '',
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

  // Extract type string from field or [type, description] tuple.
  const [typeStr] = unpackField(field);
  const isOptional = typeStr.endsWith('?');
  const isArray = typeStr.includes('[]');

  // Strip optional marker for base type extraction.
  let baseType = isOptional ? typeStr.slice(0, -1) : typeStr;

  // Strip array marker.
  if (isArray) {
    baseType = baseType.replace('[]', '');
  }

  // Handle missing/empty values.
  if (value === undefined || value === null || value === '') {
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
  parentPath: string = '',
): { success: boolean; data: Record<string, unknown>; errors: Record<string, string[]> } {
  const result: Record<string, unknown> = {};
  const allErrors: Record<string, string[]> = {};
  const source = typeof data === 'object' && data !== null && !Array.isArray(data) ? data : {};

  for (const [key, field] of Object.entries(schema)) {
    const value = Object.hasOwn(source, key) ? source[key] : undefined;
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
      if (
        Array.isArray(field) &&
        (field.length !== 2 || typeof field[0] !== 'string' || typeof field[1] !== 'string')
      ) {
        throw new Error(`Invalid field definition at '${fieldPath}'`);
      }
      const [typeStr] = unpackField(field);
      if (typeof typeStr !== 'string') {
        throw new Error(`Unknown type '${String(typeStr)}' at '${fieldPath}'`);
      }
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
export function compileSchema<const T extends SchemaDefinition>(
  schema: T,
): CompiledSchema<InferSchema<T>> {
  // Validate schema structure at compile time.
  validateSchemaDefinition(schema);

  return {
    safeParse(data: object): ValidationResult<InferSchema<T>> {
      const {
        success,
        data: result,
        errors,
      } = validateSchema(schema, data as Record<string, unknown>);

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

/** JSON Schema object produced by {@link toJsonSchema}. */
export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  /** Omitted when empty, as OpenAPI 3.0 requires. */
  required?: string[];
}

/**
 * Converts a schema definition to JSON Schema, recursing into nested objects.
 */
export function toJsonSchema(schema: SchemaDefinition): JsonSchemaObject {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, field] of Object.entries(schema)) {
    if (isNestedSchema(field)) {
      properties[key] = toJsonSchema(field);
      required.push(key);
      continue;
    }
    const [typeStr, description] = unpackField(field);
    const described = description === undefined ? {} : { description };
    const optional = typeStr.endsWith('?');
    const base = optional ? typeStr.slice(0, -1) : typeStr;
    const primitive = base.replace('[]', '');
    const item = primitive === 'unknown' ? {} : { type: primitive };
    properties[key] = base.endsWith('[]')
      ? { type: 'array', items: item, ...described }
      : { ...item, ...described };
    if (!optional) required.push(key);
  }
  return { type: 'object', properties, ...(required.length > 0 && { required }) };
}
