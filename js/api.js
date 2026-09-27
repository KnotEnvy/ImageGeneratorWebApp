/**
 * Browser API client. Every call goes to same-origin /api routes; provider and Stripe
 * credentials live only on the server.
 */
export class ApiError extends Error {
    constructor(message, { status = 0, code = 'request_failed', details = null } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

async function requestJson(url, options = {}) {
    const headers = {
        Accept: 'application/json',
        ...(options.headers || {})
    };
    const init = {
        method: options.method || 'GET',
        credentials: 'same-origin',
        headers,
        signal: options.signal
    };
    if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(options.body);
    }

    let response;
    try {
        response = await fetch(url, init);
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new ApiError('Could not reach the server. Check your connection and try again.', { code: 'network_error' });
    }

    const text = await response.text();
    let data = {};
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = {};
        }
    }

    if (!response.ok || data.ok === false) {
        throw new ApiError(data.error?.message || `Request failed (${response.status}).`, {
            status: response.status,
            code: data.error?.code || 'request_failed',
            details: data.error?.details || null
        });
    }

    return data;
}

export function createIdempotencyKey() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export const getStatus = () => requestJson('/api/status');
export const getBillingStatus = () => requestJson('/api/billing/status');

export const signUp = (email, password) => requestJson('/api/auth/signup', { method: 'POST', body: { email, password } });
export const login = (email, password) => requestJson('/api/auth/login', { method: 'POST', body: { email, password } });
export const logout = () => requestJson('/api/auth/logout', { method: 'POST' });
export const requestEmailVerification = () => requestJson('/api/auth/request-verification', { method: 'POST' });
export const verifyEmail = (token) => requestJson('/api/auth/verify-email', { method: 'POST', body: { token } });
export const requestPasswordReset = (email) => requestJson('/api/auth/request-password-reset', { method: 'POST', body: { email } });
export const resetPassword = (token, password) => requestJson('/api/auth/reset-password', { method: 'POST', body: { token, password } });

export const startCheckout = (kind, packId) => requestJson('/api/billing/checkout', {
    method: 'POST',
    body: { kind, packId }
});
export const openBillingPortal = () => requestJson('/api/billing/portal', { method: 'POST' });
export const completeMockCheckout = (sessionId) => requestJson('/api/billing/mock-complete', {
    method: 'POST',
    body: { sessionId }
});

export async function improveDescription(prompt, styleId) {
    const data = await requestJson('/api/prompt-enhancements', {
        method: 'POST',
        body: { prompt, styleId }
    });
    return data.enhancedPrompt;
}

export function generateImage({ provider, model, prompt, styleId, textSpace, aspectRatio, signal, idempotencyKey }) {
    return requestJson('/api/generations', {
        method: 'POST',
        signal,
        headers: {
            'Idempotency-Key': idempotencyKey || createIdempotencyKey()
        },
        body: {
            provider,
            model,
            prompt,
            styleId,
            textSpace,
            aspectRatio,
            quality: 'medium',
            outputFormat: 'png'
        }
    });
}

export async function getGallery() {
    const data = await requestJson('/api/gallery');
    return data.items || [];
}

export async function saveGalleryItem(item) {
    const data = await requestJson('/api/gallery', { method: 'POST', body: item });
    return data.item;
}

export async function updateGalleryItem(id, item) {
    const data = await requestJson(`/api/gallery/${encodeURIComponent(id)}`, { method: 'PUT', body: item });
    return data.item;
}

export const deleteGalleryItem = (id) => requestJson(`/api/gallery/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const reportAbuse = (report) => requestJson('/api/abuse-reports', { method: 'POST', body: report });

function adminRequest(url, token, options = {}) {
    return requestJson(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`
        }
    });
}

export const getAdminSummary = (token) => adminRequest('/api/admin/summary', token);
export const getAdminJobs = (token) => adminRequest('/api/admin/jobs?limit=20', token);
export const getAdminReports = (token) => adminRequest('/api/admin/reports?limit=20', token);
export const getAdminPolicyEvents = (token) => adminRequest('/api/admin/policy-events?limit=20', token);
export const grantAdminCredits = (token, grant) => adminRequest('/api/admin/credits', token, { method: 'POST', body: grant });
