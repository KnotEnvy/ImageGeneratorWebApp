import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
let nextTestPort = 6200;

test('auth, gallery, generation, quota, and idempotency work with mocked providers', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-test-'));
    const server = await startServer({
        dataDir,
        env: {
            STARTER_MONTHLY_GENERATION_LIMIT: '2'
        }
    });

    try {
        const health = await api(server.baseUrl, '/api/health');
        assert.equal(health.status, 200);
        assert.equal(health.json.status, 'ok');
        assert.equal(health.json.service, 'nano-banana-saas');

        const readiness = await api(server.baseUrl, '/api/readiness');
        assert.equal(readiness.status, 200);
        assert.equal(readiness.json.ready, true);
        assert.equal(readiness.json.checks.dataStore.ok, true);
        assert.equal(readiness.json.checks.assetStorage.ok, true);
        assert.equal(readiness.json.checks.assetStorage.details.driver, 'local');
        assert.equal(readiness.json.checks.rateLimiting.ok, true);
        assert.equal(readiness.json.checks.rateLimiting.details.driver, 'memory');
        assert.equal(readiness.json.checks.rateLimiting.details.distributed, false);
        assert.equal(readiness.json.checks.emailDelivery.ok, true);
        assert.equal(readiness.json.checks.emailDelivery.details.driver, 'log');
        assert.equal(readiness.json.checks.providers.ok, true);

        const unauth = await api(server.baseUrl, '/api/generations', {
            method: 'POST',
            body: {
                provider: 'openai',
                model: 'gpt-image-2',
                prompt: 'test',
                aspectRatio: '1:1'
            }
        });
        assert.equal(unauth.status, 401);
        assert.equal(unauth.json.error.code, 'auth_required');

        const signup = await api(server.baseUrl, '/api/auth/signup', {
            method: 'POST',
            body: {
                email: `test-${Date.now()}@example.com`,
                password: 'Password123!'
            }
        });
        assert.equal(signup.status, 201);
        assert.equal(signup.json.user.quota.monthlyLimit, 2);
        assert.equal(signup.json.user.subscription.status, 'active');
        assert.equal(signup.json.user.subscription.billingProvider, 'local');
        assert.deepEqual(signup.json.user.entitlements.allowedModels.includes('gpt-image-2'), true);
        const cookie = signup.cookie;
        assert.ok(cookie.includes('nbs_session='));

        const status = await api(server.baseUrl, '/api/status', { cookie });
        assert.equal(status.status, 200);
        assert.equal(status.json.providers.openai.configured, true);
        assert.equal(status.json.user.email, signup.json.user.email);
        assert.equal(status.json.user.entitlements.plan, 'starter');

        const billing = await api(server.baseUrl, '/api/billing/status', { cookie });
        assert.equal(billing.status, 200);
        assert.equal(billing.json.billing.subscription.status, 'active');
        assert.equal(billing.json.billing.entitlements.monthlyGenerationLimit, 2);

        const emptyGallery = await api(server.baseUrl, '/api/gallery', { cookie });
        assert.deepEqual(emptyGallery.json.items, []);

        const saved = await api(server.baseUrl, '/api/gallery', {
            method: 'POST',
            cookie,
            body: {
                originalImage: tinyPng,
                finalImage: tinyPng,
                prompt: 'gallery prompt',
                stylePreset: 'None',
                modelUsed: 'test-model',
                overlays: { header: { text: 'HELLO' } },
                filters: { brightness: 100 }
            }
        });
        assert.equal(saved.status, 201);
        assert.match(saved.json.item.finalImage, /^\/api\/assets\//);

        const protectedAsset = await fetch(`${server.baseUrl}${saved.json.item.finalImage}`, {
            headers: { Cookie: cookie }
        });
        assert.equal(protectedAsset.status, 200);
        assert.equal(protectedAsset.headers.get('content-type'), 'image/png');

        const blockedAsset = await fetch(`${server.baseUrl}${saved.json.item.finalImage}`);
        assert.equal(blockedAsset.status, 401);

        const galleryAfterSave = await api(server.baseUrl, '/api/gallery', { cookie });
        assert.equal(galleryAfterSave.json.items.length, 1);

        const generationBody = {
            provider: 'openai',
            model: 'gpt-image-2',
            prompt: 'mock test image',
            aspectRatio: '1:1',
            quality: 'medium',
            outputFormat: 'png'
        };
        const firstGeneration = await api(server.baseUrl, '/api/generations', {
            method: 'POST',
            cookie,
            idempotencyKey: 'test-generation-key',
            body: generationBody
        });
        assert.equal(firstGeneration.status, 200);
        assert.match(firstGeneration.json.imageUrl, /^\/api\/assets\//);

        const replayedGeneration = await api(server.baseUrl, '/api/generations', {
            method: 'POST',
            cookie,
            idempotencyKey: 'test-generation-key',
            body: generationBody
        });
        assert.equal(replayedGeneration.status, 200);
        assert.equal(replayedGeneration.json.generationJobId, firstGeneration.json.generationJobId);
        assert.equal(replayedGeneration.json.meta.idempotentReplay, true);

        const secondGeneration = await api(server.baseUrl, '/api/generations', {
            method: 'POST',
            cookie,
            idempotencyKey: 'test-generation-key-2',
            body: generationBody
        });
        assert.equal(secondGeneration.status, 200);

        const overQuota = await api(server.baseUrl, '/api/generations', {
            method: 'POST',
            cookie,
            idempotencyKey: 'test-generation-key-3',
            body: generationBody
        });
        assert.equal(overQuota.status, 402);
        assert.equal(overQuota.json.error.code, 'quota_exceeded');

        const db = JSON.parse(await readFile(path.join(dataDir, 'db.json'), 'utf8'));
        assert.equal(db.subscriptions.length, 1);
        assert.equal(db.subscriptions[0].plan, 'starter');
        assert.equal(db.sessions.length, 1);
        assert.equal(Object.hasOwn(db.sessions[0], 'token'), false);
        assert.match(db.sessions[0].tokenHash, /^[a-f0-9]{64}$/);
        assert.notEqual(db.sessions[0].tokenHash, getSessionCookieValue(cookie));
        assert.ok(db.imageAssets.length >= 4);
        assert.deepEqual(db.imageAssets.every((asset) => asset.storageDriver === 'local'), true);
        assert.deepEqual(db.imageAssets.every((asset) => asset.storageKey?.startsWith(`assets/${signup.json.user.id}/`)), true);
        assert.deepEqual(db.imageAssets.every((asset) => asset.relativePath === asset.storageKey), true);
        assert.equal(db.generationJobs.filter((job) => job.status === 'completed').length, 2);
        assert.deepEqual(db.generationJobs.every((job) => job.plan === 'starter'), true);
        assert.equal(db.providerUsageEvents.length, 2);
        assert.deepEqual(db.providerUsageEvents.every((event) => event.plan === 'starter'), true);

        const deleted = await api(server.baseUrl, `/api/gallery/${saved.json.item.id}`, {
            method: 'DELETE',
            cookie
        });
        assert.equal(deleted.status, 200);

        const galleryAfterDelete = await api(server.baseUrl, '/api/gallery', { cookie });
        assert.equal(galleryAfterDelete.json.items.length, 0);
    } finally {
        await server.stop();
        await rm(dataDir, { recursive: true, force: true });
    }
});

test('email verification can gate generation with hashed single-use tokens', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-email-verification-test-'));
    const server = await startServer({
        dataDir,
        env: {
            EMAIL_VERIFICATION_REQUIRED: '1',
            AUTH_TOKEN_DEBUG: '1'
        }
    });

    try {
        const signup = await api(server.baseUrl, '/api/auth/signup', {
            method: 'POST',
            body: {
                email: `verify-${Date.now()}@example.com`,
                password: 'Password123!'
            }
        });
        assert.equal(signup.status, 201);
        assert.equal(signup.json.user.emailVerified, false);
        assert.equal(signup.json.user.emailVerificationRequired, true);
        assert.match(signup.json.debug.authToken, /^[a-zA-Z0-9_-]+$/);
        const cookie = signup.cookie;

        const blockedGeneration = await api(server.baseUrl, '/api/generations', {
            method: 'POST',
            cookie,
            idempotencyKey: 'email-unverified-generation',
            body: {
                provider: 'openai',
                model: 'gpt-image-2',
                prompt: 'blocked until email verified',
                aspectRatio: '1:1'
            }
        });
        assert.equal(blockedGeneration.status, 403);
        assert.equal(blockedGeneration.json.error.code, 'email_unverified');

        const dbBeforeVerify = JSON.parse(await readFile(path.join(dataDir, 'db.json'), 'utf8'));
        assert.equal(dbBeforeVerify.authTokens.length, 1);
        assert.equal(dbBeforeVerify.authTokens[0].type, 'email_verification');
        assert.match(dbBeforeVerify.authTokens[0].tokenHash, /^[a-f0-9]{64}$/);
        assert.equal(dbBeforeVerify.authTokens[0].tokenHash.includes(signup.json.debug.authToken), false);
        assert.equal(Object.hasOwn(dbBeforeVerify.authTokens[0], 'token'), false);
        assert.equal(dbBeforeVerify.emailDeliveryEvents.length, 1);
        assert.equal(dbBeforeVerify.emailDeliveryEvents[0].type, 'email_verification');
        assert.equal(dbBeforeVerify.emailDeliveryEvents[0].provider, 'log');
        assert.equal(dbBeforeVerify.emailDeliveryEvents[0].status, 'sent');
        assert.equal(JSON.stringify(dbBeforeVerify.emailDeliveryEvents).includes(signup.json.debug.authToken), false);
        assert.equal(JSON.stringify(dbBeforeVerify.emailDeliveryEvents).includes('verify_email='), false);

        const verified = await api(server.baseUrl, '/api/auth/verify-email', {
            method: 'POST',
            cookie,
            body: {
                token: signup.json.debug.authToken
            }
        });
        assert.equal(verified.status, 200);
        assert.equal(verified.json.user.emailVerified, true);

        const reused = await api(server.baseUrl, '/api/auth/verify-email', {
            method: 'POST',
            cookie,
            body: {
                token: signup.json.debug.authToken
            }
        });
        assert.equal(reused.status, 400);
        assert.equal(reused.json.error.code, 'invalid_auth_token');

        const generated = await api(server.baseUrl, '/api/generations', {
            method: 'POST',
            cookie,
            idempotencyKey: 'email-verified-generation',
            body: {
                provider: 'openai',
                model: 'gpt-image-2',
                prompt: 'allowed after email verified',
                aspectRatio: '1:1'
            }
        });
        assert.equal(generated.status, 200);
        assert.match(generated.json.imageUrl, /^\/api\/assets\//);
    } finally {
        await server.stop();
        await rm(dataDir, { recursive: true, force: true });
    }
});

test('password reset flow is generic, single-use, hashed, and revokes sessions', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-password-reset-test-'));
    const email = `reset-${Date.now()}@example.com`;
    const server = await startServer({
        dataDir,
        env: {
            AUTH_TOKEN_DEBUG: '1'
        }
    });

    try {
        const signup = await api(server.baseUrl, '/api/auth/signup', {
            method: 'POST',
            body: {
                email,
                password: 'Password123!'
            }
        });
        assert.equal(signup.status, 201);
        const cookie = signup.cookie;

        const unknownRequest = await api(server.baseUrl, '/api/auth/request-password-reset', {
            method: 'POST',
            body: {
                email: `missing-${Date.now()}@example.com`
            }
        });
        assert.equal(unknownRequest.status, 200);
        assert.equal(unknownRequest.json.message, 'If an account exists for that email, a reset link will be sent.');
        assert.equal(Object.hasOwn(unknownRequest.json, 'debug'), false);

        const resetRequest = await api(server.baseUrl, '/api/auth/request-password-reset', {
            method: 'POST',
            body: {
                email
            }
        });
        assert.equal(resetRequest.status, 200);
        assert.equal(resetRequest.json.message, unknownRequest.json.message);
        assert.match(resetRequest.json.debug.authToken, /^[a-zA-Z0-9_-]+$/);

        const dbBeforeReset = JSON.parse(await readFile(path.join(dataDir, 'db.json'), 'utf8'));
        const resetTokens = dbBeforeReset.authTokens.filter((token) => token.type === 'password_reset');
        assert.equal(resetTokens.length, 1);
        assert.match(resetTokens[0].tokenHash, /^[a-f0-9]{64}$/);
        assert.equal(resetTokens[0].tokenHash.includes(resetRequest.json.debug.authToken), false);
        assert.equal(Object.hasOwn(resetTokens[0], 'token'), false);
        const resetDeliveryEvents = dbBeforeReset.emailDeliveryEvents.filter((event) => event.type === 'password_reset');
        assert.equal(resetDeliveryEvents.length, 1);
        assert.equal(resetDeliveryEvents[0].provider, 'log');
        assert.equal(resetDeliveryEvents[0].status, 'sent');
        assert.equal(JSON.stringify(resetDeliveryEvents).includes(resetRequest.json.debug.authToken), false);

        const reset = await api(server.baseUrl, '/api/auth/reset-password', {
            method: 'POST',
            body: {
                token: resetRequest.json.debug.authToken,
                password: 'NewPassword123!'
            }
        });
        assert.equal(reset.status, 200);

        const dbAfterReset = JSON.parse(await readFile(path.join(dataDir, 'db.json'), 'utf8'));
        assert.equal(dbAfterReset.emailDeliveryEvents.filter((event) => event.type === 'password_changed').length, 1);

        const sessionAfterReset = await api(server.baseUrl, '/api/auth/session', { cookie });
        assert.equal(sessionAfterReset.status, 200);
        assert.equal(sessionAfterReset.json.user, null);

        const oldLogin = await api(server.baseUrl, '/api/auth/login', {
            method: 'POST',
            body: {
                email,
                password: 'Password123!'
            }
        });
        assert.equal(oldLogin.status, 401);

        const newLogin = await api(server.baseUrl, '/api/auth/login', {
            method: 'POST',
            body: {
                email,
                password: 'NewPassword123!'
            }
        });
        assert.equal(newLogin.status, 200);
        assert.equal(newLogin.json.user.email, email);

        const reused = await api(server.baseUrl, '/api/auth/reset-password', {
            method: 'POST',
            body: {
                token: resetRequest.json.debug.authToken,
                password: 'AnotherPassword123!'
            }
        });
        assert.equal(reused.status, 400);
        assert.equal(reused.json.error.code, 'invalid_auth_token');
    } finally {
        await server.stop();
        await rm(dataDir, { recursive: true, force: true });
    }
});

test('stripe billing endpoints fail closed when checkout is not configured', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-stripe-missing-test-'));
    const server = await startServer({ dataDir });

    try {
        const signup = await api(server.baseUrl, '/api/auth/signup', {
            method: 'POST',
            body: {
                email: `stripe-missing-${Date.now()}@example.com`,
                password: 'Password123!'
            }
        });
        assert.equal(signup.status, 201);

        const checkout = await api(server.baseUrl, '/api/billing/checkout', {
            method: 'POST',
            cookie: signup.cookie
        });
        assert.equal(checkout.status, 503);
        assert.equal(checkout.json.error.code, 'stripe_not_configured');

        const portal = await api(server.baseUrl, '/api/billing/portal', {
            method: 'POST',
            cookie: signup.cookie
        });
        assert.equal(portal.status, 503);
        assert.equal(portal.json.error.code, 'stripe_not_configured');
    } finally {
        await server.stop();
        await rm(dataDir, { recursive: true, force: true });
    }
});

test('stripe checkout, webhook, portal, and downgrade flow update local entitlements', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-stripe-flow-test-'));
    const server = await startServer({
        dataDir,
        env: {
            MOCK_STRIPE_RESPONSES: '1',
            STRIPE_PRO_PRICE_ID: 'price_test_pro'
        }
    });

    try {
        const signup = await api(server.baseUrl, '/api/auth/signup', {
            method: 'POST',
            body: {
                email: `stripe-flow-${Date.now()}@example.com`,
                password: 'Password123!'
            }
        });
        assert.equal(signup.status, 201);
        const cookie = signup.cookie;
        const userId = signup.json.user.id;

        const missingPortal = await api(server.baseUrl, '/api/billing/portal', {
            method: 'POST',
            cookie
        });
        assert.equal(missingPortal.status, 409);
        assert.equal(missingPortal.json.error.code, 'stripe_customer_missing');

        const checkout = await api(server.baseUrl, '/api/billing/checkout', {
            method: 'POST',
            cookie
        });
        assert.equal(checkout.status, 200);
        assert.match(checkout.json.checkoutSessionId, /^cs_test_/);
        assert.match(checkout.json.url, /mock_checkout_session=/);

        const checkoutWebhook = await api(server.baseUrl, '/api/billing/webhook', {
            method: 'POST',
            body: {
                id: 'evt_mock_checkout_completed',
                type: 'checkout.session.completed',
                data: {
                    object: {
                        id: checkout.json.checkoutSessionId,
                        mode: 'subscription',
                        customer: 'cus_test_customer',
                        subscription: 'sub_test_subscription',
                        client_reference_id: userId,
                        metadata: {
                            userId,
                            plan: 'pro'
                        }
                    }
                }
            }
        });
        assert.equal(checkoutWebhook.status, 200);
        assert.equal(checkoutWebhook.json.result.updated, true);

        const proBilling = await api(server.baseUrl, '/api/billing/status', { cookie });
        assert.equal(proBilling.status, 200);
        assert.equal(proBilling.json.billing.entitlements.plan, 'pro');
        assert.equal(proBilling.json.billing.subscription.billingProvider, 'stripe');
        assert.equal(proBilling.json.billing.subscription.billingCustomerId, 'cus_test_customer');
        assert.equal(proBilling.json.billing.subscription.billingSubscriptionId, 'sub_test_subscription');
        assert.equal(proBilling.json.billing.subscription.billingPriceId, 'price_test_pro');
        assert.equal(proBilling.json.billing.portalAvailable, true);

        const premiumGeneration = await api(server.baseUrl, '/api/generations', {
            method: 'POST',
            cookie,
            idempotencyKey: 'stripe-pro-premium-model',
            body: {
                provider: 'huggingface',
                model: 'Qwen/Qwen-Image',
                prompt: 'premium model after checkout',
                aspectRatio: '1:1'
            }
        });
        assert.equal(premiumGeneration.status, 200);

        const portal = await api(server.baseUrl, '/api/billing/portal', {
            method: 'POST',
            cookie
        });
        assert.equal(portal.status, 200);
        assert.match(portal.json.url, /mock_billing_portal=/);

        const deletedWebhook = await api(server.baseUrl, '/api/billing/webhook', {
            method: 'POST',
            body: {
                id: 'evt_mock_subscription_deleted',
                type: 'customer.subscription.deleted',
                data: {
                    object: {
                        id: 'sub_test_subscription',
                        customer: 'cus_test_customer',
                        status: 'canceled',
                        metadata: {
                            userId
                        },
                        items: {
                            data: [
                                {
                                    price: {
                                        id: 'price_test_pro'
                                    }
                                }
                            ]
                        }
                    }
                }
            }
        });
        assert.equal(deletedWebhook.status, 200);
        assert.equal(deletedWebhook.json.result.updated, true);

        const starterBilling = await api(server.baseUrl, '/api/billing/status', { cookie });
        assert.equal(starterBilling.status, 200);
        assert.equal(starterBilling.json.billing.entitlements.plan, 'starter');
        assert.equal(starterBilling.json.billing.subscription.status, 'active');
        assert.equal(starterBilling.json.billing.subscription.billingProvider, 'stripe');

        const blockedPremiumGeneration = await api(server.baseUrl, '/api/generations', {
            method: 'POST',
            cookie,
            idempotencyKey: 'stripe-starter-premium-model',
            body: {
                provider: 'huggingface',
                model: 'Qwen/Qwen-Image',
                prompt: 'premium model after downgrade',
                aspectRatio: '1:1'
            }
        });
        assert.equal(blockedPremiumGeneration.status, 403);
        assert.equal(blockedPremiumGeneration.json.error.code, 'plan_model_not_allowed');
    } finally {
        await server.stop();
        await rm(dataDir, { recursive: true, force: true });
    }
});

test('production mode refuses unsafe config and stores secure hashed sessions when explicitly allowed', async () => {
    const unsafeDataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-production-unsafe-test-'));
    const unsafe = await runProductionServerUntilExit({
        dataDir: unsafeDataDir,
        env: {
            SESSION_SECRET: 'too-short',
            REQUIRED_PROVIDERS: 'openai',
            OPENAI_API_KEY: 'test-openai-key',
            ALLOW_LOCAL_PRODUCTION_STORAGE: '0'
        }
    });

    assert.notEqual(unsafe.exitCode, 0);
    assert.match(unsafe.logs, /SESSION_SECRET/);
    assert.match(unsafe.logs, /EMAIL_VERIFICATION_REQUIRED=1/);
    assert.match(unsafe.logs, /RATE_LIMIT_DRIVER=memory/);
    assert.match(unsafe.logs, /ASSET_STORAGE_DRIVER=local/);
    assert.match(unsafe.logs, /Local DATA_DIR database storage/);
    await rm(unsafeDataDir, { recursive: true, force: true });

    const unsafeRedisDataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-production-redis-unsafe-test-'));
    const unsafeRedis = await runProductionServerUntilExit({
        dataDir: unsafeRedisDataDir,
        env: {
            SESSION_SECRET: 'test-production-session-secret-32-chars-minimum',
            REQUIRED_PROVIDERS: 'openai',
            OPENAI_API_KEY: 'test-openai-key',
            ALLOW_LOCAL_PRODUCTION_STORAGE: '1',
            ALLOW_UNVERIFIED_EMAILS: '1',
            RATE_LIMIT_DRIVER: 'redis',
            REDIS_URL: ''
        }
    });

    assert.notEqual(unsafeRedis.exitCode, 0);
    assert.match(unsafeRedis.logs, /RATE_LIMIT_DRIVER=redis requires REDIS_URL/);
    await rm(unsafeRedisDataDir, { recursive: true, force: true });

    const unsafeS3DataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-production-s3-unsafe-test-'));
    const unsafeS3 = await runProductionServerUntilExit({
        dataDir: unsafeS3DataDir,
        env: {
            SESSION_SECRET: 'test-production-session-secret-32-chars-minimum',
            REQUIRED_PROVIDERS: 'openai',
            OPENAI_API_KEY: 'test-openai-key',
            ALLOW_LOCAL_PRODUCTION_STORAGE: '1',
            ALLOW_IN_MEMORY_RATE_LIMITS: '1',
            ALLOW_UNVERIFIED_EMAILS: '1',
            ASSET_STORAGE_DRIVER: 's3'
        }
    });

    assert.notEqual(unsafeS3.exitCode, 0);
    assert.match(unsafeS3.logs, /ASSET_STORAGE_DRIVER=s3 requires/);
    await rm(unsafeS3DataDir, { recursive: true, force: true });

    const unsafeEmailDataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-production-email-unsafe-test-'));
    const unsafeEmail = await runProductionServerUntilExit({
        dataDir: unsafeEmailDataDir,
        env: {
            SESSION_SECRET: 'test-production-session-secret-32-chars-minimum',
            REQUIRED_PROVIDERS: 'openai',
            OPENAI_API_KEY: 'test-openai-key',
            ALLOW_LOCAL_PRODUCTION_STORAGE: '1',
            ALLOW_IN_MEMORY_RATE_LIMITS: '1',
            EMAIL_VERIFICATION_REQUIRED: '1',
            EMAIL_DELIVERY_DRIVER: 'resend',
            RESEND_API_KEY: '',
            EMAIL_FROM: '',
            APP_BASE_URL: ''
        }
    });

    assert.notEqual(unsafeEmail.exitCode, 0);
    assert.match(unsafeEmail.logs, /EMAIL_DELIVERY_DRIVER=resend requires/);
    assert.match(unsafeEmail.logs, /EMAIL_VERIFICATION_REQUIRED=1 requires production-ready email delivery/);
    await rm(unsafeEmailDataDir, { recursive: true, force: true });

    const unsafeStripeDataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-production-stripe-unsafe-test-'));
    const unsafeStripe = await runProductionServerUntilExit({
        dataDir: unsafeStripeDataDir,
        env: {
            SESSION_SECRET: 'test-production-session-secret-32-chars-minimum',
            REQUIRED_PROVIDERS: 'openai',
            OPENAI_API_KEY: 'test-openai-key',
            ALLOW_LOCAL_PRODUCTION_STORAGE: '1',
            ALLOW_IN_MEMORY_RATE_LIMITS: '1',
            ALLOW_UNVERIFIED_EMAILS: '1',
            BILLING_PROVIDER: 'stripe',
            STRIPE_SECRET_KEY: '',
            STRIPE_WEBHOOK_SECRET: '',
            STRIPE_PRO_PRICE_ID: '',
            APP_BASE_URL: ''
        }
    });

    assert.notEqual(unsafeStripe.exitCode, 0);
    assert.match(unsafeStripe.logs, /STRIPE_SECRET_KEY/);
    assert.match(unsafeStripe.logs, /STRIPE_WEBHOOK_SECRET/);
    assert.match(unsafeStripe.logs, /STRIPE_PRO_PRICE_ID/);
    assert.match(unsafeStripe.logs, /APP_BASE_URL/);
    await rm(unsafeStripeDataDir, { recursive: true, force: true });

    const dataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-production-safe-test-'));
    const server = await startServer({
        dataDir,
        production: true,
        mockProviders: false,
        includeProviderKeys: true,
        env: {
            SESSION_SECRET: 'test-production-session-secret-32-chars-minimum',
            REQUIRED_PROVIDERS: 'openai',
            ALLOW_LOCAL_PRODUCTION_STORAGE: '1',
            ALLOW_IN_MEMORY_RATE_LIMITS: '1',
            ALLOW_UNVERIFIED_EMAILS: '1'
        }
    });

    try {
        const signup = await api(server.baseUrl, '/api/auth/signup', {
            method: 'POST',
            body: {
                email: `prod-${Date.now()}@example.com`,
                password: 'Password123!'
            }
        });

        assert.equal(signup.status, 201);
        assert.match(signup.cookie, /;\s*Secure\b/);

        const db = JSON.parse(await readFile(path.join(dataDir, 'db.json'), 'utf8'));
        assert.equal(db.sessions.length, 1);
        assert.equal(Object.hasOwn(db.sessions[0], 'token'), false);
        assert.match(db.sessions[0].tokenHash, /^[a-f0-9]{64}$/);
        assert.notEqual(db.sessions[0].tokenHash, getSessionCookieValue(signup.cookie));
    } finally {
        await server.stop();
        await rm(dataDir, { recursive: true, force: true });
    }
});

test('content policy blocks unsafe prompts and abuse reports are visible to admins', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-policy-test-'));
    const adminToken = 'policy-admin-token';
    const server = await startServer({
        dataDir,
        env: {
            ADMIN_API_TOKEN: adminToken
        }
    });

    try {
        const signup = await api(server.baseUrl, '/api/auth/signup', {
            method: 'POST',
            body: {
                email: `policy-${Date.now()}@example.com`,
                password: 'Password123!'
            }
        });
        assert.equal(signup.status, 201);
        const cookie = signup.cookie;

        const blocked = await api(server.baseUrl, '/api/generations', {
            method: 'POST',
            cookie,
            idempotencyKey: 'blocked-policy-key',
            body: {
                provider: 'openai',
                model: 'gpt-image-2',
                prompt: 'underage nude portrait',
                aspectRatio: '1:1'
            }
        });
        assert.equal(blocked.status, 400);
        assert.equal(blocked.json.error.code, 'content_policy_blocked');

        const saved = await api(server.baseUrl, '/api/gallery', {
            method: 'POST',
            cookie,
            body: {
                originalImage: tinyPng,
                finalImage: tinyPng,
                prompt: 'safe gallery image',
                stylePreset: 'None',
                modelUsed: 'test-model',
                overlays: { header: { text: 'SAFE' } },
                filters: { brightness: 100 }
            }
        });
        assert.equal(saved.status, 201);

        const report = await api(server.baseUrl, '/api/abuse-reports', {
            method: 'POST',
            cookie,
            body: {
                targetType: 'gallery_item',
                targetId: saved.json.item.id,
                reason: 'unsafe_content',
                details: 'Please review this saved item.'
            }
        });
        assert.equal(report.status, 201);
        assert.equal(report.json.report.status, 'open');
        assert.equal(report.json.report.targetId, saved.json.item.id);

        const db = JSON.parse(await readFile(path.join(dataDir, 'db.json'), 'utf8'));
        assert.equal(db.generationJobs.length, 0);
        assert.equal(db.contentPolicyEvents.length, 1);
        assert.equal(db.contentPolicyEvents[0].policyCode, 'sexual_minors');
        assert.equal(db.contentPolicyEvents[0].surface, 'generation');
        assert.equal(db.abuseReports.length, 1);

        const summary = await api(server.baseUrl, '/api/admin/summary', { adminToken });
        assert.equal(summary.status, 200);
        assert.equal(summary.json.summary.totals.contentPolicyEvents, 1);
        assert.equal(summary.json.summary.totals.abuseReports, 1);
        assert.equal(summary.json.summary.contentPolicy.byCode.sexual_minors, 1);
        assert.equal(summary.json.summary.abuseReports.byStatus.open, 1);

        const reports = await api(server.baseUrl, '/api/admin/reports', { adminToken });
        assert.equal(reports.status, 200);
        assert.equal(reports.json.reports.length, 1);
        assert.equal(reports.json.reports[0].reason, 'unsafe_content');

        const policyEvents = await api(server.baseUrl, '/api/admin/policy-events?surface=generation', { adminToken });
        assert.equal(policyEvents.status, 200);
        assert.equal(policyEvents.json.events.length, 1);
        assert.equal(policyEvents.json.events[0].policyCode, 'sexual_minors');
        assert.equal(policyEvents.json.events[0].context.provider, 'openai');
    } finally {
        await server.stop();
        await rm(dataDir, { recursive: true, force: true });
    }
});

test('readiness reports missing required providers without running provider work', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-readiness-test-'));
    const server = await startServer({
        dataDir,
        mockProviders: false,
        includeProviderKeys: false,
        env: {
            REQUIRED_PROVIDERS: 'openai,gemini'
        }
    });

    try {
        const readiness = await api(server.baseUrl, '/api/readiness');
        assert.equal(readiness.status, 503);
        assert.equal(readiness.json.ready, false);
        assert.deepEqual(readiness.json.checks.providers.details.missingRequired, ['openai', 'gemini']);
        assert.equal(readiness.json.checks.dataStore.ok, true);
        assert.equal(readiness.json.checks.assetStorage.ok, true);
    } finally {
        await server.stop();
        await rm(dataDir, { recursive: true, force: true });
    }
});

test('plan entitlements block unavailable models before generation jobs are created', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-entitlement-test-'));
    const server = await startServer({
        dataDir,
        env: {
            STARTER_MONTHLY_GENERATION_LIMIT: '25'
        }
    });

    try {
        const signup = await api(server.baseUrl, '/api/auth/signup', {
            method: 'POST',
            body: {
                email: `entitlement-${Date.now()}@example.com`,
                password: 'Password123!'
            }
        });
        const cookie = signup.cookie;
        assert.equal(signup.json.user.entitlements.allowedModels.includes('Qwen/Qwen-Image'), false);

        const blocked = await api(server.baseUrl, '/api/generations', {
            method: 'POST',
            cookie,
            idempotencyKey: 'blocked-plan-model',
            body: {
                provider: 'huggingface',
                model: 'Qwen/Qwen-Image',
                prompt: 'premium model test',
                aspectRatio: '1:1'
            }
        });
        assert.equal(blocked.status, 403);
        assert.equal(blocked.json.error.code, 'plan_model_not_allowed');

        const db = JSON.parse(await readFile(path.join(dataDir, 'db.json'), 'utf8'));
        assert.equal(db.generationJobs.length, 0);
        assert.equal(db.providerUsageEvents.length, 0);
    } finally {
        await server.stop();
        await rm(dataDir, { recursive: true, force: true });
    }
});

test('aborted generation marks the job failed without a usage event', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-abort-test-'));
    const server = await startServer({
        dataDir,
        env: {
            STARTER_MONTHLY_GENERATION_LIMIT: '25',
            MOCK_PROVIDER_DELAY_MS: '2000'
        }
    });

    try {
        const signup = await api(server.baseUrl, '/api/auth/signup', {
            method: 'POST',
            body: {
                email: `abort-${Date.now()}@example.com`,
                password: 'Password123!'
            }
        });
        const cookie = signup.cookie;
        const controller = new AbortController();

        const generationPromise = fetch(`${server.baseUrl}/api/generations`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                'Idempotency-Key': 'abort-generation-key'
            },
            body: JSON.stringify({
                provider: 'openai',
                model: 'gpt-image-2',
                prompt: 'abort test image',
                aspectRatio: '1:1'
            })
        }).catch((error) => error);

        await waitForCondition(async () => {
            const db = await readJson(path.join(dataDir, 'db.json'));
            return db.generationJobs.length === 1;
        });

        controller.abort();
        const aborted = await generationPromise;
        assert.equal(aborted.name, 'AbortError');

        await waitForCondition(async () => {
            const db = await readJson(path.join(dataDir, 'db.json'));
            return db.generationJobs[0]?.status === 'failed';
        });

        const db = await readJson(path.join(dataDir, 'db.json'));
        assert.equal(db.generationJobs[0].errorCode, 'generation_aborted');
        assert.equal(db.providerUsageEvents.length, 0);
    } finally {
        await server.stop();
        await rm(dataDir, { recursive: true, force: true });
    }
});

test('admin summary and jobs require token and expose sanitized observability data', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-admin-test-'));
    const adminToken = 'test-admin-token';
    const server = await startServer({
        dataDir,
        env: {
            ADMIN_API_TOKEN: adminToken,
            LOG_LEVEL: 'info'
        }
    });

    try {
        const blocked = await api(server.baseUrl, '/api/admin/summary');
        assert.equal(blocked.status, 401);
        assert.equal(blocked.json.error.code, 'admin_auth_required');

        const signup = await api(server.baseUrl, '/api/auth/signup', {
            method: 'POST',
            body: {
                email: `admin-${Date.now()}@example.com`,
                password: 'Password123!'
            }
        });
        const cookie = signup.cookie;

        const generated = await api(server.baseUrl, '/api/generations', {
            method: 'POST',
            cookie,
            idempotencyKey: 'admin-generation-key',
            body: {
                provider: 'openai',
                model: 'gpt-image-2',
                prompt: 'admin observability image',
                aspectRatio: '1:1'
            }
        });
        assert.equal(generated.status, 200);

        const summary = await api(server.baseUrl, '/api/admin/summary', {
            adminToken
        });
        assert.equal(summary.status, 200);
        assert.equal(summary.json.summary.totals.users, 1);
        assert.equal(summary.json.summary.totals.generationJobs, 1);
        assert.equal(summary.json.summary.jobsByStatus.completed, 1);
        assert.equal(summary.json.summary.usage.totalEvents, 1);
        assert.equal(summary.json.summary.usage.byProvider.openai, 1);

        const jobs = await api(server.baseUrl, '/api/admin/jobs?status=completed', {
            adminToken
        });
        assert.equal(jobs.status, 200);
        assert.equal(jobs.json.jobs.length, 1);
        assert.equal(jobs.json.jobs[0].status, 'completed');
        assert.equal(Object.hasOwn(jobs.json.jobs[0], 'rawErrorJson'), false);
        assert.equal(Object.hasOwn(jobs.json.jobs[0], 'prompt'), false);

        await waitForCondition(() => parseLogEvents(server.logs).some((event) => event.event === 'http_request'));
        assert.equal(server.logs.join('').includes(adminToken), false);
        assert.ok(parseLogEvents(server.logs).some((event) => event.event === 'http_request'));
    } finally {
        await server.stop();
        await rm(dataDir, { recursive: true, force: true });
    }
});

test('generation rate limit returns rate_limited before provider work', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-rate-test-'));
    const server = await startServer({
        dataDir,
        env: {
            STARTER_MONTHLY_GENERATION_LIMIT: '25',
            GENERATION_RATE_LIMIT_PER_HOUR: '1'
        }
    });

    try {
        const signup = await api(server.baseUrl, '/api/auth/signup', {
            method: 'POST',
            body: {
                email: `rate-${Date.now()}@example.com`,
                password: 'Password123!'
            }
        });
        const cookie = signup.cookie;
        const body = {
            provider: 'openai',
            model: 'gpt-image-2',
            prompt: 'mock test image',
            aspectRatio: '1:1'
        };

        const first = await api(server.baseUrl, '/api/generations', {
            method: 'POST',
            cookie,
            idempotencyKey: 'rate-key-1',
            body
        });
        assert.equal(first.status, 200);

        const second = await api(server.baseUrl, '/api/generations', {
            method: 'POST',
            cookie,
            idempotencyKey: 'rate-key-2',
            body
        });
        assert.equal(second.status, 429);
        assert.equal(second.json.error.code, 'rate_limited');
    } finally {
        await server.stop();
        await rm(dataDir, { recursive: true, force: true });
    }
});

async function startServer({ dataDir, env = {}, mockProviders = true, includeProviderKeys = true, production = false }) {
    const port = nextTestPort++;
    const providerEnv = includeProviderKeys
        ? {
            OPENAI_API_KEY: 'test-openai-key',
            GEMINI_API_KEY: 'test-gemini-key',
            HF_TOKEN: 'test-hf-token'
        }
        : {
            OPENAI_API_KEY: '',
            GEMINI_API_KEY: '',
            HF_TOKEN: ''
        };
    const stripeEnv = {
        BILLING_PROVIDER: 'local',
        STRIPE_REQUIRED: '0',
        STRIPE_SECRET_KEY: '',
        STRIPE_WEBHOOK_SECRET: '',
        STRIPE_PRO_PRICE_ID: '',
        APP_BASE_URL: '',
        STRIPE_BILLING_PORTAL_RETURN_URL: '',
        MOCK_STRIPE_RESPONSES: '0'
    };
    const rateLimitEnv = {
        RATE_LIMIT_DRIVER: 'memory',
        RATE_LIMIT_KEY_PREFIX: 'nano-banana-test',
        REDIS_URL: '',
        ALLOW_IN_MEMORY_RATE_LIMITS: '0'
    };
    const authEnv = {
        EMAIL_VERIFICATION_REQUIRED: '0',
        AUTH_TOKEN_DEBUG: '0',
        ALLOW_UNVERIFIED_EMAILS: '0',
        EMAIL_DELIVERY_DRIVER: 'log',
        EMAIL_PRODUCT_NAME: 'Nano Banana Art Lab',
        EMAIL_FROM: '',
        EMAIL_REPLY_TO: '',
        RESEND_API_KEY: '',
        ALLOW_LOCAL_EMAIL_DELIVERY: '0'
    };
    const child = spawn(process.execPath, ['server.js', production ? '--production' : '--dev'], {
        cwd: repoRoot,
        env: {
            ...process.env,
            ...stripeEnv,
            ...rateLimitEnv,
            ...authEnv,
            ...env,
            PORT: String(port),
            DATA_DIR: dataDir,
            MOCK_PROVIDER_RESPONSES: mockProviders ? '1' : '0',
            ...providerEnv,
            API_RATE_LIMIT_PER_MINUTE: '1000',
            AUTH_RATE_LIMIT_PER_15_MINUTES: '100',
            LOG_LEVEL: env.LOG_LEVEL || 'silent'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const logs = [];
    child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
    child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

    const baseUrl = `http://localhost:${port}`;
    await waitForServer(baseUrl, child, logs);

    return {
        baseUrl,
        logs,
        stop: () => stopServer(child)
    };
}

async function runProductionServerUntilExit({ dataDir, env = {} }) {
    const port = nextTestPort++;
    const stripeEnv = {
        BILLING_PROVIDER: 'local',
        STRIPE_REQUIRED: '0',
        STRIPE_SECRET_KEY: '',
        STRIPE_WEBHOOK_SECRET: '',
        STRIPE_PRO_PRICE_ID: '',
        APP_BASE_URL: '',
        STRIPE_BILLING_PORTAL_RETURN_URL: '',
        MOCK_STRIPE_RESPONSES: '0'
    };
    const rateLimitEnv = {
        RATE_LIMIT_DRIVER: 'memory',
        RATE_LIMIT_KEY_PREFIX: 'nano-banana-test',
        REDIS_URL: '',
        ALLOW_IN_MEMORY_RATE_LIMITS: '0'
    };
    const authEnv = {
        EMAIL_VERIFICATION_REQUIRED: '0',
        AUTH_TOKEN_DEBUG: '0',
        ALLOW_UNVERIFIED_EMAILS: '0',
        EMAIL_DELIVERY_DRIVER: 'log',
        EMAIL_PRODUCT_NAME: 'Nano Banana Art Lab',
        EMAIL_FROM: '',
        EMAIL_REPLY_TO: '',
        RESEND_API_KEY: '',
        ALLOW_LOCAL_EMAIL_DELIVERY: '0'
    };
    const child = spawn(process.execPath, ['server.js', '--production'], {
        cwd: repoRoot,
        env: {
            ...process.env,
            ...stripeEnv,
            ...rateLimitEnv,
            ...authEnv,
            ...env,
            PORT: String(port),
            DATA_DIR: dataDir,
            MOCK_PROVIDER_RESPONSES: '0',
            LOG_LEVEL: 'silent'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const logs = [];
    child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
    child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

    const exited = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 10000);
        child.once('exit', () => {
            clearTimeout(timeout);
            resolve(true);
        });
    });

    if (!exited) {
        child.kill();
        throw new Error(`Production server did not exit:\n${logs.join('')}`);
    }

    return {
        exitCode: child.exitCode,
        logs: logs.join('')
    };
}

async function waitForServer(baseUrl, child, logs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 10000) {
        if (child.exitCode !== null) {
            throw new Error(`Server exited before startup:\n${logs.join('')}`);
        }

        try {
            const response = await fetch(`${baseUrl}/api/status`);
            if (response.ok) return;
        } catch {
            await delay(100);
        }
    }

    throw new Error(`Server did not start:\n${logs.join('')}`);
}

async function stopServer(child) {
    if (child.exitCode !== null) return;

    child.kill();
    await new Promise((resolve) => {
        child.once('exit', resolve);
        setTimeout(resolve, 2000);
    });
}

async function api(baseUrl, pathname, options = {}) {
    const headers = {
        'Content-Type': 'application/json'
    };
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    if (options.adminToken) headers.Authorization = `Bearer ${options.adminToken}`;

    const response = await fetch(`${baseUrl}${pathname}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const text = await response.text();

    return {
        status: response.status,
        cookie: response.headers.get('set-cookie') || '',
        json: text ? JSON.parse(text) : null
    };
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSessionCookieValue(setCookieHeader) {
    const match = String(setCookieHeader).match(/(?:^|;\s*)nbs_session=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

async function readJson(filePath) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 2000) {
        try {
            return JSON.parse(await readFile(filePath, 'utf8'));
        } catch (error) {
            if (error instanceof SyntaxError) {
                await delay(25);
                continue;
            }
            throw error;
        }
    }

    return JSON.parse(await readFile(filePath, 'utf8'));
}

async function waitForCondition(condition, timeoutMs = 5000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (await condition()) {
            return;
        }
        await delay(50);
    }
    throw new Error('Timed out waiting for condition.');
}

function parseLogEvents(logs) {
    return logs
        .join('')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}
