import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const runEnabled = process.env.RUN_REDIS_RATE_LIMIT_SMOKE === '1';
const keepData = process.env.REDIS_RATE_LIMIT_SMOKE_KEEP_DATA === '1';
const rateLimitKeyPrefix = process.env.RATE_LIMIT_KEY_PREFIX || `nano-banana-smoke-${Date.now()}`;

if (!runEnabled) {
    console.log('Skipping Redis rate-limit smoke test. Set RUN_REDIS_RATE_LIMIT_SMOKE=1 and REDIS_URL to run it.');
    process.exit(0);
}

if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL is required when RUN_REDIS_RATE_LIMIT_SMOKE=1.');
}

const dataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-redis-rate-limit-'));
const server = await startServer({ dataDir });

try {
    const readiness = await api(server.baseUrl, '/api/readiness');
    assertStatus(readiness, 200, 'readiness');

    const rateLimitCheck = readiness.json.checks?.rateLimiting;
    if (rateLimitCheck?.details?.driver !== 'redis') {
        throw new Error(`Expected rate-limit driver "redis", got ${rateLimitCheck?.details?.driver}.`);
    }
    if (rateLimitCheck?.details?.distributed !== true) {
        throw new Error('Expected Redis rate-limit readiness to report distributed=true.');
    }

    const firstSignup = await api(server.baseUrl, '/api/auth/signup', {
        method: 'POST',
        body: {
            email: `redis-limit-one-${Date.now()}@example.com`,
            password: 'Password123!'
        }
    });
    assertStatus(firstSignup, 201, 'first signup');

    const secondSignup = await api(server.baseUrl, '/api/auth/signup', {
        method: 'POST',
        body: {
            email: `redis-limit-two-${Date.now()}@example.com`,
            password: 'Password123!'
        }
    });
    assertStatus(secondSignup, 429, 'second signup');
    if (secondSignup.json.error?.code !== 'rate_limited') {
        throw new Error(`Expected rate_limited error, got ${JSON.stringify(secondSignup.json.error)}.`);
    }

    console.log(`Redis rate-limit smoke test passed using key prefix ${rateLimitKeyPrefix}.`);
} finally {
    await server.stop();
    if (keepData) {
        console.log(`Keeping Redis rate-limit smoke data at ${dataDir}`);
    } else {
        await rm(dataDir, { recursive: true, force: true });
    }
}

async function startServer({ dataDir }) {
    const port = 7800 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, ['server.js', '--production'], {
        cwd: repoRoot,
        env: {
            ...process.env,
            PORT: String(port),
            DATA_DIR: dataDir,
            SESSION_SECRET: process.env.SESSION_SECRET || 'redis-rate-limit-smoke-session-secret-32-chars',
            REQUIRED_PROVIDERS: process.env.REQUIRED_PROVIDERS || 'openai',
            OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'redis-rate-limit-smoke-openai-key',
            ALLOW_LOCAL_PRODUCTION_STORAGE: '1',
            ALLOW_UNVERIFIED_EMAILS: process.env.ALLOW_UNVERIFIED_EMAILS || '1',
            RATE_LIMIT_DRIVER: 'redis',
            RATE_LIMIT_KEY_PREFIX: rateLimitKeyPrefix,
            MOCK_PROVIDER_RESPONSES: '0',
            API_RATE_LIMIT_PER_MINUTE: '1000',
            AUTH_RATE_LIMIT_PER_15_MINUTES: '1',
            GENERATION_RATE_LIMIT_PER_HOUR: '100',
            STARTER_MONTHLY_GENERATION_LIMIT: '25',
            LOG_LEVEL: process.env.LOG_LEVEL || 'silent'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const logs = [];
    child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
    child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(baseUrl, child, logs);

    return {
        baseUrl,
        stop: () => stopServer(child)
    };
}

async function waitForServer(baseUrl, child, logs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15000) {
        if (child.exitCode !== null) {
            throw new Error(`Server exited before startup:\n${logs.join('')}`);
        }

        try {
            const response = await fetch(`${baseUrl}/api/health`);
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

    const response = await fetch(`${baseUrl}${pathname}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const text = await response.text();

    return {
        status: response.status,
        json: text ? JSON.parse(text) : null
    };
}

function assertStatus(response, expected, label) {
    if (response.status !== expected) {
        throw new Error(`${label} returned ${response.status}: ${JSON.stringify(response.json)}`);
    }
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
