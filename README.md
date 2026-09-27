# Nano Banana Art Studio

An AI art studio for making polished, professional-looking images: describe a scene, pick one of 31 curated art styles, add your own words with a layered text editor, adjust the look, and download a full-resolution PNG.

Everyone gets free monthly credits. When they run out, the app offers one-time credit packs or a monthly subscription through Stripe.

## What's in the app

- **Create**: describe the image (optionally "Improve my description" with Gemini), choose a style, a shape (square, portrait, poster, landscape, wide, story), and an engine. Each engine shows its credit cost. "Adding words later?" asks the engine to leave calm space at the top or bottom.
- **Text**: one-click designs (poster title, greeting card, quote card, caption bar), text styles, and unlimited text layers. Drag text anywhere, resize and rotate with handles, snap to center, and pick from 22 typefaces, colors from the style's palette, shadow, outline, and background boxes. Undo/redo throughout.
- **Adjust**: looks (Warm, Cool, Vivid, Faded, Noir, Dramatic) plus brightness, contrast, color, warmth, softness, and vignette. Adjustments affect the picture only; text stays crisp.
- **My Art**: saved pieces with their editable text layers. Reopen, change, and "Save changes".
- **Account**: credit balance (monthly allowance plus purchased credits), plan, billing portal, sign-out.
- **Admin** (`/#admin`, needs `ADMIN_API_TOKEN`): usage, credits spent and bought, recent jobs, reports, blocked prompts, and a form to give a tester credits.

## Quick start (no API keys needed)

```bash
npm install
cp .env.example .env
# In .env set MOCK_PROVIDER_RESPONSES=1 and MOCK_STRIPE_RESPONSES=1
npm run dev
```

Open http://localhost:5180. Mock mode paints a placeholder landscape instead of calling a provider, and the paywall's checkout completes locally, so the whole flow works without spending anything.

## Using real image engines

Add the provider keys you have to `.env` (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `HF_TOKEN`) and turn mock mode off. Only engines whose provider is configured are shown to users.

The engine list, labels, and prices live in `server.js` (`DEFAULT_IMAGE_MODELS`). Provider model names change often, so they can be overridden without code changes:

- `MODEL_CREDIT_COSTS='{"gemini-3-pro-image":4}'` changes prices.
- `IMAGE_MODELS='[...]'` replaces the whole catalog (`id`, `provider`, `label`, `description`, `credits`, `recommended`).

Before inviting anyone, check every engine for real (this spends a little on each provider and saves a sample image from each):

```bash
RUN_REAL_PROVIDER_SMOKE=1 REAL_PROVIDER_SMOKE_PROVIDERS=openai,gemini \
REAL_PROVIDER_SMOKE_OUTPUT_DIR=./smoke-samples npm run test:providers
```

## Style preview thumbnails

Until previews are generated, each style card shows a small palette illustration. To paint the same sample scene in every style (about 31 images on the cheapest engine):

```bash
RUN_STYLE_PREVIEWS=1 npm run styles:previews
```

Thumbnails are saved to `public/style-previews/` (roughly 30 KB each) and picked up automatically; commit them. `STYLE_PREVIEW_ONLY=watercolor,pop-art` regenerates specific styles, and `STYLE_PREVIEW_DRY_RUN=1` checks the pipeline for free.

Styles are defined in `js/styles.js`. Each has a prompt (describing a medium or tradition, never a living artist or brand), a palette, and suggested fonts.

## Credits and billing

| Setting | Default | Meaning |
| --- | --- | --- |
| `FREE_MONTHLY_CREDITS` | 20 | Free allowance per account |
| `FREE_CREDITS_REFRESH` | `monthly` | `monthly` refills on the 1st (UTC); `never` is a one-time grant |
| `SUBSCRIPTION_MONTHLY_CREDITS` | 400 | Allowance for subscribers, reset on each paid invoice |
| `SUBSCRIPTION_PLAN_LABEL` / `SUBSCRIPTION_PRICE_LABEL` | Creator / $12/month | Display text for the plan (must match Stripe) |
| `CREDIT_PACKS` | 100 for $5, 500 for $20 | JSON list of packs with Stripe `priceId`s |

The allowance is spent first, then purchased credits, which never expire. Credits are charged when an image starts and refunded automatically if it fails or is canceled.

Stripe setup:

1. Create a recurring monthly price for the subscription (`STRIPE_SUBSCRIPTION_PRICE_ID`) and a one-time price for each credit pack (`CREDIT_PACKS`).
2. Set `BILLING_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `APP_BASE_URL`.
3. Point a webhook at `https://your-domain/api/billing/webhook` with these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
4. Enable the Customer Portal so subscribers can cancel and see receipts. Promotion codes are accepted at checkout (a 100%-off code still grants a pack's credits).

Webhook handling is idempotent and tolerates Stripe's retries and out-of-order delivery: events for a subscription that already ended are ignored, and a second open subscription checkout reuses the first session instead of starting a second subscription. Refunds and chargebacks are not yet reflected in credit balances automatically.

`MOCK_STRIPE_RESPONSES=1` fakes purchases for local testing. Never enable it on a server other people can reach (production mode refuses to start with it).

## Tests

```bash
npm run lint
npm test            # server: auth, credits, billing webhooks, gallery, safety, production guards
npm run test:e2e    # browser: full design flow, cancel refund, paywall purchase, admin, phone layout
npm run build
```

## Deploying for testers

`npm start` runs the production server (`server.js --production`), which serves the Vite build and refuses unsafe settings. `checklist.md` walks through every external service and setting. The main thing to know is that user data currently lives in a JSON file (`.data/db.json`). That is fine on a single server with a persistent disk for a small private beta (`ALLOW_LOCAL_PRODUCTION_STORAGE=1`), but it needs a real database before a public launch.

## Project layout

```
server.js               HTTP server: auth, credits, Stripe, generation, gallery, admin, static files
index.html, styles.css  App shell and visual design (light and dark)
app.js                  Create flow, generation, save/download/share, navigation
js/editor.js            Canvas compositor: text layers, handles, snapping, filters, undo, export
js/styles.js            Art style library (shared by server and browser)
js/presets.js           Text layer model, text styles, templates, looks
js/fonts.js             Typeface catalog and font loading
js/ui/*.js              Text and adjust panels, paywall, account, admin, helpers
js/gallery.js           My Art page
scripts/                Real-provider, storage, Redis smoke tests and the style preview generator
tests/                  Server tests (node:test) and browser tests (Playwright)
```
