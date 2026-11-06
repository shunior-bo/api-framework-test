/**
 * Normalized view of an OpenAPI document, as used by the coverage analysis.
 *
 * Paths are template paths RELATIVE to the server base path (e.g. "/articles/{id}").
 */

/** Where a parameter travels. */
export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie';

/** One parameter of an operation. */
export interface Parameter {
  /** Parameter name exactly as in the spec (header names compared case-insensitively). */
  name: string;
  /** Location. */
  in: ParameterLocation;
  /** `required` from the spec (always true for path parameters). */
  required: boolean;
  /** False for a `{var}` in the template that the operation does not declare. */
  declared: boolean;
}

/** One documented response of an operation. */
export interface DocumentedResponse {
  /** Response key: "200", "2XX" or "default". */
  code: string;
  /** Response description, if any. */
  description: string | null;
  /** Schema reference of the JSON body, e.g. "components.schemas.Article". */
  schemaRef: string | null;
}

/** One operation (`METHOD path`). */
export interface Operation {
  /** Stable key, e.g. "POST /articles". */
  key: string;
  /** Upper-case method. */
  method: string;
  /** Template path relative to the base path. */
  path: string;
  /** operationId, or null when the spec omits it. */
  operationId: string | null;
  /** OpenAPI tags (sorted). */
  tags: string[];
  /** Operation summary, if any. */
  summary: string | null;
  /** Request body schema reference, e.g. "components.schemas.ArticleCreate". */
  requestBodyRef: string | null;
  /** True when a non-empty security requirement applies. */
  requiresAuth: boolean;
  /** Parameters sorted by location then name. */
  parameters: Parameter[];
  /** Responses sorted by code (exact, ranges, default). */
  responses: DocumentedResponse[];
}

/** A problem found in the spec itself (spec drift / authoring issue). */
export interface SpecWarning {
  /** Machine-readable warning code. */
  code:
    'implicit-path-param' | 'base-path-in-template' | 'unresolved-ref' | 'duplicate-operation-id';
  /** Operation key the warning refers to, when applicable. */
  key: string | null;
  /** Human-readable explanation. */
  message: string;
}

/** The loaded, normalized spec. */
export interface LoadedSpec {
  /** Spec path as given on the command line. */
  path: string;
  /** info.title (trimmed). */
  title: string;
  /** info.version. */
  version: string;
  /** SHA-256 of the spec file bytes. */
  sha256: string;
  /** Base path from servers[0].url, without trailing slash ("" when none). */
  basePath: string;
  /** Operations sorted by path then method. */
  operations: Operation[];
  /** Sorted spec warnings. */
  warnings: SpecWarning[];
}
