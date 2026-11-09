# `tools/coverage-mcp/`: api-coverage MCP server

A stdio [Model Context Protocol](https://modelcontextprotocol.io) server that gives agents standardized, permissioned access to the coverage tool. It **reuses the functions in `tools/coverage/src`**, with no duplicated logic and no parsing of console output. It is built on the official `@modelcontextprotocol/sdk`, and its tool input schemas use the repo's existing `zod`.

| Tool | Input | Returns | Side effects |
|---|---|---|---|
| `coverage_summary` | — | totals, per-tag coverage, gap counts, spec/git of the latest run | none |
| `coverage_list_gaps` | `priority[]`, `type[]`, `tag[]`, `pathPrefix`, `excludeIds[]`, `onlyIds[]` (allow-list; `[]` selects nothing), `limit` (default 5, 0 = all) | the same batch as `cli.ts gaps`, with resolved spec context | none |
| `coverage_get_operation` | `key` (`"POST /likes"`) | coverage detail, open gaps, excluded flag, resolved spec | none |
| `coverage_compare` | `base`, `head?` (default `reports/coverage`), `out?` | verdict, totals delta, operations, opened/closed gap ids | writes `delta.json` / `delta.md` |
| `coverage_run` | `grep?`, `files?` (under `tests/api/`), `timeoutSec?` (default 600, max 1800) | test counts and failures (from JUnit), coverage totals, gap counts, stdout/stderr tails | runs `npx playwright test --project=api` against the local GAD, then re-analyzes; **a filtered run replaces the recorded data** |

Input errors come back as MCP tool errors (`isError: true`). They never crash the server.

## Use it

It is registered as `api-coverage` in the repo's `.mcp.json`, so Claude Code starts it with `node tools/coverage-mcp/src/server.ts` from the project root. `.claude/settings.json` pre-approves it (`enabledMcpjsonServers`) in trusted folders. Otherwise approve it when `claude` asks the first time. `claude mcp get api-coverage` shows its status.

Run it by hand, for example with the MCP Inspector:

```bash
npm run coverage:mcp
node tools/coverage-mcp/src/server.ts --root . --coverage-dir reports/coverage --spec spec/openapi.json
```

Code rules are the same as `tools/coverage` (erasable TypeScript run natively by Node, relative `.ts` imports, no Playwright and no `src/`). Two differences: this package may import the MCP SDK and `zod`, and `server.ts` (the entrypoint) may use `import.meta`. It is tested in `tests/unit/coverage/mcpServer.spec.ts`, which starts the server over stdio with the official SDK client.
