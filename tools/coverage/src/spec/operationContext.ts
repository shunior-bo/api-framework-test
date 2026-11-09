/**
 * Extracts the full spec context of one operation, with every local `$ref`
 * resolved (recursively), so an agent can write a test for a gap without
 * reading the whole spec.
 *
 * - Resolution is deterministic and cycle-safe: a `$ref` already being
 *   expanded on the current path becomes `{ "$ref": "...", "$circular": true }`.
 * - Depth is capped (MAX_DEPTH); deeper nodes become `{ "$truncated": true }`.
 * - `xml` keys (serialization hints irrelevant for JSON tests) are dropped.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { InputError } from '../shared/errors.ts';
import { compareStrings } from '../shared/order.ts';

/** Maximum nesting depth of resolved schemas. */
export const MAX_DEPTH = 12;

/** Loosely typed JSON object. */
type JsonObject = Record<string, unknown>;

/** Raw spec document plus identity. */
export interface SpecDocument {
  path: string;
  sha256: string;
  basePath: string;
  doc: JsonObject;
}

/** The resolved context of one operation. */
export interface OperationContext {
  method: string;
  path: string;
  /** Full request path including the server base path, e.g. "/api/likes". */
  url: string;
  operationId: string | null;
  summary: string | null;
  description: string | null;
  tags: string[];
  /** Effective security requirements (operation level, else root level). */
  security: unknown[];
  /** Security schemes referenced by `security`, resolved. */
  securitySchemes: Record<string, unknown>;
  /** Path-level + operation-level parameters (operation wins), resolved. */
  parameters: unknown[];
  requestBody: unknown;
  /** Responses keyed by code, resolved (sorted keys). */
  responses: Record<string, unknown>;
}

/**
 * @param value - Any value.
 */
function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Loads a spec file as a raw document.
 *
 * @param specPath - Path to the OpenAPI JSON file.
 */
export function loadSpecDocument(specPath: string): SpecDocument {
  let text: string;
  try {
    text = readFileSync(specPath, 'utf8');
  } catch {
    throw new InputError(`Cannot read spec "${specPath}". Pass --spec <file>.`);
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new InputError(`Spec ${specPath} is not valid JSON.`);
  }
  if (!isObject(doc) || !isObject(doc.paths)) {
    throw new InputError(`Spec ${specPath} has no "paths" object.`);
  }
  const servers = doc.servers;
  const first = Array.isArray(servers) && isObject(servers[0]) ? servers[0].url : undefined;
  let basePath = '';
  if (typeof first === 'string') {
    try {
      basePath = new URL(first, 'http://placeholder').pathname.replace(/\/+$/, '');
    } catch {
      basePath = first.replace(/\/+$/, '');
    }
  }
  return {
    path: specPath,
    sha256: createHash('sha256').update(text).digest('hex'),
    basePath,
    doc,
  };
}

/**
 * Evaluates a local JSON pointer ("#/components/schemas/X").
 *
 * @param root - Spec document.
 * @param ref - Pointer.
 */
function pointer(root: JsonObject, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let node: unknown = root;
  for (const raw of ref.slice(2).split('/')) {
    const part = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObject(node)) return undefined;
    node = node[part];
  }
  return node;
}

/**
 * Recursively resolves `$ref`s (cycle-safe, depth-capped, `xml` dropped).
 * Object keys keep the spec's order, which is stable for a given file.
 *
 * @param node - Any spec node.
 * @param root - Spec document.
 * @param stack - Refs being expanded on the current path.
 * @param depth - Current depth.
 */
export function resolveDeep(
  node: unknown,
  root: JsonObject,
  stack: readonly string[] = [],
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH) return { $truncated: true };
  if (Array.isArray(node)) return node.map((item) => resolveDeep(item, root, stack, depth + 1));
  if (!isObject(node)) return node;
  if (typeof node.$ref === 'string') {
    const ref = node.$ref;
    if (stack.includes(ref)) return { $ref: ref, $circular: true };
    const target = pointer(root, ref);
    if (target === undefined) return { $ref: ref, $unresolved: true };
    return resolveDeep(target, root, [...stack, ref], depth + 1);
  }
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'xml') continue;
    out[key] = resolveDeep(value, root, stack, depth + 1);
  }
  return out;
}

/**
 * Builds the resolved context of one operation.
 *
 * @param spec - Spec document.
 * @param method - HTTP method (any case).
 * @param path - Template path relative to the base path, e.g. "/likes".
 * @returns The context, or null when the operation does not exist.
 */
export function operationContext(
  spec: SpecDocument,
  method: string,
  path: string,
): OperationContext | null {
  const paths = spec.doc.paths as JsonObject;
  const item = paths[path];
  if (!isObject(item)) return null;
  const op = item[method.toLowerCase()];
  if (!isObject(op)) return null;
  const root = spec.doc;

  const params = new Map<string, unknown>();
  for (const source of [item.parameters, op.parameters]) {
    if (!Array.isArray(source)) continue;
    for (const raw of source) {
      const resolved = resolveDeep(raw, root);
      if (!isObject(resolved)) continue;
      const loc = String(resolved.in ?? '');
      const name = String(resolved.name ?? '');
      params.set(`${loc}:${loc === 'header' ? name.toLowerCase() : name}`, resolved);
    }
  }

  const security = Array.isArray(op.security)
    ? op.security
    : Array.isArray(root.security)
      ? root.security
      : [];
  const schemeNames = [
    ...new Set(security.flatMap((req) => (isObject(req) ? Object.keys(req) : []))),
  ].sort(compareStrings);
  const components = isObject(root.components) ? root.components : {};
  const allSchemes = isObject(components.securitySchemes) ? components.securitySchemes : {};
  const securitySchemes: Record<string, unknown> = {};
  for (const name of schemeNames) {
    securitySchemes[name] = resolveDeep(allSchemes[name] ?? null, root);
  }

  const responses: Record<string, unknown> = {};
  const rawResponses = isObject(op.responses) ? op.responses : {};
  for (const code of Object.keys(rawResponses).sort(compareStrings)) {
    responses[code] = resolveDeep(rawResponses[code], root);
  }

  const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
  return {
    method: method.toUpperCase(),
    path,
    url: `${spec.basePath}${path}`,
    operationId: str(op.operationId),
    summary: str(op.summary),
    description: str(op.description),
    tags: Array.isArray(op.tags)
      ? op.tags.filter((t): t is string => typeof t === 'string').sort(compareStrings)
      : [],
    security,
    securitySchemes,
    parameters: [...params.values()],
    requestBody: op.requestBody === undefined ? null : resolveDeep(op.requestBody, root),
    responses,
  };
}
