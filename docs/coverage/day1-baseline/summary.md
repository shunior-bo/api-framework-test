## API coverage

Spec **🦎 GAD v1.3.3** · 64 counted requests · 10 excluded operations

| Dimension | Covered | Total | % |
|---|---:|---:|---:|
| Operations | 16 | 160 | 10.00% |
| Statuses | 27 | 374 | 7.22% |
| Parameters | 7 | 95 | 7.37% |
| ↳ required | 7 | 49 | 14.29% |
| ↳ optional | 0 | 46 | 0.00% |

### Top 15 gaps (162 total: 145 high, 17 medium, 0 low)

| Priority | Type | Gap | Hint |
|---|---|---|---|
| high | operation | `GET /about` | GET /about (Get information about application) is never called. Documented responses: 200. |
| high | operation | `GET /article-labels/articles/{id}` | GET /article-labels/articles/{id} (Get labels for article) is never called. Documented responses: 200, 404. |
| high | operation | `PUT /article-labels/articles/{id}` | PUT /article-labels/articles/{id} (Creates, updates or deletes labels for article) is never called. Documented responses: 200, 201, 400, 404, 422. Request body: components.schemas.ArticleLabelsUpdate. Requires a bearer token. |
| high | operation | `GET /articles/search` | GET /articles/search (Get articles with query) is never called. Documented responses: 200. |
| high | status | `PUT /articles/{id}:201` | Documented 201 ("Article created") for PUT /articles/{id} is never exercised. Call it with a valid request (see components.schemas.ArticleUpdatePut). |
| high | operation | `HEAD /articles/{id}` | HEAD /articles/{id} (Info about article) is never called. Documented responses: 200, 400, 404. |
| high | operation | `GET /book-authors` | GET /book-authors (Get book authors) is never called. Documented responses: 200, 404. |
| high | operation | `GET /book-genres` | GET /book-genres (Get book genres) is never called. Documented responses: 200, 404. |
| high | operation | `GET /book-shop-account-payment-cards` | GET /book-shop-account-payment-cards (Get user payment card from logged account) is never called. Documented responses: 200, 401, 404. Requires a bearer token. |
| high | operation | `PUT /book-shop-account-payment-cards` | PUT /book-shop-account-payment-cards (Update payment card from logged account) is never called. Documented responses: 200, 401, 422. Request body: components.schemas.BookShopPaymentCardUpdate. Requires a bearer token. |
| high | operation | `DELETE /book-shop-account-payment-cards` | DELETE /book-shop-account-payment-cards (Delete payment card from logged account) is never called. Documented responses: 200, 401, 404. Requires a bearer token. |
| high | operation | `POST /book-shop-account-payment-cards/topup` | POST /book-shop-account-payment-cards/topup (Top up account from payment card) is never called. Documented responses: 200, 401, 422. Request body: components.schemas.BookShopPaymentCardTopUp. Requires a bearer token. |
| high | operation | `GET /book-shop-accounts` | GET /book-shop-accounts (Get book shop account) is never called. Documented responses: 200, 401, 404. Requires a bearer token. |
| high | operation | `POST /book-shop-accounts` | POST /book-shop-accounts (Create book shop account) is never called. Documented responses: 201, 401, 409. Request body: components.schemas.BookShopAccount. Requires a bearer token. |
| high | operation | `POST /book-shop-accounts/files` | POST /book-shop-accounts/files (Upload account files) is never called. Documented responses: 200, 401. Requires a bearer token. |

> ⚠️ 0 unmatched request groups · 0 undocumented statuses · 2 spec warnings · 0 corrupt record lines (see coverage.json)

