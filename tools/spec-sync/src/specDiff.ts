/**
 * Spec text normalization and an operation-level diff between two OpenAPI
 * documents. The diff REUSES the coverage tool's spec loader (`parseSpec`), so
 * "operation", "parameter" and "response" mean exactly what coverage measures.
 *
 * SOLID: Single Responsibility Principle (SRP) — compare two spec texts.
 *
 * Must NOT: read files, run git, or reimplement OpenAPI parsing.
 */
import { parseSpec } from '../../coverage/src/spec/loadSpec.ts';
import type { Operation } from '../../coverage/src/spec/types.ts';

/** Operation-level differences (keys like "GET /articles/{id}"), each list sorted. */
export interface SpecDiff {
  added: string[];
  removed: string[];
  /** Same key on both sides, different summary/tags/auth/body/parameters/responses. */
  changed: { key: string; fields: string[] }[];
  /** True when the texts differ at all (even if no operation changed, e.g. info or components). */
  textChanged: boolean;
}

/**
 * Normalizes a spec text the way the repo stores it: byte-identical to GAD,
 * except line endings (LF) and exactly one trailing newline. The content is
 * NOT re-serialized: GAD's own formatting is kept so a no-op sync leaves an
 * empty diff and `cmp` against GAD stays meaningful.
 *
 * @param text - Raw spec text.
 */
export function normalizeSpecText(text: string): string {
  const unix = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  return `${unix.replace(/\n+$/, '')}\n`;
}

/** Fields of an operation compared by the diff. */
const FIELDS = [
  'operationId',
  'summary',
  'tags',
  'requiresAuth',
  'requestBodyRef',
  'parameters',
  'responses',
] as const satisfies readonly (keyof Operation)[];

/**
 * Computes the operation-level diff `from` → `to`.
 *
 * @param fromText - Current spec (e.g. the framework's spec/openapi.json).
 * @param toText - Target spec (e.g. GAD's spec).
 */
export function diffSpecs(fromText: string, toText: string): SpecDiff {
  const from = new Map(parseSpec(fromText, 'from').operations.map((op) => [op.key, op]));
  const to = new Map(parseSpec(toText, 'to').operations.map((op) => [op.key, op]));
  const sort = (keys: string[]): string[] => [...keys].sort();
  const changed: SpecDiff['changed'] = [];
  for (const [key, next] of to) {
    const prev = from.get(key);
    if (!prev) continue;
    const fields = FIELDS.filter((f) => JSON.stringify(prev[f]) !== JSON.stringify(next[f]));
    if (fields.length > 0) changed.push({ key, fields: [...fields] });
  }
  changed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    added: sort([...to.keys()].filter((k) => !from.has(k))),
    removed: sort([...from.keys()].filter((k) => !to.has(k))),
    changed,
    textChanged: normalizeSpecText(fromText) !== normalizeSpecText(toText),
  };
}

/**
 * Renders a diff as short text lines (for console and CI logs).
 *
 * @param diff - The diff.
 */
export function renderDiff(diff: SpecDiff): string {
  const lines = [
    `operations added: ${diff.added.length} · removed: ${diff.removed.length} · changed: ${diff.changed.length}`,
    ...diff.added.map((k) => `  + ${k}`),
    ...diff.removed.map((k) => `  - ${k}`),
    ...diff.changed.map((c) => `  ~ ${c.key} (${c.fields.join(', ')})`),
  ];
  if (diff.textChanged && diff.added.length + diff.removed.length + diff.changed.length === 0) {
    lines.push('  (no operation changed: the difference is in info, servers or components)');
  }
  return `${lines.join('\n')}\n`;
}
