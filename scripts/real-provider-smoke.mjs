import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const providerEnvKeys = {
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
    huggingface: 'HF_TOKEN'
};

const runEnabled = process.env.RUN_REAL_PROVIDER_SMOKE === '1';
const selectedProviders = parseProviderList(process.env.REAL_PROVIDER_SMOKE_PROVIDERS || '');
const selectedModels = parseProviderList(process.env.REAL_PROVIDER_SMOKE_MODELS || '');
const prompt = process.env.REAL_PROVIDER_SMOKE_PROMPT
    || 'A simple studio product photo of a yellow banana on a white background.';
const keepData = process.env.REAL_PROVIDER_SMOKE_KEEP_DATA === '1';
const outputDir = process.env.REAL_PROVIDER_SMOKE_OUTPUT_DIR || '';

if (!runEnabled) {
    console.log('Skipping real-provider smoke tests. Set RUN_REAL_PROVIDER_SMOKE=1 and REAL_PROVIDER_SMOKE_PROVIDERS to run them.');
    process.exit(0);
}

if (!selectedProviders.length) {
    throw new Error('REAL_PROVIDER_SMOKE_PROVIDERS is required when RUN_REAL_PROVIDER_SMOKE=1. Example: openai,gemini,huggingface');
}

for (const provider of selectedProviders) {
    const envKey = providerEnvKeys[provider];
    if (!envKey) {
        throw new Error(`Unsupported REAL_PROVIDER_SMOKE_PROVIDERS entry: ${provider}`);
    }
    if (!process.env[envKey]) {
        throw new Error(`${envKey} is required for ${provider} real-provider smoke testing.`);
    }
}

if (outputDir) {
    await mkdir(outputDir, { recursive: true });
}

const dataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-real-provider-'));
const server = await startServer({ dataDir });
const results = [];

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

    // Exercise every catalog engine for the chosen providers (or just REAL_PROVIDER_SMOKE_MODELS).
    const models = status.json.models.filter((model) => (
        selectedProviders.includes(model.provider) &&
        (!selectedModels.length || selectedModels.includes(model.id.toLowerCase()))
    ));
    if (!models.length) {
        throw new Error('No catalog models matched the selected providers/models.');
    }

    for (const model of models) {
        const label = `${model.provider}/${model.id}`;
        const startedAt = Date.now();
        try {
            if (!model.configured) {
                throw new Error('provider is not configured according to /api/status');
            }

            const result = await api(server.baseUrl, '/api/generations', {
                method: 'POST',
                cookie,
                idempotencyKey: `real-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                body: {
                    provider: model.provider,
                    model: model.id,
                    prompt,
                    aspectRatio: '1:1',
                    quality: 'low',
                    outputFormat: 'png'
                }
            });
            assertStatus(result, 200, `${label} generation`);

            if (!/^\/api\/assets\//.test(result.json.imageUrl || '')) {
                throw new Error('did not return a protected image asset URL');
            }

            const asset = await fetch(`${server.baseUrl}${result.json.imageUrl}`, {
                headers: { Cookie: cookie }
            });
            if (!asset.ok) {
                throw new Error(`generated asset fetch failed with status ${asset.status}`);
            }
            const contentType = asset.headers.get('content-type') || '';
            if (!contentType.startsWith('image/')) {
                throw new Error('generated asset did not return an image content type');
            }
            const bytes = Buffer.from(await asset.arrayBuffer());
            if (bytes.byteLength === 0) {
                throw new Error('generated asset was empty');
            }

            if (outputDir) {
                const ext = contentType.split('/')[1]?.split(';')[0] || 'png';
                await writeFile(path.join(outputDir, `${model.id.replace(/[^a-z0-9.-]/gi, '_')}.${ext}`), bytes);
            }

            results.push({ label, ok: true, seconds: (Date.now() - startedAt) / 1000, detail: `${bytes.byteLength} bytes` });
        } catch (error) {
            results.push({ label, ok: false, seconds: (Date.now() - startedAt) / 1000, detail: error.message });
        }
    }

    for (const result of results) {
        console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.label}  ${result.seconds.toFixed(1)}s  ${result.detail}`);
    }
    if (outputDir) {
        console.log(`Sample images written to ${outputDir}`);
    }

    const failed = results.filter((result) => !result.ok);
    if (failed.length) {
        throw new Error(`${failed.length} of ${results.length} engines failed. Update IMAGE_MODELS or provider keys and re-run.`);
    }

    const db = JSON.parse(await readFile(path.join(dataDir, 'db.json'), 'utf8'));
    if (db.providerUsageEvents.length !== results.length) {
        throw new Error(`Expected ${results.length} provider usage events, found ${db.providerUsageEvents.length}.`);
    }

    console.log(`Real-provider smoke tests passed for ${results.length} engines.`);
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
            FREE_MONTHLY_CREDITS: '1000',
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
