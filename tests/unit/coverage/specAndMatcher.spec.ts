/**
 * Unit tests for tools/coverage spec loading and path matching.
 *
 * WHY unit tests here?
 * The coverage tool is the deterministic judge of AI-generated tests. If it
 * maps a request to the wrong template, every number it reports is wrong.
 * These tests pin the matching rules and $ref handling on a mini OpenAPI
 * designed around the edge cases (fixtures/mini-openapi.json).
 *
 * Run with: npm run test:unit
 */
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { PathMatcher, stripBasePath } from '@coverage/match/pathMatcher';
import { loadSpec, parseSpec } from '@coverage/spec/loadSpec';
import { type Operation } from '@coverage/spec/types';

const MINI_SPEC = join(__dirname, 'fixtures', 'mini-openapi.json');

/**
 * Builds a minimal operation for matcher-only tests.
 *
 * @param method - Upper-case method.
 * @param path - Template path.
 */
function op(method: string, path: string): Operation {
  return {
    key: `${method} ${path}`,
    method,
    path,
    operationId: null,
    tags: [],
    summary: null,
    requestBodyRef: null,
    requiresAuth: false,
    parameters: [],
    responses: [],
  };
}

test.describe('Coverage spec loader', () => {
  test(
    'loadSpec derives the base path from servers[0].url and lists every operation',
    { tag: ['@regression', '@tc-coverage-01'] },
    () => {
      // --- ARRANGE / ACT ---------------------------------------------------
      const spec = loadSpec(MINI_SPEC);

      // --- ASSERT ----------------------------------------------------------
      expect(spec.basePath).toBe('/api');
      expect(spec.title).toBe('Mini API');
      expect(spec.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(spec.operations.map((o) => o.key)).toEqual([
        'POST /admin/reset',
        'GET /items',
        'POST /items',
        'GET /items/search',
        'GET /items/{id}',
        'DELETE /items/{id}',
        'GET /items/{id}/parts/{partId}',
        'GET /never',
      ]);
    },
  );

  test(
    'loadSpec resolves $ref in parameters and responses',
    { tag: ['@regression', '@tc-coverage-02'] },
    () => {
      // --- ARRANGE / ACT ---------------------------------------------------
      const spec = loadSpec(MINI_SPEC);
      const listItems = spec.operations.find((o) => o.key === 'GET /items');
      const getItem = spec.operations.find((o) => o.key === 'GET /items/{id}');
      const createItem = spec.operations.find((o) => o.key === 'POST /items');

      // --- ASSERT ----------------------------------------------------------
      expect(listItems?.parameters).toEqual([
        { name: '_limit', in: 'query', required: false, declared: true },
        { name: 'q', in: 'query', required: true, declared: true },
        { name: 'X-Trace', in: 'header', required: false, declared: true },
      ]);
      expect(listItems?.responses.find((r) => r.code === '401')?.description).toBe(
        'Missing or invalid token',
      );
      expect(getItem?.parameters).toEqual([
        { name: 'id', in: 'path', required: true, declared: true },
      ]);
      expect(createItem?.requestBodyRef).toBe('components.schemas.ItemCreate');
      expect(createItem?.requiresAuth).toBe(true);
      expect(createItem?.responses.map((r) => r.code)).toEqual(['201', '422', 'default']);
    },
  );

  test(
    'loadSpec adds implicit path parameters and reports them as spec warnings',
    { tag: ['@regression', '@tc-coverage-03'] },
    () => {
      // --- ARRANGE / ACT ---------------------------------------------------
      const spec = loadSpec(MINI_SPEC);
      const deleteItem = spec.operations.find((o) => o.key === 'DELETE /items/{id}');

      // --- ASSERT ----------------------------------------------------------
      expect(deleteItem?.parameters).toEqual([
        { name: 'id', in: 'path', required: true, declared: false },
      ]);
      expect(spec.warnings).toContainEqual(
        expect.objectContaining({ code: 'implicit-path-param', key: 'DELETE /items/{id}' }),
      );
    },
  );

  test(
    'parseSpec warns when a template repeats the base path',
    { tag: ['@regression', '@tc-coverage-04'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      const text = JSON.stringify({
        servers: [{ url: '/api' }],
        paths: { '/api/books/{id}': { patch: { responses: { '200': {} } } } },
      });

      // --- ACT -------------------------------------------------------------
      const spec = parseSpec(text, 'inline.json');

      // --- ASSERT ----------------------------------------------------------
      expect(spec.warnings.map((w) => w.code)).toContain('base-path-in-template');
    },
  );
});

test.describe('Coverage path matcher', () => {
  const spec = loadSpec(MINI_SPEC);
  const matcher = new PathMatcher(spec.operations, spec.basePath);

  test(
    'a literal template beats a variable template (specificity)',
    { tag: ['@regression', '@tc-coverage-05'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const literal = matcher.match('GET', '/api/items/search');
      const variable = matcher.match('GET', '/api/items/42');

      // --- ASSERT ----------------------------------------------------------
      expect(literal.kind === 'matched' && literal.operation.key).toBe('GET /items/search');
      expect(variable.kind === 'matched' && variable.operation.key).toBe('GET /items/{id}');
    },
  );

  test(
    'equal literal counts are broken left to right, deterministically',
    { tag: ['@regression', '@tc-coverage-06'] },
    () => {
      // --- ARRANGE ---------------------------------------------------------
      const ops = [op('GET', '/a/{x}/c'), op('GET', '/a/b/{y}')];
      const forward = new PathMatcher(ops, '');
      const reversed = new PathMatcher([...ops].reverse(), '');

      // --- ACT -------------------------------------------------------------
      const a = forward.match('GET', '/a/b/c');
      const b = reversed.match('GET', '/a/b/c');

      // --- ASSERT ----------------------------------------------------------
      expect(a.kind === 'matched' && a.operation.path).toBe('/a/b/{y}');
      expect(b.kind === 'matched' && b.operation.path).toBe('/a/b/{y}');
    },
  );

  test(
    'the base path is stripped and paths outside it are not documented',
    { tag: ['@regression', '@tc-coverage-07'] },
    () => {
      // --- ACT / ASSERT ----------------------------------------------------
      expect(stripBasePath('/api/items', '/api')).toBe('/items');
      expect(stripBasePath('/api', '/api')).toBe('/');
      expect(stripBasePath('/apix/items', '/api')).toBeNull();
      expect(stripBasePath('/items', '')).toBe('/items');
      expect(matcher.match('GET', '/items')).toMatchObject({
        kind: 'unmatched',
        reason: 'path-not-documented',
      });
    },
  );

  test(
    'a trailing slash and URL-encoded segments are normalized',
    { tag: ['@regression', '@tc-coverage-08'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const slash = matcher.match('GET', '/api/items/search/');
      const encoded = matcher.match('GET', '/api/items/7/parts/a%20b');

      // --- ASSERT ----------------------------------------------------------
      expect(slash.kind === 'matched' && slash.operation.key).toBe('GET /items/search');
      expect(encoded).toMatchObject({
        kind: 'matched',
        relativePath: '/items/7/parts/a b',
      });
    },
  );

  test(
    'requests are unmatched by path or by method',
    { tag: ['@negative', '@tc-coverage-09'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const byPath = matcher.match('GET', '/api/unknown');
      const byMethod = matcher.match('put', '/api/items/7');

      // --- ASSERT ----------------------------------------------------------
      expect(byPath).toMatchObject({ kind: 'unmatched', reason: 'path-not-documented' });
      expect(byMethod).toMatchObject({
        kind: 'unmatched',
        reason: 'method-not-documented',
        template: '/items/{id}',
      });
    },
  );

  test(
    'an empty variable segment does not match a template variable',
    { tag: ['@negative', '@tc-coverage-10'] },
    () => {
      // --- ACT -------------------------------------------------------------
      const result = matcher.match('GET', '/api/items//parts/x');

      // --- ASSERT ----------------------------------------------------------
      expect(result.kind).toBe('unmatched');
    },
  );
});
