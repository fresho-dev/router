import assert from 'node:assert';
import { describe, it } from 'node:test';
import { route, router } from './core.js';
import { createHttpClient } from './http-client.js';
import { createLocalClient } from './local-client.js';
import {
  type CollectPathParams,
  isRoute,
  isRouter,
  type Router,
  type RouterBrand,
  type RouterRoutes,
} from './types.js';

describe('types', () => {
  describe('isRouter()', () => {
    it('returns true for router objects', () => {
      const r = router({});
      assert.strictEqual(isRouter(r), true);
    });

    it('returns false for route objects', () => {
      const r = route({ handler: async () => ({}) });
      assert.strictEqual(isRouter(r), false);
    });

    it('returns false for null', () => {
      assert.strictEqual(isRouter(null), false);
    });

    it('returns false for undefined', () => {
      assert.strictEqual(isRouter(undefined), false);
    });

    it('returns false for primitives', () => {
      assert.strictEqual(isRouter('string'), false);
      assert.strictEqual(isRouter(123), false);
      assert.strictEqual(isRouter(true), false);
    });

    it('returns false for plain objects without ROUTER_MARKER', () => {
      assert.strictEqual(isRouter({ routes: {} }), false);
    });

    it('returns true for router objects with routes', () => {
      const r = router({ test: router({ get: async () => ({}) }) });
      assert.strictEqual(isRouter(r), true);
    });
  });

  describe('isRoute()', () => {
    it('returns true for route objects', () => {
      const r = route({ handler: async () => ({}) });
      assert.strictEqual(isRoute(r), true);
    });

    it('returns false for router objects', () => {
      const r = router({});
      assert.strictEqual(isRoute(r), false);
    });

    it('returns false for null', () => {
      assert.strictEqual(isRoute(null), false);
    });

    it('returns false for undefined', () => {
      assert.strictEqual(isRoute(undefined), false);
    });

    it('returns false for primitives', () => {
      assert.strictEqual(isRoute('string'), false);
      assert.strictEqual(isRoute(123), false);
      assert.strictEqual(isRoute(true), false);
    });

    it('returns false for plain objects without ROUTE_MARKER', () => {
      assert.strictEqual(isRoute({ handler: () => ({}) }), false);
    });

    it('returns true for route objects with schemas', () => {
      const r = route({ query: { name: 'string' }, handler: async () => ({}) });
      assert.strictEqual(isRoute(r), true);
    });
  });

  describe('CollectPathParams', () => {
    it('extracts single path parameter type', () => {
      // With the new API, path params come from $param property names.
      const api = router({
        users: router({
          $id: router({
            get: async (c) => {
              const id: string = c.path.id;
              return Response.json({ id });
            },
          }),
        }),
      });

      // Runtime check that router was created.
      assert.ok(api.routes.users);
    });

    it('extracts multiple path parameters type', () => {
      // With nested $param routers.
      const api = router({
        users: router({
          $userId: router({
            posts: router({
              $postId: router({
                get: async (c) => {
                  const userId: string = c.path.userId;
                  const postId: string = c.path.postId;
                  return Response.json({ userId, postId });
                },
              }),
            }),
          }),
        }),
      });

      assert.ok(api.routes.users);
    });

    it('handles routes without path parameters', () => {
      const api = router({
        users: router({
          get: async (c) => {
            return Response.json({ path: c.path });
          },
        }),
      });

      assert.ok(api.routes.users);
    });

    it('verifies type inference at compile time', () => {
      // With the new design, path params are collected from $param property names.
      type SingleParam = CollectPathParams<['$id']>;
      type MultiParam = CollectPathParams<['$userId', 'posts', '$postId']>;
      type NoParams = CollectPathParams<['users']>;

      // These type assertions will fail to compile if types are wrong.
      const _single: SingleParam = { id: 'test' };
      const _multi: MultiParam = { userId: 'u1', postId: 'p1' };
      const _none: NoParams = {};

      // Runtime assertion to satisfy test runner.
      assert.ok(true);
    });
  });

  describe('Deeply nested routes with api prefix pattern', () => {
    // This test suite specifically covers the issue where deeply nested routers
    // (3+ levels like api -> todos -> $id -> get) caused type inference to fail,
    // resulting in `never` types or `unknown` return types.

    it('infers correct return type for nested GET routes', () => {
      const api = router({
        api: router({
          health: router({
            get: route({
              handler: async () => ({ status: 'ok' as const, timestamp: new Date().toISOString() }),
            }),
          }),
        }),
      });

      const client = createLocalClient(api);

      // The return type should be inferred correctly, not 'unknown'.
      type HealthResult = Awaited<ReturnType<typeof client.api.health>>;
      type HasStatus = HealthResult extends { status: 'ok' } ? true : false;
      const _hasStatus: HasStatus = true;

      assert.ok(true);
    });

    it('infers correct return type for nested POST routes', () => {
      interface Todo {
        id: string;
        title: string;
      }

      const api = router({
        api: router({
          todos: router({
            post: route({
              body: { title: 'string' },
              handler: async (c): Promise<Todo> => ({
                id: '1',
                title: c.body.title,
              }),
            }),
          }),
        }),
      });

      const client = createLocalClient(api);

      // The POST method should be callable and return the correct type.
      type PostResult = Awaited<ReturnType<typeof client.api.todos.$post>>;
      type HasId = PostResult extends { id: string } ? true : false;
      const _hasId: HasId = true;

      assert.ok(true);
    });

    it('handles routes with path parameters at 4+ levels deep', () => {
      const api = router({
        api: router({
          todos: router({
            $id: router({
              get: route.ctx<{ path: { id: string } }>()({
                handler: async (c) => ({ id: c.path.id, title: 'Test' }),
              }),
              patch: route.ctx<{ path: { id: string } }>()({
                body: { title: 'string?', completed: 'boolean?' },
                handler: async (c) => ({
                  id: c.path.id,
                  title: c.body.title ?? 'Default',
                  completed: c.body.completed ?? false,
                }),
              }),
              delete: route.ctx<{ path: { id: string } }>()({
                handler: async (c) => ({ deleted: true, id: c.path.id }),
              }),
            }),
          }),
        }),
      });

      const client = createLocalClient(api);

      // All methods should be callable, not 'never'.
      type GetMethod = typeof client.api.todos.$id;
      type PatchMethod = typeof client.api.todos.$id.$patch;
      type DeleteMethod = typeof client.api.todos.$id.$delete;

      type IsGetNever = GetMethod extends never ? true : false;
      type IsPatchNever = PatchMethod extends never ? true : false;
      type IsDeleteNever = DeleteMethod extends never ? true : false;

      const _getNotNever: IsGetNever = false;
      const _patchNotNever: IsPatchNever = false;
      const _deleteNotNever: IsDeleteNever = false;

      assert.ok(true);
    });

    it('does not require body for routes without body schema', async () => {
      const api = router({
        api: router({
          items: router({
            $id: router({
              // DELETE route with no body schema.
              delete: route.ctx<{ path: { id: string } }>()({
                handler: async (c) => ({ deleted: true, id: c.path.id }),
              }),
            }),
          }),
        }),
      });

      const client = createLocalClient(api);

      // This should compile without requiring a body parameter.
      // If body was incorrectly required, this would be a type error.
      const result = await client.api.items.$id.$delete({ path: { id: '123' } });
      assert.strictEqual(result.deleted, true);
      assert.strictEqual(result.id, '123');
    });

    it('HttpClient resolves deeply nested routes with api prefix', () => {
      const api = router({
        api: router({
          users: router({
            get: route({
              query: { limit: 'number?' },
              handler: async () => ({ users: [], count: 0 }),
            }),
            $id: router({
              get: route.ctx<{ path: { id: string } }>()({
                handler: async (c) => ({ id: c.path.id, name: 'Test' }),
              }),
            }),
          }),
        }),
      });

      const client = createHttpClient<typeof api>({});

      // All nested paths should resolve correctly.
      type UsersClient = typeof client.api.users;
      type UserByIdClient = typeof client.api.users.$id;

      type IsUsersNever = UsersClient extends never ? true : false;
      type IsUserByIdNever = UserByIdClient extends never ? true : false;

      const _usersNotNever: IsUsersNever = false;
      const _userByIdNotNever: IsUserByIdNever = false;

      // $get should work for explicit GET calls.
      type GetMethod = typeof client.api.users.$get;
      type IsGetMethodNever = GetMethod extends never ? true : false;
      const _getMethodNotNever: IsGetMethodNever = false;

      // Implicit GET (calling client.api.users() directly) should also work.
      // The client.api.users is an intersection type that includes a callable.
      type UsersCallable = typeof client.api.users;
      type IsUsersCallable = UsersCallable extends () => unknown ? true : false;
      const _usersCallable: IsUsersCallable = true;

      assert.ok(true);
    });
  });

  describe('RouterBrand', () => {
    it('Router extends RouterBrand for cross-module type inference', () => {
      // Create a sub-router (simulates import from another module).
      const subRouter = router({
        inner: router({
          get: async () => ({ result: 'ok' }),
        }),
      });

      // Compose into main app.
      const app = router({
        sub: subRouter,
      });

      // Verify the sub-router entry extends RouterBrand.
      // This is critical for cross-module type inference.
      type SubEntry = (typeof app.routes)['sub'];
      type HasBrand = SubEntry extends RouterBrand ? true : false;
      const _hasBrand: HasBrand = true;

      // Verify it's also recognized as a Router.
      type IsRouter = SubEntry extends Router<RouterRoutes> ? true : false;
      const _isRouter: IsRouter = true;

      assert.ok(true);
    });

    it('HttpClient resolves nested router types (not never)', () => {
      // This test would fail before the RouterBrand fix.
      // The issue: when routers cross module boundaries, T[K] extends Router<infer R>
      // fails, causing nested client types to resolve to 'never'.

      const subRouter = router({
        deep: router({
          get: async () => ({ value: 42 }),
        }),
      });

      const app = router({
        sub: subRouter,
      });

      const client = createHttpClient<typeof app>({});

      // These types should NOT be 'never'.
      type SubClient = typeof client.sub;
      type DeepClient = typeof client.sub.deep;

      type IsSubNever = SubClient extends never ? true : false;
      type IsDeepNever = DeepClient extends never ? true : false;

      // If the fix works, both should be false (not never).
      const _subNotNever: IsSubNever = false;
      const _deepNotNever: IsDeepNever = false;

      assert.ok(true);
    });

    it('LocalClient resolves nested router types (not never)', () => {
      const subRouter = router({
        deep: router({
          get: async () => ({ value: 42 }),
        }),
      });

      const app = router({
        sub: subRouter,
      });

      const client = createLocalClient(app);

      // These types should NOT be 'never'.
      type SubClient = typeof client.sub;
      type DeepClient = typeof client.sub.deep;

      type IsSubNever = SubClient extends never ? true : false;
      type IsDeepNever = DeepClient extends never ? true : false;

      const _subNotNever: IsSubNever = false;
      const _deepNotNever: IsDeepNever = false;

      assert.ok(true);
    });

    it('deeply nested routers (3+ levels) resolve correctly', () => {
      const level3 = router({
        get: async () => ({ level: 3 }),
      });

      const level2 = router({
        l3: level3,
      });

      const level1 = router({
        l2: level2,
      });

      const app = router({
        l1: level1,
      });

      const client = createHttpClient<typeof app>({});

      // All levels should resolve, not be 'never'.
      type L1 = typeof client.l1;
      type L2 = typeof client.l1.l2;
      type L3 = typeof client.l1.l2.l3;

      type IsL1Never = L1 extends never ? true : false;
      type IsL2Never = L2 extends never ? true : false;
      type IsL3Never = L3 extends never ? true : false;

      const _l1NotNever: IsL1Never = false;
      const _l2NotNever: IsL2Never = false;
      const _l3NotNever: IsL3Never = false;

      assert.ok(true);
    });
  });
});
