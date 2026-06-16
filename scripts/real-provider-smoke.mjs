import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const providerCatalog = {
    openai: {
        envKey: 'OPENAI_API_KEY',
        model: 'gpt-image-2'
    },
    gemini: {
        envKey: 'GEMINI_API_KEY',
        model: 'gemini-2.5-flash-image'
    },
    huggingface: {
        envKey: 'HF_TOKEN',
        model: 'black-forest-labs/FLUX.1-Krea-dev'
    }
};

const runEnabled = process.env.RUN_REAL_PROVIDER_SMOKE === '1';
const selectedProviders = parseProviderList(process.env.REAL_PROVIDER_SMOKE_PROVIDERS || '');
const prompt = process.env.REAL_PROVIDER_SMOKE_PROMPT
    || 'A simple studio product photo of a yellow banana on a white background.';
const keepData = process.env.REAL_PROVIDER_SMOKE_KEEP_DATA === '1';

if (!runEnabled) {
    console.log('Skipping real-provider smoke tests. Set RUN_REAL_PROVIDER_SMOKE=1 and REAL_PROVIDER_SMOKE_PROVIDERS to run them.');
    process.exit(0);
}

if (!selectedProviders.length) {
    throw new Error('REAL_PROVIDER_SMOKE_PROVIDERS is required when RUN_REAL_PROVIDER_SMOKE=1. Example: openai,gemini,huggingface');
}

for (const provider of selectedProviders) {
    if (!providerCatalog[provider]) {
        throw new Error(`Unsupported REAL_PROVIDER_SMOKE_PROVIDERS entry: ${provider}`);
    }
    const envKey = providerCatalog[provider].envKey;
    if (!process.env[envKey]) {
        throw new Error(`${envKey} is required for ${provider} real-provider smoke testing.`);
    }
}

const dataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-real-provider-'));
const server = await startServer({ dataDir });

try {
    const signup = await api(server.baseUrl, '/api/auth/signup', {
        method: 'POST',
        body: {
            email: `real-provider-${Date.now()}@example.com`,
            password: 'Password123!'
        }
    });
    assertStatus(signup, 201, 'signup');
    const cookie = signup.cookie;

    const status = await api(server.baseUrl, '/api/status', { cookie });
    assertStatus(status, 200, 'status');

    for (const provider of selectedProviders) {
        if (!status.json.providers?.[provider]?.configured) {
            throw new Error(`${provider} is not configured according to /api/status.`);
        }

        const model = providerCatalog[provider].model;
        const result = await api(server.baseUrl, '/api/generations', {
            method: 'POST',
            cookie,
            idempotencyKey: `real-${provider}-${Date.now()}`,
            body: {
                provider,
                model,
                prompt,
                aspectRatio: '1:1',
                quality: 'low',
                outputFormat: 'png'
            }
        });
        assertStatus(result, 200, `${provider} generation`);

        if (!/^\/api\/assets\//.test(result.json.imageUrl || '')) {
            throw new Error(`${provider} did not return a protected image asset URL.`);
        }

        const asset = await fetch(`${server.baseUrl}${result.json.imageUrl}`, {
            headers: { Cookie: cookie }
        });
        if (!asset.ok) {
            throw new Error(`${provider} generated asset fetch failed with status ${asset.status}.`);
        }
        const contentType = asset.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) {
            throw new Error(`${provider} generated asset did not return an image content type.`);
        }
        const bytes = await asset.arrayBuffer();
        if (bytes.byteLength === 0) {
            throw new Error(`${provider} generated asset was empty.`);
        }

        console.log(`${provider}: generated ${result.json.generationJobId} (${bytes.byteLength} bytes, ${contentType})`);
    }

    const db = JSON.parse(await readFile(path.join(dataDir, 'db.json'), 'utf8'));
    const completedJobs = db.generationJobs.filter((job) => job.status === 'completed');
    if (completedJobs.length !== selectedProviders.length) {
        throw new Error(`Expected ${selectedProviders.length} completed jobs, found ${completedJobs.length}.`);
    }
    if (db.providerUsageEvents.length !== selectedProviders.length) {
        throw new Error(`Expected ${selectedProviders.length} provider usage events, found ${db.providerUsageEvents.length}.`);
    }

    console.log(`Real-provider smoke tests passed for: ${selectedProviders.join(', ')}`);
} finally {
    await server.stop();
    if (keepData) {
        console.log(`Keeping real-provider smoke data at ${dataDir}`);
    } else {
        await rm(dataDir, { recursive: true, force: true });
    }
}

function parseProviderList(value) {
    return value
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
}

async function startServer({ dataDir }) {
    const port = 6500 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, ['server.js', '--dev'], {
        cwd: repoRoot,
        env: {
            ...process.env,
            PORT: String(port),
            DATA_DIR: dataDir,
            MOCK_PROVIDER_RESPONSES: '0',
            API_RATE_LIMIT_PER_MINUTE: '1000',
            AUTH_RATE_LIMIT_PER_15_MINUTES: '100',
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

function assertStatus(response, expected, label) {
    if (response.status !== expected) {
        throw new Error(`${label} returned ${response.status}: ${JSON.stringify(response.json)}`);
    }
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
