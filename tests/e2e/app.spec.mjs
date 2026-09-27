import { expect, test } from '@playwright/test';

// Web fonts come from Google Fonts; offline CI runners can't reach it, which is not an app error.
const IGNORED_ERRORS = [/fonts\.(googleapis|gstatic)\.com/, /ERR_(CERT|TOO_MANY_RETRIES|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION)/];

function trackBrowserErrors(page) {
    const errors = [];
    page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = `${message.text()} ${message.location()?.url || ''}`;
        if (!IGNORED_ERRORS.some((pattern) => pattern.test(text))) errors.push(text);
    });
    page.on('pageerror', (error) => errors.push(error.message));
    return errors;
}

function uniqueEmail(label) {
    return `e2e-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

async function signUpFromHeader(page, email) {
    await page.locator('#account-btn').click();
    await page.locator('#auth-switch').click();
    await page.locator('#auth-email').fill(email);
    await page.locator('#auth-password').fill('Password123!');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#credits-pill')).toBeVisible();
}

async function canvasPoint(page, xFraction, yFraction) {
    const box = await page.locator('#main-canvas').boundingBox();
    return { x: box.x + box.width * xFraction, y: box.y + box.height * yFraction };
}

test('new visitor signs up from Create, designs a greeting card, saves, reopens, and downloads', async ({ page }) => {
    const errors = trackBrowserErrors(page);
    const email = uniqueEmail('flow');
    const prompt = `Lighthouse on a cliff ${Date.now()}`;

    await page.goto('/');
    await expect(page).toHaveTitle(/Nano Banana/);
    await expect(page.locator('#stage-empty')).toContainText('Make something beautiful');
    await expect(page.locator('#footer-note')).toContainText('Sign up free');

    await page.locator('#prompt-input').fill(prompt);
    await page.locator('[data-style="watercolor"]').click();
    await expect(page.locator('#style-picked')).toHaveText('Watercolor');
    await page.locator('[data-shape="2:3"]').click();
    await page.locator('[data-model="gemini-3.1-flash-image"]').click();

    // Creating while signed out asks for an account, then continues automatically.
    await page.locator('#generate-btn').click();
    await expect(page.locator('#auth-dialog')).toBeVisible();
    await expect(page.locator('#auth-title')).toHaveText('Create your free account');
    await page.locator('#auth-email').fill(email);
    await page.locator('#auth-password').fill('Password123!');
    await page.locator('#auth-submit').click();

    await expect(page.locator('#main-canvas')).toBeVisible();
    await expect(page.locator('#credits-count')).toHaveText('2');
    const canvasSize = await page.locator('#main-canvas').evaluate((canvas) => ({ width: canvas.width, height: canvas.height }));
    expect(canvasSize.height / canvasSize.width).toBeCloseTo(1.5, 1);

    await page.locator('.panel-tab[data-tab="text"]').click();
    await page.locator('[data-template="greeting"]').click();
    await expect(page.locator('.layer-item')).toHaveCount(2);

    await page.locator('.layer-item').filter({ hasText: 'Happy Birthday' }).locator('[data-action="select"]').click();
    await page.locator('#layer-text').fill('Happy Birthday, Mom');
    await expect(page.locator('.layer-item').filter({ hasText: 'Happy Birthday, Mom' })).toBeVisible();

    // Drag the greeting lower on the canvas and confirm its position changed.
    const start = await canvasPoint(page, 0.5, 0.16);
    const end = await canvasPoint(page, 0.5, 0.6);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => {
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nb_studio_v2') || '{}'));
        return saved.design?.layers?.find((layer) => layer.text === 'Happy Birthday, Mom')?.y ?? 0;
    }).toBeGreaterThan(0.45);

    await page.locator('.panel-tab[data-tab="adjust"]').click();
    await page.locator('[data-look="warm"]').click();

    await page.locator('#save-btn').click();
    await expect(page.locator('#toast-region')).toContainText('Saved to My Art');
    await expect(page.locator('#save-label')).toHaveText('Save changes');

    await page.locator('.topnav [data-nav="gallery"]').click();
    const card = page.locator('.gallery-card').filter({ hasText: prompt });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Watercolor');

    await card.locator('[data-gallery-action="open"]').first().click();
    await expect(page.locator('#main-canvas')).toBeVisible();
    await expect(page.locator('.layer-item')).toHaveCount(2);
    await expect(page.locator('.layer-item').filter({ hasText: 'Happy Birthday, Mom' })).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#download-btn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^lighthouse-on-a-cliff-\d+\.png$/);

    expect(errors).toEqual([]);
});

test('canceling a generation refunds the credit', async ({ page }) => {
    const errors = trackBrowserErrors(page);
    await page.goto('/');
    await signUpFromHeader(page, uniqueEmail('cancel'));
    await expect(page.locator('#credits-count')).toHaveText('3');

    await page.locator('#prompt-input').fill('A slow painting that will be canceled');
    await page.locator('#generate-btn').click();
    await expect(page.locator('#stage-loading')).toBeVisible();
    await page.locator('#cancel-btn').click();

    await expect(page.locator('#toast-region')).toContainText('Canceled');
    await expect(page.locator('#generate-btn')).toBeEnabled();
    await expect(page.locator('#main-canvas')).toBeHidden();
    await expect(page.locator('#credits-count')).toHaveText('3');
    expect(errors).toEqual([]);
});

test('running out of credits opens the paywall and a credit pack tops up the balance', async ({ page }) => {
    const errors = trackBrowserErrors(page);
    await page.goto('/');
    await signUpFromHeader(page, uniqueEmail('paywall'));

    await page.locator('#prompt-input').fill('Hot air balloons over autumn hills');
    await page.locator('[data-model="gpt-image-2.5-sunburst"]').click();
    await expect(page.locator('#generate-cost')).toHaveText('· 4 credits');
    await expect(page.locator('#credits-pill')).toHaveClass(/low/);

    await page.locator('#generate-btn').click();
    await expect(page.locator('#paywall-dialog')).toBeVisible();
    await expect(page.locator('#paywall-title')).toHaveText('You\'re out of credits');
    await expect(page.locator('#paywall-dialog')).toContainText('This image needs 4 credits and you have 3');

    await page.locator('[data-checkout="credit_pack"][data-pack="small"]').click();
    await expect(page.locator('#toast-region')).toContainText('Test payment complete');
    await expect(page.locator('#credits-count')).toHaveText('103');

    await page.locator('#generate-btn').click();
    await expect(page.locator('#main-canvas')).toBeVisible();
    await expect(page.locator('#credits-count')).toHaveText('99');

    await page.locator('#account-btn').click();
    await expect(page.locator('#account-container')).toContainText('Purchased credits (never expire)');
    await expect(page.locator('#account-container')).toContainText('99');
    expect(errors).toEqual([]);
});

test('admin can connect with the token and give a tester credits', async ({ page }) => {
    const errors = trackBrowserErrors(page);
    const email = uniqueEmail('admin');
    await page.goto('/');
    await signUpFromHeader(page, email);

    await page.goto('/#admin');
    await page.locator('#admin-token-input').fill('e2e-admin-token');
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.locator('.metric').first()).toBeVisible();

    const grantForm = page.locator('[data-admin-form="grant"]');
    await grantForm.locator('input[name="email"]').fill(email);
    await grantForm.locator('input[name="credits"]').fill('25');
    await grantForm.getByRole('button', { name: 'Give credits' }).click();
    await expect(page.locator('#toast-region')).toContainText(`Gave 25 credits to ${email}`);

    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain('e2e-admin-token');
    expect(errors).toEqual([]);
});

test('phone layout keeps navigation reachable without sideways scrolling', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = trackBrowserErrors(page);
    await page.goto('/');

    await expect(page.locator('.brand')).toBeVisible();
    await expect(page.locator('.topnav')).toBeVisible();
    await expect(page.locator('#generate-btn')).toBeVisible();

    const topnavBox = await page.locator('.topnav').boundingBox();
    expect(topnavBox.y + topnavBox.height).toBeGreaterThan(800);

    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.viewport);
    expect(errors).toEqual([]);
    await context.close();
});
