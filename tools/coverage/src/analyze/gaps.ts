/**
 * Builds the prioritized, machine-readable gap list (gaps.json).
 *
 * Priorities:
 *   high    operation never called              (one gap; pending statuses/params nested)
 *   high    documented 2xx/1xx/3xx status not received, in a covered operation
 *   medium  documented 4xx/5xx status (or range) not received, in a covered operation
 *   medium  required parameter not covered, in a covered operation
 *   low     optional parameter not covered, in a covered operation
 * "default" responses never produce gaps.
 *
 * Order: priority (high → low), then path, then method (GET, POST, PUT, PATCH,
 * DELETE, HEAD, OPTIONS), then type (operation, status, parameter), then
 * status code / parameter location + name.
 *
 * Ids are stable across runs and are the join key for Day 3 deltas:
 *   operation:<METHOD> <path>
 *   status:<METHOD> <path>:<code>
 *   parameter:<METHOD> <path>:<in>:<name>
 *
 * Hints are generated from spec data only (summary, description, $ref names).
 */
import {
  compareMethods,
  compareParamIn,
  compareStatusCodes,
  compareStrings,
} from '../shared/order.ts';
import type { Operation } from '../spec/types.ts';
import type { Gap, GapPriority, OperationCoverage } from './types.ts';

const PRIORITY_RANK: Record<GapPriority, number> = { high: 0, medium: 1, low: 2 };
const TYPE_RANK: Record<Gap['type'], number> = { operation: 0, status: 1, parameter: 2 };

/**
 * Suggests how to provoke a status code, from spec data only.
 *
 * @param code - Documented status.
 * @param op - The spec operation.
 */
function statusAdvice(code: string, op: Operation): string {
  const body = op.requestBodyRef ? ` (see ${op.requestBodyRef})` : '';
  switch (code) {
    case '400':
      return 'Send a malformed request (e.g. invalid JSON body).';
    case '401':
      return op.requiresAuth
        ? 'Call it without a token or with an invalid token.'
        : 'Call it with invalid credentials.';
    case '403':
      return 'Call it as a user that lacks permission for the resource.';
    case '404':
      return op.parameters.some((p) => p.in === 'path')
        ? 'Use an id that does not exist.'
        : 'Request a resource that does not exist.';
    case '409':
      return `Send a payload that conflicts with existing data (e.g. a duplicate)${body}.`;
    case '422':
      return `Send an invalid payload${body}.`;
    case '500':
      return 'Documented server error; usually not reproducible on purpose — consider an exclusion.';
    default:
      if (code.startsWith('2')) return `Call it with a valid request${body}.`;
      return 'Exercise the documented condition.';
  }
}

/**
 * Builds the priority of a status gap.
 *
 * @param code - "201", "4XX", …
 */
function statusPriority(code: string): GapPriority {
  return code.startsWith('4') || code.startsWith('5') ? 'medium' : 'high';
}

/**
 * Builds the gap list.
 *
 * @param operations - Coverage of in-scope operations.
 * @param specOps - Spec operations, used for hints.
 * @returns Sorted gaps.
 */
export function buildGaps(
  operations: readonly OperationCoverage[],
  specOps: readonly Operation[],
): Gap[] {
  const specByKey = new Map(specOps.map((op) => [op.key, op]));
  const gaps: Gap[] = [];

  for (const cov of operations) {
    const op = specByKey.get(cov.key);
    if (!op) continue;
    const base = {
      method: cov.method,
      path: cov.path,
      operationId: cov.operationId,
      tags: cov.tags,
    };
    const summary = op.summary ? ` (${op.summary.trim()})` : '';

    if (!cov.covered) {
      const statuses = cov.statuses.filter((s) => s.counted).map((s) => s.code);
      const parameters = cov.parameters.map((p) => ({
        name: p.name,
        in: p.in,
        required: p.required,
      }));
      const auth = op.requiresAuth ? ' Requires a bearer token.' : '';
      const bodyHint = op.requestBodyRef ? ` Request body: ${op.requestBodyRef}.` : '';
      gaps.push({
        id: `operation:${cov.key}`,
        type: 'operation',
        priority: 'high',
        ...base,
        pending: { statuses, parameters },
        hint: `${cov.key}${summary} is never called. Documented responses: ${statuses.join(', ') || 'none'}.${bodyHint}${auth}`,
      });
      continue;
    }

    for (const st of cov.statuses) {
      if (!st.counted || st.covered) continue;
      const description = op.responses.find((r) => r.code === st.code)?.description;
      const what = description ? ` ("${description.trim()}")` : '';
      gaps.push({
        id: `status:${cov.key}:${st.code}`,
        type: 'status',
        priority: statusPriority(st.code),
        ...base,
        status: st.code,
        hint: `Documented ${st.code}${what} for ${cov.key} is never exercised. ${statusAdvice(st.code, op)}`,
      });
    }

    for (const p of cov.parameters) {
      if (p.covered) continue;
      const kind = p.required ? 'Required' : 'Optional';
      gaps.push({
        id: `parameter:${cov.key}:${p.in}:${p.name}`,
        type: 'parameter',
        priority: p.required ? 'medium' : 'low',
        ...base,
        parameter: { name: p.name, in: p.in, required: p.required },
        hint: `${kind} ${p.in} parameter "${p.name}" of ${cov.key} is never sent.`,
      });
    }
  }

  return gaps.sort(compareGaps);
}

/**
 * The canonical gap order (see the file header). Exported so batch selection
 * (`gaps` subcommand, MCP) orders gaps exactly like gaps.json.
 *
 * @param a - Gap.
 * @param b - Gap.
 */
export function compareGaps(a: Gap, b: Gap): number {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    compareStrings(a.path, b.path) ||
    compareMethods(a.method, b.method) ||
    TYPE_RANK[a.type] - TYPE_RANK[b.type] ||
    compareStatusCodes(a.status ?? '', b.status ?? '') ||
    compareParamIn(a.parameter?.in ?? '', b.parameter?.in ?? '') ||
    compareStrings(a.parameter?.name ?? '', b.parameter?.name ?? '') ||
    compareStrings(a.id, b.id)
  );
}

/**
 * Counts gaps by priority.
 *
 * @param gaps - Gap list.
 */
export function summarizeGaps(gaps: readonly Gap[]): {
  total: number;
  high: number;
  medium: number;
  low: number;
} {
  return {
    total: gaps.length,
    high: gaps.filter((g) => g.priority === 'high').length,
    medium: gaps.filter((g) => g.priority === 'medium').length,
    low: gaps.filter((g) => g.priority === 'low').length,
  };
}
