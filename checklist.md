# Live Beta External Setup Checklist

Last updated: 2026-06-13

This checklist covers the work outside the coding environment needed to get Nano Banana Art Lab ready for first live beta testers. It assumes the current codebase state described in `SAAS_READINESS_REVIEW.md` session 19.

Important boundary: the app is now a backend SaaS, not a static GitHub Pages site. First live beta readiness requires a Node-capable deployment, production secrets, real provider smoke tests, real email delivery, real object storage, Redis, Stripe validation, and a production database adapter wired by the coder team. Do not invite live beta testers while the app still depends on `.data/db.json` for durable user data.

## 0. Launch Decisions To Lock First

- [ ] Choose the beta URL, for example `https://beta.yourdomain.com`.
- [ ] Choose the sending email subdomain, for example `updates.yourdomain.com` or `mail.yourdomain.com`.
- [ ] Decide whether beta is free, paid, or invite-only.
- [ ] Decide the required launch providers:
  - [ ] `openai`
  - [ ] `gemini`
  - [ ] `huggingface`
- [ ] Decide the starting beta quota:
  - [ ] `STARTER_MONTHLY_GENERATION_LIMIT`
  - [ ] `PRO_MONTHLY_GENERATION_LIMIT`
  - [ ] `API_RATE_LIMIT_PER_MINUTE`
  - [ ] `AUTH_RATE_LIMIT_PER_15_MINUTES`
  - [ ] `GENERATION_RATE_LIMIT_PER_HOUR`
- [ ] Choose production services:
  - [ ] Deployment host for a Node server.
  - [ ] Managed Postgres database.
  - [ ] S3-compatible object storage.
  - [ ] Managed Redis.
  - [ ] Resend for transactional email.
  - [ ] Stripe for subscriptions.

## 1. Domain, DNS, And Deployment Host

- [ ] Confirm you own the root domain and can edit DNS records.
- [ ] Create the beta app hostname in your deployment provider.
- [ ] Point DNS for the app hostname to the deployment provider.
- [ ] Confirm HTTPS/TLS is active on the beta hostname.
- [ ] Configure the deployment as a Node web service:
  - Build command: `npm run build`
  - Start command: `npm start`
  - Runtime should support the current Node version used by the project.
- [ ] Use a host that can run the current standalone `server.js` process, or hand adapter work to the coder team before choosing a serverless-only platform.
- [ ] Add all production environment variables in the deploy provider dashboard, not in the repo.
- [ ] Confirm env changes trigger a new deployment.
- [ ] Configure health checks:
  - [ ] Liveness: `/api/health`
  - [ ] Readiness: `/api/readiness`
- [ ] Confirm the deployment platform keeps server logs and allows log export or alerting.

Docs:

- Vercel environment variables: https://vercel.com/docs/environment-variables
- Render environment variables: https://render.com/docs/configure-environment-variables

## 2. Core Production Secrets

- [ ] Generate a long random `SESSION_SECRET` with at least 32 characters.
- [ ] Generate a strong `ADMIN_API_TOKEN`.
- [ ] Store both in a password manager.
- [ ] Set `APP_BASE_URL` to the public beta URL.
- [ ] Set `STRIPE_BILLING_PORTAL_RETURN_URL` to the public beta URL unless you want a separate billing return page.
- [ ] Set `LOG_LEVEL=info`.
- [ ] Set `CONTENT_POLICY_MODE=local`.
- [ ] Set `MOCK_PROVIDER_RESPONSES=0`.
- [ ] Set `MOCK_STRIPE_RESPONSES=0`.
- [ ] Set `AUTH_TOKEN_DEBUG=0`.

Required values:

```env
APP_BASE_URL=https://beta.yourdomain.com
STRIPE_BILLING_PORTAL_RETURN_URL=https://beta.yourdomain.com
SESSION_SECRET=<long random secret>
ADMIN_API_TOKEN=<long random admin token>
LOG_LEVEL=info
CONTENT_POLICY_MODE=local
MOCK_PROVIDER_RESPONSES=0
MOCK_STRIPE_RESPONSES=0
AUTH_TOKEN_DEBUG=0
```

## 3. OpenAI Setup

- [ ] Create or select a dedicated OpenAI API project for the beta.
- [ ] Create a project API key for the server.
- [ ] Prefer restricted/project-scoped permissions where available.
- [ ] Enable billing for the project.
- [ ] Set project budget and usage alerts.
- [ ] Confirm the project can use the image model used by the app.
- [ ] Save the secret as `OPENAI_API_KEY`.
- [ ] If OpenAI is a required launch provider, include `openai` in `REQUIRED_PROVIDERS`.

Docs:

- OpenAI project API keys, budgets, and limits: https://help.openai.com/en/articles/9186755-managing-your-work-in-the-api-platform-with-projects

## 4. Google Gemini Setup

- [ ] Create or select a Google Cloud project for beta.
- [ ] Use Google AI Studio to create a Gemini API key for that project.
- [ ] Prefer the current auth-key flow rather than an unrestricted legacy standard key.
- [ ] Restrict the key to Gemini API where available.
- [ ] Enable billing and budget alerts on the Google Cloud project.
- [ ] Confirm the app's configured Gemini image models are available to the project.
- [ ] Save the key as `GEMINI_API_KEY`.
- [ ] If Gemini is a required launch provider, include `gemini` in `REQUIRED_PROVIDERS`.

Docs:

- Gemini API keys: https://ai.google.dev/gemini-api/docs/api-key

## 5. Hugging Face Setup

- [ ] Confirm the Hugging Face account or organization has Inference Providers access and billing set up.
- [ ] Create a token for server-side inference use.
- [ ] Prefer a fine-grained token limited to only the needed inference resources when possible.
- [ ] Save the token as `HF_TOKEN`.
- [ ] Decide whether to use automatic provider selection or a specific provider.
- [ ] Set `HF_INFERENCE_PROVIDER=auto` unless the team selects a specific provider.
- [ ] If Hugging Face is a required launch provider, include `huggingface` in `REQUIRED_PROVIDERS`.

Docs:

- Hugging Face access tokens: https://huggingface.co/docs/hub/en/security-tokens

## 6. Resend Transactional Email Setup

- [ ] Add a sending domain or subdomain in Resend.
- [ ] Add the DNS records Resend gives you.
- [ ] Wait for Resend domain verification.
- [ ] Use a sending subdomain rather than the root domain when possible.
- [ ] Create a Resend API key for this app.
- [ ] Choose the sender:
  - Example: `Nano Banana Art Lab <noreply@updates.yourdomain.com>`
- [ ] Choose the reply-to/support mailbox:
  - Example: `support@yourdomain.com`
- [ ] Send a real verification email to yourself.
- [ ] Send a real password reset email to yourself.
- [ ] Check Gmail, Outlook, and at least one non-major mailbox if possible.
- [ ] Confirm emails do not land in spam.
- [ ] Set these env vars:

```env
EMAIL_VERIFICATION_REQUIRED=1
ALLOW_UNVERIFIED_EMAILS=0
EMAIL_DELIVERY_DRIVER=resend
EMAIL_PRODUCT_NAME=Nano Banana Art Lab
EMAIL_FROM=Nano Banana Art Lab <noreply@updates.yourdomain.com>
EMAIL_REPLY_TO=support@yourdomain.com
RESEND_API_KEY=<resend api key>
ALLOW_LOCAL_EMAIL_DELIVERY=0
```

Docs:

- Resend domain setup: https://resend.com/docs/dashboard/domains/introduction
- Resend send email API: https://resend.com/docs/api-reference/emails/send-email

## 7. Stripe Billing Setup

- [ ] Decide whether live beta testers will pay real money.
- [ ] If beta is free, use Stripe test mode for validation but keep paid features disabled or couponed.
- [ ] In Stripe test mode, create the Pro subscription product.
- [ ] Create a recurring monthly Pro price.
- [ ] Copy the test price ID as `STRIPE_PRO_PRICE_ID`.
- [ ] Configure Customer Portal settings in Stripe.
- [ ] Deploy the app to the beta URL before registering the webhook.
- [ ] Register a Stripe webhook endpoint:
  - URL: `https://beta.yourdomain.com/api/billing/webhook`
- [ ] Subscribe the webhook to the events the app currently handles:
  - [ ] `checkout.session.completed`
  - [ ] `customer.subscription.created`
  - [ ] `customer.subscription.updated`
  - [ ] `customer.subscription.deleted`
- [ ] Copy the webhook signing secret as `STRIPE_WEBHOOK_SECRET`.
- [ ] Copy the Stripe secret key as `STRIPE_SECRET_KEY`.
- [ ] Set:

```env
BILLING_PROVIDER=stripe
STRIPE_REQUIRED=1
STRIPE_SECRET_KEY=<stripe secret key>
STRIPE_WEBHOOK_SECRET=<stripe webhook signing secret>
STRIPE_PRO_PRICE_ID=<stripe recurring price id>
APP_BASE_URL=https://beta.yourdomain.com
STRIPE_BILLING_PORTAL_RETURN_URL=https://beta.yourdomain.com
MOCK_STRIPE_RESPONSES=0
```

- [ ] Run a full test-mode checkout.
- [ ] Confirm the app upgrades the user to Pro after checkout.
- [ ] Open the Customer Portal from the app.
- [ ] Cancel or downgrade in the Customer Portal.
- [ ] Confirm the app downgrades the user back to Starter after the webhook.
- [ ] Only after test mode is clean, repeat the setup in live mode if beta testers will pay.

Docs:

- Stripe subscription quickstart: https://docs.stripe.com/billing/quickstart
- Stripe subscription webhooks: https://docs.stripe.com/billing/subscriptions/webhooks

## 8. Managed Redis Setup

- [ ] Create a managed Redis database in the same region as the app when possible.
- [ ] Require authentication.
- [ ] Prefer a TLS URL if the provider supports it.
- [ ] Copy the connection URL as `REDIS_URL`.
- [ ] Set:

```env
RATE_LIMIT_DRIVER=redis
RATE_LIMIT_KEY_PREFIX=nano-banana-beta
REDIS_URL=<redis or rediss connection url>
ALLOW_IN_MEMORY_RATE_LIMITS=0
```

- [ ] Run the Redis smoke test after deployment credentials are available:

```powershell
$env:RUN_REDIS_RATE_LIMIT_SMOKE='1'
$env:REDIS_URL='<redis url>'
npm run test:rate-limit
```

- [ ] Confirm `/api/readiness` reports:
  - `checks.rateLimiting.ok: true`
  - `checks.rateLimiting.details.driver: "redis"`
  - `checks.rateLimiting.details.distributed: true`

Docs:

- Redis connection strings for the Node client: https://redis.io/docs/latest/develop/clients/nodejs/connect/
- Redis Cloud connection details: https://redis.io/docs/latest/operate/rc/databases/connect/

## 9. Object Storage Setup

- [ ] Choose an S3-compatible object storage provider:
  - [ ] AWS S3
  - [ ] Cloudflare R2
  - [ ] another S3-compatible service
- [ ] Create a private bucket.
- [ ] Keep public bucket access disabled.
- [ ] Create bucket-scoped credentials for the app.
- [ ] Credentials should allow only the actions needed for generated image assets:
  - [ ] Put object
  - [ ] Get object
  - [ ] Delete object
  - [ ] List only if required by the provider/policy
- [ ] Decide the prefix, for example `assets`.
- [ ] Set a lifecycle/retention policy if beta data should expire.
- [ ] Set provider-specific env vars.

AWS S3 example:

```env
ASSET_STORAGE_DRIVER=s3
ASSET_STORAGE_PREFIX=assets
ASSET_STORAGE_BUCKET=<bucket name>
ASSET_STORAGE_REGION=us-east-1
ASSET_STORAGE_ENDPOINT=
ASSET_STORAGE_FORCE_PATH_STYLE=0
ASSET_STORAGE_ACCESS_KEY_ID=<access key>
ASSET_STORAGE_SECRET_ACCESS_KEY=<secret key>
```

Cloudflare R2 example:

```env
ASSET_STORAGE_DRIVER=s3
ASSET_STORAGE_PREFIX=assets
ASSET_STORAGE_BUCKET=<bucket name>
ASSET_STORAGE_REGION=auto
ASSET_STORAGE_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
ASSET_STORAGE_FORCE_PATH_STYLE=1
ASSET_STORAGE_ACCESS_KEY_ID=<r2 access key id>
ASSET_STORAGE_SECRET_ACCESS_KEY=<r2 secret access key>
```

- [ ] Run the object-storage smoke test:

```powershell
$env:RUN_OBJECT_STORAGE_SMOKE='1'
$env:ASSET_STORAGE_DRIVER='s3'
npm run test:storage
```

- [ ] Confirm `/api/readiness` reports:
  - `checks.assetStorage.ok: true`
  - `checks.assetStorage.details.driver: "s3"`

Docs:

- AWS S3 getting started: https://docs.aws.amazon.com/AmazonS3/latest/userguide/GetStartedWithS3.html
- AWS S3 bucket creation and public-access defaults: https://docs.aws.amazon.com/AmazonS3/latest/userguide/create-bucket-overview.html
- Cloudflare R2 S3-compatible API: https://developers.cloudflare.com/r2/get-started/s3/
- Cloudflare R2 API tokens: https://developers.cloudflare.com/r2/api/tokens/

## 10. Managed Postgres Setup

- [ ] Choose a managed Postgres provider.
- [ ] Create a beta project/database in the same region as the app when possible.
- [ ] Create at least two database roles:
  - [ ] migration/admin role
  - [ ] app runtime role with least required permissions
- [ ] Enable SSL.
- [ ] Enable automated backups.
- [ ] Enable point-in-time recovery if available.
- [ ] Copy the pooled app connection string for runtime.
- [ ] Copy the direct/admin connection string for migrations.
- [ ] Store the intended env names for the coder team:

```env
DATABASE_URL=<pooled app runtime connection string>
DATABASE_MIGRATION_URL=<direct/admin migration connection string>
```

- [ ] Hand these requirements to the coder team:
  - [ ] Replace `.data/db.json` with Postgres before live beta.
  - [ ] Add migrations for `users`, `sessions`, `auth_tokens`, `subscriptions`, `generation_jobs`, `image_assets`, `provider_usage_events`, `user_gallery_items`, `content_policy_events`, `abuse_reports`, and `email_delivery_events`.
  - [ ] Add indexes for user-owned reads, session lookup, auth-token lookup, job status, asset ownership, monthly usage, billing customer/subscription IDs, and admin moderation views.
  - [ ] Update `/api/readiness` so the datastore check proves Postgres connectivity and required tables/migrations.

Do not mark the site beta-ready with real testers until this database adapter exists and passes readiness. Local `.data/db.json` is acceptable for local testing only.

Docs:

- Neon Postgres connection strings: https://neon.com/docs/connect/connect-from-any-app
- Supabase Postgres connection strings: https://supabase.com/docs/guides/database/connecting-to-postgres

## 11. Required Production Env Snapshot

Fill this in as you configure services. Do not commit real values.

```env
# Runtime
NODE_ENV=production
PORT=<platform provided or 5180>
APP_BASE_URL=https://beta.yourdomain.com
STRIPE_BILLING_PORTAL_RETURN_URL=https://beta.yourdomain.com
SESSION_SECRET=<set>
ADMIN_API_TOKEN=<set>
LOG_LEVEL=info

# Providers
OPENAI_API_KEY=<set if openai enabled>
GEMINI_API_KEY=<set if gemini enabled>
HF_TOKEN=<set if huggingface enabled>
HF_INFERENCE_PROVIDER=auto
REQUIRED_PROVIDERS=openai,gemini,huggingface

# Plans and quotas
STARTER_MONTHLY_GENERATION_LIMIT=25
PRO_MONTHLY_GENERATION_LIMIT=500
API_RATE_LIMIT_PER_MINUTE=180
AUTH_RATE_LIMIT_PER_15_MINUTES=25
GENERATION_RATE_LIMIT_PER_HOUR=30

# Auth and email
EMAIL_VERIFICATION_REQUIRED=1
ALLOW_UNVERIFIED_EMAILS=0
AUTH_TOKEN_DEBUG=0
EMAIL_DELIVERY_DRIVER=resend
EMAIL_PRODUCT_NAME=Nano Banana Art Lab
EMAIL_FROM=Nano Banana Art Lab <noreply@updates.yourdomain.com>
EMAIL_REPLY_TO=support@yourdomain.com
RESEND_API_KEY=<set>
ALLOW_LOCAL_EMAIL_DELIVERY=0

# Billing
BILLING_PROVIDER=stripe
STRIPE_REQUIRED=1
STRIPE_SECRET_KEY=<set>
STRIPE_WEBHOOK_SECRET=<set>
STRIPE_PRO_PRICE_ID=<set>
MOCK_STRIPE_RESPONSES=0

# Object storage
ASSET_STORAGE_DRIVER=s3
ASSET_STORAGE_PREFIX=assets
ASSET_STORAGE_BUCKET=<set>
ASSET_STORAGE_REGION=<set>
ASSET_STORAGE_ENDPOINT=<set if using R2 or another custom endpoint>
ASSET_STORAGE_FORCE_PATH_STYLE=<0 for AWS S3, usually 1 for R2>
ASSET_STORAGE_ACCESS_KEY_ID=<set>
ASSET_STORAGE_SECRET_ACCESS_KEY=<set>

# Redis rate limiting
RATE_LIMIT_DRIVER=redis
RATE_LIMIT_KEY_PREFIX=nano-banana-beta
REDIS_URL=<set>
ALLOW_IN_MEMORY_RATE_LIMITS=0

# Safety and production guards
CONTENT_POLICY_MODE=local
ALLOW_LOCAL_PRODUCTION_STORAGE=0
MOCK_PROVIDER_RESPONSES=0
MOCK_PROVIDER_DELAY_MS=0
```

## 12. Values That Should Be No-Go For Live Beta

- [ ] `MOCK_PROVIDER_RESPONSES=1`
- [ ] `MOCK_STRIPE_RESPONSES=1`
- [ ] `AUTH_TOKEN_DEBUG=1`
- [ ] `CONTENT_POLICY_MODE=off`
- [ ] `EMAIL_VERIFICATION_REQUIRED=0`
- [ ] `ALLOW_UNVERIFIED_EMAILS=1`
- [ ] `EMAIL_DELIVERY_DRIVER=log`
- [ ] `ALLOW_LOCAL_EMAIL_DELIVERY=1`
- [ ] `RATE_LIMIT_DRIVER=memory`
- [ ] `ALLOW_IN_MEMORY_RATE_LIMITS=1`
- [ ] `ASSET_STORAGE_DRIVER=local`
- [ ] `ALLOW_LOCAL_PRODUCTION_STORAGE=1`
- [ ] empty `REQUIRED_PROVIDERS`
- [ ] missing `SESSION_SECRET`
- [ ] missing `ADMIN_API_TOKEN`
- [ ] missing `APP_BASE_URL`

## 13. Observability And Alerts

- [ ] Configure deployment logs retention.
- [ ] Add an uptime monitor for `/api/health`.
- [ ] Add an alert for `/api/readiness` returning non-200.
- [ ] Add alerting for HTTP 5xx spikes.
- [ ] Add alerting for Stripe webhook failures.
- [ ] Add alerting for `emailDeliveryEvents.status=failed`.
- [ ] Add alerting for provider generation failures by provider/model.
- [ ] Add alerting for unusually high generation volume or spend.
- [ ] Add alerting for Redis connection failures.
- [ ] Add alerting for object-storage read/write failures.
- [ ] Restrict access to the Admin Operations token.
- [ ] Store the incident contact list and escalation path.

## 14. Safety, Legal, And Beta Operations

- [ ] Publish beta Terms of Use.
- [ ] Publish Privacy Policy.
- [ ] Decide data retention rules for generated images and account data.
- [ ] Decide whether minors are allowed to use the beta.
- [ ] Add a support inbox, for example `support@yourdomain.com`.
- [ ] Add a feedback path for beta testers.
- [ ] Decide a moderation review cadence for abuse reports.
- [ ] Decide what content is disallowed beyond the current local policy gate.
- [ ] Decide whether signups are open or invite-only.
- [ ] If invite-only is required, hand that requirement to the coder team because current local auth supports open signup.
- [ ] Prepare beta onboarding instructions.
- [ ] Prepare a known-issues list for testers.
- [ ] Prepare a rollback plan if costs spike or unsafe behavior appears.

## 15. Final External Validation Run

Run this only after the external services are configured and the coder team has wired the production database adapter.

- [ ] Deploy to the beta URL.
- [ ] Confirm `npm start` is the production start path.
- [ ] Confirm no no-go env values are present.
- [ ] Visit `https://beta.yourdomain.com/api/health`; it must return 200.
- [ ] Visit `https://beta.yourdomain.com/api/readiness`; it must return 200.
- [ ] Confirm readiness details:
  - [ ] datastore uses production Postgres and required migrations are current.
  - [ ] `assetStorage.details.driver` is `s3`.
  - [ ] `rateLimiting.details.driver` is `redis`.
  - [ ] `rateLimiting.details.distributed` is `true`.
  - [ ] `emailDelivery.details.driver` is `resend`.
  - [ ] `emailDelivery.details.productionReady` is `true`.
  - [ ] billing reports Stripe configured.
  - [ ] required providers are configured.
- [ ] Run real provider smoke tests with explicit cost approval:

```powershell
$env:RUN_REAL_PROVIDER_SMOKE='1'
$env:REAL_PROVIDER_SMOKE_PROVIDERS='openai,gemini,huggingface'
npm run test:providers
```

- [ ] Run object-storage smoke:

```powershell
$env:RUN_OBJECT_STORAGE_SMOKE='1'
$env:ASSET_STORAGE_DRIVER='s3'
npm run test:storage
```

- [ ] Run Redis smoke:

```powershell
$env:RUN_REDIS_RATE_LIMIT_SMOKE='1'
$env:REDIS_URL='<redis url>'
npm run test:rate-limit
```

- [ ] Run a real Resend verification email flow.
- [ ] Run a real Resend password reset flow.
- [ ] Run a Stripe test-mode checkout.
- [ ] Run a Stripe test-mode customer portal cancellation.
- [ ] Create a fresh beta user in a private browser window.
- [ ] Verify email.
- [ ] Generate one OpenAI image.
- [ ] Generate one Gemini image if Gemini is enabled.
- [ ] Generate one Hugging Face image if Hugging Face is enabled.
- [ ] Save to gallery.
- [ ] Log out.
- [ ] Log in from a second browser/device.
- [ ] Confirm the gallery item is still available.
- [ ] Confirm the protected image URL is not available when signed out.
- [ ] Confirm quota increases after generation.
- [ ] Confirm admin summary loads with the admin token.
- [ ] Confirm support/feedback path works.

## 16. Beta Launch Gate

Only invite first live beta testers after all of these are true:

- [ ] Real domain and HTTPS are active.
- [ ] Production database adapter is implemented and backed by managed Postgres.
- [ ] Object storage is S3-compatible and verified by smoke test.
- [ ] Redis rate limiting is verified by smoke test.
- [ ] Resend domain is verified and real auth emails deliver.
- [ ] Stripe sandbox flow is verified; live mode is configured if beta testers pay.
- [ ] Required image providers pass real smoke tests.
- [ ] `/api/readiness` returns 200 in the deployed beta environment.
- [ ] No no-go env values are present.
- [ ] Terms, privacy, support, feedback, and moderation process are ready.
- [ ] The coder team has updated `SAAS_READINESS_REVIEW.md` with the final validation evidence.
