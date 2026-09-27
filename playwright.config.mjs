import { defineConfig, devices } from '@playwright/test';

const e2ePort = 5190;

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 30000,
    expect: {
        timeout: 10000
    },
    fullyParallel: false,
    workers: 1,
    reporter: 'list',
    use: {
        baseURL: `http://127.0.0.1:${e2ePort}`,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node scripts/e2e-server.mjs --dev',
        url: `http://127.0.0.1:${e2ePort}/api/status`,
        timeout: 15000,
        reuseExistingServer: false,
        env: {
            PORT: String(e2ePort),
            DATA_DIR: '.data-e2e',
            E2E_RESET_DATA: '1',
            MOCK_PROVIDER_RESPONSES: '1',
            MOCK_PROVIDER_DELAY_MS: '1200',
            OPENAI_API_KEY: 'test-openai-key',
            GEMINI_API_KEY: 'test-gemini-key',
            HF_TOKEN: 'test-hf-token',
            ADMIN_API_TOKEN: 'e2e-admin-token',
            API_RATE_LIMIT_PER_MINUTE: '1000',
            AUTH_RATE_LIMIT_PER_15_MINUTES: '100',
            GENERATION_RATE_LIMIT_PER_HOUR: '100',
            FREE_MONTHLY_CREDITS: '25'
        }
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] }
        }
    ]
});
