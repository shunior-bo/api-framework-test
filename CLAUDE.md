# CLAUDE.md

Playwright + TypeScript API test framework for **GAD** (`../gad-gui-api-demo`).

**Read [`CONVENTIONS.md`](CONVENTIONS.md) before writing or changing any code. It is mandatory.** It defines the layers, naming, imports, assertion order, cleanup, auth, and the step-by-step recipe for adding a test. Contract: `spec/openapi.json`.

## Quick commands

```bash
# Start GAD (separate terminal) and check it
cd ../gad-gui-api-demo && npm install && npm start
curl http://localhost:3000/api/health

# Framework
cp .env.example .env        # first time only
npm run lint && npm run format:check && npm run typecheck
npm run test:unit           # no server needed
npm run test:api            # needs GAD at BASE_URL
npm run report              # open reports/html

# Coverage (CONVENTIONS.md §12, tools/coverage/README.md)
npm run test:api:coverage   # tests + coverage report; gaps in reports/coverage/gaps.json
npm run coverage            # re-report the last recorded run
node tools/coverage/src/cli.ts gaps --tag likes --limit 5          # next gap batch + spec context
node tools/coverage/src/cli.ts compare --base <dir> --head reports/coverage

# AI test generation (CONVENTIONS.md §13, docs/day3-ai-test-generation.md)
claude --settings .claude/test-generator.settings.json   # then: /fill-coverage-gaps <scope>

# GAD pin and spec sync (CONVENTIONS.md §14, tools/spec-sync/README.md)
npm run spec:check -- --gad-dir ../gad-gui-api-demo     # exit 1 if spec/openapi.json ≠ GAD's spec
npm run spec:sync  -- --gad-dir ../gad-gui-api-demo
npm run gad:pin    -- --sha <40-char GAD sha> --ref main

# Multi-agent pipeline in CI (docs/day4-multi-agent-pipeline.md): agents run in GitHub Actions, not locally
#   issue + label feature-request → feature-agent.yml (feature-developer) → GAD PR + framework PR
#   API coverage regressed on feature/* → test-agent.yml (/fill-coverage-gaps --mode ci-pr) → tests pushed to the PR
node .github/scripts/lane-check.js --base <sha> --head <sha>   # agent lanes of a PR (also in pr-guards.yml)
```

The `api-coverage` MCP server (`.mcp.json`) exposes the coverage tool: prefer its tools over reading `reports/` or `spec/` by hand.

## Working rules

- Work on a branch (`session/NN-…`), never on `main`. Commit prefixes: `feat:` `test:` `fix:` `chore:` `docs:`.
- Do not push or open PRs without asking. Exception: a `/fill-coverage-gaps` run is the user's request to push its `ai/<run-id>` branch and open one `ai-generated` PR (never to touch `main`); in CI, the `feature-developer` and `test-generator` (`--mode ci-pr`) agents push `feature/*` branches as their workflows define.
- Never edit `spec/openapi.json` or `gad.ref.json` by hand: use `npm run spec:sync` / `npm run gad:pin`.
- Do not add dependencies without asking.
- Do not modify `../gad-gui-api-demo` or `../api-testing-playwright-ts-junior`.
