# SaaS Readiness Review And Implementation Handoff

Date reviewed: 2026-06-11  
Last updated: 2026-06-13 session 20

## Executive Summary

This project has moved from a client-only image-generation prototype to an early SaaS-bound architecture. The browser no longer asks users for Gemini or Hugging Face keys, provider calls go through same-origin server routes in `server.js`, users can create local accounts, email verification/password reset flows exist with hashed single-use tokens and a Resend-capable delivery boundary, gallery assets are stored on the server under per-user ownership, local subscription/plan entitlements gate generation, Stripe checkout/webhook/customer-portal boundaries now exist behind server routes, admin/observability APIs exist behind a token, and the primary browser flow now has automated Playwright coverage. OpenAI `gpt-image-2`, current Gemini image models, and Hugging Face Inference Providers are represented as server-side adapters.

The app is still not public-SaaS-ready. The next blockers are production auth/email validation, external database/object storage, real Redis/Stripe/object-storage validation, production observability, real provider integration tests, and deployment hardening. Treat the current editor UI as reusable product surface and `server.js` as the first backend boundary, not the final production backend.

## Session 1 Progress

- Added `server.js`, a Node server that serves the app and exposes:
  - `GET /api/status`
  - `POST /api/prompt-enhancements`
  - `POST /api/generations`
- Added `.env.example` for server-side provider credentials:
  - `OPENAI_API_KEY`
  - `GEMINI_API_KEY`
  - `HF_TOKEN`
  - optional `HF_INFERENCE_PROVIDER`
- Added OpenAI image generation through `POST https://api.openai.com/v1/images/generations` with `gpt-image-2`.
- Updated Gemini server-side calls to stable image model ids:
  - `gemini-3.1-flash-image`
  - `gemini-3-pro-image`
  - `gemini-2.5-flash-image`
- Added Hugging Face server-side text-to-image generation through `@huggingface/inference`.
- Replaced client-side API-key setup UI with server provider status.
- Replaced browser provider calls in `js/api.js` with same-origin `/api/*` calls.
- Removed browser `localStorage` storage of provider keys.
- Fixed toast/gallery error HTML injection risks.
- Fixed author text mojibake and the author typography binding bug.
- Upgraded Vite to `^8.0.16`; `npm audit --audit-level=moderate` now reports zero vulnerabilities.

## Session 2 Progress

- Added local account authentication:
  - `POST /api/auth/signup`
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/session`
- Added HTTP-only session cookies.
- Added PBKDF2 password hashing for local accounts.
- Added per-user starter monthly generation quota enforcement.
- Added a local `.data/db.json` datastore, ignored by git.
- Added local `.data/assets/` image asset storage, ignored by git.
- Added durable server records for:
  - `users`
  - `sessions`
  - `generationJobs`
  - `imageAssets`
  - `providerUsageEvents`
  - `userGalleryItems`
- Generation now requires a signed-in user and creates a durable generation job.
- Successful generation now stores the generated source image as a protected server asset and returns `/api/assets/:id` instead of returning a base64 data URL.
- Added protected asset serving through `GET /api/assets/:id`.
- Replaced IndexedDB gallery persistence with server-backed gallery APIs:
  - `GET /api/gallery`
  - `POST /api/gallery`
  - `DELETE /api/gallery/:id`
- Added an Account & Server Status panel for sign up, sign in, sign out, provider status, and quota display.
- Updated the canvas loader to fetch protected `/api/assets/*` URLs with the signed-in session before drawing.
- Cleaned remaining UI encoding artifacts in the app title/status dot.

## Session 3 Progress

- Added in-memory API rate limiting with environment controls:
  - `API_RATE_LIMIT_PER_MINUTE`
  - `AUTH_RATE_LIMIT_PER_15_MINUTES`
  - `GENERATION_RATE_LIMIT_PER_HOUR`
- Added generation idempotency through the `Idempotency-Key` request header.
- Updated the frontend generation call to send an idempotency key.
- Disabled the Generate button while a generation request is in flight.
- Added `MOCK_PROVIDER_RESPONSES=1` test mode so provider paths can be tested without spending API credits.
- Added `npm test` using Node's built-in test runner.
- Added automated backend tests in `tests/server.test.mjs` covering:
  - unauthenticated generation blocking
  - signup/session
  - server-backed gallery save/load/delete
  - protected asset access
  - mocked provider generation
  - durable generation jobs and usage events
  - idempotent generation replay
  - monthly quota enforcement
  - generation rate limiting

## Session 4 Progress

- Added a committed Playwright E2E harness:
  - `playwright.config.mjs`
  - `scripts/e2e-server.mjs`
  - `tests/e2e/app.spec.mjs`
- Added `npm run test:e2e`.
- The E2E server runs with `MOCK_PROVIDER_RESPONSES=1`, fake provider keys, high local rate limits, and a reset `.data-e2e` data directory.
- Added browser coverage for:
  - app load and first meaningful Studio render
  - server provider status display
  - account creation
  - OpenAI-model generation through the server API
  - quota UI update
  - text overlay edit
  - save to server-backed gallery
  - gallery card render
  - PNG download
- Fixed gallery card action binding for server UUID IDs. The previous browser handler coerced IDs with `Number(...)`, which broke edit/share/download/delete on server-backed gallery items.
- Updated mocked provider images from a 1x1 PNG to a small visible PNG so browser tests exercise the real editor controls.

## Session 5 Progress

- Added local subscription and plan-entitlement records to `.data/db.json`:
  - `subscriptions`
  - `plan`
  - `status`
  - `billingProvider`
  - billing customer/subscription ID placeholders
  - billing period fields
- Added startup backfill for existing local users that do not yet have subscription records.
- Added `GET /api/billing/status`, protected by auth.
- Added a local plan catalog:
  - `starter`: limited monthly quota and a curated lower-cost model set.
  - `pro`: higher monthly quota and all configured models.
- Generation authorization now checks provider configuration, subscription status, plan-allowed provider/model, and plan-aware quota before creating a generation job or calling a provider.
- Generation jobs and usage events now record the plan and subscription ID that authorized the generation.
- Account & Server Status now shows current plan and billing status.
- Added `PRO_MONTHLY_GENERATION_LIMIT` to `.env.example`.
- Expanded automated tests to cover billing status, subscription record creation, plan metadata on usage/jobs, and model blocking before provider work.
- Expanded the Playwright smoke test to verify visible plan and billing status after signup.

## Session 6 Progress

- Added user-cancelable image generation:
  - visible `Cancel Generation` control in the loading overlay
  - frontend `AbortController` for `/api/generations`
  - user-safe canceled-generation toast
- Added server-side abort propagation for generation requests:
  - client disconnects create an `AbortSignal`
  - OpenAI and Gemini provider `fetch` calls receive that signal
  - mocked provider calls support delayed, abortable responses for tests
  - Hugging Face generation checks the abort signal before and after the SDK call
- Canceled generation jobs are marked failed with `generation_aborted`.
- Canceled generation requests do not write provider usage events.
- Added `MOCK_PROVIDER_DELAY_MS` to `.env.example` for deterministic local cancellation tests.
- Hardened backend test server port allocation to avoid random port collisions.
- Expanded automated tests:
  - backend test verifies aborted generation fails the job without usage
  - Playwright test verifies the visible cancel flow

## Session 7 Progress

- Added structured JSON server logging:
  - startup event
  - per-request `http_request` events with request ID, method, path, status, duration, and authenticated user ID when available
  - error events with redacted error details
- Added recursive log redaction for sensitive keys and configured secret values.
- Added `LOG_LEVEL` to `.env.example`; tests default to `silent` logs unless explicitly exercising observability.
- Added read-only admin observability APIs:
  - `GET /api/admin/summary`
  - `GET /api/admin/jobs`
- Added `ADMIN_API_TOKEN` to `.env.example`.
- Admin routes require `Authorization: Bearer <token>` or `x-admin-token` and return `admin_not_configured` when no token is configured.
- Admin job output omits raw provider error details and prompts to avoid leaking provider payloads or user content.
- Expanded automated tests to verify admin token enforcement, summary counts, sanitized job output, structured log emission, and token redaction.

## Session 8 Progress

- Added a gated real-provider smoke test harness in `scripts/real-provider-smoke.mjs`.
- Added `npm run test:providers`.
- The real-provider smoke script is skipped by default and requires:
  - `RUN_REAL_PROVIDER_SMOKE=1`
  - `REAL_PROVIDER_SMOKE_PROVIDERS=openai,gemini,huggingface` or a subset
  - the matching provider keys
- The smoke script starts the app server with `MOCK_PROVIDER_RESPONSES=0`, creates a temporary user, generates through `/api/generations`, fetches the protected `/api/assets/:id` image, verifies durable job/usage records, and removes temporary data unless `REAL_PROVIDER_SMOKE_KEEP_DATA=1`.
- Added `.env.example` entries for:
  - `RUN_REAL_PROVIDER_SMOKE`
  - `REAL_PROVIDER_SMOKE_PROVIDERS`
  - `REAL_PROVIDER_SMOKE_PROMPT`
  - `REAL_PROVIDER_SMOKE_KEEP_DATA`
- Verified the default skip path so normal local test runs cannot spend provider credits accidentally.

## Session 9 Progress

- Added deployment health endpoints:
  - `GET /api/health` for liveness
  - `GET /api/readiness` for datastore, asset-storage, and required-provider checks
- Added `REQUIRED_PROVIDERS` to `.env.example`.
- Readiness writes and removes a small asset-storage probe file so deploy targets can detect local storage write failures.
- Readiness only requires provider configuration when `REQUIRED_PROVIDERS` is set, so partial local provider setup does not fail normal development.
- Added backend tests for health/readiness success and missing-required-provider failure.
- Restarted the local dev server on port `5180` so `/api/health` and `/api/readiness` reflect the current code.

## Session 10 Progress

- Added ESLint as a committed quality gate:
  - `eslint.config.js`
  - `npm run lint`
- Scoped linting across browser code, backend code, Vite config, Playwright config, scripts, and tests.
- Ignored generated/runtime folders such as `dist/`, `node_modules/`, `.data/`, `.data-e2e/`, and Playwright reports.
- Fixed the initial lint findings without changing runtime behavior:
  - removed an unused model-selector event parameter in `app.js`
  - removed an unnecessary overwritten toast icon initializer in `app.js`
  - iterated editor overlay values directly in `js/editor.js`
- Re-ran the full local verification matrix, including linting.

## Session 11 Progress

- Hardened local auth/session storage:
  - new sessions now store only an HMAC SHA-256 `tokenHash` in `.data/db.json`
  - raw session bearer tokens remain only in the HTTP-only cookie
  - legacy raw session records are normalized to hashed records on datastore load
- Added `SESSION_SECRET` to `.env.example`; production mode requires at least 32 characters.
- Added explicit production mode via `node server.js --production`.
- Updated `npm start` and `npm run preview` to launch `server.js --production`.
- Added production startup guards:
  - block `MOCK_PROVIDER_RESPONSES=1`
  - require `SESSION_SECRET`
  - require `REQUIRED_PROVIDERS`
  - require configured credentials for required providers
  - block local `.data` storage in production unless `ALLOW_LOCAL_PRODUCTION_STORAGE=1` is explicitly set for controlled single-instance staging
- Production session cookies now use `Secure` based on production mode, not only `NODE_ENV`.
- Added backend tests proving unsafe production config exits and production signup writes only hashed session records.

## Session 12 Progress

- Added an asset-storage driver boundary in `server.js`.
- Kept `local` asset storage as the default development/test driver.
- Added an S3-compatible asset-storage driver using `@aws-sdk/client-s3`, configurable for AWS S3, Cloudflare R2, MinIO, or similar providers.
- Added asset storage env controls to `.env.example`:
  - `ASSET_STORAGE_DRIVER`
  - `ASSET_STORAGE_PREFIX`
  - `ASSET_STORAGE_BUCKET`
  - `ASSET_STORAGE_REGION`
  - `ASSET_STORAGE_ENDPOINT`
  - `ASSET_STORAGE_FORCE_PATH_STYLE`
  - `ASSET_STORAGE_ACCESS_KEY_ID`
  - `ASSET_STORAGE_SECRET_ACCESS_KEY`
- New asset records now store `storageDriver` and `storageKey`; legacy local records are normalized on load.
- `/api/assets/:id` now reads through the configured storage driver while preserving the same browser URL contract.
- `/api/readiness` now probes the configured asset-storage driver and reports driver/bucket/prefix details.
- Production startup now rejects `ASSET_STORAGE_DRIVER=s3` unless bucket, region, and access credentials are present.
- Backend tests now verify local asset metadata and missing S3 production config.
- Refreshed the current-code dev server on `http://localhost:5182`.

## Session 13 Progress

- Added a gated real object-storage smoke harness:
  - `scripts/object-storage-smoke.mjs`
  - `npm run test:storage`
- The object-storage smoke script is skipped by default and requires:
  - `RUN_OBJECT_STORAGE_SMOKE=1`
  - `ASSET_STORAGE_DRIVER=s3`
  - `ASSET_STORAGE_BUCKET`
  - `ASSET_STORAGE_REGION`
  - `ASSET_STORAGE_ACCESS_KEY_ID`
  - `ASSET_STORAGE_SECRET_ACCESS_KEY`
- The smoke script starts the app server in production mode with isolated temp data, allows local JSON DB only for the smoke run, writes two tiny gallery image assets through the configured S3-compatible driver, fetches one back through protected `/api/assets/:id`, verifies `storageDriver: "s3"` records, and removes temp data unless `OBJECT_STORAGE_SMOKE_KEEP_DATA=1`.
- Added `.env.example` entries for:
  - `RUN_OBJECT_STORAGE_SMOKE`
  - `OBJECT_STORAGE_SMOKE_KEEP_DATA`
- Verified the default skip path so normal local test runs cannot write to object storage accidentally.
- Refreshed the current-code dev server on `http://localhost:5182`.

## Session 14 Progress

- Added a local content-policy gate for user text before provider or asset work:
  - generation prompts
  - prompt-enhancement prompts
  - gallery-save prompt and text overlays
- Added durable content-policy event records in `.data/db.json` under `contentPolicyEvents`.
- Added `CONTENT_POLICY_MODE=local` to `.env.example`; production startup rejects `CONTENT_POLICY_MODE=off`.
- Added signed-in abuse reporting:
  - `POST /api/abuse-reports`
  - report targets can be gallery items, image assets, generation jobs, or other content
  - known target IDs are checked against the reporting user before a report is accepted
- Added admin moderation APIs:
  - `GET /api/admin/reports`
  - `GET /api/admin/policy-events`
- Expanded `GET /api/admin/summary` with content-policy and abuse-report counts.
- Added a gallery card Report action that submits an abuse report for the selected gallery item.
- Added backend tests proving unsafe prompts are blocked before generation jobs/provider work and abuse reports appear in admin moderation views.
- Refreshed the current-code dev server on `http://localhost:5182`.

## Session 15 Progress

- Added an in-app Admin Operations dashboard:
  - Admin nav item and `#admin-view`
  - admin token input held in memory only
  - summary metric cards
  - recent jobs list
  - abuse reports list
  - policy events list
- Added frontend admin API wrappers for:
  - `GET /api/admin/summary`
  - `GET /api/admin/jobs`
  - `GET /api/admin/reports`
  - `GET /api/admin/policy-events`
- Added Playwright coverage proving the admin token can load dashboard data and is not stored in `localStorage` or `sessionStorage`.
- Added `ADMIN_API_TOKEN` to the e2e server environment.
- Performed a Playwright screenshot visual pass for the Admin view on `http://localhost:5182`; fixed a stretched Refresh button layout issue found in the screenshot.
- Refreshed the current-code dev server on `http://localhost:5182` with a local admin token for manual Admin UI testing.

## Session 16 Progress

- Added the official Stripe Node SDK dependency and pinned server requests to Stripe API version `2026-05-27.dahlia`.
- Added guarded Stripe billing environment controls to `.env.example`:
  - `BILLING_PROVIDER`
  - `STRIPE_REQUIRED`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_PRO_PRICE_ID`
  - `APP_BASE_URL`
  - `STRIPE_BILLING_PORTAL_RETURN_URL`
  - `MOCK_STRIPE_RESPONSES`
- Added server-side billing APIs:
  - `POST /api/billing/checkout`
  - `POST /api/billing/portal`
  - `POST /api/billing/webhook`
- Checkout creates Stripe Checkout Sessions in `subscription` mode for the configured Pro Price ID.
- Customer Portal sessions are server-created and require an existing linked Stripe customer.
- Webhooks read the raw request body, verify Stripe signatures outside mock mode, and handle:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Subscription records now retain Stripe checkout session, customer, subscription, and price IDs.
- Stripe subscription updates converge local plan entitlements:
  - active/trialing Stripe subscriptions unlock Pro.
  - canceled/incomplete-expired/unpaid subscriptions downgrade the account back to Starter.
- Added billing readiness reporting when `BILLING_PROVIDER=stripe` or `STRIPE_REQUIRED=1`.
- Production startup now rejects `MOCK_STRIPE_RESPONSES=1` and refuses Stripe-required deploys without Stripe secret, webhook secret, Pro Price ID, and explicit `APP_BASE_URL`.
- Added Account & Server Status billing actions:
  - `Upgrade to Pro`
  - `Manage Billing`
- The browser still never receives Stripe secret keys; it only receives hosted session URLs from same-origin server routes.
- Added backend tests covering missing Stripe config, mocked checkout/webhook/portal upgrade flow, downgrade flow, premium model unlock/relock, and unsafe Stripe-required production startup.
- Refreshed a current-code dev server on `http://localhost:5183` with mocked providers and mocked Stripe billing for manual billing UI inspection.

## Session 17 Progress

- Added the official `redis` Node client dependency for distributed rate limiting.
- Added rate-limit environment controls to `.env.example`:
  - `RATE_LIMIT_DRIVER`
  - `RATE_LIMIT_KEY_PREFIX`
  - `REDIS_URL`
  - `ALLOW_IN_MEMORY_RATE_LIMITS`
  - `RUN_REDIS_RATE_LIMIT_SMOKE`
  - `REDIS_RATE_LIMIT_SMOKE_KEEP_DATA`
- Converted route-level rate limiting to an async driver boundary:
  - `memory` remains the development/test default.
  - `redis` uses Redis-backed counters for multi-instance deployments.
- Redis limiter keys use HMAC-hashed identities so raw IP/user identifiers are not written into Redis key names.
- Redis rate limiting uses a server-side Lua script through `EVAL` so `INCR` and `PEXPIRE` happen atomically.
- Added `/api/readiness` rate-limit reporting:
  - memory mode reports `distributed: false`.
  - Redis mode pings Redis and reports `distributed: true` when reachable.
- Production startup now rejects:
  - `RATE_LIMIT_DRIVER=redis` without `REDIS_URL`.
  - `RATE_LIMIT_DRIVER=memory` unless `ALLOW_IN_MEMORY_RATE_LIMITS=1` is explicitly set for controlled single-instance staging.
- Added a gated real Redis smoke harness:
  - `scripts/redis-rate-limit-smoke.mjs`
  - `npm run test:rate-limit`
- The Redis smoke script is skipped by default and requires `RUN_REDIS_RATE_LIMIT_SMOKE=1` plus `REDIS_URL`.
- Expanded backend tests to assert rate-limit readiness details and production Redis/memory guard failures.
- Refreshed the current-code dev server on `http://localhost:5183` with mocked providers, mocked Stripe billing, and local memory rate limiting for manual testing.

## Session 18 Progress

- Added local email verification and password reset foundations.
- Added auth environment controls to `.env.example`:
  - `EMAIL_VERIFICATION_REQUIRED`
  - `AUTH_TOKEN_DEBUG`
  - `ALLOW_UNVERIFIED_EMAILS`
- Added durable `authTokens` records to the local datastore.
- Auth token records store only HMAC hashes, never raw verification/reset tokens.
- Added server-side auth APIs:
  - `POST /api/auth/request-verification`
  - `POST /api/auth/verify-email`
  - `POST /api/auth/request-password-reset`
  - `POST /api/auth/reset-password`
- Password reset requests return a generic response for existing and missing accounts to reduce account enumeration risk.
- Password reset tokens are single-use, expire after 20 minutes, and revoke all active sessions for the user after a successful reset.
- Email verification tokens are single-use and expire after 24 hours.
- When `EMAIL_VERIFICATION_REQUIRED=1`, content-creation routes are blocked until email is verified:
  - gallery save
  - prompt enhancement
  - image generation
- Production startup now rejects:
  - `AUTH_TOKEN_DEBUG=1`
  - missing email verification unless `ALLOW_UNVERIFIED_EMAILS=1` is explicitly set for controlled staging.
- Account & Server Status now shows email verification status and a `Send Verification Link` action when verification is required.
- Frontend API wrappers now expose the verification and password reset endpoints.
- Expanded backend tests to cover email-verification gating, hashed token storage, single-use verification tokens, generic password-reset requests, single-use reset tokens, password update, and session revocation.
- Expanded Playwright coverage to assert visible email status after signup.

## Session 19 Progress

- Added the official `resend` SDK dependency for transactional email delivery.
- Added transactional email environment controls to `.env.example`:
  - `EMAIL_DELIVERY_DRIVER`
  - `EMAIL_PRODUCT_NAME`
  - `EMAIL_FROM`
  - `EMAIL_REPLY_TO`
  - `RESEND_API_KEY`
  - `ALLOW_LOCAL_EMAIL_DELIVERY`
- Added a server-side email delivery boundary:
  - `log` driver for local development.
  - `resend` driver for production email.
  - Resend send calls use SDK-level idempotency keys derived from hashed auth tokens.
- Added durable `emailDeliveryEvents` records to the local datastore.
- Email delivery events record type, provider, status, provider message ID, and safe error metadata, but do not store raw verification/reset tokens or query-string links.
- Signup and verification-request flows now send verification emails when a token is created.
- Password reset requests now send reset-link emails for existing users while keeping the same generic API response for existing and missing accounts.
- Successful password reset now sends a password-changed notification and revokes prior sessions.
- Production startup now rejects:
  - `EMAIL_VERIFICATION_REQUIRED=1` without production-ready email delivery.
  - `EMAIL_DELIVERY_DRIVER=resend` without `RESEND_API_KEY`, `EMAIL_FROM`, and `APP_BASE_URL`.
  - `EMAIL_DELIVERY_DRIVER=log` for required-verification production unless `ALLOW_LOCAL_EMAIL_DELIVERY=1` is explicitly set for controlled staging.
- `/api/readiness` now reports an `emailDelivery` check with driver, configured, production-ready, email-verification, sender, and app-base-url status.
- Admin summary now includes email-delivery totals grouped by type, status, and provider.
- Added user-facing emailed-link handling in the single-page app:
  - `?verify_email=...` verifies the email, refreshes the account session, shows Account settings, and removes the token from the URL.
  - `?reset_password=...` shows a reset-password panel, keeps the token only in memory, and removes the token from the URL.
  - Signed-out users can request a password reset from the Account panel.
- Expanded backend tests to assert email-delivery audit records for verification/reset/password-change flows, no plaintext token/link persistence in delivery events, email-delivery readiness, and unsafe Resend production startup.
- Added a focused Playwright reset-link probe against `http://localhost:5184` to verify the reset panel, token URL cleanup, and absence of browser console errors.

## Session 20 Progress

- Added `checklist.md` as an operator-facing live beta external setup checklist.
- The checklist maps current production blockers to owner actions outside the coding environment:
  - deployment host and DNS
  - OpenAI, Gemini, and Hugging Face provider accounts/keys
  - Resend domain verification and transactional email
  - Stripe product, price, portal, and webhook setup
  - Redis provisioning and smoke test
  - S3-compatible object storage provisioning and smoke test
  - managed Postgres provisioning for the upcoming datastore adapter
  - observability, safety/legal, and beta operations
- The checklist explicitly calls out that live beta must not proceed while the app depends on `.data/db.json` for durable user data.
- The checklist includes the production env snapshot, no-go env values, final validation run, and beta launch gate.

## Current Project Shape

- Frontend: Vite/vanilla JS app with `index.html`, `styles.css`, `app.js`, and helper modules under `js/`.
- Backend: Node server in `server.js` with provider adapter functions and static serving.
- Runtime state: prompt/editor session remains in `localStorage`; gallery history is now server-backed.
- Provider calls: server-side routes in `server.js`; browser wrapper in `js/api.js` calls only same-origin `/api/*`.
- Generation UX: in-flight generations can be canceled from the loading overlay.
- Credentials: server-side environment variables only; `.env` and `.env.local` are ignored by git.
- Local persistence: `.data/db.json` and `.data/assets/` are local development substitutes for a real database and object storage.
- Asset storage: server assets are behind a `local` or `s3` driver selected by `ASSET_STORAGE_DRIVER`; the app still defaults to local storage until real object-storage credentials are configured.
- Billing foundation: `.data/db.json` stores subscription records, plan entitlements, and Stripe identifier fields; Stripe checkout/webhook/customer-portal server routes exist, but real Stripe keys/webhook registration have not been validated in sandbox or live mode.
- Rate limiting: route, auth, prompt-enhancement, and generation rate limits now use a `memory` or `redis` driver selected by `RATE_LIMIT_DRIVER`; Redis is the production path, while memory mode is development/staging only.
- Local auth hardening: session cookies are HTTP-only; production cookies are `Secure`; stored session records use HMAC token hashes instead of raw bearer tokens; email verification and password reset tokens are stored as HMAC hashes and are single-use with expirations.
- Transactional email boundary: auth emails use `EMAIL_DELIVERY_DRIVER=log` for local development or `EMAIL_DELIVERY_DRIVER=resend` for production; delivery attempts are recorded in `emailDeliveryEvents` without raw auth links/tokens.
- Local observability foundation: JSON logs go to stdout/stderr and token-guarded admin APIs expose usage/job summaries without raw provider payloads.
- Local trust/safety foundation: `CONTENT_POLICY_MODE=local` blocks clearly unsafe prompt text before provider work, stores moderation events, and supports user abuse reports plus admin review APIs.
- Admin UI: the in-app Admin Operations view can load summary, job, report, and policy-event data using a manually entered admin token that is not persisted in browser storage.
- Deployment checks: `/api/health` and `/api/readiness` are available for liveness/readiness probes.
- Dev server: `npm run dev` starts `node server.js --dev` on port `5180` by default.
- Production start: `npm start` launches `node server.js --production` and refuses unsafe production config unless local-storage staging is explicitly allowed.
- Tests: `npm test` starts isolated mock-provider servers with temporary data directories. `npm run test:e2e` starts a reset mocked-provider browser server and runs the Playwright user-flow smoke test.
- Linting: `npm run lint` runs ESLint across app, server, config, script, and test files.
- Real-provider checks: `npm run test:providers` is available but skipped unless explicit spend-approval environment variables are set.
- Real object-storage checks: `npm run test:storage` is available but skipped unless explicit bucket-write approval environment variables are set.
- Build: `npm run build` succeeds with Vite 8.

## Current Provider Docs Snapshot

Provider docs were rechecked on 2026-06-11 against official provider documentation, and transactional email docs were rechecked on 2026-06-13. Use these docs again when implementing because provider APIs move quickly.

### OpenAI

Sources:

- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/reference/resources/images/methods/generate

Current implementation:

- Uses the Images API for single-prompt generation.
- Uses model `gpt-image-2`.
- Stores GPT Image base64 output as a protected server asset and returns `/api/assets/:id` to the browser.
- Maps UI aspect ratios to `gpt-image-2` sizes:
  - `1:1` -> `1024x1024`
  - `16:9` -> `1536x864`
  - `9:16` -> `864x1536`
- Uses server-side `OPENAI_API_KEY`.

Remaining OpenAI work:

- Add image edit endpoint when product flow needs edits.
- Add quality/output-format controls to the UI if desired.
- Persist provider response metadata and cost/usage estimates.
- Add one controlled real-provider smoke test after approval to spend API credits.

### Google Gemini / Nano Banana

Sources:

- https://ai.google.dev/gemini-api/docs/image-generation
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/rate-limits

Current implementation:

- Uses server-side REST calls with `x-goog-api-key`.
- Uses current stable model ids in the UI and adapter.
- Uses `generationConfig.responseFormat.image.aspectRatio` instead of appending aspect ratio only as prompt text.
- Adds `imageSize: "1K"` for Gemini 3 image models.
- Uses server-side `GEMINI_API_KEY`.

Remaining Gemini work:

- Run real generation tests with a configured key.
- Persist request/response metadata and rate-limit failures.
- Decide which Gemini models are available per plan.

### Hugging Face

Sources:

- https://huggingface.co/docs/inference-providers/en/index
- https://huggingface.co/docs/inference-providers/tasks/text-to-image
- https://huggingface.co/docs/huggingface.js/en/inference/README

Current implementation:

- Uses `@huggingface/inference` on the server.
- Uses curated model options:
  - `black-forest-labs/FLUX.1-Krea-dev`
  - `Qwen/Qwen-Image`
  - `ByteDance/Hyper-SD`
- Uses server-side `HF_TOKEN`.
- Supports optional `HF_INFERENCE_PROVIDER`, defaulting to `auto`.

Remaining Hugging Face work:

- Run real generation tests with a configured token.
- Validate which model/provider combinations are reliable and cost-appropriate.
- Store provider/model availability in database config rather than hardcoding it.

### Stripe Billing

Sources:

- https://docs.stripe.com/api/versioning
- https://docs.stripe.com/sdks/set-version
- https://docs.stripe.com/api/checkout/sessions
- https://docs.stripe.com/api/checkout/sessions/create
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/customer-management/integrate-customer-portal

Current implementation:

- Uses the official Stripe Node SDK on the server.
- Pins SDK requests to Stripe API version `2026-05-27.dahlia`.
- Creates Checkout Sessions in `subscription` mode for a configured Pro Price ID.
- Creates Customer Portal sessions for linked Stripe customers.
- Processes webhook events from the raw request body and verifies Stripe signatures outside mock mode.
- Keeps Stripe secret keys, webhook secrets, and price IDs server-side only.

Remaining Stripe work:

- Configure real Stripe sandbox Product/Price IDs and webhook endpoint.
- Run hosted Checkout and Customer Portal flows with sandbox keys.
- Confirm live event payloads for subscription create/update/delete against the production database schema.
- Move billing records out of `.data/db.json` before multi-instance deployment.

### Redis Rate Limiting

Sources:

- https://redis.io/docs/latest/develop/clients/nodejs/
- https://redis.io/docs/latest/commands/incr/
- https://redis.io/docs/latest/commands/pexpire/
- https://redis.io/docs/latest/commands/eval/

Current implementation:

- Uses the official `redis` Node client.
- Supports `RATE_LIMIT_DRIVER=memory` for development/test and `RATE_LIMIT_DRIVER=redis` for distributed deployments.
- Uses Redis `EVAL` to atomically increment a counter and apply a millisecond TTL.
- Adds readiness checks for the selected rate-limit driver.
- Production startup refuses in-memory limits unless explicitly allowed for single-instance staging.

Remaining Redis work:

- Provision Redis or Redis-compatible managed storage.
- Run `RUN_REDIS_RATE_LIMIT_SMOKE=1 REDIS_URL=... npm run test:rate-limit` against the configured instance.
- Decide final rate-limit values by plan/provider and monitor false positives.

### Local Auth Hardening

Sources:

- https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/09-Testing_for_Weak_Password_Change_or_Reset_Functionalities

Current implementation:

- Stores session tokens and auth recovery tokens only as HMAC hashes.
- Uses single-use expiring tokens for email verification and password reset.
- Gives password reset requests a generic success response.
- Revokes existing sessions after successful password reset.
- Can require verified email before content creation through `EMAIL_VERIFICATION_REQUIRED=1`.
- Sends verification/reset/password-changed transactional emails through a delivery boundary when tokens are created or consumed.
- Handles emailed verification/reset links in the SPA and removes auth tokens from the URL after load.

Remaining auth work:

- Configure and validate real Resend delivery, including domain verification, sender identity, and inbox deliverability.
- Decide whether to keep hardening local auth or replace it with a managed identity provider.
- Add MFA/OAuth/organization support if the SaaS product needs teams.

### Transactional Email

Sources:

- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/dashboard/domains/introduction
- https://resend.com/docs/dashboard/domains/verify-dns-records

Current implementation:

- Uses the official `resend` Node SDK.
- Supports `EMAIL_DELIVERY_DRIVER=log` for development and `EMAIL_DELIVERY_DRIVER=resend` for production.
- Uses `RESEND_API_KEY`, `EMAIL_FROM`, optional `EMAIL_REPLY_TO`, and `APP_BASE_URL`.
- Uses Resend idempotency keys for auth-token email sends.
- Records delivery events without storing raw verification/reset links.
- Production startup refuses required email verification unless production-ready delivery is configured or explicitly allowed for controlled staging.

Remaining email work:

- Verify the sender domain in Resend and set DNS records.
- Run a real verification email and password-reset email through Resend.
- Add monitoring/alerting for `emailDeliveryEvents.status=failed`.

## Blocking SaaS Issues

### 1. Auth Is Harder But Still Not Production-Complete

Users can now create local accounts and protected session cookies. Session records are no longer stored as raw bearer tokens, production cookies use `Secure`, production mode refuses to start without `SESSION_SECRET`, and email verification/password-reset token flows now have a Resend-capable delivery boundary plus user-facing link handling. This is enough for local SaaS flow testing and safer staging, but still not enough for full production identity because real Resend domain/key validation, inbox deliverability, MFA, OAuth, organization/team membership, and managed identity operations are not done.

Required action: configure and verify real Resend delivery or replace local auth with a managed provider. Every generation now attaches `user_id`; add organization/team support if the SaaS will support multi-user accounts.

### 2. Stripe Billing Boundary Exists But Is Not Production-Live

The backend now creates local subscription records, exposes billing status, checks plan-aware provider/model access, creates server-side Stripe Checkout and Customer Portal sessions, and processes Stripe webhooks through a raw-body/signature-verification path. This is enough for local and mocked SaaS flow testing, but real Stripe sandbox/live keys, webhook endpoint registration, product/price configuration, and deployed callback URLs have not been validated. Billing state is still stored in `.data/db.json`, so it is not multi-instance safe.

Required action: configure Stripe sandbox Product/Price IDs, set `BILLING_PROVIDER=stripe`, `STRIPE_REQUIRED=1`, `APP_BASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRO_PRICE_ID`; register the deployed `/api/billing/webhook` endpoint for the required event types; run an end-to-end Stripe sandbox checkout and customer-portal cancellation/update test; then move billing records to the production database and tune Redis-backed plan-aware controls.

### 3. Local File Storage Must Become Object Storage

Generated and saved images now go through an asset-storage driver. Local development still stores files under `.data/assets/`, while `ASSET_STORAGE_DRIVER=s3` can route assets to S3-compatible object storage. The object-storage code path is configured and guarded, but it has not yet been verified against a real bucket.

Required action: provision object storage such as S3, Cloudflare R2, Supabase Storage, or Vercel Blob; configure the production env; run `RUN_OBJECT_STORAGE_SMOKE=1 ASSET_STORAGE_DRIVER=s3 npm run test:storage` with explicit bucket-write approval; and keep local storage only for development/staging.

### 4. Local JSON Store Must Become A Real Database

Durable records now exist in `.data/db.json`, but this is not a concurrent production database. It has no migrations, backups, indexes, query controls, or multi-instance safety.

Required action: replace `.data/db.json` with Postgres or another production datastore. Add migrations and indexes for user, job, asset, and usage queries.

### 5. Real Provider Smoke Runs Still Needed

Mocked provider tests now exercise the generation path without API spend, and a gated real-provider smoke harness now exists. Real provider generation was not run to avoid spending API credits without explicit approval.

Required action: run one controlled real-provider smoke test per intended launch provider with explicit cost approval and configured provider keys. Record which provider/model combinations are reliable and cost-appropriate.

## Code Quality Findings

### High Priority

- Provision Redis and run the gated Redis rate-limit smoke test before public deployment.
- Move local `.data` persistence to production services.
- Finish real Stripe sandbox/live billing configuration and move billing state out of `.data/db.json`.
- Configure and validate real Resend delivery/domain DNS, or move auth to a managed provider.

### Medium Priority

- `wrapText` does not break long single words (`js/editor.js`), so long prompts/URLs/user text can overflow the canvas.
- Canvas dragging chooses overlays by vertical proximity rather than actual text bounds. Overlapping layers will be frustrating.
- Gallery save/load/delete now uses server APIs, but editing an existing gallery item is still not implemented.
- `app.js` still has too much global state; provider expansion and tests will be easier after modularizing UI state.

### Lower Priority

- `package.json` still has a placeholder `homepage` for GitHub Pages even though the SaaS path now requires a backend.
- Many inline styles in `index.html` should be consolidated after the product shell stabilizes.

## Recommended Target Architecture

### Frontend

- Keep the canvas editor as the starting point.
- Keep provider choice server-driven.
- Replace the local gallery with server-backed gallery records.
- Show queued/running/failed/completed job states.
- Add account, plan, quota, and billing status views.

### Backend

- Auth middleware on every generation/gallery route.
- Provider adapter interface with common request/result shape.
- Queue long-running jobs if provider latency can exceed deployment timeouts.
- Rate limit by user, IP, plan, and provider.
- Log provider request metadata without storing raw secrets.
- Sanitize prompts and provider errors before displaying them.

### Data Model

Minimum tables/collections:

- `users`
- `subscriptions` or billing customer mapping
- `generation_jobs`
- `image_assets`
- `provider_usage_events`
- `prompt_presets`
- `user_gallery_items`
- `content_policy_events`
- `abuse_reports`
- `email_delivery_events`

Minimum fields for `generation_jobs`:

- `id`, `user_id`, `status`, `provider`, `model`, `prompt`, `aspect_ratio`, `quality`, `output_format`
- `input_asset_ids`, `output_asset_ids`
- `provider_request_id`, `provider_usage_json`, `cost_estimate_cents`
- `error_code`, `safe_error_message`
- `created_at`, `started_at`, `completed_at`

## Implementation Phases

### Phase 1: Stabilize The Prototype

- Done: fix toast/gallery error injection.
- Done: fix mojibake author text.
- Done: fix author typography binding.
- Done: add non-JSON provider error handling in client/server wrappers.
- Done: update model labels/ids in UI to current docs without client-side production keys.
- Done: add automated backend smoke tests with mocked providers.
- Done: add browser automation smoke tests with mocked providers.
- Done: add cancelable in-flight generation requests.
- Done: add linting.

### Phase 2: Add SaaS Foundation

- Done: add first server API shell.
- Done: move Gemini and Hugging Face calls server-side.
- Done: replace browser key setup UI with server status.
- Done: add local auth/session flow.
- Done: add local email verification and password reset token flows.
- Done: add Resend-capable transactional email boundary and verification/reset link handling.
- Done: add local quota checks.
- Done: add local server-backed gallery storage.
- Done: add local route/generation/auth rate limits.
- Done: add Redis-capable distributed rate-limit driver and production guard.
- Done: add generation idempotency.
- Done: add local subscription records, plan-aware model gates, and billing status UI.
- Done: add frontend and server-side cancellation for image generation.
- Done: add health/readiness endpoints for deployment probes.
- Done: hash stored session tokens and add production startup guards.
- Done: add local/S3-compatible asset-storage driver boundary.
- Done: add gated real object-storage smoke harness.
- Remaining: pick production deployment stack.
- Remaining: configure and validate real Resend delivery/domain DNS or move auth to a managed identity provider.
- Done: add Stripe checkout, customer portal, and webhook server-route boundary with mocked tests.
- Remaining: configure and validate real Stripe sandbox/live billing.
- Remaining: provision and verify production object storage with real bucket credentials.
- Remaining: replace `.data/db.json` with a production database.

### Phase 3: Add OpenAI `gpt-image-2`

- Done: add OpenAI server adapter using the Images API.
- Done: map current UI aspect ratios to OpenAI-supported `gpt-image-2` sizes.
- Remaining: add quality/output-format controls if product wants them.
- Remaining: persist OpenAI usage/cost metadata where returned.
- Remaining: add provider-specific moderation/error handling.

### Phase 4: Production Controls

- Done: add guarded Stripe checkout, customer portal, and webhook route boundary.
- Remaining: validate real Stripe sandbox/live checkout, portal, webhook signatures, and subscription lifecycle events.
- Done: add local plan-aware quota and model gates before provider calls.
- Done: add Redis-capable distributed route/auth/generation rate-limit driver.
- Remaining: provision Redis and run the gated real Redis smoke test.
- Done: add Resend-capable transactional email delivery boundary, delivery audit records, readiness check, and production guards.
- Remaining: verify real Resend sender domain, API key, and inbox delivery.
- Done: add token-guarded admin APIs for failed jobs and usage summaries.
- Done: add admin dashboard UI over token-guarded admin APIs.
- Remaining: add production observability integration.
- Done: add liveness/readiness endpoints for deployment checks.
- Done: add content policy flow and abuse reporting.
- Done: add integration tests with mocked provider responses.
- Done: add gated real-provider smoke test harness.
- Remaining: run real-provider smoke tests with explicit cost approval.
- Done: add gated real object-storage smoke test harness.
- Done: add browser tests for generate -> edit text -> save -> gallery -> download.

## Suggested Acceptance Criteria

- A user can sign in, generate an image with OpenAI `gpt-image-2`, save it, reload on another device/browser, and see it in their account gallery.
- No provider API key or bearer token is present in client JavaScript, localStorage, sessionStorage, IndexedDB, browser devtools requests to third-party providers, or rendered HTML.
- Each generation creates a durable server record with provider/model/status/usage/cost metadata.
- A failed provider response shows a sanitized user-safe message and keeps the raw error server-side only.
- Users cannot generate after exceeding their plan quota.
- `npm run lint`, `npm run build`, audit, unit tests, and browser smoke tests pass.

## Latest Verification

- `node --check server.js`: passed.
- `node --check app.js`: passed.
- `node --check js/api.js`: passed.
- `node --check js/db.js`: passed.
- `node --check js/editor.js`: passed.
- `node --check js/gallery.js`: passed.
- `node --check tests/server.test.mjs`: passed.
- `node --check playwright.config.mjs`: passed.
- `node --check scripts/e2e-server.mjs`: passed.
- `node --check scripts/real-provider-smoke.mjs`: passed.
- `node --check scripts/object-storage-smoke.mjs`: passed.
- `node --check scripts/redis-rate-limit-smoke.mjs`: passed.
- `node --check tests/e2e/app.spec.mjs`: passed.
- `node --check vite.config.js`: passed.
- `node --check eslint.config.js`: passed.
- `npm run lint`: passed.
- `npm test`: passed, 12 tests.
- `npm run test:e2e`: passed, 3 Chromium tests.
- `npm run test:providers`: passed default skip path; no provider credits spent.
- `npm run test:storage`: passed default skip path; no object-storage writes performed.
- `npm run test:rate-limit`: passed default skip path; no Redis writes performed.
- `npm run build`: passed with Vite 8.
- `npm audit --audit-level=moderate`: passed with zero vulnerabilities.
- Focused Playwright reset-link probe on `http://localhost:5184`: `?reset_password=...` opened Account settings, showed the reset-password panel, removed the token query param from the URL, and produced no browser console errors.
- Playwright billing UI smoke on `http://localhost:5183`: signed-up Starter user showed `Upgrade to Pro`, disabled `Manage Billing`, expected quota/status text, and no browser console errors.
- Temporary test servers exercised `/api/status`, `/api/health`, `/api/readiness`, auth, gallery, generation, and the browser app flow.
- Fresh current-code dev server is running on `http://localhost:5184`; `GET /api/health` returned `status: ok`, and `GET /api/readiness` returned `ready: true`, rate limiting reported `driver: memory`, `distributed: false`, and email delivery reported `driver: log`, `productionReady: false`.
- Admin UI Playwright visual pass on `http://localhost:5182` loaded without console errors; temporary screenshot artifact was removed after inspection.
- Persistent `localhost:5180` was not disturbed in session 15.
- API validation smoke test: empty OpenAI prompt returns sanitized `invalid_prompt`.
- API configuration smoke test: unconfigured Gemini returns sanitized `provider_not_configured`.
- Secret scan: provider env names only appear in `server.js` and `.env.example`; provider endpoint URLs only appear in `server.js`.
- Session 2 auth/gallery smoke test: unauthenticated generation returns `auth_required`.
- Session 2 auth/gallery smoke test: signup creates a user and session cookie.
- Session 2 auth/gallery smoke test: authenticated `GET /api/gallery` returns an empty list for a new user.
- Session 2 auth/gallery smoke test: `POST /api/gallery` stores original/final image assets and returns protected asset URLs.
- Session 2 auth/gallery smoke test: authenticated `GET /api/assets/:id` returns 200.
- Session 2 auth/gallery smoke test: unauthenticated `GET /api/assets/:id` returns `auth_required`.
- Session 2 auth/gallery smoke test: `DELETE /api/gallery/:id` removes the gallery item.
- Session 2 auth/gallery smoke test: logout clears the active session.
- Session 3 automated tests: mocked provider generation creates completed jobs, protected assets, usage events, and quota counts.
- Session 3 automated tests: repeated generation with the same idempotency key returns the same job without creating another usage event.
- Session 3 automated tests: generation rate limiting returns `rate_limited` before provider work.
- Session 4 Playwright browser test: signup -> mocked OpenAI generation -> text edit -> save to gallery -> gallery card render -> PNG download passed.
- Session 5 automated tests: signup creates an active local subscription, `/api/billing/status` returns entitlements, jobs/usage events store plan metadata, and disallowed models return `plan_model_not_allowed` before job/provider work.
- Session 5 Playwright browser test: account creation renders Starter plan and Active local billing status.
- Session 6 automated tests: client-aborted generation marks the job failed with `generation_aborted` and creates no usage event.
- Session 6 Playwright browser test: canceling an in-flight generation shows `Generation canceled.`, re-enables generation, and leaves the canvas hidden.
- Session 7 automated tests: admin routes require token auth, expose sanitized summary/job data, emit structured JSON request logs, and do not log the admin token.
- Session 8 smoke harness: default `npm run test:providers` path skips unless real-provider spend is explicitly enabled.
- Session 9 automated tests: readiness returns 200 when datastore/assets are healthy and required providers are satisfied; readiness returns 503 when required providers are missing.
- Session 10 quality gate: ESLint runs cleanly across app, server, config, script, and test files.
- Session 11 automated tests: unsafe production config exits; explicitly allowed production staging starts, sets `Secure` session cookies, and stores only hashed session tokens.
- Session 12 automated tests: local asset records store `storageDriver`/`storageKey`; missing S3 production config exits before startup.
- Session 13 smoke harness: default `npm run test:storage` path skips unless object-storage bucket writes are explicitly enabled.
- Session 14 automated tests: content policy blocks unsafe prompts before jobs/provider work; abuse reports are stored and visible to admin moderation APIs.
- Session 15 Playwright test: admin token loads the Admin Operations dashboard and is not persisted in browser storage.
- Session 16 automated tests: unconfigured Stripe checkout/portal fail closed with `stripe_not_configured`; mocked Stripe checkout/webhook upgrades to Pro, unlocks a Pro-only Hugging Face model, customer portal returns a hosted URL, and subscription deletion downgrades the account back to Starter.
- Session 16 production guard test: `BILLING_PROVIDER=stripe` refuses startup without Stripe secret, webhook secret, Pro Price ID, and explicit public `APP_BASE_URL`.
- Session 17 automated tests: readiness reports the rate-limit driver; production refuses `RATE_LIMIT_DRIVER=redis` without `REDIS_URL`; production refuses `RATE_LIMIT_DRIVER=memory` unless `ALLOW_IN_MEMORY_RATE_LIMITS=1`.
- Session 18 automated tests: email verification can block generation until a hashed single-use verification token is consumed; password reset requests are generic, reset tokens are hashed and single-use, password reset revokes existing sessions, and old passwords stop working.
- Session 18 Playwright test: account creation renders visible email status.
- Session 19 automated tests: delivery events are created for verification, reset, and password-changed emails without storing plaintext tokens or auth-link query strings.
- Session 19 production guard test: `EMAIL_DELIVERY_DRIVER=resend` refuses startup without `RESEND_API_KEY`, `EMAIL_FROM`, and `APP_BASE_URL` when email verification is required.
- Session 19 Playwright probe: reset-link URL handling removes the token from the URL and reveals the reset-password form.
- Session 20 documentation pass: `checklist.md` was created and reviewed against `.env.example`, `server.js` production guards, and the blocking SaaS issues in this handoff.
- Real object-storage provider smoke testing was not run because no bucket credentials were provided.
- Real provider generation was still not run in this session.
- Real Stripe sandbox/live checkout was not run because no Stripe keys/webhook secret/price ID were provided.
- Real Redis rate-limit smoke testing was not run because no `REDIS_URL` was provided.
- Real Resend email delivery was not run because no Resend API key or verified sender domain was provided.
- Project-level Playwright was used for rendered browser verification.

## Go / No-Go

No-go for public SaaS until production auth/email validation or managed identity, real Stripe sandbox/live validation, external database/object storage, real Redis validation, deployment hardening, and approved real-provider smoke runs exist. The provider-secret blocker is resolved for this local architecture, auth/gallery/quota/local entitlements now exist for local testing, production mode now blocks several unsafe deploy configs, an S3-compatible asset-storage path exists, a local trust/safety flow exists, a Stripe billing route boundary exists, a Redis-capable rate-limit boundary exists, and a Resend-capable transactional email boundary exists, but the app still must not be publicly deployed as a paid SaaS in its current state.
