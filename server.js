import { createServer } from 'node:http';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { InferenceClient } from '@huggingface/inference';
import { createClient as createRedisClient } from 'redis';
import { Resend } from 'resend';
import Stripe from 'stripe';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const hasDevFlag = process.argv.includes('--dev');
const hasProductionFlag = process.argv.includes('--production');
const isProduction = hasProductionFlag || (!hasDevFlag && process.env.NODE_ENV === 'production');
const isDev = hasDevFlag || !isProduction;

loadEnvFile('.env.local');
loadEnvFile('.env');

const port = Number(process.env.PORT || 5180);
const dataRoot = path.resolve(__dirname, process.env.DATA_DIR || '.data');
const assetRoot = path.join(dataRoot, 'assets');
const dbPath = path.join(dataRoot, 'db.json');
const assetStorageDriver = normalizeAssetStorageDriver(process.env.ASSET_STORAGE_DRIVER || 'local');
const assetStoragePrefix = normalizeStoragePrefix(process.env.ASSET_STORAGE_PREFIX || 'assets');
const assetStorageBucket = process.env.ASSET_STORAGE_BUCKET || '';
const assetStorageRegion = process.env.ASSET_STORAGE_REGION || 'auto';
const assetStorageEndpoint = process.env.ASSET_STORAGE_ENDPOINT || '';
const assetStorageForcePathStyle = process.env.ASSET_STORAGE_FORCE_PATH_STYLE === '1';
const assetStorageAccessKeyId = process.env.ASSET_STORAGE_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '';
const assetStorageSecretAccessKey = process.env.ASSET_STORAGE_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '';
const sessionCookieName = 'nbs_session';
const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;
const emailVerificationTokenMaxAgeMs = 1000 * 60 * 60 * 24;
const passwordResetTokenMaxAgeMs = 1000 * 60 * 20;
const starterMonthlyGenerationLimit = Number(process.env.STARTER_MONTHLY_GENERATION_LIMIT || 25);
const passwordIterations = 210000;
const mockProviderResponses = process.env.MOCK_PROVIDER_RESPONSES === '1';
const genericApiRateLimit = Number(process.env.API_RATE_LIMIT_PER_MINUTE || 180);
const authRateLimit = Number(process.env.AUTH_RATE_LIMIT_PER_15_MINUTES || 25);
const generationRateLimit = Number(process.env.GENERATION_RATE_LIMIT_PER_HOUR || 30);
const rateLimitDriver = normalizeRateLimitDriver(process.env.RATE_LIMIT_DRIVER || 'memory');
const redisUrl = process.env.REDIS_URL || '';
const rateLimitKeyPrefix = normalizeRateLimitKeyPrefix(process.env.RATE_LIMIT_KEY_PREFIX || 'nano-banana');
const allowInMemoryRateLimits = process.env.ALLOW_IN_MEMORY_RATE_LIMITS === '1';
const mockProviderDelayMs = Number(process.env.MOCK_PROVIDER_DELAY_MS || 0);
const adminApiToken = process.env.ADMIN_API_TOKEN || '';
const contentPolicyMode = normalizeContentPolicyMode(process.env.CONTENT_POLICY_MODE || 'local');
const sessionSecret = process.env.SESSION_SECRET || (isDev ? 'local-development-session-secret' : '');
const allowLocalProductionStorage = process.env.ALLOW_LOCAL_PRODUCTION_STORAGE === '1';
const emailVerificationRequired = process.env.EMAIL_VERIFICATION_REQUIRED === '1';
const allowUnverifiedEmails = process.env.ALLOW_UNVERIFIED_EMAILS === '1';
const authTokenDebug = process.env.AUTH_TOKEN_DEBUG === '1';
const emailDeliveryDriver = normalizeEmailDeliveryDriver(process.env.EMAIL_DELIVERY_DRIVER || 'log');
const allowLocalEmailDelivery = process.env.ALLOW_LOCAL_EMAIL_DELIVERY === '1';
const resendApiKey = process.env.RESEND_API_KEY || '';
const emailFrom = process.env.EMAIL_FROM || '';
const emailReplyTo = process.env.EMAIL_REPLY_TO || '';
const emailProductName = normalizeEmailProductName(process.env.EMAIL_PRODUCT_NAME || 'Nano Banana Art Lab');
const logLevel = process.env.LOG_LEVEL || 'info';
const STRIPE_API_VERSION = '2026-05-27.dahlia';
const billingProvider = normalizeBillingProvider(process.env.BILLING_PROVIDER || 'local');
const stripeRequired = billingProvider === 'stripe' || process.env.STRIPE_REQUIRED === '1';
const mockStripeResponses = process.env.MOCK_STRIPE_RESPONSES === '1';
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripeProPriceId = process.env.STRIPE_PRO_PRICE_ID || '';
const hasExplicitAppBaseUrl = Boolean(process.env.APP_BASE_URL);
const appBaseUrl = normalizeAbsoluteUrl(process.env.APP_BASE_URL || `http://localhost:${port}`);
const stripeBillingPortalReturnUrl = normalizeAbsoluteUrl(process.env.STRIPE_BILLING_PORTAL_RETURN_URL || appBaseUrl);
let dbCache = null;
let dbWriteQueue = Promise.resolve();
const rateLimitBuckets = new Map();
let s3Client = null;
let stripeClient = null;
let redisClient = null;
let redisClientPromise = null;
let resendClient = null;

const PROVIDERS = {
    openai: {
        label: 'OpenAI GPT Image',
        configured: () => mockProviderResponses || Boolean(process.env.OPENAI_API_KEY),
        models: ['gpt-image-2']
    },
    gemini: {
        label: 'Google Gemini / Nano Banana',
        configured: () => mockProviderResponses || Boolean(process.env.GEMINI_API_KEY),
        models: ['gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image']
    },
    huggingface: {
        label: 'Hugging Face Inference Providers',
        configured: () => mockProviderResponses || Boolean(process.env.HF_TOKEN),
        models: ['black-forest-labs/FLUX.1-Krea-dev', 'Qwen/Qwen-Image', 'ByteDance/Hyper-SD']
    }
};
const requiredProviders = parseRequiredProviders(process.env.REQUIRED_PROVIDERS || '');

const PLAN_CATALOG = {
    starter: {
        label: 'Starter',
        monthlyGenerationLimit: starterMonthlyGenerationLimit,
        allowedProviders: ['openai', 'gemini', 'huggingface'],
        allowedModels: ['gpt-image-2', 'gemini-2.5-flash-image', 'black-forest-labs/FLUX.1-Krea-dev']
    },
    pro: {
        label: 'Pro',
        monthlyGenerationLimit: Number(process.env.PRO_MONTHLY_GENERATION_LIMIT || 500),
        allowedProviders: Object.keys(PROVIDERS),
        allowedModels: Object.values(PROVIDERS).flatMap((provider) => provider.models)
    }
};
const activeBillingStatuses = new Set(['active', 'trialing']);

const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

const publicExtensions = new Set(Object.keys(contentTypes));

class PublicApiError extends Error {
    constructor(message, status = 500, code = 'api_error', details = null) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

function validateRuntimeConfiguration() {
    if (!isProduction) {
        return;
    }

    const issues = [];

    if (sessionSecret.length < 32) {
        issues.push('SESSION_SECRET must be set to at least 32 characters in production.');
    }

    if (mockProviderResponses) {
        issues.push('MOCK_PROVIDER_RESPONSES must be disabled in production.');
    }

    if (mockStripeResponses) {
        issues.push('MOCK_STRIPE_RESPONSES must be disabled in production.');
    }

    if (authTokenDebug) {
        issues.push('AUTH_TOKEN_DEBUG must be disabled in production.');
    }

    if (contentPolicyMode === 'off') {
        issues.push('CONTENT_POLICY_MODE=off is not allowed in production.');
    }

    if (!emailVerificationRequired && !allowUnverifiedEmails) {
        issues.push('EMAIL_VERIFICATION_REQUIRED=1 is required in production, or set ALLOW_UNVERIFIED_EMAILS=1 only for controlled staging.');
    }

    if (emailVerificationRequired && !isEmailDeliveryProductionReady()) {
        issues.push('EMAIL_VERIFICATION_REQUIRED=1 requires production-ready email delivery. Configure EMAIL_DELIVERY_DRIVER=resend with RESEND_API_KEY, EMAIL_FROM, and APP_BASE_URL.');
    }

    if (emailDeliveryDriver === 'resend' && !isResendEmailDeliveryConfigured()) {
        issues.push('EMAIL_DELIVERY_DRIVER=resend requires RESEND_API_KEY, EMAIL_FROM, and APP_BASE_URL.');
    }

    if (emailDeliveryDriver === 'log' && emailVerificationRequired && !allowLocalEmailDelivery) {
        issues.push('EMAIL_DELIVERY_DRIVER=log is development-only; configure Resend for production transactional email or set ALLOW_LOCAL_EMAIL_DELIVERY=1 for controlled staging.');
    }

    if (!requiredProviders.length) {
        issues.push('REQUIRED_PROVIDERS must list the launch providers required for production readiness.');
    }

    const missingProviders = requiredProviders.filter((provider) => !PROVIDERS[provider]?.configured());
    if (missingProviders.length) {
        issues.push(`Missing credentials for required production providers: ${missingProviders.join(', ')}.`);
    }

    if (rateLimitDriver === 'redis' && !redisUrl) {
        issues.push('RATE_LIMIT_DRIVER=redis requires REDIS_URL.');
    }

    if (rateLimitDriver === 'memory' && !allowInMemoryRateLimits) {
        issues.push('RATE_LIMIT_DRIVER=memory is development-only; configure Redis for distributed production rate limiting or set ALLOW_IN_MEMORY_RATE_LIMITS=1 for controlled single-instance staging.');
    }

    if (assetStorageDriver === 's3' && !isS3AssetStorageConfigured()) {
        issues.push('ASSET_STORAGE_DRIVER=s3 requires ASSET_STORAGE_BUCKET, ASSET_STORAGE_REGION, and S3-compatible access credentials.');
    }

    if (assetStorageDriver === 'local' && !allowLocalProductionStorage) {
        issues.push('ASSET_STORAGE_DRIVER=local is development-only; configure S3-compatible object storage for production.');
    }

    if (!allowLocalProductionStorage) {
        issues.push('Local DATA_DIR database storage is development-only; replace it with a production datastore or set ALLOW_LOCAL_PRODUCTION_STORAGE=1 for controlled single-instance staging.');
    }

    if (stripeRequired) {
        if (!stripeSecretKey) {
            issues.push('STRIPE_SECRET_KEY is required when BILLING_PROVIDER=stripe or STRIPE_REQUIRED=1.');
        }
        if (!stripeWebhookSecret) {
            issues.push('STRIPE_WEBHOOK_SECRET is required when BILLING_PROVIDER=stripe or STRIPE_REQUIRED=1.');
        }
        if (!stripeProPriceId) {
            issues.push('STRIPE_PRO_PRICE_ID is required when BILLING_PROVIDER=stripe or STRIPE_REQUIRED=1.');
        }
        if (!hasExplicitAppBaseUrl || !appBaseUrl) {
            issues.push('APP_BASE_URL must be set to an absolute public URL when Stripe billing is required.');
        }
    }

    if (issues.length) {
        for (const issue of issues) {
            console.error(`[startup] ${issue}`);
        }
        throw new Error(`Production configuration is not safe:\n- ${issues.join('\n- ')}`);
    }
}

validateRuntimeConfiguration();
await ensureDataStore();

const server = createServer(async (req, res) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    let requestPath = req.url || '/';

    try {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        requestPath = url.pathname;
        res.on('finish', () => {
            logInfo('http_request', {
                requestId,
                method: req.method,
                path: requestPath,
                statusCode: res.statusCode,
                durationMs: Date.now() - startedAt,
                userId: req.authUserId || null
            });
        });

        if (url.pathname.startsWith('/api/')) {
            await handleApi(req, res, url, requestId);
            return;
        }

        await serveStaticFile(res, url);
    } catch (error) {
        handleServerError(res, error, requestId);
    }
});

server.listen(port, () => {
    logInfo('server_started', {
        port,
        staticMode: isDev ? 'source files' : 'dist'
    });
});

async function handleApi(req, res, url, requestId) {
    if (req.method === 'GET' && url.pathname === '/api/health') {
        sendJson(res, 200, {
            ok: true,
            requestId,
            status: 'ok',
            service: 'nano-banana-saas',
            uptimeSeconds: Math.round(process.uptime()),
            timestamp: new Date().toISOString()
        });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/readiness') {
        const readiness = await getReadinessStatus();
        sendJson(res, readiness.ready ? 200 : 503, {
            ok: readiness.ready,
            requestId,
            ...readiness
        });
        return;
    }

    await enforceRateLimit(req, 'api', genericApiRateLimit, 60 * 1000);

    if (req.method === 'GET' && url.pathname === '/api/admin/summary') {
        requireAdmin(req);
        sendJson(res, 200, {
            ok: true,
            requestId,
            summary: await getAdminSummary()
        });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/jobs') {
        requireAdmin(req);
        sendJson(res, 200, {
            ok: true,
            requestId,
            jobs: await getAdminJobs(url)
        });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/reports') {
        requireAdmin(req);
        sendJson(res, 200, {
            ok: true,
            requestId,
            reports: await getAdminAbuseReports(url)
        });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/policy-events') {
        requireAdmin(req);
        sendJson(res, 200, {
            ok: true,
            requestId,
            events: await getAdminContentPolicyEvents(url)
        });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
        const user = await getCurrentUser(req);
        sendJson(res, 200, {
            ok: true,
            requestId,
            providers: getProviderStatus(),
            user: user ? publicUser(user) : null
        });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/session') {
        const user = await getCurrentUser(req);
        sendJson(res, 200, {
            ok: true,
            requestId,
            user: user ? publicUser(user) : null
        });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/billing/webhook') {
        const result = await handleStripeWebhook(req);
        sendJson(res, 200, {
            ok: true,
            requestId,
            received: true,
            result
        });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/billing/status') {
        const user = await requireAuth(req);
        sendJson(res, 200, {
            ok: true,
            requestId,
            billing: publicBillingStatus(user)
        });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/billing/checkout') {
        const user = await requireAuth(req);
        const checkout = await createStripeCheckoutSession(user);
        sendJson(res, 200, {
            ok: true,
            requestId,
            checkoutSessionId: checkout.id,
            url: checkout.url
        });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/billing/portal') {
        const user = await requireAuth(req);
        const portal = await createStripePortalSession(user);
        sendJson(res, 200, {
            ok: true,
            requestId,
            url: portal.url
        });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/signup') {
        await enforceRateLimit(req, 'auth', authRateLimit, 15 * 60 * 1000);
        const body = await readJsonBody(req);
        const { user, token, verificationToken } = await createUserAndSession(body);
        await sendAuthTokenEmail('email_verification', user, verificationToken);
        sendJson(
            res,
            201,
            {
                ok: true,
                requestId,
                user: publicUser(user),
                ...debugAuthTokenPayload(verificationToken)
            },
            {
                'Set-Cookie': buildSessionCookie(token)
            }
        );
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        await enforceRateLimit(req, 'auth', authRateLimit, 15 * 60 * 1000);
        const body = await readJsonBody(req);
        const { user, token } = await loginUser(body);
        sendJson(
            res,
            200,
            {
                ok: true,
                requestId,
                user: publicUser(user)
            },
            {
                'Set-Cookie': buildSessionCookie(token)
            }
        );
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/request-verification') {
        await enforceRateLimit(req, 'auth', authRateLimit, 15 * 60 * 1000);
        const user = await requireAuth(req);
        const result = await requestEmailVerification(user.id);
        await sendAuthTokenEmail('email_verification', result.user, result.token);
        sendJson(res, 200, {
            ok: true,
            requestId,
            message: 'If verification is needed, a verification link will be sent.',
            ...debugAuthTokenPayload(result.token)
        });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/verify-email') {
        await enforceRateLimit(req, 'auth', authRateLimit, 15 * 60 * 1000);
        const body = await readJsonBody(req);
        const verifiedUser = await verifyEmailToken(body?.token);
        const currentUser = await getCurrentUser(req);
        sendJson(res, 200, {
            ok: true,
            requestId,
            user: currentUser?.id === verifiedUser.id ? publicUser(verifiedUser) : null
        });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/request-password-reset') {
        await enforceRateLimit(req, 'auth', authRateLimit, 15 * 60 * 1000);
        const body = await readJsonBody(req);
        const result = await requestPasswordReset(body?.email);
        await sendAuthTokenEmail('password_reset', result.user, result.token, { suppressErrors: true });
        sendJson(res, 200, {
            ok: true,
            requestId,
            message: 'If an account exists for that email, a reset link will be sent.',
            ...debugAuthTokenPayload(result.token)
        });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/reset-password') {
        await enforceRateLimit(req, 'auth', authRateLimit, 15 * 60 * 1000);
        const body = await readJsonBody(req);
        const user = await resetPasswordWithToken(body?.token, body?.password);
        await sendPasswordChangedEmail(user, { suppressErrors: true });
        sendJson(res, 200, {
            ok: true,
            requestId
        });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        await logoutUser(req);
        sendJson(
            res,
            200,
            {
                ok: true,
                requestId
            },
            {
                'Set-Cookie': clearSessionCookie()
            }
        );
        return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/assets/')) {
        const user = await requireAuth(req);
        await serveUserAsset(res, user, url.pathname.split('/').pop());
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/gallery') {
        const user = await requireAuth(req);
        const items = await getGalleryItems(user.id);
        sendJson(res, 200, {
            ok: true,
            requestId,
            items
        });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/gallery') {
        const user = await requireAuth(req);
        assertEmailVerifiedIfRequired(user);
        const body = await readJsonBody(req);
        const item = await createGalleryItem(user.id, body);
        sendJson(res, 201, {
            ok: true,
            requestId,
            item
        });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/abuse-reports') {
        const user = await requireAuth(req);
        const body = await readJsonBody(req);
        const report = await createAbuseReport(user.id, body);
        sendJson(res, 201, {
            ok: true,
            requestId,
            report
        });
        return;
    }

    const galleryDeleteMatch = url.pathname.match(/^\/api\/gallery\/([^/]+)$/);
    if (req.method === 'DELETE' && galleryDeleteMatch) {
        const user = await requireAuth(req);
        await deleteGalleryItem(user.id, galleryDeleteMatch[1]);
        sendJson(res, 200, {
            ok: true,
            requestId
        });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/prompt-enhancements') {
        const user = await requireAuth(req);
        assertEmailVerifiedIfRequired(user);
        await enforceRateLimit(req, `prompt:${user.id}`, generationRateLimit, 60 * 60 * 1000);
        const body = await readJsonBody(req);
        await assertContentPolicyAllowed(user.id, body?.prompt, {
            surface: 'prompt_enhancement'
        });
        const enhancedPrompt = await enhancePromptWithGemini(body);
        sendJson(res, 200, {
            ok: true,
            requestId,
            enhancedPrompt
        });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/generations') {
        const user = await requireAuth(req);
        assertEmailVerifiedIfRequired(user);
        await enforceRateLimit(req, `generation:${user.id}`, generationRateLimit, 60 * 60 * 1000);
        const body = await readJsonBody(req);
        const abortSignal = createRequestAbortSignal(req, res);
        const result = await createGeneration(user, body, {
            idempotencyKey: getHeaderValue(req, 'idempotency-key') || getHeaderValue(req, 'x-idempotency-key'),
            signal: abortSignal
        });
        sendJson(res, 200, {
            ok: true,
            requestId,
            ...result
        });
        return;
    }

    throw new PublicApiError('API route not found.', 404, 'not_found');
}

async function enforceRateLimit(req, scope, limit, windowMs) {
    if (!Number.isFinite(limit) || limit <= 0) {
        return;
    }

    const identity = buildRateLimitIdentity(req, scope);
    const count = rateLimitDriver === 'redis'
        ? await incrementRedisRateLimit(identity, windowMs)
        : incrementMemoryRateLimit(identity, windowMs);

    if (count > limit) {
        throw new PublicApiError('Too many requests. Please wait and try again.', 429, 'rate_limited', {
            retryAfterSeconds: Math.ceil(windowMs / 1000),
            driver: rateLimitDriver
        });
    }
}

function incrementMemoryRateLimit(identity, windowMs) {
    const now = Date.now();
    const bucket = rateLimitBuckets.get(identity);

    if (!bucket || bucket.resetAt <= now) {
        rateLimitBuckets.set(identity, {
            count: 1,
            resetAt: now + windowMs
        });
        return 1;
    }

    bucket.count += 1;
    return bucket.count;
}

async function incrementRedisRateLimit(identity, windowMs) {
    const client = await getRedisRateLimitClient();
    const key = buildRateLimitKey(identity);
    const result = await client.sendCommand([
        'EVAL',
        'local current = redis.call("INCR", KEYS[1]); if current == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]); end; return current;',
        '1',
        key,
        String(windowMs)
    ]);
    return Number(result);
}

function buildRateLimitIdentity(req, scope) {
    return `${scope}:${getClientAddress(req)}`;
}

function buildRateLimitKey(identity) {
    const digest = createHmac('sha256', sessionSecret || 'rate-limit-key')
        .update(identity)
        .digest('hex')
        .slice(0, 32);
    const scope = String(identity).split(':', 1)[0].replace(/[^a-z0-9_-]/gi, '-').slice(0, 60) || 'scope';
    return `${rateLimitKeyPrefix}:rate-limit:${scope}:${digest}`;
}

async function getRedisRateLimitClient() {
    if (redisClient?.isOpen) {
        return redisClient;
    }

    if (!redisUrl) {
        throw new PublicApiError('Redis rate limiting is not configured.', 503, 'redis_not_configured');
    }

    if (!redisClientPromise) {
        redisClientPromise = connectRedisRateLimitClient();
    }

    try {
        return await redisClientPromise;
    } catch (error) {
        redisClientPromise = null;
        throw error;
    }
}

async function connectRedisRateLimitClient() {
    const client = createRedisClient({
        url: redisUrl,
        socket: {
            connectTimeout: 5000,
            reconnectStrategy: false
        }
    });

    client.on('error', (error) => {
        logError('redis_rate_limit_error', {
            message: error.message
        });
    });

    await client.connect();
    redisClient = client;
    return client;
}

function getClientAddress(req) {
    const forwardedFor = getHeaderValue(req, 'x-forwarded-for');
    if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
    }

    return req.socket?.remoteAddress || 'unknown';
}

function getHeaderValue(req, headerName) {
    const value = req.headers[headerName.toLowerCase()];
    if (Array.isArray(value)) {
        return value[0] || '';
    }
    return value || '';
}

function createRequestAbortSignal(req, res) {
    const controller = new AbortController();
    const abort = () => {
        if (!controller.signal.aborted) {
            controller.abort();
        }
    };

    req.on('aborted', abort);
    res.on('close', () => {
        if (!res.writableEnded) {
            abort();
        }
    });

    return controller.signal;
}

async function ensureDataStore() {
    await ensureAssetStorage();

    if (!existsSync(dbPath)) {
        dbCache = createEmptyDb();
        await writeFile(dbPath, JSON.stringify(dbCache, null, 2), 'utf8');
        return;
    }

    const raw = await readFile(dbPath, 'utf8');
    dbCache = normalizeDb(raw ? JSON.parse(raw) : {});
    backfillSubscriptionRecords(dbCache);
    await writeDb(dbCache);
}

function createEmptyDb() {
    return {
        users: [],
        subscriptions: [],
        sessions: [],
        authTokens: [],
        generationJobs: [],
        imageAssets: [],
        providerUsageEvents: [],
        userGalleryItems: [],
        contentPolicyEvents: [],
        abuseReports: [],
        emailDeliveryEvents: []
    };
}

function normalizeDb(db) {
    const empty = createEmptyDb();
    return {
        ...empty,
        ...db,
        users: Array.isArray(db.users) ? db.users : [],
        subscriptions: Array.isArray(db.subscriptions) ? db.subscriptions : [],
        sessions: normalizeSessionRecords(db.sessions),
        authTokens: normalizeAuthTokenRecords(db.authTokens),
        generationJobs: Array.isArray(db.generationJobs) ? db.generationJobs : [],
        imageAssets: normalizeImageAssetRecords(db.imageAssets),
        providerUsageEvents: Array.isArray(db.providerUsageEvents) ? db.providerUsageEvents : [],
        userGalleryItems: Array.isArray(db.userGalleryItems) ? db.userGalleryItems : [],
        contentPolicyEvents: Array.isArray(db.contentPolicyEvents) ? db.contentPolicyEvents : [],
        abuseReports: Array.isArray(db.abuseReports) ? db.abuseReports : [],
        emailDeliveryEvents: normalizeEmailDeliveryEventRecords(db.emailDeliveryEvents)
    };
}

function normalizeSessionRecords(sessions) {
    if (!Array.isArray(sessions)) {
        return [];
    }

    return sessions
        .map((session) => {
            const normalized = {
                ...session,
                tokenHash: session.tokenHash || (session.token ? hashSessionToken(session.token) : '')
            };
            delete normalized.token;
            return normalized;
        })
        .filter((session) => session.userId && session.tokenHash && session.expiresAt);
}

function normalizeAuthTokenRecords(authTokens) {
    if (!Array.isArray(authTokens)) {
        return [];
    }

    return authTokens
        .filter((token) => token && token.id && token.userId && token.tokenHash && token.type && token.expiresAt)
        .map((token) => ({
            ...token,
            consumedAt: token.consumedAt || null
        }));
}

function normalizeEmailDeliveryEventRecords(emailDeliveryEvents) {
    if (!Array.isArray(emailDeliveryEvents)) {
        return [];
    }

    return emailDeliveryEvents
        .filter((event) => event && event.id && event.userId && event.type && event.provider && event.status && event.createdAt)
        .map((event) => ({
            ...event,
            providerMessageId: event.providerMessageId || null,
            errorCode: event.errorCode || null,
            errorMessage: event.errorMessage || null
        }));
}

function normalizeImageAssetRecords(imageAssets) {
    if (!Array.isArray(imageAssets)) {
        return [];
    }

    return imageAssets
        .filter((asset) => asset && asset.id && asset.userId)
        .map((asset) => {
            const storageDriver = asset.storageDriver || 'local';
            const storageKey = asset.storageKey || asset.relativePath || '';
            return {
                ...asset,
                storageDriver,
                storageKey,
                relativePath: asset.relativePath || (storageDriver === 'local' ? storageKey : null)
            };
        });
}

function backfillSubscriptionRecords(db) {
    const now = new Date().toISOString();

    for (const user of db.users) {
        if (!user.plan || !(user.plan in PLAN_CATALOG)) {
            user.plan = 'starter';
        }

        user.emailVerifiedAt = user.emailVerifiedAt || null;
        user.lastVerificationRequestedAt = user.lastVerificationRequestedAt || null;
        user.lastPasswordResetRequestedAt = user.lastPasswordResetRequestedAt || null;

        if (typeof user.monthlyGenerationLimit !== 'number') {
            user.monthlyGenerationLimit = getPlanConfig(user.plan).monthlyGenerationLimit;
        }

        const subscription = db.subscriptions.find((candidate) => candidate.userId === user.id);
        if (subscription) {
            subscription.plan = normalizePlanId(subscription.plan || user.plan);
            subscription.status = normalizeSubscriptionStatus(subscription.status || 'active');
            subscription.billingProvider = subscription.billingProvider || 'local';
            subscription.currentPeriodStart = subscription.currentPeriodStart || user.createdAt || now;
            subscription.currentPeriodEnd = subscription.currentPeriodEnd || null;
            subscription.billingCustomerId = subscription.billingCustomerId || null;
            subscription.billingSubscriptionId = subscription.billingSubscriptionId || null;
            subscription.billingCheckoutSessionId = subscription.billingCheckoutSessionId || null;
            subscription.billingPriceId = subscription.billingPriceId || null;
            subscription.updatedAt = subscription.updatedAt || now;
            user.plan = subscription.plan;
            user.monthlyGenerationLimit = getPlanConfig(subscription.plan).monthlyGenerationLimit;
            continue;
        }

        db.subscriptions.push(createLocalSubscriptionRecord(user, now));
    }
}

async function getDb() {
    if (dbCache) {
        return dbCache;
    }

    await ensureDataStore();
    return dbCache;
}

async function writeDb(db) {
    dbWriteQueue = dbWriteQueue.then(() => writeFile(dbPath, JSON.stringify(db, null, 2), 'utf8'));
    await dbWriteQueue;
}

async function updateDb(mutator) {
    const db = await getDb();
    const result = await mutator(db);
    await writeDb(db);
    return result;
}

async function createUserAndSession(body) {
    const email = normalizeEmail(body?.email);
    const password = normalizePassword(body?.password);
    const now = new Date().toISOString();

    return updateDb((db) => {
        if (db.users.some((user) => user.email === email)) {
            throw new PublicApiError('An account already exists for that email.', 409, 'account_exists');
        }

        const passwordRecord = hashPassword(password);
        const user = {
            id: randomUUID(),
            email,
            passwordHash: passwordRecord.hash,
            passwordSalt: passwordRecord.salt,
            emailVerifiedAt: null,
            lastVerificationRequestedAt: null,
            lastPasswordResetRequestedAt: null,
            plan: 'starter',
            monthlyGenerationLimit: getPlanConfig('starter').monthlyGenerationLimit,
            createdAt: now,
            updatedAt: now
        };
        const session = createSessionRecord(user.id);
        const subscription = createLocalSubscriptionRecord(user, now);
        const verificationToken = emailVerificationRequired
            ? createAuthTokenRecord(user.id, 'email_verification', emailVerificationTokenMaxAgeMs, now)
            : null;

        db.users.push(user);
        db.subscriptions.push(subscription);
        db.sessions.push(session.record);
        if (verificationToken) {
            user.lastVerificationRequestedAt = now;
            db.authTokens.push(verificationToken.record);
        }

        return {
            user,
            token: session.token,
            verificationToken: verificationToken?.token || null
        };
    });
}

async function loginUser(body) {
    const email = normalizeEmail(body?.email);
    const password = normalizePassword(body?.password);

    return updateDb((db) => {
        const user = db.users.find((candidate) => candidate.email === email);
        if (!user || !verifyPassword(password, user)) {
            throw new PublicApiError('Invalid email or password.', 401, 'invalid_credentials');
        }

        const session = createSessionRecord(user.id);
        db.sessions.push(session.record);

        return {
            user,
            token: session.token
        };
    });
}

async function requestEmailVerification(userId) {
    const now = new Date().toISOString();
    return updateDb((db) => {
        const user = db.users.find((candidate) => candidate.id === userId);
        if (!user || user.emailVerifiedAt) {
            return { user: user || null, token: null };
        }

        consumeActiveAuthTokens(db, user.id, 'email_verification', now);
        const authToken = createAuthTokenRecord(user.id, 'email_verification', emailVerificationTokenMaxAgeMs, now);
        user.lastVerificationRequestedAt = now;
        user.updatedAt = now;
        db.authTokens.push(authToken.record);
        return {
            user,
            token: authToken.token
        };
    });
}

async function verifyEmailToken(rawToken) {
    const token = normalizeAuthToken(rawToken);
    const now = new Date().toISOString();
    return updateDb((db) => {
        const record = findActiveAuthToken(db, 'email_verification', token, now);
        if (!record) {
            throw new PublicApiError('Verification link is invalid or expired.', 400, 'invalid_auth_token');
        }

        const user = db.users.find((candidate) => candidate.id === record.userId);
        if (!user) {
            throw new PublicApiError('Verification link is invalid or expired.', 400, 'invalid_auth_token');
        }

        record.consumedAt = now;
        user.emailVerifiedAt = now;
        user.updatedAt = now;
        return user;
    });
}

async function requestPasswordReset(emailInput) {
    let email = '';
    try {
        email = normalizeEmail(emailInput);
    } catch {
        return { user: null, token: null };
    }

    const now = new Date().toISOString();
    return updateDb((db) => {
        const user = db.users.find((candidate) => candidate.email === email);
        if (!user) {
            return { user: null, token: null };
        }

        consumeActiveAuthTokens(db, user.id, 'password_reset', now);
        const authToken = createAuthTokenRecord(user.id, 'password_reset', passwordResetTokenMaxAgeMs, now);
        user.lastPasswordResetRequestedAt = now;
        user.updatedAt = now;
        db.authTokens.push(authToken.record);
        return {
            user,
            token: authToken.token
        };
    });
}

async function resetPasswordWithToken(rawToken, rawPassword) {
    const token = normalizeAuthToken(rawToken);
    const password = normalizePassword(rawPassword);
    const now = new Date().toISOString();
    return updateDb((db) => {
        const record = findActiveAuthToken(db, 'password_reset', token, now);
        if (!record) {
            throw new PublicApiError('Reset link is invalid or expired.', 400, 'invalid_auth_token');
        }

        const user = db.users.find((candidate) => candidate.id === record.userId);
        if (!user) {
            throw new PublicApiError('Reset link is invalid or expired.', 400, 'invalid_auth_token');
        }

        const passwordRecord = hashPassword(password);
        user.passwordHash = passwordRecord.hash;
        user.passwordSalt = passwordRecord.salt;
        user.updatedAt = now;
        record.consumedAt = now;
        db.sessions = db.sessions.filter((session) => session.userId !== user.id);
        return user;
    });
}

async function sendAuthTokenEmail(type, user, token, options = {}) {
    if (!user || !token) {
        return null;
    }

    const message = buildAuthTokenEmail(type, user, token);
    return sendTransactionalEmail(message, options);
}

async function sendPasswordChangedEmail(user, options = {}) {
    if (!user) {
        return null;
    }

    return sendTransactionalEmail(buildPasswordChangedEmail(user), options);
}

function buildAuthTokenEmail(type, user, token) {
    const isVerification = type === 'email_verification';
    if (!isVerification && type !== 'password_reset') {
        throw new Error(`Unsupported auth email type: ${type}`);
    }

    const actionPath = isVerification
        ? `/?verify_email=${encodeURIComponent(token)}`
        : `/?reset_password=${encodeURIComponent(token)}`;
    const actionUrl = buildAppUrl(actionPath);
    const subject = isVerification
        ? `Verify your ${emailProductName} email`
        : `Reset your ${emailProductName} password`;
    const title = isVerification
        ? 'Verify your email address'
        : 'Reset your password';
    const body = isVerification
        ? `Use this link to verify your ${emailProductName} account. The link expires in 24 hours.`
        : `Use this link to choose a new ${emailProductName} password. The link expires in 20 minutes.`;
    const actionLabel = isVerification ? 'Verify email' : 'Reset password';

    return {
        type,
        user,
        to: user.email,
        subject,
        text: `${title}\n\n${body}\n\n${actionUrl}\n\nIf you did not request this, you can ignore this email.`,
        html: buildTransactionalEmailHtml({
            title,
            body,
            actionLabel,
            actionUrl
        }),
        localDeliveryUrl: actionUrl,
        idempotencyKey: `${type}/${hashAuthToken(token).slice(0, 48)}`,
        tags: buildEmailTags(type, user.id)
    };
}

function buildPasswordChangedEmail(user) {
    const title = 'Your password was changed';
    const body = `The password for your ${emailProductName} account was changed. If this was not you, reset your password immediately.`;

    return {
        type: 'password_changed',
        user,
        to: user.email,
        subject: `${emailProductName} password changed`,
        text: `${title}\n\n${body}\n\n${buildAppUrl('/')}`,
        html: buildTransactionalEmailHtml({
            title,
            body,
            actionLabel: 'Open app',
            actionUrl: buildAppUrl('/')
        }),
        localDeliveryUrl: buildAppUrl('/'),
        idempotencyKey: `password_changed/${user.id}/${randomUUID()}`,
        tags: buildEmailTags('password_changed', user.id)
    };
}

async function sendTransactionalEmail(message, { suppressErrors = false } = {}) {
    try {
        if (emailDeliveryDriver === 'log') {
            logInfo('email_delivery_log', {
                type: message.type,
                userId: message.user.id,
                to: message.to,
                provider: 'log',
                subject: message.subject,
                localDeliveryUrl: authTokenDebug ? message.localDeliveryUrl : null
            });

            return recordEmailDeliveryEvent({
                type: message.type,
                userId: message.user.id,
                to: message.to,
                provider: 'log',
                status: 'sent',
                providerMessageId: `log_${randomUUID()}`
            });
        }

        if (emailDeliveryDriver !== 'resend') {
            throw new Error(`Unsupported email delivery driver: ${emailDeliveryDriver}`);
        }

        if (!isResendEmailDeliveryConfigured()) {
            throw new Error('Resend email delivery is not configured.');
        }

        const payload = {
            from: emailFrom,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
            tags: message.tags
        };
        if (emailReplyTo) {
            payload.replyTo = emailReplyTo;
        }

        const { data, error } = await getResendClient().emails.send(payload, {
            idempotencyKey: message.idempotencyKey
        });

        if (error) {
            throw toEmailDeliveryError(error);
        }

        return recordEmailDeliveryEvent({
            type: message.type,
            userId: message.user.id,
            to: message.to,
            provider: 'resend',
            status: 'sent',
            providerMessageId: data?.id || null
        });
    } catch (error) {
        await recordEmailDeliveryEvent({
            type: message.type,
            userId: message.user.id,
            to: message.to,
            provider: emailDeliveryDriver,
            status: 'failed',
            errorCode: getEmailDeliveryErrorCode(error),
            errorMessage: getSafeEmailDeliveryErrorMessage(error)
        });
        logError('email_delivery_failed', {
            type: message.type,
            userId: message.user.id,
            provider: emailDeliveryDriver,
            error: serializeErrorForLog(error)
        });

        if (suppressErrors) {
            return null;
        }

        throw new PublicApiError('Email delivery failed. Please try again.', 502, 'email_delivery_failed');
    }
}

async function recordEmailDeliveryEvent(event) {
    const now = new Date().toISOString();
    const record = {
        id: randomUUID(),
        userId: event.userId,
        type: event.type,
        to: event.to,
        provider: event.provider,
        status: event.status,
        providerMessageId: event.providerMessageId || null,
        errorCode: event.errorCode || null,
        errorMessage: event.errorMessage || null,
        createdAt: now
    };

    await updateDb((db) => {
        db.emailDeliveryEvents.push(record);
    });

    return record;
}

function buildTransactionalEmailHtml({ title, body, actionLabel, actionUrl }) {
    return `<!doctype html>
<html>
<body style="margin:0;background:#f6f7f9;color:#171717;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border:1px solid #e7e8ec;border-radius:8px;padding:28px;">
      <h1 style="font-size:22px;line-height:1.25;margin:0 0 16px;">${escapeHtml(title)}</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">${escapeHtml(body)}</p>
      <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#171717;color:#ffffff;text-decoration:none;border-radius:6px;padding:12px 18px;font-weight:700;">${escapeHtml(actionLabel)}</a>
      <p style="font-size:12px;line-height:1.5;color:#62666f;margin:24px 0 0;">If the button does not work, paste this URL into your browser:<br><span style="word-break:break-all;">${escapeHtml(actionUrl)}</span></p>
    </div>
  </div>
</body>
</html>`;
}

function buildEmailTags(type, userId) {
    return [
        { name: 'type', value: normalizeEmailTagValue(type) },
        { name: 'user_id', value: normalizeEmailTagValue(userId) }
    ];
}

function getResendClient() {
    if (!resendClient) {
        resendClient = new Resend(resendApiKey);
    }
    return resendClient;
}

function toEmailDeliveryError(error) {
    const output = new Error(error?.message || 'Email provider rejected the request.');
    output.code = error?.name || error?.code || 'email_provider_error';
    output.status = error?.statusCode || error?.status;
    output.details = error;
    return output;
}

function getEmailDeliveryErrorCode(error) {
    return String(error?.code || error?.name || 'email_delivery_failed').slice(0, 80);
}

function getSafeEmailDeliveryErrorMessage(error) {
    return String(error?.message || 'Email delivery failed.').slice(0, 240);
}

async function logoutUser(req) {
    const token = getCookie(req, sessionCookieName);
    if (!token) return;

    const tokenHash = hashSessionToken(token);
    await updateDb((db) => {
        db.sessions = db.sessions.filter((session) => !constantTimeStringEqual(session.tokenHash, tokenHash));
    });
}

async function getCurrentUser(req) {
    const token = getCookie(req, sessionCookieName);
    if (!token) return null;

    const db = await getDb();
    const now = Date.now();
    const tokenHash = hashSessionToken(token);
    const session = db.sessions.find((candidate) => constantTimeStringEqual(candidate.tokenHash, tokenHash));
    if (!session || Date.parse(session.expiresAt) <= now) {
        return null;
    }

    return db.users.find((user) => user.id === session.userId) || null;
}

async function requireAuth(req) {
    const user = await getCurrentUser(req);
    if (!user) {
        throw new PublicApiError('Sign in is required.', 401, 'auth_required');
    }
    req.authUserId = user.id;
    return user;
}

function requireAdmin(req) {
    if (!adminApiToken) {
        throw new PublicApiError('Admin API is not configured.', 503, 'admin_not_configured');
    }

    const provided = getBearerToken(req) || getHeaderValue(req, 'x-admin-token');
    if (!constantTimeStringEqual(provided, adminApiToken)) {
        throw new PublicApiError('Admin authorization is required.', 401, 'admin_auth_required');
    }
}

function getBearerToken(req) {
    const authorization = getHeaderValue(req, 'authorization');
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : '';
}

function publicUser(user) {
    const db = dbCache || createEmptyDb();
    const entitlements = getUserEntitlements(db, user);
    const monthlyUsed = getMonthlyGenerationCount(db, user.id);
    const monthlyLimit = entitlements.monthlyGenerationLimit;
    return {
        id: user.id,
        email: user.email,
        emailVerified: Boolean(user.emailVerifiedAt),
        emailVerifiedAt: user.emailVerifiedAt || null,
        emailVerificationRequired,
        plan: entitlements.plan,
        monthlyGenerationLimit: monthlyLimit,
        subscription: entitlements.subscription,
        entitlements: {
            plan: entitlements.plan,
            planLabel: entitlements.planLabel,
            allowedProviders: entitlements.allowedProviders,
            allowedModels: entitlements.allowedModels,
            monthlyGenerationLimit: monthlyLimit
        },
        quota: {
            monthlyUsed,
            monthlyLimit,
            monthlyRemaining: Math.max(0, monthlyLimit - monthlyUsed)
        }
    };
}

function publicBillingStatus(user) {
    const db = dbCache || createEmptyDb();
    const entitlements = getUserEntitlements(db, user);
    const monthlyUsed = getMonthlyGenerationCount(db, user.id);

    return {
        billingProvider,
        checkoutAvailable: isStripeCheckoutConfigured(),
        portalAvailable: Boolean(entitlements.subscription.billingCustomerId) && isStripeApiConfigured(),
        subscription: entitlements.subscription,
        entitlements: {
            plan: entitlements.plan,
            planLabel: entitlements.planLabel,
            allowedProviders: entitlements.allowedProviders,
            allowedModels: entitlements.allowedModels,
            monthlyGenerationLimit: entitlements.monthlyGenerationLimit
        },
        quota: {
            monthlyUsed,
            monthlyLimit: entitlements.monthlyGenerationLimit,
            monthlyRemaining: Math.max(0, entitlements.monthlyGenerationLimit - monthlyUsed)
        }
    };
}

function getUserEntitlements(db, user) {
    const subscription = getUserSubscription(db, user);
    const plan = getPlanConfig(subscription.plan);

    return {
        plan: subscription.plan,
        planLabel: plan.label,
        monthlyGenerationLimit: plan.monthlyGenerationLimit,
        allowedProviders: [...plan.allowedProviders],
        allowedModels: [...plan.allowedModels],
        subscription: {
            id: subscription.id,
            plan: subscription.plan,
            status: subscription.status,
            billingProvider: subscription.billingProvider,
            billingCustomerId: subscription.billingCustomerId,
            billingSubscriptionId: subscription.billingSubscriptionId,
            billingCheckoutSessionId: subscription.billingCheckoutSessionId,
            billingPriceId: subscription.billingPriceId,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd
        }
    };
}

function getUserSubscription(db, user) {
    const existing = db.subscriptions.find((subscription) => subscription.userId === user.id);
    if (existing) {
        existing.plan = normalizePlanId(existing.plan || user.plan);
        existing.status = normalizeSubscriptionStatus(existing.status || 'active');
        return existing;
    }

    const subscription = createLocalSubscriptionRecord(user);
    db.subscriptions.push(subscription);
    return subscription;
}

function createLocalSubscriptionRecord(user, timestamp = new Date().toISOString()) {
    const plan = normalizePlanId(user.plan || 'starter');
    return {
        id: randomUUID(),
        userId: user.id,
        plan,
        status: 'active',
        billingProvider: 'local',
        billingCustomerId: null,
        billingSubscriptionId: null,
        billingCheckoutSessionId: null,
        billingPriceId: null,
        currentPeriodStart: timestamp,
        currentPeriodEnd: null,
        createdAt: timestamp,
        updatedAt: timestamp
    };
}

function getPlanConfig(planId) {
    return PLAN_CATALOG[normalizePlanId(planId)];
}

function normalizePlanId(planId) {
    if (typeof planId === 'string' && planId in PLAN_CATALOG) {
        return planId;
    }
    return 'starter';
}

function normalizeSubscriptionStatus(status) {
    if (['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'paused', 'unpaid'].includes(status)) {
        return status;
    }
    return 'active';
}

function normalizeBillingProvider(value) {
    return value === 'stripe' ? 'stripe' : 'local';
}

function normalizeRateLimitDriver(value) {
    return value === 'redis' ? 'redis' : 'memory';
}

function normalizeEmailDeliveryDriver(value) {
    return value === 'resend' ? 'resend' : 'log';
}

function normalizeEmailProductName(value) {
    const normalized = String(value || '').trim().slice(0, 80);
    return normalized || 'Nano Banana Art Lab';
}

function normalizeEmailTagValue(value) {
    const normalized = String(value || '')
        .trim()
        .replace(/[^a-z0-9_-]/gi, '-')
        .replace(/-+/g, '-')
        .slice(0, 256);
    return normalized || 'unknown';
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function normalizeRateLimitKeyPrefix(value) {
    const prefix = String(value || '')
        .trim()
        .replace(/[^a-z0-9:_-]/gi, '-')
        .replace(/-+/g, '-')
        .slice(0, 80);
    return prefix || 'nano-banana';
}

function normalizeAbsoluteUrl(value) {
    try {
        const url = new URL(String(value || ''));
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return '';
        }
        return url.toString().replace(/\/$/, '');
    } catch {
        return '';
    }
}

function buildAppUrl(pathname) {
    if (!appBaseUrl) {
        throw new PublicApiError('APP_BASE_URL must be configured.', 503, 'app_base_url_missing');
    }

    return new URL(pathname, `${appBaseUrl}/`).toString();
}

function isResendEmailDeliveryConfigured() {
    return Boolean(resendApiKey && emailFrom && appBaseUrl);
}

function isEmailDeliveryProductionReady() {
    if (emailDeliveryDriver === 'resend') {
        return isResendEmailDeliveryConfigured();
    }

    return emailDeliveryDriver === 'log' && allowLocalEmailDelivery;
}

function isStripeApiConfigured() {
    return mockStripeResponses || Boolean(stripeSecretKey);
}

function isStripeCheckoutConfigured() {
    return mockStripeResponses || Boolean(stripeSecretKey && stripeProPriceId && appBaseUrl);
}

function isStripeWebhookConfigured() {
    return mockStripeResponses || Boolean(stripeSecretKey && stripeWebhookSecret);
}

function requireStripeApiConfigured() {
    if (!isStripeApiConfigured()) {
        throw new PublicApiError('Stripe billing is not configured on this server.', 503, 'stripe_not_configured');
    }
}

function requireStripeCheckoutConfigured() {
    if (!isStripeCheckoutConfigured()) {
        throw new PublicApiError('Stripe checkout is not configured on this server.', 503, 'stripe_not_configured');
    }
}

function requireStripeWebhookConfigured() {
    if (!isStripeWebhookConfigured()) {
        throw new PublicApiError('Stripe webhooks are not configured on this server.', 503, 'stripe_not_configured');
    }
}

function getStripeClient() {
    if (!stripeSecretKey) {
        throw new PublicApiError('Stripe billing is not configured on this server.', 503, 'stripe_not_configured');
    }

    if (!stripeClient) {
        stripeClient = new Stripe(stripeSecretKey, {
            apiVersion: STRIPE_API_VERSION
        });
    }

    return stripeClient;
}

async function createStripeCheckoutSession(user) {
    requireStripeCheckoutConfigured();

    if (mockStripeResponses) {
        return createMockStripeCheckoutSession(user);
    }

    const db = await getDb();
    const subscription = getUserSubscription(db, user);
    const checkoutPayload = {
        mode: 'subscription',
        line_items: [
            {
                price: stripeProPriceId,
                quantity: 1
            }
        ],
        success_url: buildAppUrl('/?billing=success&session_id={CHECKOUT_SESSION_ID}'),
        cancel_url: buildAppUrl('/?billing=cancel'),
        client_reference_id: user.id,
        metadata: {
            userId: user.id,
            plan: 'pro'
        },
        subscription_data: {
            metadata: {
                userId: user.id,
                plan: 'pro'
            }
        }
    };

    if (subscription.billingCustomerId) {
        checkoutPayload.customer = subscription.billingCustomerId;
    } else {
        checkoutPayload.customer_email = user.email;
    }

    const session = await getStripeClient().checkout.sessions.create(checkoutPayload);
    if (!session.url) {
        throw new PublicApiError('Stripe did not return a Checkout URL.', 502, 'stripe_checkout_url_missing');
    }

    await recordStripeCheckoutAttempt(user.id, {
        checkoutSessionId: session.id,
        billingPriceId: stripeProPriceId
    });

    return {
        id: session.id,
        url: session.url
    };
}

async function createMockStripeCheckoutSession(user) {
    const id = `cs_test_${randomUUID().replace(/-/g, '')}`;
    await recordStripeCheckoutAttempt(user.id, {
        checkoutSessionId: id,
        billingPriceId: stripeProPriceId || 'price_mock_pro'
    });

    return {
        id,
        url: buildAppUrl(`/?mock_checkout_session=${encodeURIComponent(id)}`)
    };
}

async function recordStripeCheckoutAttempt(userId, values) {
    const now = new Date().toISOString();
    await updateDb((db) => {
        const user = db.users.find((candidate) => candidate.id === userId);
        if (!user) {
            return;
        }

        const subscription = getUserSubscription(db, user);
        subscription.billingCheckoutSessionId = values.checkoutSessionId || subscription.billingCheckoutSessionId || null;
        subscription.billingPriceId = values.billingPriceId || subscription.billingPriceId || null;
        subscription.updatedAt = now;
    });
}

async function createStripePortalSession(user) {
    requireStripeApiConfigured();

    const db = await getDb();
    const subscription = getUserSubscription(db, user);
    const customerId = subscription.billingCustomerId;
    if (!customerId) {
        throw new PublicApiError('No Stripe customer is linked to this account yet.', 409, 'stripe_customer_missing');
    }

    if (mockStripeResponses) {
        return {
            url: buildAppUrl(`/?mock_billing_portal=${encodeURIComponent(customerId)}`)
        };
    }

    const portal = await getStripeClient().billingPortal.sessions.create({
        customer: customerId,
        return_url: stripeBillingPortalReturnUrl || appBaseUrl
    });

    if (!portal.url) {
        throw new PublicApiError('Stripe did not return a customer portal URL.', 502, 'stripe_portal_url_missing');
    }

    return {
        url: portal.url
    };
}

async function handleStripeWebhook(req) {
    const rawBody = await readRawBody(req, 2 * 1024 * 1024);
    const event = constructStripeWebhookEvent(rawBody, req);
    return processStripeWebhookEvent(event);
}

function constructStripeWebhookEvent(rawBody, req) {
    if (mockStripeResponses) {
        try {
            return JSON.parse(rawBody.toString('utf8'));
        } catch {
            throw new PublicApiError('Stripe webhook payload must be valid JSON.', 400, 'invalid_stripe_event');
        }
    }

    requireStripeWebhookConfigured();

    const signature = getHeaderValue(req, 'stripe-signature');
    if (!signature) {
        throw new PublicApiError('Missing Stripe webhook signature.', 400, 'stripe_signature_missing');
    }

    try {
        return getStripeClient().webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);
    } catch (error) {
        throw new PublicApiError('Invalid Stripe webhook signature.', 400, 'stripe_signature_invalid', {
            message: error.message
        });
    }
}

async function processStripeWebhookEvent(event) {
    if (!event?.type || !event?.data?.object) {
        throw new PublicApiError('Invalid Stripe event payload.', 400, 'invalid_stripe_event');
    }

    if (event.type === 'checkout.session.completed') {
        return applyCheckoutSessionCompleted(event.data.object, event.id);
    }

    if (
        event.type === 'customer.subscription.created' ||
        event.type === 'customer.subscription.updated' ||
        event.type === 'customer.subscription.deleted'
    ) {
        return applyStripeSubscriptionChanged(event.data.object, event.type, event.id);
    }

    logInfo('stripe_webhook_ignored', {
        eventId: event.id || null,
        type: event.type
    });
    return {
        ignored: true,
        type: event.type
    };
}

async function applyCheckoutSessionCompleted(session, eventId) {
    const userId = session.client_reference_id || session.metadata?.userId || '';
    const customerId = getStripeObjectId(session.customer);
    const stripeSubscriptionId = getStripeObjectId(session.subscription);
    const now = new Date().toISOString();

    if (!userId) {
        logError('stripe_checkout_missing_user', {
            eventId,
            checkoutSessionId: session.id || null
        });
        return {
            updated: false,
            reason: 'missing_user_id'
        };
    }

    return updateDb((db) => {
        const user = db.users.find((candidate) => candidate.id === userId);
        if (!user) {
            logError('stripe_checkout_unknown_user', {
                eventId,
                checkoutSessionId: session.id || null,
                userId
            });
            return {
                updated: false,
                reason: 'user_not_found'
            };
        }

        const subscription = getUserSubscription(db, user);
        subscription.plan = 'pro';
        subscription.status = 'active';
        subscription.billingProvider = 'stripe';
        subscription.billingCustomerId = customerId || subscription.billingCustomerId || null;
        subscription.billingSubscriptionId = stripeSubscriptionId || subscription.billingSubscriptionId || null;
        subscription.billingCheckoutSessionId = session.id || subscription.billingCheckoutSessionId || null;
        subscription.billingPriceId = stripeProPriceId || subscription.billingPriceId || null;
        subscription.updatedAt = now;
        user.plan = 'pro';
        user.monthlyGenerationLimit = getPlanConfig('pro').monthlyGenerationLimit;
        user.updatedAt = now;

        return {
            updated: true,
            userId: user.id,
            subscriptionId: subscription.id,
            plan: subscription.plan,
            status: subscription.status
        };
    });
}

async function applyStripeSubscriptionChanged(stripeSubscription, eventType, eventId) {
    const stripeSubscriptionId = getStripeObjectId(stripeSubscription.id);
    const customerId = getStripeObjectId(stripeSubscription.customer);
    const userId = stripeSubscription.metadata?.userId || '';
    const priceId = getStripePriceIdFromSubscription(stripeSubscription);
    const stripeStatus = eventType === 'customer.subscription.deleted'
        ? 'canceled'
        : stripeSubscription.status;
    const normalizedStatus = normalizeStripeSubscriptionStatus(stripeStatus);
    const now = new Date().toISOString();

    return updateDb((db) => {
        let subscription = db.subscriptions.find((candidate) => (
            stripeSubscriptionId &&
            candidate.billingSubscriptionId === stripeSubscriptionId
        ));

        if (!subscription && customerId) {
            subscription = db.subscriptions.find((candidate) => candidate.billingCustomerId === customerId);
        }

        let user = subscription
            ? db.users.find((candidate) => candidate.id === subscription.userId)
            : null;

        if (!user && userId) {
            user = db.users.find((candidate) => candidate.id === userId);
            if (user) {
                subscription = getUserSubscription(db, user);
            }
        }

        if (!user || !subscription) {
            logError('stripe_subscription_unknown_account', {
                eventId,
                eventType,
                stripeSubscriptionId,
                customerId,
                userId
            });
            return {
                updated: false,
                reason: 'account_not_found'
            };
        }

        const shouldDowngrade = ['canceled', 'incomplete_expired', 'unpaid'].includes(normalizedStatus);
        const nextPlan = shouldDowngrade ? 'starter' : 'pro';
        const nextStatus = shouldDowngrade ? 'active' : normalizedStatus;
        subscription.plan = nextPlan;
        subscription.status = nextStatus;
        subscription.billingProvider = 'stripe';
        subscription.billingCustomerId = customerId || subscription.billingCustomerId || null;
        subscription.billingSubscriptionId = stripeSubscriptionId || subscription.billingSubscriptionId || null;
        subscription.billingPriceId = priceId || subscription.billingPriceId || stripeProPriceId || null;
        subscription.currentPeriodStart = toIsoFromStripeTimestamp(
            stripeSubscription.current_period_start ||
            stripeSubscription.items?.data?.[0]?.current_period_start
        ) || subscription.currentPeriodStart || null;
        subscription.currentPeriodEnd = toIsoFromStripeTimestamp(
            stripeSubscription.current_period_end ||
            stripeSubscription.items?.data?.[0]?.current_period_end
        ) || subscription.currentPeriodEnd || null;
        subscription.updatedAt = now;
        user.plan = nextPlan;
        user.monthlyGenerationLimit = getPlanConfig(nextPlan).monthlyGenerationLimit;
        user.updatedAt = now;

        return {
            updated: true,
            userId: user.id,
            subscriptionId: subscription.id,
            plan: subscription.plan,
            status: subscription.status
        };
    });
}

function normalizeStripeSubscriptionStatus(status) {
    if (['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'paused', 'unpaid'].includes(status)) {
        return status;
    }
    return 'incomplete';
}

function getStripeObjectId(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (value && typeof value.id === 'string') {
        return value.id;
    }
    return null;
}

function getStripePriceIdFromSubscription(stripeSubscription) {
    const item = stripeSubscription.items?.data?.[0] || stripeSubscription.items?.[0] || null;
    return getStripeObjectId(item?.price);
}

function toIsoFromStripeTimestamp(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return new Date(value * 1000).toISOString();
}

async function getAdminSummary() {
    const db = await getDb();
    const currentMonth = currentMonthKey();
    const jobsByStatus = countBy(db.generationJobs, (job) => job.status || 'unknown');
    const usageThisMonth = db.providerUsageEvents.filter((event) => event.month === currentMonth);
    const usageByProvider = countBy(usageThisMonth, (event) => event.provider || 'unknown');
    const usageByModel = countBy(usageThisMonth, (event) => event.model || 'unknown');
    const usageByPlan = countBy(usageThisMonth, (event) => event.plan || 'unknown');
    const contentPolicyByCode = countBy(db.contentPolicyEvents, (event) => event.policyCode || 'unknown');
    const abuseReportsByStatus = countBy(db.abuseReports, (report) => report.status || 'open');
    const emailDeliveryByType = countBy(db.emailDeliveryEvents, (event) => event.type || 'unknown');
    const emailDeliveryByStatus = countBy(db.emailDeliveryEvents, (event) => event.status || 'unknown');
    const emailDeliveryByProvider = countBy(db.emailDeliveryEvents, (event) => event.provider || 'unknown');
    const failedJobs = db.generationJobs
        .filter((job) => job.status === 'failed')
        .sort((a, b) => Date.parse(b.completedAt || b.createdAt) - Date.parse(a.completedAt || a.createdAt))
        .slice(0, 10)
        .map(formatAdminJob);

    return {
        totals: {
            users: db.users.length,
            subscriptions: db.subscriptions.length,
            generationJobs: db.generationJobs.length,
            imageAssets: db.imageAssets.length,
            galleryItems: db.userGalleryItems.length,
            providerUsageEvents: db.providerUsageEvents.length,
            contentPolicyEvents: db.contentPolicyEvents.length,
            abuseReports: db.abuseReports.length,
            emailDeliveryEvents: db.emailDeliveryEvents.length
        },
        jobsByStatus,
        usage: {
            month: currentMonth,
            totalEvents: usageThisMonth.length,
            byProvider: usageByProvider,
            byModel: usageByModel,
            byPlan: usageByPlan
        },
        contentPolicy: {
            byCode: contentPolicyByCode
        },
        abuseReports: {
            byStatus: abuseReportsByStatus
        },
        emailDelivery: {
            byType: emailDeliveryByType,
            byStatus: emailDeliveryByStatus,
            byProvider: emailDeliveryByProvider
        },
        recentFailedJobs: failedJobs
    };
}

async function getAdminJobs(url) {
    const db = await getDb();
    const status = url.searchParams.get('status');
    const limit = clampNumber(Number(url.searchParams.get('limit') || 25), 1, 100);
    return db.generationJobs
        .filter((job) => !status || job.status === status)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, limit)
        .map(formatAdminJob);
}

async function getAdminAbuseReports(url) {
    const db = await getDb();
    const status = url.searchParams.get('status');
    const limit = clampNumber(Number(url.searchParams.get('limit') || 25), 1, 100);
    return db.abuseReports
        .filter((report) => !status || report.status === status)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, limit)
        .map(formatAdminAbuseReport);
}

async function getAdminContentPolicyEvents(url) {
    const db = await getDb();
    const surface = url.searchParams.get('surface');
    const limit = clampNumber(Number(url.searchParams.get('limit') || 25), 1, 100);
    return db.contentPolicyEvents
        .filter((event) => !surface || event.surface === surface)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, limit)
        .map(formatAdminContentPolicyEvent);
}

function formatAdminJob(job) {
    return {
        id: job.id,
        userId: job.userId,
        status: job.status,
        provider: job.provider,
        model: job.model,
        aspectRatio: job.aspectRatio,
        quality: job.quality,
        outputFormat: job.outputFormat,
        plan: job.plan || null,
        subscriptionId: job.subscriptionId || null,
        outputAssetIds: job.outputAssetIds || [],
        providerRequestId: job.providerRequestId || null,
        providerUsageJson: job.providerUsageJson || null,
        costEstimateCents: job.costEstimateCents,
        errorCode: job.errorCode,
        safeErrorMessage: job.safeErrorMessage,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt
    };
}

function formatAdminAbuseReport(report) {
    return {
        id: report.id,
        reporterUserId: report.reporterUserId,
        targetType: report.targetType,
        targetId: report.targetId,
        reason: report.reason,
        details: report.details,
        status: report.status,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt
    };
}

function formatAdminContentPolicyEvent(event) {
    return {
        id: event.id,
        userId: event.userId,
        surface: event.surface,
        policyCode: event.policyCode,
        tags: event.tags,
        textExcerpt: event.textExcerpt,
        context: event.context,
        createdAt: event.createdAt
    };
}

function countBy(items, keyFn) {
    return items.reduce((counts, item) => {
        const key = keyFn(item);
        counts[key] = (counts[key] || 0) + 1;
        return counts;
    }, {});
}

function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.min(max, Math.max(min, Math.floor(value)));
}

function createSessionRecord(userId) {
    const now = Date.now();
    const token = randomBytes(32).toString('hex');
    return {
        token,
        record: {
            tokenHash: hashSessionToken(token),
            userId,
            createdAt: new Date(now).toISOString(),
            expiresAt: new Date(now + sessionMaxAgeSeconds * 1000).toISOString()
        }
    };
}

function createAuthTokenRecord(userId, type, maxAgeMs, timestamp = new Date().toISOString()) {
    const createdAt = Date.parse(timestamp);
    const token = randomBytes(32).toString('base64url');
    return {
        token,
        record: {
            id: randomUUID(),
            userId,
            type,
            tokenHash: hashAuthToken(token),
            createdAt: timestamp,
            expiresAt: new Date(createdAt + maxAgeMs).toISOString(),
            consumedAt: null
        }
    };
}

function hashSessionToken(token) {
    if (!sessionSecret) {
        throw new Error('SESSION_SECRET is required to create or verify sessions.');
    }

    return createHmac('sha256', sessionSecret).update(String(token)).digest('hex');
}

function hashAuthToken(token) {
    if (!sessionSecret) {
        throw new Error('SESSION_SECRET is required to create or verify auth tokens.');
    }

    return createHmac('sha256', `${sessionSecret}:auth-token`).update(String(token)).digest('hex');
}

function normalizeAuthToken(token) {
    if (typeof token !== 'string') {
        throw new PublicApiError('Auth token is required.', 400, 'invalid_auth_token');
    }

    const normalized = token.trim();
    if (!/^[a-zA-Z0-9_-]{32,160}$/.test(normalized)) {
        throw new PublicApiError('Auth token is invalid.', 400, 'invalid_auth_token');
    }

    return normalized;
}

function findActiveAuthToken(db, type, token, now = new Date().toISOString()) {
    const tokenHash = hashAuthToken(token);
    return db.authTokens.find((record) => (
        record.type === type &&
        !record.consumedAt &&
        Date.parse(record.expiresAt) > Date.parse(now) &&
        constantTimeStringEqual(record.tokenHash, tokenHash)
    ));
}

function consumeActiveAuthTokens(db, userId, type, timestamp = new Date().toISOString()) {
    for (const token of db.authTokens) {
        if (token.userId === userId && token.type === type && !token.consumedAt) {
            token.consumedAt = timestamp;
        }
    }
}

function debugAuthTokenPayload(token) {
    if (!authTokenDebug || !token) {
        return {};
    }

    return {
        debug: {
            authToken: token
        }
    };
}

function assertEmailVerifiedIfRequired(user) {
    if (!emailVerificationRequired || user.emailVerifiedAt) {
        return;
    }

    throw new PublicApiError('Verify your email before using this feature.', 403, 'email_unverified');
}

function normalizeEmail(email) {
    if (typeof email !== 'string') {
        throw new PublicApiError('Email is required.', 400, 'invalid_email');
    }

    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        throw new PublicApiError('Enter a valid email address.', 400, 'invalid_email');
    }

    return normalized;
}

function normalizePassword(password) {
    if (typeof password !== 'string' || password.length < 8) {
        throw new PublicApiError('Password must be at least 8 characters.', 400, 'invalid_password');
    }

    if (password.length > 200) {
        throw new PublicApiError('Password is too long.', 400, 'invalid_password');
    }

    return password;
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
    return {
        salt,
        hash: pbkdf2Sync(password, salt, passwordIterations, 32, 'sha256').toString('hex')
    };
}

function verifyPassword(password, user) {
    const candidate = hashPassword(password, user.passwordSalt).hash;
    const candidateBuffer = Buffer.from(candidate, 'hex');
    const storedBuffer = Buffer.from(user.passwordHash, 'hex');

    return candidateBuffer.length === storedBuffer.length && timingSafeEqual(candidateBuffer, storedBuffer);
}

function constantTimeStringEqual(a, b) {
    if (!a || !b) {
        return false;
    }

    const aBuffer = Buffer.from(String(a));
    const bBuffer = Buffer.from(String(b));
    if (aBuffer.length !== bBuffer.length) {
        return false;
    }

    return timingSafeEqual(aBuffer, bBuffer);
}

function buildSessionCookie(token) {
    const secure = isProduction ? '; Secure' : '';
    return `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionMaxAgeSeconds}${secure}`;
}

function clearSessionCookie() {
    const secure = isProduction ? '; Secure' : '';
    return `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function getCookie(req, name) {
    const cookieHeader = req.headers.cookie || '';
    const cookies = cookieHeader.split(';').map((item) => item.trim()).filter(Boolean);
    const prefix = `${name}=`;
    const cookie = cookies.find((item) => item.startsWith(prefix));
    return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}

async function assertCanGenerate(userId, request) {
    const db = await getDb();
    const user = db.users.find((candidate) => candidate.id === userId);
    if (!user) {
        throw new PublicApiError('Sign in is required.', 401, 'auth_required');
    }

    const entitlements = getUserEntitlements(db, user);
    if (!activeBillingStatuses.has(entitlements.subscription.status)) {
        throw new PublicApiError('Your subscription is not active.', 402, 'subscription_inactive');
    }

    if (!entitlements.allowedProviders.includes(request.provider) || !entitlements.allowedModels.includes(request.model)) {
        throw new PublicApiError('This image model is not available on your current plan.', 403, 'plan_model_not_allowed', {
            plan: entitlements.plan,
            provider: request.provider,
            model: request.model
        });
    }

    const used = getMonthlyGenerationCount(db, userId);
    if (used >= entitlements.monthlyGenerationLimit) {
        throw new PublicApiError('Monthly generation quota exceeded.', 402, 'quota_exceeded');
    }

    return entitlements;
}

function getMonthlyGenerationCount(db, userId) {
    const month = currentMonthKey();
    return db.providerUsageEvents.filter((event) => (
        event.userId === userId &&
        event.type === 'image_generation' &&
        event.month === month
    )).length;
}

function currentMonthKey(date = new Date()) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function createGenerationJob(userId, request) {
    const now = new Date().toISOString();
    const job = {
        id: randomUUID(),
        userId,
        status: 'running',
        provider: request.provider,
        model: request.model,
        prompt: request.prompt,
        aspectRatio: request.aspectRatio,
        quality: request.quality,
        outputFormat: request.outputFormat,
        plan: request.plan,
        subscriptionId: request.subscriptionId,
        inputAssetIds: [],
        outputAssetIds: [],
        idempotencyKey: request.idempotencyKey || null,
        providerRequestId: null,
        providerUsageJson: null,
        costEstimateCents: null,
        errorCode: null,
        safeErrorMessage: null,
        rawErrorJson: null,
        createdAt: now,
        startedAt: now,
        completedAt: null
    };

    await updateDb((db) => {
        db.generationJobs.push(job);
    });

    return job;
}

async function getIdempotentGenerationResult(userId, idempotencyKey) {
    const db = await getDb();
    const job = db.generationJobs.find((candidate) => (
        candidate.userId === userId &&
        candidate.idempotencyKey === idempotencyKey
    ));

    if (!job) {
        return null;
    }

    if (job.status === 'completed' && job.outputAssetIds?.[0]) {
        return {
            imageUrl: assetUrl(job.outputAssetIds[0]),
            imageAssetId: job.outputAssetIds[0],
            generationJobId: job.id,
            provider: job.provider,
            model: job.model,
            meta: {
                ...(job.providerUsageJson || {}),
                idempotentReplay: true
            }
        };
    }

    if (job.status === 'running') {
        throw new PublicApiError('A generation with this idempotency key is still running.', 409, 'idempotency_in_progress');
    }

    return null;
}

async function completeGenerationJob(jobId, result) {
    const now = new Date().toISOString();
    await updateDb((db) => {
        const job = db.generationJobs.find((candidate) => candidate.id === jobId);
        if (!job) return;

        job.status = 'completed';
        job.outputAssetIds = result.outputAssetIds || [];
        job.provider = result.provider;
        job.model = result.model;
        job.providerUsageJson = result.meta || null;
        job.completedAt = now;
    });
}

async function failGenerationJob(jobId, error) {
    const now = new Date().toISOString();
    await updateDb((db) => {
        const job = db.generationJobs.find((candidate) => candidate.id === jobId);
        if (!job) return;

        job.status = 'failed';
        job.errorCode = error instanceof PublicApiError ? error.code : 'internal_error';
        job.safeErrorMessage = error instanceof PublicApiError ? error.message : 'Generation failed.';
        job.rawErrorJson = serializeErrorDetails(error);
        job.completedAt = now;
    });
}

async function createUsageEvent(userId, event) {
    const now = new Date();
    await updateDb((db) => {
        db.providerUsageEvents.push({
            id: randomUUID(),
            userId,
            type: 'image_generation',
            month: currentMonthKey(now),
            plan: event.plan,
            subscriptionId: event.subscriptionId,
            provider: event.provider,
            model: event.model,
            quantity: event.quantity,
            costEstimateCents: event.costEstimateCents,
            generationJobId: event.generationJobId,
            createdAt: now.toISOString()
        });
    });
}

function serializeErrorDetails(error) {
    if (error instanceof PublicApiError) {
        return error.details || null;
    }

    return {
        message: error?.message || 'Unknown error'
    };
}

async function storeDataUrlAsset(userId, dataUrl, metadata = {}) {
    const parsed = parseImageDataUrl(dataUrl);
    const now = new Date().toISOString();
    const assetId = randomUUID();
    const ext = extensionForMimeType(parsed.mimeType);
    const storageKey = buildAssetStorageKey(userId, assetId, ext);

    await writeAssetObject(storageKey, parsed.buffer, parsed.mimeType);

    const asset = {
        id: assetId,
        userId,
        kind: metadata.kind || 'image',
        mimeType: parsed.mimeType,
        sizeBytes: parsed.buffer.length,
        storageDriver: assetStorageDriver,
        storageKey,
        relativePath: assetStorageDriver === 'local' ? storageKey : null,
        metadata,
        createdAt: now
    };

    await updateDb((db) => {
        db.imageAssets.push(asset);
    });

    return asset;
}

function parseImageDataUrl(dataUrl) {
    if (typeof dataUrl !== 'string') {
        throw new PublicApiError('Image data is required.', 400, 'invalid_image');
    }

    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/);
    if (!match) {
        throw new PublicApiError('Image must be a PNG, JPEG, or WebP data URL.', 400, 'invalid_image');
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) {
        throw new PublicApiError('Image data is empty.', 400, 'invalid_image');
    }

    const maxBytes = 25 * 1024 * 1024;
    if (buffer.length > maxBytes) {
        throw new PublicApiError('Image exceeds the 25MB upload limit.', 413, 'image_too_large');
    }

    return {
        mimeType: match[1].toLowerCase(),
        buffer
    };
}

function extensionForMimeType(mimeType) {
    if (mimeType === 'image/jpeg') return 'jpg';
    if (mimeType === 'image/webp') return 'webp';
    return 'png';
}

async function ensureAssetStorage() {
    if (assetStorageDriver === 'local') {
        await mkdir(assetRoot, { recursive: true });
    }
}

function normalizeAssetStorageDriver(driver) {
    const normalized = String(driver || 'local').trim().toLowerCase();
    if (['local', 's3'].includes(normalized)) {
        return normalized;
    }
    throw new Error(`Unsupported ASSET_STORAGE_DRIVER: ${driver}`);
}

function normalizeContentPolicyMode(mode) {
    const normalized = String(mode || 'local').trim().toLowerCase();
    if (['local', 'off'].includes(normalized)) {
        return normalized;
    }
    throw new Error(`Unsupported CONTENT_POLICY_MODE: ${mode}`);
}

function normalizeStoragePrefix(prefix) {
    return String(prefix || '')
        .replace(/\\/g, '/')
        .split('/')
        .map((part) => sanitizeStorageSegment(part))
        .filter(Boolean)
        .join('/');
}

function sanitizeStorageSegment(value) {
    return String(value || '')
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 128);
}

function buildAssetStorageKey(userId, assetId, ext) {
    return [
        assetStoragePrefix,
        sanitizeStorageSegment(userId),
        `${sanitizeStorageSegment(assetId)}.${sanitizeStorageSegment(ext)}`
    ].filter(Boolean).join('/');
}

function buildReadinessStorageKey() {
    return [
        assetStoragePrefix,
        'readiness',
        `${process.pid}-${Date.now()}-${randomUUID()}.tmp`
    ].filter(Boolean).join('/');
}

async function writeAssetObject(storageKey, buffer, contentType) {
    if (assetStorageDriver === 'local') {
        const filePath = getSafeLocalStoragePath(storageKey);
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, buffer);
        return;
    }

    await getS3Client().send(new PutObjectCommand({
        Bucket: assetStorageBucket,
        Key: storageKey,
        Body: buffer,
        ContentType: contentType
    }));
}

async function readAssetObject(asset) {
    const driver = asset.storageDriver || 'local';
    const storageKey = asset.storageKey || asset.relativePath;

    if (!storageKey) {
        throw new PublicApiError('Asset storage record is missing.', 500, 'asset_storage_missing');
    }

    if (driver === 'local') {
        return {
            body: await readFile(getSafeLocalStoragePath(storageKey)),
            mimeType: asset.mimeType
        };
    }

    if (driver === 's3') {
        const response = await getS3Client().send(new GetObjectCommand({
            Bucket: assetStorageBucket,
            Key: storageKey
        }));

        return {
            body: await streamToBuffer(response.Body),
            mimeType: response.ContentType || asset.mimeType
        };
    }

    throw new PublicApiError('Asset storage driver is unsupported.', 500, 'asset_storage_driver_unsupported');
}

async function deleteAssetObject(storageKey) {
    if (assetStorageDriver === 'local') {
        await unlink(getSafeLocalStoragePath(storageKey));
        return;
    }

    await getS3Client().send(new DeleteObjectCommand({
        Bucket: assetStorageBucket,
        Key: storageKey
    }));
}

function getSafeLocalStoragePath(storageKey) {
    const normalizedKey = String(storageKey || '').replace(/\\/g, '/');
    if (!normalizedKey || path.isAbsolute(normalizedKey) || normalizedKey.split('/').includes('..')) {
        throw new PublicApiError('Invalid asset storage key.', 500, 'asset_storage_key_invalid');
    }

    const filePath = path.resolve(dataRoot, normalizedKey);
    if (filePath !== dataRoot && !filePath.startsWith(`${dataRoot}${path.sep}`)) {
        throw new PublicApiError('Invalid asset storage key.', 500, 'asset_storage_key_invalid');
    }

    return filePath;
}

function getS3Client() {
    if (!isS3AssetStorageConfigured()) {
        throw new PublicApiError('S3-compatible asset storage is not configured.', 503, 'asset_storage_not_configured');
    }

    if (!s3Client) {
        s3Client = new S3Client({
            region: assetStorageRegion,
            endpoint: assetStorageEndpoint || undefined,
            forcePathStyle: assetStorageForcePathStyle,
            credentials: {
                accessKeyId: assetStorageAccessKeyId,
                secretAccessKey: assetStorageSecretAccessKey
            }
        });
    }

    return s3Client;
}

function isS3AssetStorageConfigured() {
    return Boolean(
        assetStorageBucket &&
        assetStorageRegion &&
        assetStorageAccessKeyId &&
        assetStorageSecretAccessKey
    );
}

async function streamToBuffer(stream) {
    if (!stream) {
        return Buffer.alloc(0);
    }

    if (Buffer.isBuffer(stream)) {
        return stream;
    }

    if (typeof stream.transformToByteArray === 'function') {
        return Buffer.from(await stream.transformToByteArray());
    }

    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

function assetUrl(assetId) {
    return `/api/assets/${encodeURIComponent(assetId)}`;
}

async function serveUserAsset(res, user, assetId) {
    const asset = await getOwnedAsset(user.id, assetId);
    const object = await readAssetObject(asset);
    sendBuffer(res, object.body, object.mimeType, 'private, no-store');
}

async function getOwnedAsset(userId, assetId) {
    if (!assetId) {
        throw new PublicApiError('Asset not found.', 404, 'asset_not_found');
    }

    const db = await getDb();
    const asset = db.imageAssets.find((candidate) => candidate.id === assetId && candidate.userId === userId);
    if (!asset) {
        throw new PublicApiError('Asset not found.', 404, 'asset_not_found');
    }

    return asset;
}

async function getGalleryItems(userId) {
    const db = await getDb();
    return db.userGalleryItems
        .filter((item) => item.userId === userId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map(formatGalleryItem);
}

async function createGalleryItem(userId, body) {
    await assertContentPolicyAllowed(userId, collectGalleryPolicyText(body), {
        surface: 'gallery_save'
    });

    const now = new Date().toISOString();
    const originalAssetId = await resolveImageReference(userId, body?.originalImage, {
        kind: 'gallery-original',
        source: 'gallery-save'
    });
    const finalAsset = await storeDataUrlAsset(userId, body?.finalImage, {
        kind: 'gallery-final',
        source: 'gallery-save'
    });

    const item = {
        id: randomUUID(),
        userId,
        originalAssetId,
        finalAssetId: finalAsset.id,
        prompt: typeof body?.prompt === 'string' ? body.prompt.slice(0, 5000) : '',
        stylePreset: typeof body?.stylePreset === 'string' ? body.stylePreset.slice(0, 120) : 'None',
        modelUsed: typeof body?.modelUsed === 'string' ? body.modelUsed.slice(0, 200) : 'unknown',
        overlays: sanitizeJsonObject(body?.overlays),
        filters: sanitizeJsonObject(body?.filters),
        createdAt: now,
        updatedAt: now
    };

    await updateDb((db) => {
        db.userGalleryItems.push(item);
    });

    return formatGalleryItem(item);
}

async function resolveImageReference(userId, image, metadata) {
    if (typeof image !== 'string' || !image.trim()) {
        throw new PublicApiError('Original image is required.', 400, 'invalid_image');
    }

    const assetId = extractAssetIdFromUrl(image);
    if (assetId) {
        await getOwnedAsset(userId, assetId);
        return assetId;
    }

    const asset = await storeDataUrlAsset(userId, image, metadata);
    return asset.id;
}

function extractAssetIdFromUrl(value) {
    try {
        const url = new URL(value, 'http://local');
        const match = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
        return match ? decodeURIComponent(match[1]) : null;
    } catch {
        return null;
    }
}

async function deleteGalleryItem(userId, itemId) {
    await updateDb((db) => {
        const index = db.userGalleryItems.findIndex((item) => item.id === itemId && item.userId === userId);
        if (index === -1) {
            throw new PublicApiError('Gallery item not found.', 404, 'gallery_item_not_found');
        }
        db.userGalleryItems.splice(index, 1);
    });
}

function formatGalleryItem(item) {
    return {
        id: item.id,
        originalImage: assetUrl(item.originalAssetId),
        finalImage: assetUrl(item.finalAssetId),
        prompt: item.prompt,
        stylePreset: item.stylePreset,
        modelUsed: item.modelUsed,
        overlays: item.overlays,
        filters: item.filters,
        timestamp: Date.parse(item.createdAt),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
    };
}

function sanitizeJsonObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return JSON.parse(JSON.stringify(value));
}

async function assertContentPolicyAllowed(userId, text, context = {}) {
    if (contentPolicyMode === 'off') {
        return;
    }

    const normalized = normalizePrompt(text);
    const result = evaluateContentPolicy(normalized);
    if (result.allowed) {
        return;
    }

    await recordContentPolicyEvent(userId, {
        surface: context.surface || 'unknown',
        policyCode: result.policyCode,
        tags: result.tags,
        textExcerpt: normalized.slice(0, 500),
        context: sanitizeJsonObject({
            ...context,
            provider: context.provider || null,
            model: context.model || null
        })
    });

    throw new PublicApiError('This request was blocked by the content policy.', 400, 'content_policy_blocked', {
        policyCode: result.policyCode,
        tags: result.tags
    });
}

function evaluateContentPolicy(text) {
    const normalized = String(text || '').toLowerCase();
    const rules = [
        {
            policyCode: 'sexual_minors',
            tags: ['sexual', 'minor'],
            matches: () => hasAny(normalized, [
                'minor', 'underage', 'child', 'children', 'kid', 'teen', 'teenager',
                'schoolgirl', 'schoolboy', 'toddler', 'baby'
            ]) && hasAny(normalized, [
                'nude', 'naked', 'porn', 'sexual', 'sex', 'erotic', 'explicit', 'lingerie'
            ])
        },
        {
            policyCode: 'explicit_sexual_content',
            tags: ['sexual'],
            matches: () => hasAny(normalized, [
                'porn', 'pornographic', 'hardcore', 'sexual intercourse', 'explicit sex',
                'erotic nude', 'nude photo', 'naked body', 'genitals'
            ])
        },
        {
            policyCode: 'nonconsensual_sexual_content',
            tags: ['sexual', 'nonconsensual'],
            matches: () => hasAny(normalized, [
                'rape', 'non-consensual', 'nonconsensual', 'sexual assault'
            ])
        },
        {
            policyCode: 'graphic_violence',
            tags: ['violence', 'graphic'],
            matches: () => hasAny(normalized, [
                'gore', 'gory', 'dismembered', 'dismemberment', 'decapitated',
                'beheading', 'bloodbath', 'mutilated corpse', 'graphic violence'
            ])
        },
        {
            policyCode: 'self_harm',
            tags: ['self-harm'],
            matches: () => hasAny(normalized, [
                'suicide instructions', 'how to self harm', 'self-harm tutorial',
                'cutting wrists', 'hang myself'
            ])
        }
    ];

    const rule = rules.find((candidate) => candidate.matches());
    if (!rule) {
        return {
            allowed: true,
            policyCode: null,
            tags: []
        };
    }

    return {
        allowed: false,
        policyCode: rule.policyCode,
        tags: rule.tags
    };
}

function hasAny(text, terms) {
    return terms.some((term) => text.includes(term));
}

async function recordContentPolicyEvent(userId, event) {
    const now = new Date().toISOString();
    await updateDb((db) => {
        db.contentPolicyEvents.push({
            id: randomUUID(),
            userId,
            surface: event.surface,
            policyCode: event.policyCode,
            tags: event.tags,
            textExcerpt: event.textExcerpt,
            context: event.context,
            createdAt: now
        });
    });
}

function collectGalleryPolicyText(body) {
    const parts = [];
    if (typeof body?.prompt === 'string') {
        parts.push(body.prompt);
    }

    const overlays = body?.overlays;
    if (overlays && typeof overlays === 'object' && !Array.isArray(overlays)) {
        for (const overlay of Object.values(overlays)) {
            if (overlay && typeof overlay.text === 'string') {
                parts.push(overlay.text);
            }
        }
    }

    return parts.join('\n').trim() || 'gallery save';
}

async function createAbuseReport(reporterUserId, body) {
    const targetType = normalizeReportTargetType(body?.targetType);
    const targetId = normalizeOptionalId(body?.targetId);
    await assertReportTargetAccessible(reporterUserId, targetType, targetId);

    const now = new Date().toISOString();
    const report = {
        id: randomUUID(),
        reporterUserId,
        targetType,
        targetId,
        reason: normalizeReportReason(body?.reason),
        details: normalizeReportDetails(body?.details),
        status: 'open',
        createdAt: now,
        updatedAt: now
    };

    await updateDb((db) => {
        db.abuseReports.push(report);
    });

    return {
        id: report.id,
        targetType: report.targetType,
        targetId: report.targetId,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt
    };
}

function normalizeReportTargetType(targetType) {
    if (['gallery_item', 'image_asset', 'generation_job', 'other'].includes(targetType)) {
        return targetType;
    }
    throw new PublicApiError('Unsupported report target type.', 400, 'invalid_report_target');
}

function normalizeOptionalId(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const normalized = String(value).trim();
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(normalized)) {
        throw new PublicApiError('Invalid report target id.', 400, 'invalid_report_target');
    }
    return normalized;
}

async function assertReportTargetAccessible(userId, targetType, targetId) {
    if (targetType === 'other') {
        return;
    }

    if (!targetId) {
        throw new PublicApiError('Report target id is required.', 400, 'invalid_report_target');
    }

    const db = await getDb();
    const exists = (
        (targetType === 'gallery_item' && db.userGalleryItems.some((item) => item.id === targetId && item.userId === userId)) ||
        (targetType === 'image_asset' && db.imageAssets.some((asset) => asset.id === targetId && asset.userId === userId)) ||
        (targetType === 'generation_job' && db.generationJobs.some((job) => job.id === targetId && job.userId === userId))
    );

    if (!exists) {
        throw new PublicApiError('Report target not found.', 404, 'report_target_not_found');
    }
}

function normalizeReportReason(reason) {
    if (['unsafe_content', 'copyright', 'privacy', 'other'].includes(reason)) {
        return reason;
    }
    return 'other';
}

function normalizeReportDetails(details) {
    if (typeof details !== 'string') {
        return '';
    }
    return details.trim().slice(0, 2000);
}

function getProviderStatus() {
    return Object.fromEntries(
        Object.entries(PROVIDERS).map(([key, config]) => [
            key,
            {
                label: config.label,
                configured: config.configured(),
                models: config.models
            }
        ])
    );
}

async function getReadinessStatus() {
    const checks = {
        dataStore: await checkDataStoreReadiness(),
        assetStorage: await checkAssetStorageReadiness(),
        billing: checkBillingReadiness(),
        rateLimiting: await checkRateLimitReadiness(),
        emailDelivery: checkEmailDeliveryReadiness(),
        providers: checkProviderReadiness()
    };
    const ready = Object.values(checks).every((check) => check.ok);

    return {
        ready,
        checks,
        timestamp: new Date().toISOString()
    };
}

async function checkDataStoreReadiness() {
    try {
        const db = await getDb();
        const requiredCollections = [
            'users',
            'subscriptions',
            'sessions',
            'authTokens',
            'generationJobs',
            'imageAssets',
            'providerUsageEvents',
            'userGalleryItems',
            'contentPolicyEvents',
            'abuseReports',
            'emailDeliveryEvents'
        ];
        const missingCollections = requiredCollections.filter((key) => !Array.isArray(db[key]));

        return {
            ok: missingCollections.length === 0,
            details: {
                path: dbPath,
                missingCollections
            }
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

async function checkAssetStorageReadiness() {
    const probeKey = buildReadinessStorageKey();
    try {
        await writeAssetObject(probeKey, Buffer.from('ok'), 'text/plain');
        await deleteAssetObject(probeKey);

        return {
            ok: true,
            details: {
                driver: assetStorageDriver,
                path: assetStorageDriver === 'local' ? assetRoot : null,
                bucket: assetStorageDriver === 's3' ? assetStorageBucket : null,
                prefix: assetStoragePrefix,
                writable: true
            }
        };
    } catch (error) {
        try {
            await deleteAssetObject(probeKey);
        } catch {
            // Ignore cleanup failures for a failed readiness probe.
        }

        return {
            ok: false,
            error: error.message
        };
    }
}

function checkBillingReadiness() {
    if (!stripeRequired) {
        return {
            ok: true,
            details: {
                provider: billingProvider,
                stripeRequired: false,
                checkoutConfigured: isStripeCheckoutConfigured(),
                webhookConfigured: isStripeWebhookConfigured()
            }
        };
    }

    return {
        ok: isStripeCheckoutConfigured() && isStripeWebhookConfigured(),
        details: {
            provider: billingProvider,
            stripeRequired: true,
            checkoutConfigured: isStripeCheckoutConfigured(),
            webhookConfigured: isStripeWebhookConfigured(),
            apiVersion: STRIPE_API_VERSION
        }
    };
}

async function checkRateLimitReadiness() {
    if (rateLimitDriver === 'memory') {
        return {
            ok: true,
            details: {
                driver: 'memory',
                distributed: false
            }
        };
    }

    if (!redisUrl) {
        return {
            ok: false,
            error: 'REDIS_URL is required when RATE_LIMIT_DRIVER=redis.',
            details: {
                driver: 'redis',
                distributed: true
            }
        };
    }

    try {
        const client = await getRedisRateLimitClient();
        const response = await client.sendCommand(['PING']);
        return {
            ok: response === 'PONG',
            details: {
                driver: 'redis',
                distributed: true,
                ping: response
            }
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message,
            details: {
                driver: 'redis',
                distributed: true
            }
        };
    }
}

function checkEmailDeliveryReadiness() {
    const resendConfigured = isResendEmailDeliveryConfigured();
    const productionReady = isEmailDeliveryProductionReady();
    const requiredForProduction = isProduction && emailVerificationRequired;
    const ok = emailDeliveryDriver === 'resend'
        ? resendConfigured
        : !requiredForProduction || productionReady;

    return {
        ok,
        details: {
            driver: emailDeliveryDriver,
            provider: emailDeliveryDriver,
            configured: emailDeliveryDriver === 'resend' ? resendConfigured : true,
            productionReady,
            emailVerificationRequired,
            fromConfigured: Boolean(emailFrom),
            appBaseUrlConfigured: Boolean(appBaseUrl)
        },
        ...(!ok ? { error: 'Production-ready email delivery is not configured.' } : {})
    };
}

function checkProviderReadiness() {
    const providers = getProviderStatus();
    const missingRequired = requiredProviders.filter((provider) => !providers[provider]?.configured);

    return {
        ok: missingRequired.length === 0,
        details: {
            requiredProviders,
            missingRequired,
            configuredProviders: Object.entries(providers)
                .filter(([, status]) => status.configured)
                .map(([provider]) => provider)
        }
    };
}

function parseRequiredProviders(value) {
    return value
        .split(',')
        .map((provider) => provider.trim().toLowerCase())
        .filter((provider) => provider in PROVIDERS);
}

async function enhancePromptWithGemini(body) {
    requireProvider('gemini');
    const prompt = normalizePrompt(body?.prompt);
    const stylePreset = typeof body?.stylePreset === 'string' ? body.stylePreset.slice(0, 80) : 'None';

    const systemInstruction = `You are a professional AI image generation prompt engineer.
Take a simple raw prompt and expand it into a detailed, descriptive, visually strong prompt for image generation.
Apply the visual style preset: "${stylePreset}".
Describe subject, layout, composition, mood, color palette, lighting, medium, texture, and rendering style.
Output only the final enhanced prompt. Do not include intro text, quotes, code fences, or outro. Keep it between 60 and 120 words.`;

    const data = await postJsonToProvider(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent`,
        {
            headers: {
                'x-goog-api-key': process.env.GEMINI_API_KEY,
                'Content-Type': 'application/json'
            },
            body: {
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: `Raw prompt: "${prompt}"` }]
                    }
                ],
                systemInstruction: {
                    parts: [{ text: systemInstruction }]
                },
                generationConfig: {
                    temperature: 0.8,
                    maxOutputTokens: 250
                }
            },
            publicMessage: 'Gemini prompt enhancement failed.'
        }
    );

    const enhancedPrompt = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!enhancedPrompt) {
        throw new PublicApiError('Gemini did not return an enhanced prompt.', 502, 'provider_empty_response', data);
    }

    return enhancedPrompt;
}

function normalizeGenerationRequest(body) {
    const prompt = normalizePrompt(body?.prompt);
    const provider = normalizeProvider(body?.provider || inferProviderFromModel(body?.model));
    const model = normalizeModel(provider, body?.model);
    const aspectRatio = normalizeAspectRatio(body?.aspectRatio);
    const quality = normalizeQuality(body?.quality);
    const outputFormat = normalizeOutputFormat(body?.outputFormat);

    return {
        prompt,
        provider,
        model,
        aspectRatio,
        quality,
        outputFormat
    };
}

async function createGeneration(user, body, options = {}) {
    const request = normalizeGenerationRequest(body);
    request.idempotencyKey = normalizeIdempotencyKey(options.idempotencyKey);
    const signal = options.signal;
    throwIfAborted(signal);
    await assertContentPolicyAllowed(user.id, request.prompt, {
        surface: 'generation',
        provider: request.provider,
        model: request.model
    });

    if (request.idempotencyKey) {
        const existingResult = await getIdempotentGenerationResult(user.id, request.idempotencyKey);
        if (existingResult) {
            return existingResult;
        }
    }

    requireProvider(request.provider);
    const entitlements = await assertCanGenerate(user.id, request);
    request.plan = entitlements.plan;
    request.subscriptionId = entitlements.subscription.id;

    const job = await createGenerationJob(user.id, request);

    try {
        throwIfAborted(signal);
        const result = await generateImage(request, { signal });
        throwIfAborted(signal);
        const sourceAsset = await storeDataUrlAsset(user.id, result.imageDataUrl, {
            kind: 'generation-original',
            source: 'generation',
            generationJobId: job.id,
            provider: result.provider,
            model: result.model
        });

        await completeGenerationJob(job.id, {
            outputAssetIds: [sourceAsset.id],
            provider: result.provider,
            model: result.model,
            meta: result.meta
        });

        await createUsageEvent(user.id, {
            generationJobId: job.id,
            provider: result.provider,
            model: result.model,
            plan: entitlements.plan,
            subscriptionId: entitlements.subscription.id,
            quantity: 1,
            costEstimateCents: null
        });

        return {
            imageUrl: assetUrl(sourceAsset.id),
            imageAssetId: sourceAsset.id,
            generationJobId: job.id,
            provider: result.provider,
            model: result.model,
            meta: result.meta
        };
    } catch (error) {
        await failGenerationJob(job.id, error);
        throw error;
    }
}

async function generateImage(request, options = {}) {
    const { prompt, provider, model, aspectRatio, quality, outputFormat } = request;
    const { signal } = options;
    throwIfAborted(signal);

    if (mockProviderResponses) {
        return generateMockImage({ provider, model, aspectRatio, quality, outputFormat, signal });
    }

    if (provider === 'openai') {
        return generateOpenAIImage({ prompt, model, aspectRatio, quality, outputFormat, signal });
    }

    if (provider === 'gemini') {
        return generateGeminiImage({ prompt, model, aspectRatio, signal });
    }

    return generateHuggingFaceImage({ prompt, model, aspectRatio, signal });
}

async function generateMockImage({ provider, model, aspectRatio, quality, outputFormat, signal }) {
    await delayWithAbort(mockProviderDelayMs, signal);
    const mockPreviewPng = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAQVSURBVHhe5db3a1V3GMfx558oYimiSGkpRRFRRFpKEWkRKaJIjHWvpGrjSBP31lSNo1q1jkatdTTe7GX2MMOYGDPcMzZVY+LW1Kq/fPp9fnjgEK7jfM+59+TyfcP9A17P/Zx7Lr0+8wFe1XbDq5rueHn6Q/X5CP9V98CLUz3xoqoX/q3sjY6Kj9FR/gmen/wUz8s+w7PSz/G0pA+eFvfFk6J+eFzYH48LBuBR/kD1GYSHeYPxIPcLPDjxJe7nfIX27K/RnjUEbZlD0ZbxDe6lf4vWtGFoTR2Ouynf4U7yCNxJGonbvlH4xzcaLcfD0JIYjr//Gotbx8ah+egENB+ZhJuHJ+Pmn1Nx49B0XP8jAtcPRuLagZm4un82riZE4crvc9RnHi7vi8alvTG4tCcWF3cvxIXfFuPCrqU4v3OZ+qzAuR2r0PTrGjRtXwsyGd+4LU4dwGB8wy/rQSbjG7Zu5AOYi6/fEg8yGV+/eTPIZPzZTVvVAQzG18VvA5mMr9u4HWQy/syGHeoABuNr1+8CmYyv/Xm3OoDB+Jq4PSCT8TVx+0DBxNspGPjT6xLUAQKMd6NA4avXHgAFCu8vO7P3l9v46jUHQcHAO3nmO+cm/tTqQ+oAAcS7+YNnzS181arDoFDAy+ytuYGvWnmUDxAaeOvsJaf4yhXHQKGG52/emhN85fJEUKjhZfbWdPEVy3zqAA7w1vd8MPEye0kXX740GeQGngs2nmdvTQdfviQFpIvnv7eSF3iZvaSDP7k4TR1AE2/9b+8Vnmcv6eDLFmWAQhkvs5fs4ssWZqkDaOD5B0/yGs/fvGQXX7ogB6SD52de8hrPs5fs4ksX5IJ08Dx7yWs8z16yiy+OKYA5ATPeY2X2Ut28MU/FYHs4uWZl0IZXxRdog6ggefZS17jefaSXXzh/DKQDp5nL3mN52desosvnFcO0sHz7CWv8Tx7yS6+YG4FSAfPs5e8xvPsJbv4/DlV6gAaeJm91BXwnF18XlQ1SBfP37zkFZ6feUkHn/djDUgXz7O35gWen3lJB587uxaki5fZS6GIPzGrTh3AAZ5nb80LPKeLz5lZD3KCl9lbCyV8zg+N6gAO8TJ7KdB4ftVJTvHZkU0gN/Aye2td/ZtnfHbkeZBbePnmrXV1fFbERXUAF/Ey+851VXzmjMsgt/Eye3/ZwfvLbXzm9CugQOCts39XjH9XTt7zb8NnTLumDhBAfOfZ20337+374tOn3gAFC/+m2XP+XnXBwKdPaeYDeId/03s+WPi0ybdAJuPTJrWATManTrytDmAwPmXCXZDJ+JTxrSCT8cnj2tQBDMYnfX8fZDI+aexDPoC5eF/4I5DJeF/4E5DJ+ONjnqkDGIxPDOvA/1xdZ0QUsIMdAAAAAElFTkSuQmCC';
    return {
        imageDataUrl: `data:image/png;base64,${mockPreviewPng}`,
        provider,
        model,
        meta: {
            mock: true,
            aspectRatio,
            quality,
            outputFormat
        }
    };
}

async function generateOpenAIImage({ prompt, model, aspectRatio, quality, outputFormat, signal }) {
    const size = mapOpenAIImageSize(aspectRatio);
    const data = await postJsonToProvider('https://api.openai.com/v1/images/generations', {
        headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: {
            model,
            prompt,
            size,
            quality,
            output_format: outputFormat,
            background: 'opaque',
            moderation: 'auto',
            n: 1
        },
        publicMessage: 'OpenAI image generation failed.',
        signal
    });

    const imageBase64 = data.data?.[0]?.b64_json;
    if (!imageBase64) {
        throw new PublicApiError('OpenAI did not return image data.', 502, 'provider_empty_response', data);
    }

    return {
        imageDataUrl: `data:image/${outputFormat};base64,${imageBase64}`,
        provider: 'openai',
        model,
        meta: {
            size,
            quality,
            outputFormat,
            created: data.created || null
        }
    };
}

async function generateGeminiImage({ prompt, model, aspectRatio, signal }) {
    const imageConfig = {
        aspectRatio
    };

    if (model === 'gemini-3.1-flash-image' || model === 'gemini-3-pro-image') {
        imageConfig.imageSize = '1K';
    }

    const data = await postJsonToProvider(
        `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`,
        {
            headers: {
                'x-goog-api-key': process.env.GEMINI_API_KEY,
                'Content-Type': 'application/json'
            },
            body: {
                contents: [
                    {
                        parts: [{ text: prompt }]
                    }
                ],
                generationConfig: {
                    responseModalities: ['Image'],
                    responseFormat: {
                        image: imageConfig
                    }
                }
            },
            publicMessage: 'Gemini image generation failed.',
            signal
        }
    );

    const imagePart = findGeminiImagePart(data);
    if (!imagePart?.data) {
        throw new PublicApiError('Gemini did not return image data.', 502, 'provider_empty_response', data);
    }

    const mimeType = imagePart.mimeType || imagePart.mime_type || 'image/png';
    return {
        imageDataUrl: `data:${mimeType};base64,${imagePart.data}`,
        provider: 'gemini',
        model,
        meta: {
            aspectRatio,
            imageSize: imageConfig.imageSize || 'default'
        }
    };
}

async function generateHuggingFaceImage({ prompt, model, aspectRatio, signal }) {
    throwIfAborted(signal);
    const client = new InferenceClient(process.env.HF_TOKEN);
    const { width, height } = mapHuggingFaceDimensions(aspectRatio);
    const provider = process.env.HF_INFERENCE_PROVIDER || 'auto';

    try {
        const imageDataUrl = await client.textToImage(
            {
                provider,
                model,
                inputs: prompt,
                parameters: {
                    width,
                    height,
                    num_inference_steps: 28
                }
            },
            {
                outputType: 'dataUrl'
            }
        );

        throwIfAborted(signal);
        return {
            imageDataUrl,
            provider: 'huggingface',
            model,
            meta: {
                providerSelection: provider,
                width,
                height
            }
        };
    } catch (error) {
        if (isAbortError(error, signal)) {
            throw createAbortError();
        }
        throw new PublicApiError('Hugging Face image generation failed.', 502, 'provider_request_failed', error);
    }
}

function findGeminiImagePart(data) {
    const candidates = data.candidates || [];
    for (const candidate of candidates) {
        const parts = candidate.content?.parts || [];
        for (const part of parts) {
            const inlineData = part.inlineData || part.inline_data;
            if (inlineData?.data) {
                return inlineData;
            }
        }
    }
    return null;
}

async function postJsonToProvider(url, { headers, body, publicMessage, signal }) {
    let response;
    let data;

    try {
        response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal
        });
        data = await parseProviderResponse(response);
    } catch (error) {
        if (isAbortError(error, signal)) {
            throw createAbortError();
        }
        throw new PublicApiError(publicMessage, 502, 'provider_network_error', error);
    }

    if (!response.ok) {
        throw new PublicApiError(publicMessage, response.status, 'provider_request_failed', data);
    }

    return data;
}

function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw createAbortError();
    }
}

function createAbortError() {
    return new PublicApiError('Generation was canceled.', 499, 'generation_aborted');
}

function isAbortError(error, signal) {
    return Boolean(signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR');
}

function delayWithAbort(ms, signal) {
    throwIfAborted(signal);

    if (!Number.isFinite(ms) || ms <= 0) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        const abort = () => {
            cleanup();
            reject(createAbortError());
        };
        const cleanup = () => {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
        };

        signal?.addEventListener('abort', abort, { once: true });
    });
}

async function parseProviderResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return response.json();
    }

    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

function requireProvider(provider) {
    if (!PROVIDERS[provider]?.configured()) {
        throw new PublicApiError(`${PROVIDERS[provider]?.label || provider} is not configured on the server.`, 503, 'provider_not_configured');
    }
}

function normalizePrompt(prompt) {
    if (typeof prompt !== 'string' || !prompt.trim()) {
        throw new PublicApiError('Prompt is required.', 400, 'invalid_prompt');
    }

    const normalized = prompt.trim();
    if (normalized.length > 32000) {
        throw new PublicApiError('Prompt is too long.', 400, 'invalid_prompt');
    }

    return normalized;
}

function normalizeProvider(provider) {
    if (provider in PROVIDERS) {
        return provider;
    }
    throw new PublicApiError('Unsupported image provider.', 400, 'unsupported_provider');
}

function inferProviderFromModel(model) {
    if (typeof model !== 'string') {
        return 'openai';
    }
    if (model.startsWith('gpt-image')) {
        return 'openai';
    }
    if (model.startsWith('gemini')) {
        return 'gemini';
    }
    return 'huggingface';
}

function normalizeModel(provider, requestedModel) {
    const fallback = PROVIDERS[provider].models[0];
    const model = typeof requestedModel === 'string' && requestedModel.trim() ? requestedModel.trim() : fallback;

    if (!PROVIDERS[provider].models.includes(model)) {
        throw new PublicApiError('Unsupported model for selected provider.', 400, 'unsupported_model');
    }

    return model;
}

function normalizeAspectRatio(aspectRatio) {
    if (['1:1', '16:9', '9:16'].includes(aspectRatio)) {
        return aspectRatio;
    }
    return '1:1';
}

function normalizeQuality(quality) {
    if (['low', 'medium', 'high', 'auto'].includes(quality)) {
        return quality;
    }
    return 'medium';
}

function normalizeOutputFormat(outputFormat) {
    if (['png', 'jpeg', 'webp'].includes(outputFormat)) {
        return outputFormat;
    }
    return 'png';
}

function normalizeIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) {
        return null;
    }

    const normalized = String(idempotencyKey).trim();
    if (!normalized) {
        return null;
    }

    if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(normalized)) {
        throw new PublicApiError('Invalid idempotency key.', 400, 'invalid_idempotency_key');
    }

    return normalized;
}

function mapOpenAIImageSize(aspectRatio) {
    if (aspectRatio === '16:9') return '1536x864';
    if (aspectRatio === '9:16') return '864x1536';
    return '1024x1024';
}

function mapHuggingFaceDimensions(aspectRatio) {
    if (aspectRatio === '16:9') return { width: 1024, height: 576 };
    if (aspectRatio === '9:16') return { width: 576, height: 1024 };
    return { width: 1024, height: 1024 };
}

async function readJsonBody(req) {
    const rawBody = await readRawBody(req);

    if (!rawBody.length) {
        return {};
    }

    try {
        return JSON.parse(rawBody.toString('utf8'));
    } catch {
        throw new PublicApiError('Request body must be valid JSON.', 400, 'invalid_json');
    }
}

async function readRawBody(req, maxBytes = 1024 * 1024) {
    const chunks = [];
    let totalBytes = 0;

    for await (const chunk of req) {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
            throw new PublicApiError('Request body is too large.', 413, 'body_too_large');
        }
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
}

function sendJson(res, status, payload, headers = {}) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...headers
    });
    res.end(body);
}

function handleServerError(res, error, requestId) {
    const status = error instanceof PublicApiError ? error.status : 500;
    const code = error instanceof PublicApiError ? error.code : 'internal_error';
    const message = error instanceof PublicApiError ? error.message : 'Unexpected server error.';

    if (status >= 500 || error.details) {
        logError('api_error', {
            requestId,
            status,
            code,
            message,
            details: serializeErrorForLog(error)
        });
    }

    if (res.destroyed || res.writableEnded) {
        return;
    }

    if (!res.headersSent) {
        sendJson(res, status, {
            ok: false,
            requestId,
            error: {
                code,
                message
            }
        });
    } else {
        res.end();
    }
}

function logInfo(event, data = {}) {
    writeStructuredLog('info', event, data);
}

function logError(event, data = {}) {
    writeStructuredLog('error', event, data);
}

function writeStructuredLog(level, event, data = {}) {
    if (logLevel === 'silent') {
        return;
    }

    if (level === 'info' && !['info', 'debug'].includes(logLevel)) {
        return;
    }

    const payload = redactSensitiveData({
        timestamp: new Date().toISOString(),
        level,
        event,
        ...data
    });

    const line = JSON.stringify(payload);
    if (level === 'error') {
        console.error(line);
    } else {
        console.log(line);
    }
}

function serializeErrorForLog(error) {
    if (!error) {
        return null;
    }

    return {
        name: error.name,
        message: error.message,
        code: error.code,
        status: error.status,
        details: error.details,
        stack: error.stack
    };
}

function redactSensitiveData(value, key = '') {
    if (isSensitiveKey(key)) {
        return '[redacted]';
    }

    if (Array.isArray(value)) {
        return value.map((item) => redactSensitiveData(item));
    }

    if (value && typeof value === 'object') {
        const output = {};
        for (const [childKey, childValue] of Object.entries(value)) {
            output[childKey] = redactSensitiveData(childValue, childKey);
        }
        return output;
    }

    if (typeof value === 'string') {
        return redactSensitiveString(value);
    }

    return value;
}

function isSensitiveKey(key) {
    return /authorization|cookie|token|secret|password|api[-_]?key|key$/i.test(key);
}

function redactSensitiveString(value) {
    let output = value;
    const secretValues = [
        adminApiToken,
        process.env.OPENAI_API_KEY,
        process.env.GEMINI_API_KEY,
        process.env.HF_TOKEN,
        resendApiKey
    ].filter(Boolean);

    for (const secret of secretValues) {
        output = output.split(secret).join('[redacted]');
    }

    return output;
}

async function serveStaticFile(res, url) {
    const staticRoot = path.resolve(__dirname, isDev ? '.' : 'dist');
    let pathname = decodeURIComponent(url.pathname);

    if (pathname === '/') {
        pathname = '/index.html';
    }

    const ext = path.extname(pathname);
    if (!publicExtensions.has(ext) || pathname.includes('..')) {
        throw new PublicApiError('File not found.', 404, 'not_found');
    }

    const requestedPath = path.resolve(staticRoot, `.${pathname}`);
    if (!requestedPath.startsWith(staticRoot)) {
        throw new PublicApiError('File not found.', 404, 'not_found');
    }

    if (!existsSync(requestedPath) || !statSync(requestedPath).isFile()) {
        throw new PublicApiError('File not found.', 404, 'not_found');
    }

    await sendFile(res, requestedPath, contentTypes[ext] || 'application/octet-stream');
}

async function sendFile(res, filePath, contentType, cacheControl = isDev ? 'no-store' : 'public, max-age=3600') {
    const body = await readFile(filePath);
    sendBuffer(res, body, contentType, cacheControl);
}

function sendBuffer(res, body, contentType, cacheControl = 'no-store') {
    res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': cacheControl
    });
    res.end(body);
}

function loadEnvFile(fileName) {
    const filePath = path.join(__dirname, fileName);
    if (!existsSync(filePath)) {
        return;
    }

    const raw = statSync(filePath).isFile() ? readFileSync(filePath, 'utf8') : '';
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) continue;

        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();
        if (!key || process.env[key]) continue;

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        process.env[key] = value;
    }
}
