import assert from 'node:assert';
import { describe, it } from 'node:test';
import { route, router } from './core.js';
import { generateDocs } from './docs.js';

describe('docs', () => {
  describe('generateDocs()', () => {
    it('returns OpenAPI 3.0.0 spec', () => {
      const spec = generateDocs({
        title: 'Test',
        version: '1.0.0',
        router: router({}),
      }) as Record<string, unknown>;

      assert.strictEqual(spec.openapi, '3.0.0');
    });

    it('includes info.title and info.version', () => {
      const spec = generateDocs({
        title: 'My API',
        version: '2.0.0',
        router: router({}),
      }) as Record<string, Record<string, unknown>>;

      assert.strictEqual(spec.info.title, 'My API');
      assert.strictEqual(spec.info.version, '2.0.0');
    });

    it('includes info.description when provided', () => {
      const spec = generateDocs({
        title: 'Test',
        version: '1.0.0',
        description: 'API description',
        router: router({}),
      }) as Record<string, Record<string, unknown>>;

      assert.strictEqual(spec.info.description, 'API description');
    });

    it('includes all routes from router', () => {
      const spec = generateDocs({
        title: 'Test',
        version: '1.0.0',
        router: router({
          users: router({ get: async () => [] }),
          posts: router({ get: async () => [] }),
        }),
      }) as Record<string, Record<string, unknown>>;

      assert.ok(spec.paths['/users']);
      assert.ok(spec.paths['/posts']);
    });

    it('converts $param to {param} format', () => {
      const spec = generateDocs({
        title: 'Test',
        version: '1.0.0',
        router: router({
          users: router({
            $id: router({ get: async (c) => ({ id: c.path.id }) }),
          }),
        }),
      }) as Record<string, Record<string, unknown>>;

      assert.ok(spec.paths['/users/{id}']);
    });

    it('combines nested router paths', () => {
      const inner = router({
        test: router({ get: async () => ({}) }),
      });
      const spec = generateDocs({
        title: 'Test',
        version: '1.0.0',
        router: router({ outer: router({ inner }) }),
      }) as Record<string, Record<string, unknown>>;

      assert.ok(spec.paths['/outer/inner/test']);
    });

    it('lists query params with required flag', () => {
      const spec = generateDocs({
        title: 'Test',
        version: '1.0.0',
        router: router({
          test: router({
            get: route({
              query: { required: 'string', optional: 'string?' },
              handler: async () => ({}),
            }),
          }),
        }),
      }) as Record<
        string,
        Record<string, Record<string, Record<string, Array<Record<string, unknown>>>>>
      >;

      const params = spec.paths['/test'].get.parameters;
      const reqParam = params.find((p) => p.name === 'required');
      const optParam = params.find((p) => p.name === 'optional');

      assert.strictEqual(reqParam?.required, true);
      assert.strictEqual(optParam?.required, false);
    });

    it('includes param type', () => {
      const spec = generateDocs({
        title: 'Test',
        version: '1.0.0',
        router: router({
          test: router({
            get: route({
              query: { count: 'number' },
              handler: async () => ({}),
            }),
          }),
        }),
      }) as Record<
        string,
        Record<
          string,
          Record<string, Record<string, Array<Record<string, Record<string, string>>>>>
        >
      >;

      const param = spec.paths['/test'].get.parameters[0];
      assert.strictEqual(param.schema.type, 'number');
    });

    it('generates request body schema for POST', () => {
      const spec = generateDocs({
        title: 'Test',
        version: '1.0.0',
        router: router({
          test: router({
            post: route({
              body: { name: 'string', age: 'number?' },
              handler: async () => ({}),
            }),
          }),
        }),
      }) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;

      const body = spec.paths['/test'].post.requestBody as Record<string, unknown>;
      assert.ok(body);
      assert.strictEqual(body.required, true);

      const content = body.content as Record<string, Record<string, Record<string, unknown>>>;
      const schema = content['application/json'].schema;
      assert.deepStrictEqual(schema.required, ['name']);
      assert.ok((schema.properties as Record<string, unknown>).name);
      assert.ok((schema.properties as Record<string, unknown>).age);
    });

    it('does not include body for GET', () => {
      const spec = generateDocs({
        title: 'Test',
        version: '1.0.0',
        router: router({
          test: router({ get: async () => ({}) }),
        }),
      }) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;

      assert.strictEqual(spec.paths['/test'].get.requestBody, undefined);
    });

    it('includes description from route', () => {
      const spec = generateDocs({
        title: 'Test',
        version: '1.0.0',
        router: router({
          test: router({
            get: route({
              description: 'Get test data',
              handler: async () => ({}),
            }),
          }),
        }),
      }) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;

      assert.strictEqual(spec.paths['/test'].get.description, 'Get test data');
    });

    it('includes 200 and 400 responses', () => {
      const spec = generateDocs({
        title: 'Test',
        version: '1.0.0',
        router: router({
          test: router({ get: async () => ({}) }),
        }),
      }) as Record<string, Record<string, Record<string, Record<string, Record<string, unknown>>>>>;

      assert.ok(spec.paths['/test'].get.responses['200']);
      assert.ok(spec.paths['/test'].get.responses['400']);
    });
  });
});
