# AI test generation run `20261109-0959-likes-bookmarks`

| | |
|---|---|
| Scope | `likes,bookmarks` (`coverage_list_gaps` filter `{ "tag": ["likes", "bookmarks"] }`) |
| Parameters | batches ≤ `3`, batch size ≤ `4` |
| Branch | `ai/20261109-0959-likes-bookmarks` (from `main` @ `81e94f9`) |
| Model / session | `claude-opus-5-5` (test-generator agent), fresh session |
| Start snapshot | `reports/ai-runs/20261109-0959-likes-bookmarks/start`: operations `16/160`, statuses `36/374`, parameters `7/95` |

Baseline: 38/38 API tests green before generation. The run stopped after batch 2 because no gaps were left in scope (the only remaining ones are blocked).

## Batches

| Batch | Target gaps (ids) | Tests added | Passed on 1st attempt | Attempts | Closed | Blocked (reason) | Δ operations / Δ statuses / Δ parameters |
|---|---|---|---|---|---|---|---|
| 1 | `operation:GET /bookmarks/articles`, `operation:POST /bookmarks/articles`, `operation:POST /likes`, `operation:GET /likes/article` | 12 (tc-bookmarks-01..05, tc-likes-01..07) | 12/13. The spec-only run was green, but the full-suite run failed the 201 "first bookmark" test (got 200: not repeatable, see Blocked). That test was removed. | 2 | 4/4 | `status:POST /bookmarks/articles:201` (opened by batch 1) | +4 / +11 / 0 |
| 2 | `operation:GET /likes/article/mylikes`, `operation:GET /likes/article/{id}`, `operation:GET /likes/comment/{id}` | 6 (tc-likes-08..13) | 6/6 | 1 | 3/3 | `status:GET /likes/article/mylikes:400` (opened by batch 2) | +3 / +6 / +4 |

Statuses closed, by operation:
- `GET /bookmarks/articles`: 200, 401
- `POST /bookmarks/articles`: 200, 401 (201 blocked)
- `POST /likes`: 200, 201, 400, 404, 422
- `GET /likes/article`: 200 (test.fail, spec drift), 404
- `GET /likes/article/{id}`: 200, 404
- `GET /likes/comment/{id}`: 200, 404
- `GET /likes/article/mylikes`: 200 (test.fail, spec drift), 404, plus parameters `query:id` and `header:userid` (400 blocked)

## Total delta vs start

| Dimension | Base | Head | Δ covered | Δ % |
|---|---:|---:|---:|---:|
| Operations | 16/160 (10.00%) | 23/160 (14.38%) | ▲ +7 | ▲ +4.38 |
| Statuses | 36/374 (9.63%) | 53/374 (14.17%) | ▲ +17 | ▲ +4.54 |
| Parameters | 7/95 (7.37%) | 11/95 (11.58%) | ▲ +4 | ▲ +4.21 |
| ↳ required | 7/49 (14.29%) | 11/49 (22.45%) | ▲ +4 | ▲ +8.16 |
| ↳ optional | 0/46 (0.00%) | 0/46 (0.00%) | ＝ 0 | ＝ 0 |

Gaps: **2 opened** (both blocked, see below) · **7 closed** · 148 in head (base 153). No longer covered: none.

## Spec drift (GAD contradicts the spec)

Both endpoints need `feature_likes` on. It was switched on with `curl -s -X POST localhost:3000/api/config/features -H 'Content-Type: application/json' -d '{"feature_likes":true}'` and then restored to `false`.

| Gap / test | Spec says | GAD does | Evidence (curl command + output) |
|---|---|---|---|
| `GET /likes/article` / tc-likes-05 (`test.fail`) | No parameters; 200 `{ likes: number }` | Without `?id=` it answers **405**. With `?id=<articleId>` it answers 200 with a per-article **map** `{ likes: { "<id>": number } }` | `curl -s -w ' [%{http_code}]' localhost:3000/api/likes/article` → `{} [405]`<br>`curl -s -w ' [%{http_code}]' 'localhost:3000/api/likes/article?id=90'` → `{"likes":{"90":1}} [200]` |
| `GET /likes/article/mylikes` / tc-likes-10 (`test.fail`) | 200 `{ likes: number }` | 200 with a per-article **map of booleans** `{ likes: { "<id>": boolean } }` | `curl -s -w ' [%{http_code}]' 'localhost:3000/api/likes/article/mylikes?id=90' -H 'userid: 1'` → `{"likes":{"90":true}} [200]` |
| `POST /likes` (no test.fail; noted for the contract) | Auth is bearer only; `userid` is not a parameter | Answers **401** "Access token for given user is invalid!" unless a `userid` header equal to the token owner's id is sent. LikesClient sends it from `user_id`. | `curl -s -w ' [%{http_code}]' -X POST localhost:3000/api/likes -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"article_id":90,"user_id":1}'` → `{"error":{"message":"Access token for given user is invalid!"}} [401]` |
| `GET /likes/article/{id}`, `GET /likes/comment/{id}` (no test.fail; noted) | 404 "Not found" | A non-existent id answers `200 {"likes":0}`. The only 404 is "feature disabled", which tc-likes-11/12 use. | `curl -s -w ' [%{http_code}]' localhost:3000/api/likes/article/999999999` → `{"likes":0} [200]`<br>`curl -s -w ' [%{http_code}]' localhost:3000/api/likes/comment/999999999` → `{"likes":0} [200]` |

## Blocked gaps

| Gap id | Reason |
|---|---|
| `status:POST /bookmarks/articles:201` | 201 "First bookmark created" needs a user with no bookmark record. The record it creates cannot be deleted through the API: there is no DELETE, and GAD 404s every `/api/bookmarks` URL except `/articles`. json-server also reuses a deleted user's id (max+1). So a fresh-user test passes once and then gets 200 on every later run. Verified: the full-suite run after the first green run got `Expected: 201, Received: 200`, and GAD's db then held `{"user_id":16,"article_ids":[],"id":3}` while the next new user was id 16 again. A repeatable, self-cleaning test is not possible. |
| `status:GET /likes/article/mylikes:400` | GAD has no 400 branch for this GET. A missing `id`, a non-numeric `id`, a missing `userid` and a non-numeric `userid` all answer 200: `curl -s 'localhost:3000/api/likes/article/mylikes'` → `{"likes":{"/api/likes/article/mylikes":false}} [200]`; `curl -s 'localhost:3000/api/likes/article/mylikes?id=abc'` → `{"likes":{"abc":false}} [200]`; `curl -s 'localhost:3000/api/likes/article/mylikes?id=1' -H 'userid: abc'` → `{"likes":{"1":false}} [200]`. The documented condition is unreachable, and there is no request we could send that would make the test prove it. |

**Test residue in GAD (from the removed tc-bookmarks 201 attempt):** bookmark record `{"user_id":16,"article_ids":[],"id":3}` stays in GAD's db until the next DB restore. It is harmless to the suite: the sanity check behind `/api/health` ignores bookmarks, and an empty list bookmarks nothing. Likes leave no residue, because every like is toggled off in `finally`.

## Where CONVENTIONS.md was insufficient

- §6 says "Only `labels.spec.ts` changes GAD's global feature flags", yet every `/api/likes*` and `/api/bookmarks*` endpoint is behind a flag that is off by default (`feature_likes`, `feature_user_bookmark_articles`), and §9 only lists `feature_labels`. This run followed the labels pattern in `likes.spec.ts` and `bookmarks.spec.ts`: serial mode, flag on in `beforeAll`, restored in `afterAll`. §6/§9 should generalize the rule or list these flags.
- "404 when the feature is disabled" is the only way GAD produces the documented 404 for likes, as in tc-labels-02. Please confirm this is the intended way to cover a bare "Not found" when GAD returns `200 {likes: 0}` for unknown ids.
- There is no guidance for toggle endpoints (POST adds or removes) that have no DELETE. Cleanup here POSTs again. Residue that cannot be removed through the API (bookmark records) is not addressed anywhere.
- §5 assumes error messages like "Access token not provided!". Likes and bookmarks answer 401 "Access token for given user is invalid!" even when the token is empty.
- How to get the seed user's id is not documented. This run reads it from `article.user_id` of an article the test creates. An `authUserId` fixture would be cleaner.
- Undocumented headers that GAD requires (`userid` on POST /likes) are not addressed. This run sends the header inside the client and documents it in the client JSDoc.
