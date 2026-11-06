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
```

## Working rules

- Work on a branch (`session/NN-…`), never on `main`. Commit prefixes: `feat:` `test:` `fix:` `chore:` `docs:`.
- Do not push or open PRs without asking.
- Do not add dependencies without asking.
- Do not modify `../gad-gui-api-demo` or `../api-testing-playwright-ts-junior`.
