/**
 * Loads an OpenAPI 3.x JSON document and normalizes it into `LoadedSpec`.
 *
 * - Resolves local `$ref`s (`#/components/...`) in parameters, responses and
 *   request bodies. External refs are reported as `unresolved-ref` warnings.
 * - Merges path-level and operation-level parameters (operation wins on name+in).
 * - Adds implicit path parameters: `{var}`s in the template that the operation
 *   does not declare (`declared: false`, warning `implicit-path-param`).
 * - Strips nothing from template paths; the base path comes from servers[0].url.
 *
 * Pure function of the file bytes: same file → same `LoadedSpec`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { InputError } from '../shared/errors.ts';
import {
  compareMethods,
  compareParamIn,
  compareStatusCodes,
  compareStrings,
  HTTP_METHODS,
  operationKey,
} from '../shared/order.ts';
import type {
  DocumentedResponse,
  LoadedSpec,
  Operation,
  Parameter,
  ParameterLocation,
  SpecWarning,
} from './types.ts';

/** Loosely typed JSON object. */
type JsonObject = Record<string, unknown>;

/**
 * @param value - Any value.
 */
function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reads a string property or returns null.
 *
 * @param obj - Object to read.
 * @param key - Property name.
 */
function str(obj: JsonObject, key: string): string | null {
  const value = obj[key];
  return typeof value === 'string' ? value : null;
}

/**
 * Converts "#/components/schemas/Article" into "components.schemas.Article".
 *
 * @param ref - A local JSON pointer reference.
 */
export function refToDotted(ref: string): string {
  return ref.replace(/^#\//, '').split('/').join('.');
}

/**
 * Resolves `$ref` chains for spec objects (parameters, responses, request bodies).
 */
class RefResolver {
  private readonly root: JsonObject;
  private readonly warnings: SpecWarning[];

  /**
   * @param root - The whole OpenAPI document.
   * @param warnings - Sink for unresolved-ref warnings.
   */
  constructor(root: JsonObject, warnings: SpecWarning[]) {
    this.root = root;
    this.warnings = warnings;
  }

  /**
   * Follows `$ref` until a concrete object is reached.
   *
   * @param value - A spec object that may be a `{ $ref }`.
   * @param key - Operation key, for warnings.
   * @returns The concrete object, or null when the reference cannot be resolved.
   */
  resolve(value: unknown, key: string): JsonObject | null {
    let current: unknown = value;
    const seen = new Set<string>();
    while (isObject(current) && typeof current.$ref === 'string') {
      const ref = current.$ref;
      if (seen.has(ref) || !ref.startsWith('#/')) {
        this.warnings.push({
          code: 'unresolved-ref',
          key,
          message: `Cannot resolve ${seen.has(ref) ? 'circular' : 'non-local'} $ref "${ref}".`,
        });
        return null;
      }
      seen.add(ref);
      current = this.pointer(ref);
      if (current === undefined) {
        this.warnings.push({ code: 'unresolved-ref', key, message: `Unresolved $ref "${ref}".` });
        return null;
      }
    }
    return isObject(current) ? current : null;
  }

  /**
   * Evaluates a local JSON pointer.
   *
   * @param ref - "#/a/b/c" pointer.
   */
  private pointer(ref: string): unknown {
    let node: unknown = this.root;
    for (const raw of ref.slice(2).split('/')) {
      const part = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      if (!isObject(node)) return undefined;
      node = node[part];
    }
    return node;
  }
}

/**
 * Extracts the JSON schema `$ref` of a request body or response, if any.
 *
 * @param obj - Resolved requestBody/response object.
 */
function contentSchemaRef(obj: JsonObject | null): string | null {
  const content = obj?.content;
  if (!isObject(content)) return null;
  const mediaKeys = Object.keys(content).sort(compareStrings);
  const preferred = mediaKeys.includes('application/json') ? 'application/json' : mediaKeys[0];
  const media = preferred === undefined ? undefined : content[preferred];
  if (!isObject(media) || !isObject(media.schema)) return null;
  const schema = media.schema;
  if (typeof schema.$ref === 'string') return refToDotted(schema.$ref);
  if (isObject(schema.items) && typeof schema.items.$ref === 'string') {
    return refToDotted(schema.items.$ref);
  }
  return null;
}

/**
 * Derives the base path from servers[0].url ("/api", "http://host:3000/api", "/").
 *
 * @param doc - The OpenAPI document.
 */
function basePathOf(doc: JsonObject): string {
  const servers = doc.servers;
  const first = Array.isArray(servers) && isObject(servers[0]) ? str(servers[0], 'url') : null;
  if (!first) return '';
  let pathname = first;
  try {
    pathname = new URL(first, 'http://placeholder').pathname;
  } catch {
    // keep the raw value
  }
  return pathname.replace(/\/+$/, '');
}

/**
 * Normalizes the parameter list of one operation.
 *
 * @param pathItem - The path item (may carry path-level parameters).
 * @param op - The operation object.
 * @param template - Template path.
 * @param key - Operation key.
 * @param resolver - $ref resolver.
 * @param warnings - Warning sink.
 */
function collectParameters(
  pathItem: JsonObject,
  op: JsonObject,
  template: string,
  key: string,
  resolver: RefResolver,
  warnings: SpecWarning[],
): Parameter[] {
  const byId = new Map<string, Parameter>();
  const sources = [pathItem.parameters, op.parameters];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const rawParam of source) {
      const param = resolver.resolve(rawParam, key);
      if (!param) continue;
      const name = str(param, 'name');
      const location = str(param, 'in');
      if (!name || !location) continue;
      const loc = location as ParameterLocation;
      byId.set(`${loc}:${loc === 'header' ? name.toLowerCase() : name}`, {
        name,
        in: loc,
        required: loc === 'path' ? true : param.required === true,
        declared: true,
      });
    }
  }
  for (const match of template.matchAll(/\{([^}]+)\}/g)) {
    const name = match[1] ?? '';
    if (!byId.has(`path:${name}`)) {
      byId.set(`path:${name}`, { name, in: 'path', required: true, declared: false });
      warnings.push({
        code: 'implicit-path-param',
        key,
        message: `Path variable {${name}} is used in the template but not declared as a parameter.`,
      });
    }
  }
  return [...byId.values()].sort(
    (a, b) => compareParamIn(a.in, b.in) || compareStrings(a.name, b.name),
  );
}

/**
 * Normalizes the documented responses of one operation.
 *
 * @param op - The operation object.
 * @param key - Operation key.
 * @param resolver - $ref resolver.
 */
function collectResponses(
  op: JsonObject,
  key: string,
  resolver: RefResolver,
): DocumentedResponse[] {
  const responses = op.responses;
  if (!isObject(responses)) return [];
  return Object.keys(responses)
    .map((code) => {
      const resolved = resolver.resolve(responses[code], key);
      return {
        code: code.toUpperCase() === 'DEFAULT' ? 'default' : code.toUpperCase(),
        description: resolved ? str(resolved, 'description') : null,
        schemaRef: contentSchemaRef(resolved),
      };
    })
    .sort((a, b) => compareStatusCodes(a.code, b.code));
}

/**
 * Determines whether an operation requires auth (operation security wins over root).
 *
 * @param doc - The OpenAPI document.
 * @param op - The operation object.
 */
function requiresAuth(doc: JsonObject, op: JsonObject): boolean {
  const security = Array.isArray(op.security) ? op.security : doc.security;
  return (
    Array.isArray(security) && security.some((req) => isObject(req) && Object.keys(req).length > 0)
  );
}

/**
 * Parses an OpenAPI document that is already in memory.
 *
 * @param text - The raw JSON text.
 * @param specPath - Path used for reporting.
 * @returns The normalized spec.
 */
export function parseSpec(text: string, specPath: string): LoadedSpec {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new InputError(
      `Spec ${specPath} is not valid JSON (${reason}). Only JSON specs are supported.`,
    );
  }
  if (!isObject(doc) || !isObject(doc.paths)) {
    throw new InputError(`Spec ${specPath} has no "paths" object — is it an OpenAPI 3 document?`);
  }

  const warnings: SpecWarning[] = [];
  const resolver = new RefResolver(doc, warnings);
  const basePath = basePathOf(doc);
  const info = isObject(doc.info) ? doc.info : {};
  const operations: Operation[] = [];

  for (const template of Object.keys(doc.paths)) {
    const pathItem = doc.paths[template];
    if (!isObject(pathItem)) continue;
    for (const lower of HTTP_METHODS) {
      const op = pathItem[lower];
      if (!isObject(op)) continue;
      const method = lower.toUpperCase();
      const key = operationKey(method, template);
      const requestBody = resolver.resolve(op.requestBody, key);
      const tags = Array.isArray(op.tags) ? op.tags.filter((t) => typeof t === 'string') : [];
      operations.push({
        key,
        method,
        path: template,
        operationId: str(op, 'operationId'),
        tags: [...new Set(tags)].sort(compareStrings),
        summary: str(op, 'summary'),
        requestBodyRef: contentSchemaRef(requestBody),
        requiresAuth: requiresAuth(doc, op),
        parameters: collectParameters(pathItem, op, template, key, resolver, warnings),
        responses: collectResponses(op, key, resolver),
      });
      if (basePath && (template === basePath || template.startsWith(`${basePath}/`))) {
        warnings.push({
          code: 'base-path-in-template',
          key,
          message: `Template already starts with the server base path "${basePath}"; the real URL would be ${basePath}${template}.`,
        });
      }
    }
  }

  operations.sort((a, b) => compareStrings(a.path, b.path) || compareMethods(a.method, b.method));

  const byOperationId = new Map<string, string[]>();
  for (const op of operations) {
    if (op.operationId)
      byOperationId.set(op.operationId, [...(byOperationId.get(op.operationId) ?? []), op.key]);
  }
  for (const [operationId, keys] of byOperationId) {
    if (keys.length > 1) {
      warnings.push({
        code: 'duplicate-operation-id',
        key: null,
        message: `operationId "${operationId}" is used by ${keys.join(', ')}.`,
      });
    }
  }

  const uniqueWarnings = new Map(warnings.map((w) => [`${w.code}|${w.key ?? ''}|${w.message}`, w]));
  return {
    path: specPath,
    title: (str(info, 'title') ?? '').trim(),
    version: str(info, 'version') ?? '',
    sha256: createHash('sha256').update(text).digest('hex'),
    basePath,
    operations,
    warnings: [...uniqueWarnings.entries()]
      .sort(([a], [b]) => compareStrings(a, b))
      .map(([, w]) => w),
  };
}

/**
 * Reads and parses an OpenAPI JSON file.
 *
 * @param specPath - Path to the spec file.
 * @returns The normalized spec.
 */
export function loadSpec(specPath: string): LoadedSpec {
  let text: string;
  try {
    text = readFileSync(specPath, 'utf8');
  } catch {
    throw new InputError(
      `Cannot read spec "${specPath}". Pass --spec <file> or set OPENAPI_PATH (default spec/openapi.json).`,
    );
  }
  return parseSpec(text, specPath);
}
