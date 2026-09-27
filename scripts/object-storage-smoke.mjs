import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const runEnabled = process.env.RUN_OBJECT_STORAGE_SMOKE === '1';
const keepData = process.env.OBJECT_STORAGE_SMOKE_KEEP_DATA === '1';
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

if (!runEnabled) {
    console.log('Skipping object-storage smoke test. Set RUN_OBJECT_STORAGE_SMOKE=1 and ASSET_STORAGE_DRIVER=s3 to run it.');
    process.exit(0);
}

assertObjectStorageConfig();

const dataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-object-storage-'));
const server = await startServer({ dataDir });

try {
    const readiness = await api(server.baseUrl, '/api/readiness');
    assertStatus(readiness, 200, 'readiness');
    if (readiness.json.checks?.assetStorage?.details?.driver !== 's3') {
        throw new Error(`Expected readiness asset storage driver "s3", got ${readiness.json.checks?.assetStorage?.details?.driver}.`);
    }

    const signup = await api(server.baseUrl, '/api/auth/signup', {
        method: 'POST',
        body: {
            email: `object-storage-${Date.now()}@example.com`,
            password: 'Password123!'
        }
    });
    assertStatus(signup, 201, 'signup');
    const cookie = signup.cookie;

    const saved = await api(server.baseUrl, '/api/gallery', {
        method: 'POST',
        cookie,
        body: {
            originalImage: tinyPng,
            finalImage: tinyPng,
            prompt: 'object storage smoke test',
            stylePreset: 'None',
            modelUsed: 'storage-smoke',
            overlays: { header: { text: 'OBJECT STORAGE' } },
            filters: { brightness: 100 }
        }
    });
    assertStatus(saved, 201, 'gallery save');

    const assetUrl = saved.json.item?.finalImage;
    if (!/^\/api\/assets\//.test(assetUrl || '')) {
        throw new Error('Gallery save did not return a protected asset URL.');
    }

    const fetched = await fetch(`${server.baseUrl}${assetUrl}`, {
        headers: { Cookie: cookie }
    });
    if (!fetched.ok) {
        throw new Error(`Protected asset fetch returned ${fetched.status}.`);
    }
    const contentType = fetched.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
        throw new Error(`Protected asset returned non-image content type: ${contentType}`);
    }
    const bytes = await fetched.arrayBuffer();
    if (bytes.byteLength === 0) {
        throw new Error('Protected asset fetch returned an empty body.');
    }

    const db = JSON.parse(await readFile(path.join(dataDir, 'db.json'), 'utf8'));
    const assets = db.imageAssets || [];
    if (assets.length !== 2) {
        throw new Error(`Expected 2 stored image asset records, found ${assets.length}.`);
    }
    for (const asset of assets) {
        if (asset.storageDriver !== 's3') {
            throw new Error(`Expected asset storageDriver "s3", got ${asset.storageDriver}.`);
        }
        if (!asset.storageKey?.includes(signup.json.user.id)) {
            throw new Error(`Asset storageKey does not include the user id: ${asset.storageKey}`);
        }
        if (asset.relativePath !== null) {
            throw new Error('S3-backed assets should not persist a local relativePath.');
        }
    }

    console.log(`Object-storage smoke test passed using bucket ${process.env.ASSET_STORAGE_BUCKET}.`);
} finally {
    await server.stop();
    if (keepData) {
        console.log(`Keeping object-storage smoke data at ${dataDir}`);
    } else {
        await rm(dataDir, { recursive: true, force: true });
    }
}

function assertObjectStorageConfig() {
    const required = [
        'ASSET_STORAGE_BUCKET',
        'ASSET_STORAGE_REGION',
        'ASSET_STORAGE_ACCESS_KEY_ID',
        'ASSET_STORAGE_SECRET_ACCESS_KEY'
    ];

    if (process.env.ASSET_STORAGE_DRIVER !== 's3') {
        throw new Error('ASSET_STORAGE_DRIVER=s3 is required when RUN_OBJECT_STORAGE_SMOKE=1.');
    }

    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) {
        throw new Error(`${missing.join(', ')} required when RUN_OBJECT_STORAGE_SMOKE=1.`);
    }
}

async function startServer({ dataDir }) {
    const port = 7600 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, ['server.js', '--production'], {
        cwd: repoRoot,
        env: {
            ...process.env,
            PORT: String(port),
            DATA_DIR: dataDir,
            SESSION_SECRET: process.env.SESSION_SECRET || 'object-storage-smoke-session-secret-32-chars',
            REQUIRED_PROVIDERS: process.env.REQUIRED_PROVIDERS || 'openai',
            OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'object-storage-smoke-openai-key',
            ALLOW_LOCAL_PRODUCTION_STORAGE: '1',
            ALLOW_IN_MEMORY_RATE_LIMITS: process.env.ALLOW_IN_MEMORY_RATE_LIMITS || '1',
            ALLOW_UNVERIFIED_EMAILS: process.env.ALLOW_UNVERIFIED_EMAILS || '1',
            MOCK_PROVIDER_RESPONSES: '0',
            API_RATE_LIMIT_PER_MINUTE: '1000',
            AUTH_RATE_LIMIT_PER_15_MINUTES: '100',
            GENERATION_RATE_LIMIT_PER_HOUR: '100',
            FREE_MONTHLY_CREDITS: '25',
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
    if (options.cookie) headers.Cookie = options.cookie;

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
