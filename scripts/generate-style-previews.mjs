/**
 * Paint one sample scene in every art style and save small WebP thumbnails for the style picker.
 *
 * This calls a real image provider once per style (about 31 images), so it spends API credits.
 * It only runs when RUN_STYLE_PREVIEWS=1 and the matching provider key is set, e.g.:
 *
 *   RUN_STYLE_PREVIEWS=1 GEMINI_API_KEY=... npm run styles:previews
 *
 * Options:
 *   STYLE_PREVIEW_MODEL    catalog model id to use (default: gemini-3.1-flash-image)
 *   STYLE_PREVIEW_SUBJECT  scene to paint (default: a harbor village scene)
 *   STYLE_PREVIEW_ONLY     comma-separated style ids to (re)generate; others are kept
 *   STYLE_PREVIEW_DRY_RUN  1 = use the mock provider (free) to check the pipeline
 *   STYLE_PREVIEW_OUTPUT_DIR  write somewhere other than public/style-previews
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { STYLE_LIBRARY } from '../js/styles.js';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const dryRun = process.env.STYLE_PREVIEW_DRY_RUN === '1';
const outputDir = process.env.STYLE_PREVIEW_OUTPUT_DIR
    ? path.resolve(process.env.STYLE_PREVIEW_OUTPUT_DIR)
    : path.join(repoRoot, 'public', 'style-previews');
const manifestPath = path.join(outputDir, 'manifest.json');
const THUMB_SIZE = 384;

if (process.env.RUN_STYLE_PREVIEWS !== '1') {
    console.log('Skipping style previews. Set RUN_STYLE_PREVIEWS=1 (this spends provider credits, about one image per style).');
    process.exit(0);
}

const modelId = process.env.STYLE_PREVIEW_MODEL || 'gemini-3.1-flash-image';
const subject = process.env.STYLE_PREVIEW_SUBJECT
    || 'A small harbor village at golden hour, colorful houses along the water, a sailboat, and hills in the distance';
const only = (process.env.STYLE_PREVIEW_ONLY || '').split(',').map((id) => id.trim()).filter(Boolean);
const styles = STYLE_LIBRARY.filter((style) => !only.length || only.includes(style.id));

await mkdir(outputDir, { recursive: true });
const manifest = existsSync(manifestPath)
    ? JSON.parse(await readFile(manifestPath, 'utf8'))
    : { previews: {} };
manifest.previews ||= {};

const dataDir = await mkdtemp(path.join(tmpdir(), 'nano-banana-style-previews-'));
const server = await startServer(dataDir);
const browser = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {});
const failures = [];

try {
    const signup = await api(server.baseUrl, '/api/auth/signup', {
        method: 'POST',
        body: { email: `style-previews-${Date.now()}@example.com`, password: 'Password123!' }
    });
    if (signup.status !== 201) throw new Error(`Signup failed: ${JSON.stringify(signup.json)}`);
    const cookie = signup.cookie;

    const status = await api(server.baseUrl, '/api/status', { cookie });
    const model = status.json.models.find((candidate) => candidate.id === modelId);
    if (!model?.configured) {
        throw new Error(`Model ${modelId} is not configured. Set its provider key or choose STYLE_PREVIEW_MODEL.`);
    }

    const page = await browser.newPage();
    for (const [index, style] of styles.entries()) {
        process.stdout.write(`[${index + 1}/${styles.length}] ${style.name}… `);
        try {
            const result = await api(server.baseUrl, '/api/generations', {
                method: 'POST',
                cookie,
                idempotencyKey: `style-preview-${style.id}-${Date.now()}`,
                body: {
                    provider: model.provider,
                    model: model.id,
                    prompt: subject,
                    styleId: style.id,
                    aspectRatio: '1:1'
                }
            });
            if (result.status !== 200) throw new Error(result.json?.error?.message || `status ${result.status}`);

            const asset = await fetch(`${server.baseUrl}${result.json.imageUrl}`, { headers: { Cookie: cookie } });
            const bytes = Buffer.from(await asset.arrayBuffer());
            const mimeType = asset.headers.get('content-type') || 'image/png';
            const webp = await toThumbnail(page, bytes, mimeType);
            const fileName = `${style.id}.webp`;
            await writeFile(path.join(outputDir, fileName), webp);
            manifest.previews[style.id] = fileName;
            console.log(`saved (${Math.round(webp.length / 1024)} KB)`);
        } catch (error) {
            failures.push(style.id);
            console.log(`failed: ${error.message}`);
        }
    }

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`\nWrote ${Object.keys(manifest.previews).length} previews to ${path.relative(repoRoot, outputDir) || outputDir}.`);
    if (failures.length) {
        console.log(`Failed: ${failures.join(', ')}. Re-run with STYLE_PREVIEW_ONLY=${failures.join(',')}`);
        process.exitCode = 1;
    }
} finally {
    await browser.close();
    await server.stop();
    await rm(dataDir, { recursive: true, force: true });
}

// Downscale in a headless browser so the repo needs no native image library.
async function toThumbnail(page, bytes, mimeType) {
    const dataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`;
    const output = await page.evaluate(async ({ src, size }) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
            image,
            (image.naturalWidth - side) / 2,
            (image.naturalHeight - side) / 2,
            side,
            side,
            0,
            0,
            size,
            size
        );
        return canvas.toDataURL('image/webp', 0.82);
    }, { src: dataUrl, size: THUMB_SIZE });
    return Buffer.from(output.split(',')[1], 'base64');
}

async function startServer(dir) {
    const port = 7300 + Math.floor(Math.random() * 500);
    const child = spawn(process.execPath, ['server.js', '--dev'], {
        cwd: repoRoot,
        env: {
            ...process.env,
            PORT: String(port),
            DATA_DIR: dir,
            MOCK_PROVIDER_RESPONSES: dryRun ? '1' : '0',
            FREE_MONTHLY_CREDITS: '10000',
            GENERATION_RATE_LIMIT_PER_HOUR: '1000',
            API_RATE_LIMIT_PER_MINUTE: '1000',
            LOG_LEVEL: process.env.LOG_LEVEL || 'error'
        },
        stdio: ['ignore', 'inherit', 'inherit']
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15000) {
        if (child.exitCode !== null) throw new Error('Server exited during startup.');
        try {
            if ((await fetch(`${baseUrl}/api/health`)).ok) break;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
    }

    return {
        baseUrl,
        stop: () => new Promise((resolve) => {
            if (child.exitCode !== null) return resolve();
            child.once('exit', resolve);
            child.kill();
            setTimeout(resolve, 2000);
        })
    };
}

async function api(baseUrl, pathname, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
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
