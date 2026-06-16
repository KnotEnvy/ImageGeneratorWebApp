import { expect, test } from '@playwright/test';

test('signed-in user can generate, edit text, save to gallery, and download', async ({ page }) => {
    const browserErrors = [];
    page.on('console', (message) => {
        if (message.type() === 'error') {
            browserErrors.push(message.text());
        }
    });
    page.on('pageerror', (error) => {
        browserErrors.push(error.message);
    });

    const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `e2e-${runId}@example.com`;
    const prompt = `E2E tropical poster ${runId}`;

    await page.goto('/');

    await expect(page).toHaveTitle(/Nano Banana/);
    await expect(page.locator('#studio-view')).toBeVisible();
    await expect(page.locator('#editor-placeholder')).toContainText('Studio Workspace');

    await page.locator('#nav-settings').click();
    await expect(page.locator('#settings-view')).toBeVisible();
    await expect(page.locator('#status-openai')).toHaveText('Ready');
    await expect(page.locator('#status-gemini')).toHaveText('Ready');
    await expect(page.locator('#status-huggingface')).toHaveText('Ready');

    await page.locator('#auth-email-input').fill(email);
    await page.locator('#auth-password-input').fill('Password123!');
    await page.locator('#sign-up-btn').click();

    await expect(page.locator('#account-status-text')).toHaveText(email);
    await expect(page.locator('#email-status-text')).toHaveText('Not verified');
    await expect(page.locator('#plan-status-text')).toHaveText('Starter');
    await expect(page.locator('#billing-status-text')).toHaveText('Active (local)');
    await expect(page.locator('#quota-status-text')).toHaveText('0/25 used');

    await page.locator('#nav-studio').click();
    await page.locator('#prompt-input').fill(prompt);
    await page.locator('#generate-btn').click();

    await expect(page.locator('#canvas-viewport')).toBeVisible();
    await expect(page.locator('#drag-hint')).toBeVisible();
    await expect(page.locator('#quota-status-text')).toHaveText('1/25 used');

    await page.locator('.tab-trigger[data-tab="tab-text"]').click();
    await page.locator('#header-text-input').fill('KEEP BUILDING');
    await expect(page.locator('#header-text-input')).toHaveValue('KEEP BUILDING');

    await page.locator('#save-gallery-btn').click();
    await expect(page.locator('#toast-container')).toContainText('Saved to Creations tab!');

    await page.locator('#nav-gallery').click();
    const savedCard = page.locator('.gallery-card').filter({ hasText: prompt });
    await expect(savedCard).toBeVisible();
    await expect(savedCard.locator('.gallery-card-prompt')).toContainText(prompt);

    const downloadPromise = page.waitForEvent('download');
    await savedCard.locator('.download-btn').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^nano-banana-.+\.png$/);
    await expect(page.locator('#toast-container')).toContainText('Image download started');
    expect(browserErrors).toEqual([]);
});

test('signed-in user can cancel an in-flight generation', async ({ page }) => {
    const browserErrors = [];
    page.on('console', (message) => {
        if (message.type() === 'error') {
            browserErrors.push(message.text());
        }
    });
    page.on('pageerror', (error) => {
        browserErrors.push(error.message);
    });

    const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `cancel-${runId}@example.com`;

    await page.goto('/');
    await page.locator('#nav-settings').click();
    await page.locator('#auth-email-input').fill(email);
    await page.locator('#auth-password-input').fill('Password123!');
    await page.locator('#sign-up-btn').click();
    await expect(page.locator('#account-status-text')).toHaveText(email);

    await page.locator('#nav-studio').click();
    await page.locator('#prompt-input').fill(`Cancel flow ${runId}`);
    await page.locator('#generate-btn').click();

    await expect(page.locator('#cancel-generation-btn')).toBeVisible();
    await page.locator('#cancel-generation-btn').click();

    await expect(page.locator('#toast-container')).toContainText('Generation canceled.');
    await expect(page.locator('#generate-btn')).toBeEnabled();
    await expect(page.locator('#canvas-viewport')).toBeHidden();
    expect(browserErrors).toEqual([]);
});

test('admin token can load operations dashboard', async ({ page }) => {
    const browserErrors = [];
    page.on('console', (message) => {
        if (message.type() === 'error') {
            browserErrors.push(message.text());
        }
    });
    page.on('pageerror', (error) => {
        browserErrors.push(error.message);
    });

    const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `admin-ui-${runId}@example.com`;

    await page.goto('/');
    await page.locator('#nav-settings').click();
    await page.locator('#auth-email-input').fill(email);
    await page.locator('#auth-password-input').fill('Password123!');
    await page.locator('#sign-up-btn').click();
    await expect(page.locator('#account-status-text')).toHaveText(email);

    await page.locator('#nav-studio').click();
    await page.locator('#prompt-input').fill(`Admin dashboard seed ${runId}`);
    await page.locator('#generate-btn').click();
    await expect(page.locator('#canvas-viewport')).toBeVisible();

    await page.locator('#nav-admin').click();
    await expect(page.locator('#admin-view')).toBeVisible();
    await page.locator('#admin-token-input').fill('e2e-admin-token');
    await page.locator('#admin-connect-btn').click();

    await expect(page.locator('#admin-dashboard')).toBeVisible();
    await expect(page.locator('#admin-metrics')).toContainText('Users');
    await expect(page.locator('#admin-metrics')).toContainText('Jobs');
    await expect(page.locator('#admin-jobs-list')).toContainText('gpt-image-2');
    await expect(page.locator('#toast-container')).toContainText('Admin dashboard refreshed.');

    const storedAdminToken = await page.evaluate(() => ({
        local: localStorage.getItem('adminToken'),
        session: sessionStorage.getItem('adminToken')
    }));
    expect(storedAdminToken).toEqual({ local: null, session: null });
    expect(browserErrors).toEqual([]);
});
