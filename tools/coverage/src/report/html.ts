/**
 * Self-contained HTML coverage report (index.html).
 *
 * - One file: inline CSS + a tiny inline script; no CDN, no network. A strict
 *   Content-Security-Policy forbids any external load.
 * - Readable without JavaScript: every table is rendered server-side; the
 *   script only filters rows.
 * - EVERY piece of text that comes from the spec, the records or git (tags,
 *   paths, summaries in hints, test titles, branch names) goes through `esc()`.
 *   The spec is external input.
 * - Deterministic: the output depends only on the inputs (generatedAt is read
 *   from the report, not from a clock).
 */
import type {
  CoverageReport,
  Gap,
  GapsReport,
  OperationCoverage,
  Ratio,
} from '../analyze/types.ts';
import { UNTAGGED } from '../analyze/coverage.ts';
import type { DeltaReport, DimensionDelta } from '../compare/types.ts';
import { compareStrings } from '../shared/order.ts';
import { formatPct } from './console.ts';

/**
 * Escapes text for HTML element content and double-quoted attributes.
 *
 * @param value - Any value (stringified).
 */
export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CSS = `
:root{--bg:#ffffff;--fg:#1f2328;--muted:#59636e;--card:#f6f8fa;--border:#d1d9e0;--ok:#1a7f37;--bad:#cf222e;--warn:#9a6700;--accent:#0969da;--bar:#e6e9ed}
@media (prefers-color-scheme: dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--card:#151b23;--border:#3d444d;--ok:#3fb950;--bad:#f85149;--warn:#d29922;--accent:#4493f8;--bar:#262c36}}
*{box-sizing:border-box}
body{margin:0;padding:24px 16px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:1200px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 8px;border-bottom:1px solid var(--border);padding-bottom:4px}
.muted{color:var(--muted)}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:16px}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 14px}
.card .pct{font-size:26px;font-weight:600}.card .sub{color:var(--muted);font-size:12.5px}
.bar{height:6px;background:var(--bar);border-radius:3px;overflow:hidden;margin-top:6px}.bar>span{display:block;height:100%;background:var(--accent)}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);vertical-align:top}
th{background:var(--card);position:sticky;top:0}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}
.chip{display:inline-block;padding:0 6px;margin:1px 2px 1px 0;border-radius:10px;border:1px solid var(--border);font-size:12px;white-space:nowrap}
.chip.ok{border-color:var(--ok)}.chip.bad{border-color:var(--bad)}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
.filters input,.filters select{font:inherit;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg)}
.filters input{flex:1;min-width:180px}
details summary{cursor:pointer;color:var(--accent)}
.verdict{font-weight:600;text-transform:uppercase}
.scroll{overflow-x:auto}
ul.compact{margin:4px 0;padding-left:18px}
`;

const SCRIPT = `
(function(){
  function setup(tableId, ids){
    var table=document.getElementById(tableId); if(!table) return;
    var rows=[].slice.call(table.tBodies[0].rows);
    var controls=ids.map(function(id){return document.getElementById(id);});
    var count=document.getElementById(tableId+'-count');
    function apply(){
      var shown=0;
      rows.forEach(function(row){
        var ok=controls.every(function(c){
          if(!c||!c.value) return true;
          var key=c.getAttribute('data-filter');
          if(key==='text') return (row.getAttribute('data-text')||'').indexOf(c.value.toLowerCase())!==-1;
          return (' '+(row.getAttribute('data-'+key)||'')+' ').indexOf(' '+c.value+' ')!==-1;
        });
        row.hidden=!ok; if(ok) shown++;
      });
      if(count) count.textContent=shown+' / '+rows.length;
    }
    controls.forEach(function(c){ if(c){ c.addEventListener('input',apply); c.addEventListener('change',apply); } });
    document.getElementById(tableId+'-filters').hidden=false;
    apply();
  }
  setup('ops',['ops-text','ops-tag','ops-covered','ops-method']);
  setup('gaps',['gaps-text','gaps-priority','gaps-type','gaps-tag']);
})();
`;

/**
 * Totals card.
 *
 * @param label - Dimension label.
 * @param r - Ratio.
 * @param extra - Extra sub-line.
 */
function card(label: string, r: Ratio, extra = ''): string {
  const width = r.pct === null ? 0 : Math.max(0, Math.min(100, r.pct));
  return `<div class="card"><div class="sub">${esc(label)}</div><div class="pct">${esc(formatPct(r.pct))}</div><div class="sub">${r.covered} / ${r.total} covered${extra ? ` · ${esc(extra)}` : ''}</div><div class="bar"><span style="width:${width}%"></span></div></div>`;
}

/**
 * Signed number with a class for color.
 *
 * @param n - Delta value.
 */
function signedCell(n: number | null): string {
  if (n === null) return '<span class="muted">n/a</span>';
  if (n === 0) return '<span class="muted">＝ 0</span>';
  return n > 0 ? `<span class="ok">▲ +${n}</span>` : `<span class="bad">▼ ${n}</span>`;
}

/**
 * Renders a list of codes/keys inline, or "none".
 *
 * @param items - Items.
 */
function inlineList(items: string[]): string {
  if (items.length === 0) return '<span class="muted">none</span>';
  return `<ul class="compact">${items.map((i) => `<li><code>${esc(i)}</code></li>`).join('')}</ul>`;
}

/**
 * Delta section (compare with an available base).
 *
 * @param delta - Delta report.
 */
function deltaSection(delta: DeltaReport): string {
  const t = delta.totals;
  const verdictClass =
    delta.verdict === 'improved' ? 'ok' : delta.verdict === 'unchanged' ? 'muted' : 'bad';
  const row = (label: string, d: DimensionDelta): string =>
    `<tr><td>${esc(label)}</td><td class="num">${d.base.covered}/${d.base.total} (${esc(formatPct(d.base.pct))})</td><td class="num">${d.head.covered}/${d.head.total} (${esc(formatPct(d.head.pct))})</td><td class="num">${signedCell(d.delta.covered)}</td><td class="num">${signedCell(d.delta.pct)}</td></tr>`;
  const sha = (s: string | null): string => esc(s ? s.slice(0, 7) : 'unknown');
  const o = delta.operations;
  return `<section id="delta"><h2>Delta vs base</h2>
<p>Verdict: <span class="verdict ${verdictClass}">${esc(delta.verdict)}</span>${delta.verdictReasons.length ? ` <span class="muted">— ${esc(delta.verdictReasons.join('; '))}</span>` : ''}</p>
<p class="muted">Base <code>${sha(delta.base.git.sha)}</code> ${esc(delta.base.git.branch ?? '')} → Head <code>${sha(delta.head.git.sha)}</code> ${esc(delta.head.git.branch ?? '')} · spec ${delta.specChanged ? '<strong>changed</strong>' : 'unchanged'} · gaps opened ${delta.gaps.summary.opened} · closed ${delta.gaps.summary.closed}</p>
<div class="scroll"><table><thead><tr><th>Dimension</th><th class="num">Base</th><th class="num">Head</th><th class="num">Δ covered</th><th class="num">Δ %</th></tr></thead><tbody>
${row('Operations', t.operations)}${row('Statuses', t.statuses)}${row('Parameters', t.parameters)}${row('↳ required', t.parameters.required)}${row('↳ optional', t.parameters.optional)}
</tbody></table></div>
<div class="cards">
<div class="card"><div class="sub">Newly covered (${o.newlyCovered.length})</div>${inlineList(o.newlyCovered)}</div>
<div class="card"><div class="sub">No longer covered (${o.noLongerCovered.length})</div>${inlineList(o.noLongerCovered)}</div>
<div class="card"><div class="sub">Added to spec (${o.added.length})</div>${inlineList(o.added.map((a) => `${a.key}${a.covered ? '' : ' (not covered)'}`))}</div>
<div class="card"><div class="sub">Removed from spec (${o.removed.length})</div>${inlineList(o.removed)}</div>
</div></section>`;
}

/**
 * One operation row with its expandable details.
 *
 * @param op - Operation coverage.
 */
function operationRow(op: OperationCoverage): string {
  const statuses = op.statuses
    .map(
      (s) =>
        `<span class="chip ${s.counted ? (s.covered ? 'ok' : 'bad') : ''}" title="${s.counted ? (s.covered ? 'covered' : 'pending') : 'not counted'}">${s.counted ? (s.covered ? '✓' : '✗') : '·'} ${esc(s.code)}</span>`,
    )
    .join('');
  const params = op.parameters.length
    ? op.parameters
        .map(
          (p) =>
            `<li>${p.covered ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>'} <code>${esc(p.name)}</code> <span class="muted">${esc(p.in)}${p.required ? ', required' : ''}${p.declared ? '' : ', undeclared'}</span></li>`,
        )
        .join('')
    : '<li class="muted">none</li>';
  const observed = Object.entries(op.observedStatuses);
  const details = `<details><summary>details</summary>
<div><strong>Parameters</strong><ul class="compact">${params}</ul></div>
<div><strong>Observed statuses</strong> ${observed.length ? observed.map(([code, n]) => `<span class="chip">${esc(code)} ×${n}</span>`).join('') : '<span class="muted">none</span>'}</div>
<div><strong>Tests (${op.tests.length})</strong>${op.tests.length ? `<ul class="compact">${op.tests.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ' <span class="muted">none</span>'}</div>
</details>`;
  const text = [op.key, op.operationId ?? '', ...op.tags, ...op.tests].join(' ').toLowerCase();
  const tagAttr = op.tags.length > 0 ? op.tags.join(' ') : UNTAGGED;
  return `<tr data-tag="${esc(tagAttr)}" data-covered="${op.covered ? 'yes' : 'no'}" data-method="${esc(op.method)}" data-text="${esc(text)}">
<td><code>${esc(op.method)}</code></td><td><code>${esc(op.path)}</code>${op.operationId ? `<div class="muted">${esc(op.operationId)}</div>` : ''}</td><td>${op.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</td>
<td>${op.covered ? '<span class="ok">✓ covered</span>' : '<span class="bad">✗ not covered</span>'}</td><td class="num">${op.requestCount}</td><td>${statuses}</td><td>${details}</td></tr>`;
}

/**
 * One gap row.
 *
 * @param gap - Gap.
 */
function gapRow(gap: Gap): string {
  const cls = gap.priority === 'high' ? 'bad' : gap.priority === 'medium' ? 'warn' : 'muted';
  const text = [gap.id, gap.hint, ...gap.tags].join(' ').toLowerCase();
  return `<tr data-priority="${esc(gap.priority)}" data-type="${esc(gap.type)}" data-tag="${esc(gap.tags.join(' '))}" data-text="${esc(text)}"><td class="${cls}">${esc(gap.priority)}</td><td>${esc(gap.type)}</td><td><code>${esc(gap.id.slice(gap.id.indexOf(':') + 1))}</code></td><td>${esc(gap.hint)}</td></tr>`;
}

/**
 * Builds a <select> filter.
 *
 * @param id - Element id.
 * @param filter - data-* key the filter matches.
 * @param label - "All …" label.
 * @param values - Option values.
 */
function select(id: string, filter: string, label: string, values: string[]): string {
  return `<select id="${id}" data-filter="${filter}" aria-label="${esc(label)}"><option value="">${esc(label)}</option>${values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select>`;
}

/**
 * Renders the HTML report.
 *
 * @param coverage - coverage.json (head side when comparing).
 * @param gaps - gaps.json of the same run.
 * @param delta - Optional delta to embed (compare with a base).
 */
export function renderHtml(
  coverage: CoverageReport,
  gaps: GapsReport,
  delta: DeltaReport | null = null,
): string {
  const { spec, git } = coverage.source;
  const t = coverage.totals;
  const tags = Object.keys(coverage.byTag).sort(compareStrings);
  const methods = [...new Set(coverage.operations.map((o) => o.method))];
  const gapTags = [...new Set(gaps.gaps.flatMap((g) => g.tags))].sort(compareStrings);
  const ex = coverage.extras;
  const pctOf = (r: Ratio): string => `${r.covered}/${r.total} (${formatPct(r.pct)})`;

  const tagRows = tags
    .map((tag) => {
      const d = coverage.byTag[tag];
      if (!d) return '';
      return `<tr><td>${esc(tag)}</td><td class="num">${esc(pctOf(d.operations))}</td><td class="num">${esc(pctOf(d.statuses))}</td><td class="num">${esc(pctOf(d.parameters))}</td></tr>`;
    })
    .join('\n');

  const extraList = (title: string, items: string[]): string =>
    `<h3>${esc(title)} (${items.length})</h3>${items.length ? `<ul class="compact">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="muted">none</p>'}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<meta name="color-scheme" content="light dark">
<title>API coverage — ${esc(spec.title)}</title>
<style>${CSS}</style>
</head>
<body><main>
<header>
<h1>API coverage — ${esc(spec.title)} v${esc(spec.version)}</h1>
<div class="muted">Spec <code>${esc(spec.path)}</code> · sha256 <code>${esc(spec.sha256.slice(0, 12))}</code> · commit <code>${esc(git.sha ? git.sha.slice(0, 7) : 'unknown')}</code> ${esc(git.branch ?? '')} · generated ${esc(coverage.generatedAt)}</div>
<div class="muted">Requests: ${coverage.requests.recorded} recorded · ${coverage.requests.counted} counted · ${coverage.requests.hooks} in hooks · ${coverage.requests.errored} errored · ${coverage.requests.unmatched} unmatched · ${coverage.excluded.length} operations excluded</div>
</header>
<div class="cards">
${card('Operations', t.operations)}
${card('Documented statuses', t.statuses)}
${card('Parameters', t.parameters, `required ${formatPct(t.parameters.required.pct)} · optional ${formatPct(t.parameters.optional.pct)}`)}
</div>
${delta ? deltaSection(delta) : ''}
<section id="tags"><h2>Coverage by tag</h2>
<div class="scroll"><table><thead><tr><th>Tag</th><th class="num">Operations</th><th class="num">Statuses</th><th class="num">Parameters</th></tr></thead><tbody>
${tagRows}
</tbody></table></div></section>
<section id="operations"><h2>Operations (${coverage.operations.length})</h2>
<div class="filters" id="ops-filters" hidden>
<input id="ops-text" data-filter="text" type="search" placeholder="Search path, operationId, tag, test…" aria-label="Search operations">
${select('ops-tag', 'tag', 'All tags', tags)}
${select('ops-covered', 'covered', 'Covered or not', ['yes', 'no'])}
${select('ops-method', 'method', 'All methods', methods)}
<span class="muted" id="ops-count"></span>
</div>
<div class="scroll"><table id="ops"><thead><tr><th>Method</th><th>Path</th><th>Tags</th><th>Covered</th><th class="num">Requests</th><th>Statuses</th><th></th></tr></thead><tbody>
${coverage.operations.map(operationRow).join('\n')}
</tbody></table></div></section>
<section id="gaps-section"><h2>Gaps (${gaps.summary.total}: ${gaps.summary.high} high · ${gaps.summary.medium} medium · ${gaps.summary.low} low)</h2>
<div class="filters" id="gaps-filters" hidden>
<input id="gaps-text" data-filter="text" type="search" placeholder="Search gap id or hint…" aria-label="Search gaps">
${select('gaps-priority', 'priority', 'All priorities', ['high', 'medium', 'low'])}
${select('gaps-type', 'type', 'All types', ['operation', 'status', 'parameter'])}
${select('gaps-tag', 'tag', 'All tags', gapTags)}
<span class="muted" id="gaps-count"></span>
</div>
<div class="scroll"><table id="gaps"><thead><tr><th>Priority</th><th>Type</th><th>Gap</th><th>Hint</th></tr></thead><tbody>
${gaps.gaps.map(gapRow).join('\n')}
</tbody></table></div></section>
<section id="extras"><h2>Extras</h2>
${extraList(
  'Excluded operations',
  coverage.excluded.map((e) => `${e.key} — ${e.reason}`),
)}
${extraList(
  'Unmatched requests',
  ex.unmatched.map(
    (u) =>
      `${u.method} ${u.path} ×${u.count} (${u.reason}${u.template ? `, template ${u.template}` : ''})`,
  ),
)}
${extraList(
  'Ignored unmatched requests',
  ex.ignoredUnmatched.map((u) => `${u.method} ${u.path} ×${u.count}`),
)}
${extraList(
  'Undocumented statuses',
  ex.undocumentedStatuses.map((u) => `${u.key} returned ${u.status} ×${u.count}`),
)}
${extraList(
  'Spec warnings',
  ex.specWarnings.map((w) => w.message),
)}
${extraList('Config warnings', ex.configWarnings)}
${extraList(
  'Corrupt record lines',
  ex.invalidRecordLines.map((l) => `${l.file}:${l.line} (${l.reason})`),
)}
</section>
<footer class="muted"><p>Generated by api-coverage · tools/coverage/README.md has the coverage definitions.</p></footer>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
