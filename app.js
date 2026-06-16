import { initDB, saveCreation } from './js/db.js';
import {
    createBillingCheckoutSession,
    createBillingPortalSession,
    enhancePromptAPI,
    generateImageAPI,
    getAdminJobs,
    getAdminPolicyEvents,
    getAdminReports,
    getAdminSummary,
    getCurrentSession,
    getProviderStatus,
    login,
    logout,
    requestEmailVerification,
    requestPasswordReset,
    resetPassword,
    signUp,
    verifyEmail
} from './js/api.js';
import { CanvasEditor } from './js/editor.js';
import { renderGallery } from './js/gallery.js';

// DOM Element Bindings
const els = {
    // Views
    studioView: document.getElementById('studio-view'),
    galleryView: document.getElementById('gallery-view'),
    settingsView: document.getElementById('settings-view'),
    adminView: document.getElementById('admin-view'),
    
    // Navigation Triggers
    navStudio: document.getElementById('nav-studio'),
    navGallery: document.getElementById('nav-gallery'),
    navSettings: document.getElementById('nav-settings'),
    navAdmin: document.getElementById('nav-admin'),
    logoTrigger: document.getElementById('logo-trigger'),
    apiKeyBadge: document.getElementById('api-key-badge'),
    
    // Tab controls
    tabTriggers: document.querySelectorAll('.tab-trigger'),
    tabContents: document.querySelectorAll('.panel-tab-content'),
    
    // Inputs: Generate Tab
    promptInput: document.getElementById('prompt-input'),
    enhancePromptBtn: document.getElementById('enhance-prompt-btn'),
    stylePresets: document.getElementById('style-presets'),
    aspectBtns: document.querySelectorAll('.aspect-btn'),
    modelSelector: document.getElementById('model-selector'),
    generateBtn: document.getElementById('generate-btn'),
    
    // Inputs: Typography Tab
    headerActive: document.getElementById('header-active'),
    headerText: document.getElementById('header-text-input'),
    headerFont: document.getElementById('header-font'),
    headerAlign: document.getElementById('header-align'),
    headerSize: document.getElementById('header-size'),
    headerSizeVal: document.getElementById('header-size-val'),
    headerSpacing: document.getElementById('header-spacing'),
    headerSpacingVal: document.getElementById('header-spacing-val'),
    headerColorCustom: document.getElementById('header-color-custom'),

    quoteActive: document.getElementById('quote-active'),
    quoteText: document.getElementById('quote-text-input'),
    quoteFont: document.getElementById('quote-font'),
    quoteAlign: document.getElementById('quote-align'),
    quoteSize: document.getElementById('quote-size'),
    quoteSizeVal: document.getElementById('quote-size-val'),
    quoteLineHeight: document.getElementById('quote-lineheight'),
    quoteLineHeightVal: document.getElementById('quote-lineheight-val'),
    quoteColorCustom: document.getElementById('quote-color-custom'),

    authorActive: document.getElementById('author-active'),
    authorText: document.getElementById('author-text-input'),
    authorFont: document.getElementById('author-font'),
    authorAlign: document.getElementById('author-align'),
    authorSize: document.getElementById('author-size'),
    authorSizeVal: document.getElementById('author-size-val'),
    authorSpacing: document.getElementById('author-spacing'),
    authorSpacingVal: document.getElementById('author-spacing-val'),
    authorColorCustom: document.getElementById('author-color-custom'),
    
    // Inputs: Filters Tab
    filterBrightness: document.getElementById('filter-brightness'),
    filterBrightnessVal: document.getElementById('filter-brightness-val'),
    filterContrast: document.getElementById('filter-contrast'),
    filterContrastVal: document.getElementById('filter-contrast-val'),
    filterSaturation: document.getElementById('filter-saturation'),
    filterSaturationVal: document.getElementById('filter-saturation-val'),
    filterBlur: document.getElementById('filter-blur'),
    filterBlurVal: document.getElementById('filter-blur-val'),
    filterVignette: document.getElementById('filter-vignette'),
    filterVignetteVal: document.getElementById('filter-vignette-val'),
    
    // Server status tab
    statusOpenAI: document.getElementById('status-openai'),
    statusGemini: document.getElementById('status-gemini'),
    statusHuggingFace: document.getElementById('status-huggingface'),
    refreshStatusBtn: document.getElementById('refresh-status-btn'),
    accountStatusText: document.getElementById('account-status-text'),
    emailStatusText: document.getElementById('email-status-text'),
    planStatusText: document.getElementById('plan-status-text'),
    billingStatusText: document.getElementById('billing-status-text'),
    quotaStatusText: document.getElementById('quota-status-text'),
    authForm: document.getElementById('auth-form'),
    authEmailInput: document.getElementById('auth-email-input'),
    authPasswordInput: document.getElementById('auth-password-input'),
    signInBtn: document.getElementById('sign-in-btn'),
    signUpBtn: document.getElementById('sign-up-btn'),
    signOutBtn: document.getElementById('sign-out-btn'),
    sendVerificationBtn: document.getElementById('send-verification-btn'),
    requestPasswordResetBtn: document.getElementById('request-password-reset-btn'),
    resetPasswordPanel: document.getElementById('reset-password-panel'),
    resetPasswordInput: document.getElementById('reset-password-input'),
    resetPasswordSubmitBtn: document.getElementById('reset-password-submit-btn'),
    billingActions: document.getElementById('billing-actions'),
    upgradePlanBtn: document.getElementById('upgrade-plan-btn'),
    manageBillingBtn: document.getElementById('manage-billing-btn'),

    // Admin tab
    adminTokenInput: document.getElementById('admin-token-input'),
    adminConnectBtn: document.getElementById('admin-connect-btn'),
    adminRefreshBtn: document.getElementById('admin-refresh-btn'),
    adminDashboard: document.getElementById('admin-dashboard'),
    adminMetrics: document.getElementById('admin-metrics'),
    adminJobsList: document.getElementById('admin-jobs-list'),
    adminReportsList: document.getElementById('admin-reports-list'),
    adminPolicyList: document.getElementById('admin-policy-list'),
    
    // Workspace
    editorPlaceholder: document.getElementById('editor-placeholder'),
    canvasViewport: document.getElementById('canvas-viewport'),
    mainCanvas: document.getElementById('main-canvas'),
    dragHint: document.getElementById('drag-hint'),
    
    // Floating Actions
    resetBtn: document.getElementById('reset-editor-btn'),
    shareBtn: document.getElementById('share-canvas-btn'),
    saveGalleryBtn: document.getElementById('save-gallery-btn'),
    downloadBtn: document.getElementById('download-canvas-btn'),
    
    // Loading State Overlay
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingText: document.getElementById('loading-status-text'),
    cancelGenerationBtn: document.getElementById('cancel-generation-btn'),
    toastContainer: document.getElementById('toast-container'),
    galleryContainer: document.getElementById('gallery-container')
};

// Global App State
let selectedPreset = 'None';
let selectedAspect = '1:1';
let currentOriginalImageBase64 = null; // Stored to save session
let providerStatus = { providers: {} };
let currentUser = null;
let generationAbortController = null;
let adminToken = '';
let pendingPasswordResetToken = '';

// Instantiate Editor
const editor = new CanvasEditor(els.mainCanvas);

// Bind drag end to auto-save session
editor.onDragEnd = saveSessionToLocalStorage;

// Initialize DB and application
async function init() {
    try {
        await initDB();
        bindUIEvents();
        syncStateToUI(); // Initialize controls values to match editor defaults
        await loadAccountSession({ silent: true });
        await loadProviderStatus({ silent: true });
        await handleAuthUrlActions();
        
        // Restore session if available
        await restoreSessionFromLocalStorage();
    } catch (err) {
        showToast('IndexedDB Init Failed: ' + err.message, 'error');
    }
}

// Update server-provider badge UI based on server-side configuration
function updateApiKeyBadge() {
    const configured = getConfiguredProviderLabels();
    
    if (configured.length > 0) {
        els.apiKeyBadge.classList.add('valid');
        setStatusBadge(`Server API: ${configured.join(' + ')}`);
    } else {
        els.apiKeyBadge.classList.remove('valid');
        setStatusBadge('Server API Setup Required');
    }
}

function setStatusBadge(text) {
    const indicator = document.createElement('span');
    indicator.className = 'indicator';
    indicator.textContent = '*';
    els.apiKeyBadge.replaceChildren(indicator, document.createTextNode(` ${text}`));
}

async function loadProviderStatus({ silent = false } = {}) {
    try {
        providerStatus = await getProviderStatus();
        if (providerStatus.user || providerStatus.user === null) {
            currentUser = providerStatus.user;
        }
    } catch (err) {
        providerStatus = { providers: {} };
        if (!silent) {
            showToast('Failed to load server provider status: ' + err.message, 'error');
        }
    }

    updateApiKeyBadge();
    updateProviderStatusUI();
    updateAccountUI();
}

async function loadAccountSession({ silent = false } = {}) {
    try {
        const session = await getCurrentSession();
        currentUser = session.user || null;
    } catch (err) {
        currentUser = null;
        if (!silent) {
            showToast('Failed to load account session: ' + err.message, 'error');
        }
    }

    updateAccountUI();
}

function updateAccountUI() {
    if (!els.accountStatusText) return;

    if (currentUser) {
        els.accountStatusText.textContent = currentUser.email;
        const quota = currentUser.quota;
        const subscription = currentUser.subscription;
        const planLabel = currentUser.entitlements?.planLabel || currentUser.plan || 'Starter';
        const needsEmailVerification = currentUser.emailVerificationRequired && !currentUser.emailVerified;
        els.planStatusText.textContent = planLabel;
        if (els.emailStatusText) {
            els.emailStatusText.textContent = currentUser.emailVerified
                ? 'Verified'
                : (currentUser.emailVerificationRequired ? 'Verification required' : 'Not verified');
        }
        els.billingStatusText.textContent = subscription
            ? `${formatStatus(subscription.status)} (${subscription.billingProvider})`
            : 'Local active';
        els.quotaStatusText.textContent = quota
            ? `${quota.monthlyUsed}/${quota.monthlyLimit} used`
            : `${currentUser.monthlyGenerationLimit || 0} monthly limit`;
        if (els.authForm) els.authForm.style.display = 'none';
        if (els.signOutBtn) els.signOutBtn.style.display = 'block';
        if (els.sendVerificationBtn) els.sendVerificationBtn.style.display = needsEmailVerification ? 'block' : 'none';
        if (els.requestPasswordResetBtn) els.requestPasswordResetBtn.style.display = 'none';
        if (els.billingActions) els.billingActions.style.display = 'grid';
        if (els.upgradePlanBtn) {
            const isPro = currentUser.entitlements?.plan === 'pro';
            els.upgradePlanBtn.style.display = isPro ? 'none' : 'block';
        }
        if (els.manageBillingBtn) {
            els.manageBillingBtn.disabled = !subscription?.billingCustomerId;
        }
    } else {
        els.accountStatusText.textContent = 'Signed out';
        if (els.emailStatusText) els.emailStatusText.textContent = 'Sign in required';
        els.planStatusText.textContent = 'Sign in required';
        els.billingStatusText.textContent = 'Sign in required';
        els.quotaStatusText.textContent = 'Sign in to use generation';
        if (els.authForm) els.authForm.style.display = 'grid';
        if (els.signOutBtn) els.signOutBtn.style.display = 'none';
        if (els.sendVerificationBtn) els.sendVerificationBtn.style.display = 'none';
        if (els.requestPasswordResetBtn) els.requestPasswordResetBtn.style.display = 'block';
        if (els.billingActions) els.billingActions.style.display = 'none';
        if (els.upgradePlanBtn) els.upgradePlanBtn.style.display = 'block';
        if (els.manageBillingBtn) els.manageBillingBtn.disabled = true;
    }

    updatePasswordResetUI();
}

function formatStatus(status) {
    return String(status || 'active')
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function updatePasswordResetUI() {
    if (!els.resetPasswordPanel) return;
    els.resetPasswordPanel.style.display = pendingPasswordResetToken ? 'grid' : 'none';
}

function readAuthForm() {
    return {
        email: els.authEmailInput.value.trim(),
        password: els.authPasswordInput.value
    };
}

async function handleAuthAction(action) {
    const { email, password } = readAuthForm();
    if (!email || !password) {
        showToast('Email and password are required.', 'error');
        return;
    }

    els.signInBtn.disabled = true;
    els.signUpBtn.disabled = true;

    try {
        const result = action === 'signup'
            ? await signUp(email, password)
            : await login(email, password);
        currentUser = result.user;
        els.authPasswordInput.value = '';
        updateAccountUI();
        showToast(action === 'signup' ? 'Account created.' : 'Signed in.', 'success');
        loadGallery();
    } catch (err) {
        showToast((action === 'signup' ? 'Sign up failed: ' : 'Sign in failed: ') + err.message, 'error');
    } finally {
        els.signInBtn.disabled = false;
        els.signUpBtn.disabled = false;
    }
}

async function handleSignOut() {
    try {
        await logout();
        currentUser = null;
        updateAccountUI();
        loadGallery();
        showToast('Signed out.', 'info');
    } catch (err) {
        showToast('Sign out failed: ' + err.message, 'error');
    }
}

async function handleSendVerification() {
    if (!requireSignedIn('request verification')) {
        return;
    }

    els.sendVerificationBtn.disabled = true;
    try {
        await requestEmailVerification();
        showToast('Verification link requested.', 'success');
    } catch (err) {
        showToast('Verification request failed: ' + err.message, 'error');
    } finally {
        els.sendVerificationBtn.disabled = false;
    }
}

async function handleRequestPasswordReset() {
    const email = els.authEmailInput?.value.trim();
    if (!email) {
        showToast('Enter your account email first.', 'error');
        return;
    }

    els.requestPasswordResetBtn.disabled = true;
    try {
        await requestPasswordReset(email);
        showToast('If an account exists, a reset link will be sent.', 'success');
    } catch (err) {
        showToast('Password reset request failed: ' + err.message, 'error');
    } finally {
        els.requestPasswordResetBtn.disabled = false;
    }
}

async function handleResetPasswordSubmit() {
    if (!pendingPasswordResetToken) {
        showToast('Reset link is missing or expired.', 'error');
        return;
    }

    const password = els.resetPasswordInput?.value || '';
    if (!password) {
        showToast('New password is required.', 'error');
        return;
    }

    els.resetPasswordSubmitBtn.disabled = true;
    try {
        await resetPassword(pendingPasswordResetToken, password);
        pendingPasswordResetToken = '';
        if (els.resetPasswordInput) els.resetPasswordInput.value = '';
        currentUser = null;
        updateAccountUI();
        showToast('Password updated. Sign in with the new password.', 'success');
    } catch (err) {
        showToast('Password reset failed: ' + err.message, 'error');
    } finally {
        els.resetPasswordSubmitBtn.disabled = false;
    }
}

async function handleAuthUrlActions() {
    const url = new URL(window.location.href);
    const verifyToken = url.searchParams.get('verify_email');
    const resetToken = url.searchParams.get('reset_password');

    if (!verifyToken && !resetToken) {
        return;
    }

    clearAuthUrlParams(url);
    switchView('settings');

    if (verifyToken) {
        try {
            const result = await verifyEmail(verifyToken);
            if (result.user) {
                currentUser = result.user;
            }
            await loadAccountSession({ silent: true });
            showToast('Email verified.', 'success');
        } catch (err) {
            showToast('Email verification failed: ' + err.message, 'error');
        }
    }

    if (resetToken) {
        pendingPasswordResetToken = resetToken;
        updatePasswordResetUI();
        showToast('Enter a new password to finish reset.', 'info');
    }
}

function clearAuthUrlParams(url) {
    url.searchParams.delete('verify_email');
    url.searchParams.delete('reset_password');
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

async function handleUpgradePlan() {
    if (!requireSignedIn('upgrade your plan')) {
        return;
    }

    els.upgradePlanBtn.disabled = true;
    try {
        const checkout = await createBillingCheckoutSession();
        window.location.href = checkout.url;
    } catch (err) {
        showToast('Checkout failed: ' + err.message, 'error');
    } finally {
        els.upgradePlanBtn.disabled = false;
    }
}

async function handleManageBilling() {
    if (!requireSignedIn('manage billing')) {
        return;
    }

    els.manageBillingBtn.disabled = true;
    try {
        const portal = await createBillingPortalSession();
        window.location.href = portal.url;
    } catch (err) {
        showToast('Billing portal failed: ' + err.message, 'error');
        updateAccountUI();
    }
}

function requireSignedIn(actionName) {
    if (currentUser) {
        return true;
    }

    showToast(`Sign in before you ${actionName}.`, 'error');
    switchView('settings');
    return false;
}

function updateProviderStatusUI() {
    setProviderStatusText(els.statusOpenAI, 'openai');
    setProviderStatusText(els.statusGemini, 'gemini');
    setProviderStatusText(els.statusHuggingFace, 'huggingface');
}

function setProviderStatusText(element, provider) {
    if (!element) return;
    const configured = isProviderConfigured(provider);
    element.textContent = configured ? 'Ready' : 'Missing server key';
    element.classList.toggle('status-ok', configured);
    element.classList.toggle('status-missing', !configured);
}

function getConfiguredProviderLabels() {
    const labels = [];
    if (isProviderConfigured('openai')) labels.push('OpenAI');
    if (isProviderConfigured('gemini')) labels.push('Gemini');
    if (isProviderConfigured('huggingface')) labels.push('HF');
    return labels;
}

function isProviderConfigured(provider) {
    return Boolean(providerStatus.providers?.[provider]?.configured);
}

function getProviderForModel(model) {
    if (model.startsWith('gpt-image')) return 'openai';
    if (model.startsWith('gemini')) return 'gemini';
    return 'huggingface';
}

function getProviderLabel(provider) {
    return providerStatus.providers?.[provider]?.label || provider;
}

// Change Active App Tab (Studio, Gallery, Setup)
function switchView(viewName) {
    // Nav buttons active classes
    els.navStudio.classList.remove('active');
    els.navGallery.classList.remove('active');
    els.navSettings.classList.remove('active');
    els.navAdmin.classList.remove('active');
    
    // Hide all
    els.studioView.classList.remove('active');
    els.galleryView.classList.remove('active');
    els.settingsView.classList.remove('active');
    els.adminView.classList.remove('active');

    if (viewName === 'studio') {
        els.navStudio.classList.add('active');
        els.studioView.classList.add('active');
        if (editor.backgroundImage) {
            // Trigger redraw on show to avoid layout squishing
            editor.draw();
        }
    } else if (viewName === 'gallery') {
        els.navGallery.classList.add('active');
        els.galleryView.classList.add('active');
        loadGallery();
    } else if (viewName === 'settings') {
        els.navSettings.classList.add('active');
        els.settingsView.classList.add('active');
        loadProviderStatus();
    } else if (viewName === 'admin') {
        els.navAdmin.classList.add('active');
        els.adminView.classList.add('active');
        if (adminToken) {
            loadAdminDashboard();
        }
    }
}

// Trigger creations list render
function loadGallery() {
    renderGallery(els.galleryContainer, handleEditCreation, showToast);
}

async function loadAdminDashboard() {
    if (!adminToken) {
        showToast('Enter an admin token first.', 'error');
        return;
    }

    setAdminLoading(true);
    try {
        const [summary, jobs, reports, policyEvents] = await Promise.all([
            getAdminSummary(adminToken),
            getAdminJobs(adminToken),
            getAdminReports(adminToken),
            getAdminPolicyEvents(adminToken)
        ]);

        els.adminDashboard.hidden = false;
        renderAdminMetrics(summary);
        renderAdminJobs(jobs);
        renderAdminReports(reports);
        renderAdminPolicyEvents(policyEvents);
        showToast('Admin dashboard refreshed.', 'success');
    } catch (err) {
        els.adminDashboard.hidden = true;
        showToast('Admin dashboard failed: ' + err.message, 'error');
    } finally {
        setAdminLoading(false);
    }
}

function setAdminLoading(loading) {
    els.adminConnectBtn.disabled = loading;
    els.adminRefreshBtn.disabled = loading || !adminToken;
    els.adminRefreshBtn.textContent = loading ? 'Refreshing...' : 'Refresh';
}

function renderAdminMetrics(summary) {
    const totals = summary?.totals || {};
    const usage = summary?.usage || {};
    const policy = summary?.contentPolicy || {};
    const reports = summary?.abuseReports || {};
    const metrics = [
        ['Users', totals.users ?? 0],
        ['Jobs', totals.generationJobs ?? 0],
        ['Usage Events', usage.totalEvents ?? 0],
        ['Assets', totals.imageAssets ?? 0],
        ['Policy Events', totals.contentPolicyEvents ?? 0],
        ['Open Reports', reports.byStatus?.open ?? 0],
        ['Completed Jobs', summary?.jobsByStatus?.completed ?? 0],
        ['Blocked Codes', Object.keys(policy.byCode || {}).length]
    ];

    els.adminMetrics.replaceChildren(...metrics.map(([label, value]) => {
        const card = document.createElement('div');
        card.className = 'admin-metric-card';
        const valueEl = document.createElement('strong');
        valueEl.textContent = String(value);
        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        card.replaceChildren(valueEl, labelEl);
        return card;
    }));
}

function renderAdminJobs(jobs) {
    renderAdminList(els.adminJobsList, jobs, (job) => [
        ['Status', job.status],
        ['Model', job.model],
        ['Plan', job.plan || 'none'],
        ['Error', job.errorCode || 'none']
    ], 'No jobs yet.');
}

function renderAdminReports(reports) {
    renderAdminList(els.adminReportsList, reports, (report) => [
        ['Status', report.status],
        ['Reason', report.reason],
        ['Target', `${report.targetType}:${report.targetId || 'none'}`],
        ['Details', report.details || 'none']
    ], 'No abuse reports.');
}

function renderAdminPolicyEvents(events) {
    renderAdminList(els.adminPolicyList, events, (event) => [
        ['Surface', event.surface],
        ['Code', event.policyCode],
        ['Tags', (event.tags || []).join(', ') || 'none'],
        ['Excerpt', event.textExcerpt || 'none']
    ], 'No policy events.');
}

function renderAdminList(container, items, getRows, emptyText) {
    container.replaceChildren();
    if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'admin-empty';
        empty.textContent = emptyText;
        container.appendChild(empty);
        return;
    }

    for (const item of items) {
        const entry = document.createElement('article');
        entry.className = 'admin-list-item';

        const header = document.createElement('div');
        header.className = 'admin-list-heading';
        const idEl = document.createElement('strong');
        idEl.textContent = item.id || 'record';
        const dateEl = document.createElement('span');
        dateEl.textContent = formatAdminDate(item.createdAt || item.updatedAt);
        header.replaceChildren(idEl, dateEl);

        const rows = document.createElement('dl');
        for (const [label, value] of getRows(item)) {
            const dt = document.createElement('dt');
            dt.textContent = label;
            const dd = document.createElement('dd');
            dd.textContent = String(value ?? 'none');
            rows.append(dt, dd);
        }

        entry.replaceChildren(header, rows);
        container.appendChild(entry);
    }
}

function formatAdminDate(value) {
    if (!value) return 'unknown';
    return new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Edit a saved creation callback from gallery
async function handleEditCreation(creation) {
    showToast('Loading creation to workspace...', 'info');
    switchView('studio');
    
    // Show loader
    toggleLoading(true, 'Reconstructing Art Layers...');
    
    try {
        // Load the original image first
        currentOriginalImageBase64 = creation.originalImage;
        await editor.loadImage(creation.originalImage);
        
        // Restore overlay and filters coordinates
        editor.state.overlays = JSON.parse(JSON.stringify(creation.overlays));
        editor.state.filters = JSON.parse(JSON.stringify(creation.filters));
        
        // Sync UI inputs to match this state
        syncStateToUI();
        
        // Draw editor canvas
        editor.draw();
        
        // Swap placeholders
        els.editorPlaceholder.style.display = 'none';
        els.canvasViewport.style.display = 'block';
        els.dragHint.style.display = 'flex';
        
        // Save restored state to active session
        saveSessionToLocalStorage();
        
        showToast('Layers loaded. You can adjust text, drag layers, or add filters.', 'success');
    } catch (err) {
        showToast('Failed to reload canvas: ' + err.message, 'error');
    } finally {
        toggleLoading(false);
    }
}

// Toggle loading overlay in Editor
function toggleLoading(show, message = 'Processing...', options = {}) {
    if (show) {
        els.loadingText.textContent = message;
        els.loadingOverlay.classList.add('active');
        if (els.cancelGenerationBtn) {
            els.cancelGenerationBtn.style.display = options.cancellable ? 'inline-flex' : 'none';
            els.cancelGenerationBtn.disabled = Boolean(options.canceling);
        }
    } else {
        els.loadingOverlay.classList.remove('active');
        if (els.cancelGenerationBtn) {
            els.cancelGenerationBtn.style.display = 'none';
        }
    }
}

// Style Preset text appends
const styleAppends = {
    'None': '',
    'Cyberpunk Neon': ', cyberpunk art style, glowing vibrant ultraviolet and cyan neon lighting, futuristic cables, high contrast reflections',
    'Surrealist Dream': ', surrealist oil painting, whimsical structures, floating abstract elements, soft volumetric dream atmosphere',
    'Vintage Retro Poster': ', vintage print style, warm sepia tones, distressed paper texture, halftone grain, classic retro poster illustration',
    'Minimalist 3D Glass': ', frosted glassmorphism render, 3d minimal shape, smooth aesthetic textures, light pastel gradient backdrop, studio light',
    'Moody Dark Editorial': ', moody low-key editorial photo, dramatic chiaroscuro lighting, deep shadows, rich atmospheric contrast'
};

// Auto-Save workspace state to localStorage
function saveSessionToLocalStorage() {
    const sessionState = {
        prompt: els.promptInput.value.trim(),
        selectedPreset: selectedPreset,
        selectedAspect: selectedAspect,
        modelSelector: els.modelSelector.value,
        backgroundImage: currentOriginalImageBase64,
        overlays: editor.state.overlays,
        filters: editor.state.filters
    };
    try {
        localStorage.setItem('nano_banana_session', JSON.stringify(sessionState));
    } catch (err) {
        console.warn('Failed to save session to localStorage:', err);
    }
}

// Auto-Restore workspace state from localStorage
async function restoreSessionFromLocalStorage() {
    try {
        const stored = localStorage.getItem('nano_banana_session');
        if (!stored) return;
        
        const sessionState = JSON.parse(stored);
        if (!sessionState) return;

        // Restore prompt
        if (sessionState.prompt) {
            els.promptInput.value = sessionState.prompt;
        }

        // Restore style preset
        if (sessionState.selectedPreset) {
            selectedPreset = sessionState.selectedPreset;
            els.stylePresets.querySelectorAll('.preset-card').forEach(card => {
                if (card.getAttribute('data-preset') === selectedPreset) {
                    card.classList.add('active');
                } else {
                    card.classList.remove('active');
                }
            });
        }

        // Restore aspect ratio
        if (sessionState.selectedAspect) {
            selectedAspect = sessionState.selectedAspect;
            els.aspectBtns.forEach(btn => {
                if (btn.getAttribute('data-aspect') === selectedAspect) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }

        // Restore model selector
        if (sessionState.modelSelector) {
            els.modelSelector.value = sessionState.modelSelector;
        }

        // Restore background image & draw
        if (sessionState.backgroundImage) {
            currentOriginalImageBase64 = sessionState.backgroundImage;
            toggleLoading(true, 'Restoring session layers...');
            await editor.loadImage(sessionState.backgroundImage);
            
            if (sessionState.overlays) {
                editor.state.overlays = JSON.parse(JSON.stringify(sessionState.overlays));
            }
            if (sessionState.filters) {
                editor.state.filters = JSON.parse(JSON.stringify(sessionState.filters));
            }
            
            syncStateToUI();
            editor.draw();

            // Swap placeholders
            els.editorPlaceholder.style.display = 'none';
            els.canvasViewport.style.display = 'block';
            els.dragHint.style.display = 'flex';
        }
    } catch (err) {
        console.error('Failed to restore session:', err);
    } finally {
        toggleLoading(false);
    }
}

// Bind DOM event listeners
function bindUIEvents() {
    // Nav links
    els.navStudio.addEventListener('click', () => switchView('studio'));
    els.navGallery.addEventListener('click', () => switchView('gallery'));
    els.navSettings.addEventListener('click', () => switchView('settings'));
    els.navAdmin.addEventListener('click', () => switchView('admin'));
    els.logoTrigger.addEventListener('click', () => switchView('studio'));
    els.apiKeyBadge.addEventListener('click', () => switchView('settings'));

    // Control Panel tabs switching
    els.tabTriggers.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            
            // Toggle triggers active
            els.tabTriggers.forEach(t => t.classList.remove('active'));
            btn.classList.add('active');

            // Toggle contents active
            els.tabContents.forEach(c => {
                c.classList.remove('active');
                if (c.id === targetTab) c.classList.add('active');
            });
        });
    });

    // Style presets selector
    els.stylePresets.querySelectorAll('.preset-card').forEach(card => {
        card.addEventListener('click', () => {
            els.stylePresets.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            selectedPreset = card.getAttribute('data-preset');
            showToast(`Style set: ${selectedPreset}`, 'info');
            saveSessionToLocalStorage();
        });
    });

    // Aspect selectors
    els.aspectBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            els.aspectBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedAspect = btn.getAttribute('data-aspect');
            saveSessionToLocalStorage();
        });
    });

    // Model Selector change handler
    els.modelSelector.addEventListener('change', () => {
        saveSessionToLocalStorage();
    });

    if (els.refreshStatusBtn) {
        els.refreshStatusBtn.addEventListener('click', () => loadProviderStatus());
    }

    if (els.signInBtn) {
        els.signInBtn.addEventListener('click', () => handleAuthAction('login'));
    }
    if (els.signUpBtn) {
        els.signUpBtn.addEventListener('click', () => handleAuthAction('signup'));
    }
    if (els.signOutBtn) {
        els.signOutBtn.addEventListener('click', handleSignOut);
    }
    if (els.sendVerificationBtn) {
        els.sendVerificationBtn.addEventListener('click', handleSendVerification);
    }
    if (els.requestPasswordResetBtn) {
        els.requestPasswordResetBtn.addEventListener('click', handleRequestPasswordReset);
    }
    if (els.resetPasswordSubmitBtn) {
        els.resetPasswordSubmitBtn.addEventListener('click', handleResetPasswordSubmit);
    }
    if (els.upgradePlanBtn) {
        els.upgradePlanBtn.addEventListener('click', handleUpgradePlan);
    }
    if (els.manageBillingBtn) {
        els.manageBillingBtn.addEventListener('click', handleManageBilling);
    }
    if (els.adminConnectBtn) {
        els.adminConnectBtn.addEventListener('click', () => {
            adminToken = els.adminTokenInput.value.trim();
            if (!adminToken) {
                showToast('Admin token is required.', 'error');
                return;
            }
            els.adminTokenInput.value = '';
            loadAdminDashboard();
        });
    }
    if (els.adminRefreshBtn) {
        els.adminRefreshBtn.addEventListener('click', loadAdminDashboard);
    }

    // Prompt input listener
    els.promptInput.addEventListener('input', () => {
        saveSessionToLocalStorage();
    });

    // AI Enhance button
    els.enhancePromptBtn.addEventListener('click', async () => {
        const prompt = els.promptInput.value.trim();
        if (!prompt) {
            showToast('Please type a base prompt first.', 'error');
            return;
        }
        if (!requireSignedIn('enhance prompts')) {
            return;
        }
        if (!isProviderConfigured('gemini')) {
            showToast('Gemini is not configured on the server. Open Server Status for setup.', 'error');
            switchView('settings');
            return;
        }

        els.enhancePromptBtn.disabled = true;
        showToast('Gemini is enhancing prompt layout...', 'info');

        try {
            const enhanced = await enhancePromptAPI(prompt, selectedPreset);
            els.promptInput.value = enhanced;
            saveSessionToLocalStorage();
            showToast('Prompt enhanced with rich style parameters!', 'success');
        } catch (err) {
            showToast('Enhancer failed: ' + err.message, 'error');
        } finally {
            els.enhancePromptBtn.disabled = false;
        }
    });

    // Main Synthesize button
    els.generateBtn.addEventListener('click', async () => {
        const rawPrompt = els.promptInput.value.trim();
        if (!rawPrompt) {
            showToast('Please enter a creative prompt first.', 'error');
            return;
        }
        if (!requireSignedIn('generate images')) {
            return;
        }

        const model = els.modelSelector.value;
        const provider = getProviderForModel(model);

        if (!isProviderConfigured(provider)) {
            showToast(`${getProviderLabel(provider)} is not configured on the server. Open Server Status for setup.`, 'error');
            switchView('settings');
            return;
        }

        els.generateBtn.disabled = true;
        generationAbortController = new AbortController();
        toggleLoading(true, 'Synthesizing creative prompt...', { cancellable: true });
        
        try {
            const stylePrompt = rawPrompt + (styleAppends[selectedPreset] || '');

            toggleLoading(true, `Connecting to ${getProviderLabel(provider)}...`, { cancellable: true });
            const base64Url = await generateImageAPI({
                provider,
                model,
                prompt: stylePrompt,
                aspectRatio: selectedAspect,
                quality: 'medium',
                outputFormat: 'png',
                signal: generationAbortController.signal
            });
            
            toggleLoading(true, 'Initializing Canvas Layers...');
            currentOriginalImageBase64 = base64Url;
            await editor.loadImage(base64Url);

            // Swap viewport and show tips
            els.editorPlaceholder.style.display = 'none';
            els.canvasViewport.style.display = 'block';
            els.dragHint.style.display = 'flex';
            
            // Save state immediately
            saveSessionToLocalStorage();
            
            showToast('Image generated successfully! Drag text overlay layers to customize.', 'success');
            await loadAccountSession({ silent: true });
        } catch (err) {
            if (err.name === 'AbortError' || err.code === 'generation_aborted') {
                showToast('Generation canceled.', 'info');
            } else {
                showToast('Generation failed: ' + err.message, 'error');
            }
        } finally {
            generationAbortController = null;
            els.generateBtn.disabled = false;
            toggleLoading(false);
        }
    });

    if (els.cancelGenerationBtn) {
        els.cancelGenerationBtn.addEventListener('click', () => {
            if (generationAbortController) {
                generationAbortController.abort();
                toggleLoading(true, 'Canceling generation...', { cancellable: true, canceling: true });
            }
        });
    }

    // Typography live bindings helper
    const bindTextControl = (key, textEl, fontEl, alignEl, sizeEl, sizeValEl, spacingOrLHSlider, spacingOrLHVal, activeEl, colorCustomEl) => {
        // Query outline and background controls dynamically
        const outlineActiveEl = document.getElementById(`${key}-outline-active`);
        const outlineColorEl = document.getElementById(`${key}-outline-color`);
        const outlineWidthEl = document.getElementById(`${key}-outline-width`);
        const bgActiveEl = document.getElementById(`${key}-bg-active`);
        const bgColorEl = document.getElementById(`${key}-bg-color`);
        const bgOpacityEl = document.getElementById(`${key}-bg-opacity`);

        const update = () => {
            const size = Number(sizeEl.value);
            sizeValEl.textContent = size + 'px';
            
            const extraVal = Number(spacingOrLHSlider.value);
            if (key === 'quote') {
                spacingOrLHVal.textContent = (extraVal / 10).toFixed(1);
            } else {
                spacingOrLHVal.textContent = extraVal + 'px';
            }

            editor.updateOverlay(key, {
                text: textEl.value,
                fontFamily: fontEl.value,
                alignment: alignEl.value,
                fontSize: size,
                letterSpacing: key !== 'quote' ? extraVal : 0,
                lineHeight: key === 'quote' ? extraVal / 10 : 1.2,
                active: activeEl.checked,
                outlineActive: outlineActiveEl ? outlineActiveEl.checked : false,
                outlineColor: outlineColorEl ? outlineColorEl.value : '#000000',
                outlineWidth: outlineWidthEl ? Number(outlineWidthEl.value) : 3,
                bgActive: bgActiveEl ? bgActiveEl.checked : false,
                bgColor: bgColorEl ? bgColorEl.value : '#000000',
                bgOpacity: bgOpacityEl ? Number(bgOpacityEl.value) : 50
            });
            saveSessionToLocalStorage();
        };

        textEl.addEventListener('input', update);
        fontEl.addEventListener('change', update);
        alignEl.addEventListener('change', update);
        sizeEl.addEventListener('input', update);
        spacingOrLHSlider.addEventListener('input', update);
        activeEl.addEventListener('change', update);

        if (outlineActiveEl) outlineActiveEl.addEventListener('change', update);
        if (outlineColorEl) outlineColorEl.addEventListener('input', update);
        if (outlineWidthEl) outlineWidthEl.addEventListener('input', update);
        if (bgActiveEl) bgActiveEl.addEventListener('change', update);
        if (bgColorEl) bgColorEl.addEventListener('input', update);
        if (bgOpacityEl) bgOpacityEl.addEventListener('input', update);

        // Color swatches clicks inside container
        const swatchesContainer = colorCustomEl.closest('.field-group').querySelector('.color-picker-container');
        if (swatchesContainer) {
            swatchesContainer.querySelectorAll('.color-swatch').forEach(swatch => {
                swatch.addEventListener('click', () => {
                    swatchesContainer.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
                    swatch.classList.add('active');
                    const color = swatch.getAttribute('data-color');
                    editor.updateOverlay(key, { color: color });
                    saveSessionToLocalStorage();
                });
            });
        }

        // Custom color picker input
        colorCustomEl.addEventListener('input', (e) => {
            const color = e.target.value;
            // De-activate pre-defined swatches
            if (swatchesContainer) {
                swatchesContainer.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
            }
            editor.updateOverlay(key, { color: color });
            saveSessionToLocalStorage();
        });
    };

    // Header Controls
    bindTextControl('header', els.headerText, els.headerFont, els.headerAlign, els.headerSize, els.headerSizeVal, els.headerSpacing, els.headerSpacingVal, els.headerActive, els.headerColorCustom);
    
    // Quote Controls
    bindTextControl('quote', els.quoteText, els.quoteFont, els.quoteAlign, els.quoteSize, els.quoteSizeVal, els.quoteLineHeight, els.quoteLineHeightVal, els.quoteActive, els.quoteColorCustom);
    
    // Author Controls
    // Using a mock slider to fit the binding helper pattern, passing header spacing placeholder
    bindTextControl('author', els.authorText, els.authorFont, els.authorAlign, els.authorSize, els.authorSizeVal, els.authorSpacing, els.authorSpacingVal, els.authorActive, els.authorColorCustom);

    // Filters sliders bindings
    const bindFilterSlider = (el, valEl, key, scale = 1) => {
        el.addEventListener('input', () => {
            const val = Number(el.value);
            valEl.textContent = val + (key === 'blur' ? 'px' : key === 'vignette' ? '%' : '%');
            editor.updateFilter(key, val / scale);
            saveSessionToLocalStorage();
        });
    };

    bindFilterSlider(els.filterBrightness, els.filterBrightnessVal, 'brightness');
    bindFilterSlider(els.filterContrast, els.filterContrastVal, 'contrast');
    bindFilterSlider(els.filterSaturation, els.filterSaturationVal, 'saturation');
    bindFilterSlider(els.filterBlur, els.filterBlurVal, 'blur');
    bindFilterSlider(els.filterVignette, els.filterVignetteVal, 'vignette', 100);

    // Canvas Floating Button Actions
    els.resetBtn.addEventListener('click', () => {
        editor.reset();
        syncStateToUI();
        saveSessionToLocalStorage();
        showToast('Positions and filters reset.', 'info');
    });

    els.downloadBtn.addEventListener('click', () => {
        const dataUrl = editor.exportPNG();
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `nano-banana-art-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('Export PNG started', 'success');
    });

    els.shareBtn.addEventListener('click', async () => {
        showToast('Composing share blob...', 'info');
        const dataUrl = editor.exportPNG();
        
        try {
            const response = await fetch(dataUrl);
            const blob = await response.blob();
            
            if (navigator.canShare && navigator.share) {
                const file = new File([blob], 'nano-banana-poster.png', { type: blob.type });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'Nano Banana Creative Motivational Art',
                        text: `Check out this poster I designed using Nano Banana models!`
                    });
                    showToast('Shared successfully!', 'success');
                    return;
                }
            }
            
            // Clipboard Fallback
            await navigator.clipboard.write([
                new ClipboardItem({ [blob.type]: blob })
            ]);
            showToast('Image copied to clipboard! Paste it anywhere to share.', 'success');
        } catch (err) {
            showToast('Share failed: ' + err.message, 'error');
        }
    });

    els.saveGalleryBtn.addEventListener('click', async () => {
        if (!currentOriginalImageBase64) return;
        if (!requireSignedIn('save to the gallery')) {
            return;
        }
        
        showToast('Saving to gallery database...', 'info');
        toggleLoading(true, 'Recording digital brush strokes...');

        const finalImage = editor.exportPNG();

        const item = {
            originalImage: currentOriginalImageBase64,
            finalImage: finalImage,
            prompt: els.promptInput.value.trim(),
            stylePreset: selectedPreset,
            modelUsed: els.modelSelector.value,
            overlays: JSON.parse(JSON.stringify(editor.state.overlays)),
            filters: JSON.parse(JSON.stringify(editor.state.filters))
        };

        try {
            await saveCreation(item);
            showToast('Saved to Creations tab!', 'success');
        } catch (err) {
            showToast('Save failed: ' + err.message, 'error');
        } finally {
            toggleLoading(false);
        }
    });
}

// Update DOM elements values to match editor state (used on load and undo/loads)
function syncStateToUI() {
    const o = editor.state.overlays;
    const f = editor.state.filters;

    // Header sync
    els.headerText.value = o.header.text;
    els.headerFont.value = o.header.fontFamily;
    els.headerAlign.value = o.header.alignment;
    els.headerSize.value = o.header.fontSize;
    els.headerSizeVal.textContent = o.header.fontSize + 'px';
    els.headerSpacing.value = o.header.letterSpacing;
    els.headerSpacingVal.textContent = o.header.letterSpacing + 'px';
    els.headerActive.checked = o.header.active;
    els.headerColorCustom.value = o.header.color.startsWith('#') ? o.header.color : '#facc15';

    // Quote sync
    els.quoteText.value = o.quote.text;
    els.quoteFont.value = o.quote.fontFamily;
    els.quoteAlign.value = o.quote.alignment;
    els.quoteSize.value = o.quote.fontSize;
    els.quoteSizeVal.textContent = o.quote.fontSize + 'px';
    els.quoteLineHeight.value = Math.round(o.quote.lineHeight * 10);
    els.quoteLineHeightVal.textContent = o.quote.lineHeight;
    els.quoteActive.checked = o.quote.active;
    els.quoteColorCustom.value = o.quote.color.startsWith('#') ? o.quote.color : '#ffffff';

    // Author sync
    els.authorText.value = o.author.text;
    els.authorFont.value = o.author.fontFamily;
    els.authorAlign.value = o.author.alignment;
    els.authorSize.value = o.author.fontSize;
    els.authorSizeVal.textContent = o.author.fontSize + 'px';
    els.authorSpacing.value = o.author.letterSpacing;
    els.authorSpacingVal.textContent = o.author.letterSpacing + 'px';
    els.authorActive.checked = o.author.active;
    els.authorColorCustom.value = o.author.color.startsWith('#') ? o.author.color : '#a1a1aa';

    // Sync extra outline and background controls
    const syncExtraControls = (key) => {
        const outlineActiveEl = document.getElementById(`${key}-outline-active`);
        const outlineColorEl = document.getElementById(`${key}-outline-color`);
        const outlineWidthEl = document.getElementById(`${key}-outline-width`);
        const bgActiveEl = document.getElementById(`${key}-bg-active`);
        const bgColorEl = document.getElementById(`${key}-bg-color`);
        const bgOpacityEl = document.getElementById(`${key}-bg-opacity`);

        if (outlineActiveEl) outlineActiveEl.checked = !!o[key].outlineActive;
        if (outlineColorEl) outlineColorEl.value = o[key].outlineColor || '#000000';
        if (outlineWidthEl) outlineWidthEl.value = o[key].outlineWidth || 3;
        if (bgActiveEl) bgActiveEl.checked = !!o[key].bgActive;
        if (bgColorEl) bgColorEl.value = o[key].bgColor || '#000000';
        if (bgOpacityEl) bgOpacityEl.value = o[key].bgOpacity || 50;
    };

    syncExtraControls('header');
    syncExtraControls('quote');
    syncExtraControls('author');

    // Filters sync
    els.filterBrightness.value = f.brightness;
    els.filterBrightnessVal.textContent = f.brightness + '%';
    els.filterContrast.value = f.contrast;
    els.filterContrastVal.textContent = f.contrast + '%';
    els.filterSaturation.value = f.saturation;
    els.filterSaturationVal.textContent = f.saturation + '%';
    els.filterBlur.value = f.blur;
    els.filterBlurVal.textContent = f.blur + 'px';
    els.filterVignette.value = Math.round(f.vignette * 100);
    els.filterVignetteVal.textContent = Math.round(f.vignette * 100) + '%';
}

// Display toast notifications with modern cyberpunk transitions
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon;
    if (type === 'success') {
        icon = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>';
    } else if (type === 'error') {
        icon = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    } else {
        icon = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    }

    const iconEl = document.createElement('div');
    iconEl.className = 'toast-icon';
    iconEl.innerHTML = icon;

    const contentEl = document.createElement('div');
    contentEl.className = 'toast-content';
    contentEl.textContent = message;

    toast.replaceChildren(iconEl, contentEl);

    els.toastContainer.appendChild(toast);

    // Fade out after 4s
    setTimeout(() => {
        toast.classList.add('toast-out');
        toast.addEventListener('animationend', () => {
            toast.remove();
        });
    }, 4000);
}

// Kick off
init();
