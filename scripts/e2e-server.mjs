import { rm } from 'node:fs/promises';
import path from 'node:path';

if (process.env.E2E_RESET_DATA === '1' && process.env.DATA_DIR) {
    const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR);
    await rm(dataDir, { recursive: true, force: true });
}

await import('../server.js');
