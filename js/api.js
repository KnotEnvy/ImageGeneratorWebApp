/**
 * Client-side API wrapper.
 * Provider credentials live only on the Node server and are never accepted from the browser.
 */

export async function getProviderStatus() {
    const data = await requestJson('/api/status');
    return data;
}

export async function getCurrentSession() {
    return requestJson('/api/auth/session');
}

export async function getBillingStatus() {
    return requestJson('/api/billing/status');
}

export async function createBillingCheckoutSession() {
    return requestJson('/api/billing/checkout', {
        method: 'POST'
    });
}

export async function createBillingPortalSession() {
    return requestJson('/api/billing/portal', {
        method: 'POST'
    });
}

export async function signUp(email, password) {
    return requestJson('/api/auth/signup', {
        method: 'POST',
        body: { email, password }
    });
}

export async function login(email, password) {
    return requestJson('/api/auth/login', {
        method: 'POST',
        body: { email, password }
    });
}

export async function logout() {
    return requestJson('/api/auth/logout', {
        method: 'POST'
    });
}

export async function requestEmailVerification() {
    return requestJson('/api/auth/request-verification', {
        method: 'POST'
    });
}

export async function verifyEmail(token) {
    return requestJson('/api/auth/verify-email', {
        method: 'POST',
        body: { token }
    });
}

export async function requestPasswordReset(email) {
    return requestJson('/api/auth/request-password-reset', {
        method: 'POST',
        body: { email }
    });
}

export async function resetPassword(token, password) {
    return requestJson('/api/auth/reset-password', {
        method: 'POST',
        body: { token, password }
    });
}

/**
 * Enhance a raw prompt using the server-side Gemini prompt route.
 * @param {string} rawPrompt
 * @param {string} stylePreset
 * @returns {Promise<string>}
 */
export async function enhancePromptAPI(rawPrompt, stylePreset) {
    const data = await requestJson('/api/prompt-enhancements', {
        method: 'POST',
        body: {
            prompt: rawPrompt,
            stylePreset
        }
    });

    return data.enhancedPrompt;
}

/**
 * Generate an image through the server-side provider adapters.
 * @param {object} request
 * @param {string} request.provider
 * @param {string} request.model
 * @param {string} request.prompt
 * @param {string} request.aspectRatio
 * @param {string=} request.quality
 * @param {string=} request.outputFormat
 * @returns {Promise<string>} Server-owned image URL
 */
export async function generateImageAPI(request) {
    const data = await requestJson('/api/generations', {
        method: 'POST',
        headers: {
            'Idempotency-Key': request.idempotencyKey || createIdempotencyKey()
        },
        signal: request.signal,
        body: {
            provider: request.provider,
            model: request.model,
            prompt: request.prompt,
            aspectRatio: request.aspectRatio,
            quality: request.quality || 'medium',
            outputFormat: request.outputFormat || 'png'
        }
    });

    const imageSource = data.imageUrl || data.imageDataUrl;
    if (!imageSource) {
        throw new Error('Generation completed without image data.');
    }

    return imageSource;
}

function createIdempotencyKey() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return `gen-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function getGallery() {
    const data = await requestJson('/api/gallery');
    return data.items || [];
}

export async function saveGalleryItem(item) {
    const data = await requestJson('/api/gallery', {
        method: 'POST',
        body: item
    });
    return data.item;
}

export async function deleteGalleryItem(id) {
    await requestJson(`/api/gallery/${encodeURIComponent(id)}`, {
        method: 'DELETE'
    });
    return true;
}

export async function reportAbuse(report) {
    const data = await requestJson('/api/abuse-reports', {
        method: 'POST',
        body: report
    });
    return data.report;
}

export async function getAdminSummary(adminToken) {
    const data = await requestJson('/api/admin/summary', {
        headers: adminHeaders(adminToken)
    });
    return data.summary;
}

export async function getAdminJobs(adminToken) {
    const data = await requestJson('/api/admin/jobs?limit=10', {
        headers: adminHeaders(adminToken)
    });
    return data.jobs || [];
}

export async function getAdminReports(adminToken) {
    const data = await requestJson('/api/admin/reports?limit=10', {
        headers: adminHeaders(adminToken)
    });
    return data.reports || [];
}

export async function getAdminPolicyEvents(adminToken) {
    const data = await requestJson('/api/admin/policy-events?limit=10', {
        headers: adminHeaders(adminToken)
    });
    return data.events || [];
}

function adminHeaders(adminToken) {
    return {
        Authorization: `Bearer ${adminToken}`
    };
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, {
        method: options.method || 'GET',
        credentials: 'same-origin',
        signal: options.signal,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await parseJsonResponse(response);
    if (!response.ok || data.ok === false) {
        const error = new Error(data.error?.message || `Request failed with status ${response.status}`);
        error.code = data.error?.code || 'request_failed';
        throw error;
    }

    return data;
}

async function parseJsonResponse(response) {
    const text = await response.text();
    if (!text) return {};

    try {
        return JSON.parse(text);
    } catch {
        return {
            ok: false,
            error: {
                message: 'Server returned an invalid JSON response.'
            }
        };
    }
}
