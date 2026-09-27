import * as api from './js/api.js';
import { CanvasEditor } from './js/editor.js';
import { createGallery } from './js/gallery.js';
import { DEFAULT_FILTERS, TEXT_PRESETS, designFromLegacy } from './js/presets.js';
import { STYLE_CATEGORIES, STYLE_LIBRARY, TEXT_SPACE_OPTIONS, getStyleById, getStylePreviewBackground } from './js/styles.js';
import { createAccount } from './js/ui/account.js';
import { createAdjustPanel } from './js/ui/adjust-panel.js';
import { createAdmin } from './js/ui/admin.js';
import { createBilling } from './js/ui/billing.js';
import { downloadBlob, formatDate, html, pluralize, raw, showToast, slugify } from './js/ui/dom.js';
import { createTextPanel } from './js/ui/text-panel.js';

const STORAGE_KEY = 'nb_studio_v2';

const SHAPES = [
    { id: '1:1', label: 'Square', note: 'Social post' },
    { id: '4:5', label: 'Portrait', note: 'Instagram' },
    { id: '2:3', label: 'Poster', note: 'Prints & cards' },
    { id: '3:2', label: 'Landscape', note: 'Photo print' },
    { id: '16:9', label: 'Wide', note: 'Screens' },
    { id: '9:16', label: 'Story', note: 'Phone' }
];

const IDEAS = [
    'A cozy cottage garden at dawn',
    'Our golden retriever as a Renaissance king',
    'A lighthouse on a stormy cliff',
    'Wildflowers in a blue enamel pitcher',
    'A tiny café on a rainy Paris street',
    'Hot air balloons over autumn hills'
];

const LOADING_MESSAGES = [
    'Mixing the paints…',
    'Sketching the composition…',
    'Laying down the first washes…',
    'Adding light and shadow…',
    'Working on the details…',
    'Framing your masterpiece…'
];

const state = {
    user: null,
    billing: null,
    models: [],
    aspectRatios: SHAPES.map((shape) => shape.id),
    providers: {},
    freeMonthlyCredits: 0,
    styleId: null,
    category: 'all',
    aspectRatio: '2:3',
    modelId: null,
    textSpace: 'none',
    imageUrl: null,
    galleryItemId: null,
    lastGeneration: null,
    generating: false,
    abortController: null,
    dirty: false,
    activeTab: 'create',
    activeView: 'create',
    stylePreviews: new Set()
};

const $ = (selector) => document.querySelector(selector);
const els = {
    createView: $('#view-create'),
    prompt: $('#prompt-input'),
    improveBtn: $('#improve-btn'),
    ideaRow: $('#idea-row'),
    styleCategories: $('#style-categories'),
    styleGrid: $('#style-grid'),
    stylePicked: $('#style-picked'),
    shapeRow: $('#shape-row'),
    engineList: $('#engine-list'),
    textSpace: $('#text-space'),
    generateBtn: $('#generate-btn'),
    generateLabel: $('#generate-label'),
    generateCost: $('#generate-cost'),
    footerNote: $('#footer-note'),
    canvas: $('#main-canvas'),
    stageEmpty: $('#stage-empty'),
    stageLoading: $('#stage-loading'),
    loadingMessage: $('#loading-message'),
    loadingElapsed: $('#loading-elapsed'),
    cancelBtn: $('#cancel-btn'),
    stageToolbar: $('#stage-toolbar'),
    stageHint: $('#stage-hint'),
    undoBtn: $('#undo-btn'),
    redoBtn: $('#redo-btn'),
    addTextBtn: $('#add-text-btn'),
    newImageBtn: $('#new-image-btn'),
    shareBtn: $('#share-btn'),
    downloadBtn: $('#download-btn'),
    saveBtn: $('#save-btn'),
    saveLabel: $('#save-label'),
    creditsPill: $('#credits-pill'),
    creditsCount: $('#credits-count'),
    accountBtn: $('#account-btn')
};

const editor = new CanvasEditor(els.canvas);

const billing = createBilling({
    dialog: $('#paywall-dialog'),
    onCreditsChanged: (user, billingStatus) => {
        if (user) {
            setUser(user);
        } else if (billingStatus && state.user) {
            state.user = { ...state.user, credits: billingStatus.credits, plan: billingStatus.plan, planLabel: billingStatus.planLabel };
            updateUserUI();
        }
    }
});

const account = createAccount({
    authDialog: $('#auth-dialog'),
    resetDialog: $('#reset-dialog'),
    accountContainer: $('#account-container'),
    onSession: (user) => setUser(user),
    getContext: () => ({ user: state.user, billing: state.billing, freeMonthlyCredits: state.freeMonthlyCredits }),
    openPaywall: () => billing.open(),
    openPortal: () => billing.openPortal()
});

const gallery = createGallery({
    container: $('#gallery-container'),
    subtitle: $('#gallery-subtitle'),
    onOpen: (item) => openGalleryItem(item),
    isSignedIn: () => Boolean(state.user),
    requestSignIn: () => account.open({ mode: 'login', then: () => gallery.render() })
});

const admin = createAdmin({ container: $('#admin-container') });

const textPanel = createTextPanel({
    container: $('#text-panel'),
    editor,
    getStyle: () => getStyleById(state.lastGeneration?.styleId ?? state.styleId),
    getPlacement: () => state.lastGeneration?.textSpace || state.textSpace
});
createAdjustPanel({ container: $('#adjust-panel'), editor });

init();

async function init() {
    restoreLocalState();
    bindEvents();
    renderIdeas();
    renderStyleCategories();
    renderStyles();
    renderShapes();
    renderTextSpace();
    els.prompt.value = state.promptDraft || '';

    await Promise.all([loadStatus(), loadStylePreviews()]);
    renderStyles();
    await account.handleEmailLinks();
    await billing.handleReturn();
    await restoreWork();
    showView(viewFromHash(), { replace: true });
}

// ---------------------------------------------------------------- session & status

async function loadStatus() {
    try {
        const status = await api.getStatus();
        state.models = status.models || [];
        state.aspectRatios = status.aspectRatios || state.aspectRatios;
        state.providers = status.providers || {};
        state.freeMonthlyCredits = status.offer?.freeMonthlyCredits || 0;
        if (!state.aspectRatios.includes(state.aspectRatio)) state.aspectRatio = state.aspectRatios[0];
        setUser(status.user, { silent: true });
    } catch (error) {
        showToast(`Couldn't reach the studio server. ${error.message}`, 'error', { duration: 8000 });
    }
    renderShapes();
    renderEngines();
    els.improveBtn.hidden = !state.providers.gemini?.configured;
    els.improveBtn.nextElementSibling.hidden = els.improveBtn.hidden;
}

function setUser(user, { silent = false } = {}) {
    const previousId = state.user?.id || null;
    state.user = user || null;
    if (previousId && previousId !== state.user?.id) {
        // Someone signed out or switched accounts: the canvas image belongs to the old account.
        resetWork();
    }
    updateUserUI();
    if (!silent && state.activeView === 'account') account.renderAccountPage();
    if (!silent && state.activeView === 'gallery') gallery.render();
    if (state.user) {
        api.getBillingStatus().then(({ billing: status }) => {
            state.billing = status;
            if (state.activeView === 'account') account.renderAccountPage();
        }).catch(() => {});
    } else {
        state.billing = null;
    }
}

function updateUserUI() {
    const user = state.user;
    const model = selectedModel();
    const cost = model?.credits ?? 1;

    if (user) {
        els.accountBtn.textContent = user.email.charAt(0).toUpperCase();
        els.accountBtn.title = `${user.email} · Account`;
        els.accountBtn.setAttribute('aria-label', `Account for ${user.email}`);
        els.accountBtn.classList.add('signed-in');
        els.creditsPill.hidden = false;
        els.creditsCount.textContent = String(user.credits.balance);
        els.creditsPill.classList.toggle('low', user.credits.balance < cost);
    } else {
        els.accountBtn.textContent = 'Sign in';
        els.accountBtn.title = 'Sign in or create an account';
        els.accountBtn.setAttribute('aria-label', 'Sign in');
        els.accountBtn.classList.remove('signed-in');
        els.creditsPill.hidden = true;
    }

    updateGenerateButton();
}

function updateGenerateButton() {
    const model = selectedModel();
    const cost = model?.credits ?? 0;
    els.generateLabel.textContent = state.generating
        ? 'Creating…'
        : editor.hasImage ? 'Create a new version' : 'Create image';
    els.generateCost.textContent = model ? `· ${pluralize(cost, 'credit')}` : '';
    els.generateBtn.disabled = state.generating || !model;

    const user = state.user;
    if (!state.models.some((candidate) => candidate.configured)) {
        els.footerNote.textContent = 'No image engines are set up on the server yet.';
    } else if (!user) {
        els.footerNote.innerHTML = state.freeMonthlyCredits
            ? html`New here? <button type="button" data-action="signup">Sign up free</button> and get ${pluralize(state.freeMonthlyCredits, 'credit')}.`
            : html`<button type="button" data-action="signup">Create a free account</button> to start.`;
    } else if (user.credits.balance < cost) {
        els.footerNote.innerHTML = html`You have ${pluralize(user.credits.balance, 'credit')}. <button type="button" data-action="paywall">Get more credits</button>`;
    } else {
        const refill = user.credits.refreshesAt && user.credits.allowanceSource === 'free'
            ? ` · free credits refill ${formatDate(user.credits.refreshesAt, { month: 'short', day: 'numeric' })}`
            : '';
        els.footerNote.textContent = `You have ${pluralize(user.credits.balance, 'credit')}${refill}`;
    }
}

async function loadStylePreviews() {
    try {
        const response = await fetch('/style-previews/manifest.json');
        if (!response.ok) return;
        const manifest = await response.json();
        state.stylePreviews = new Set(Object.keys(manifest.previews || {}));
        state.stylePreviewFiles = manifest.previews || {};
    } catch {
        // Previews are optional; cards fall back to palette swatches.
    }
}

// ---------------------------------------------------------------- navigation

function viewFromHash() {
    const name = window.location.hash.replace('#', '');
    return ['gallery', 'account', 'admin'].includes(name) ? name : 'create';
}

function showView(name, { replace = false } = {}) {
    state.activeView = name;
    document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.dataset.view === name));
    document.querySelectorAll('.topnav-link').forEach((link) => link.classList.toggle('active', link.dataset.nav === name));

    const hash = name === 'create' ? '' : `#${name}`;
    if (window.location.hash !== hash) {
        const url = `${window.location.pathname}${window.location.search}${hash}`;
        if (replace) window.history.replaceState({}, '', url);
        else window.history.pushState({}, '', url);
    }

    if (name === 'gallery') gallery.render();
    if (name === 'account') account.renderAccountPage();
    if (name === 'admin') admin.render();
    if (name === 'create') requestAnimationFrame(() => editor.requestRender());
    window.scrollTo({ top: 0 });
}

function setTab(name) {
    if (name !== 'create' && !editor.hasImage) return;
    state.activeTab = name;
    document.querySelectorAll('.panel-tab').forEach((tab) => {
        const active = tab.dataset.tab === name;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-tab-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.tabPanel !== name;
    });
}

// ---------------------------------------------------------------- create panel

function renderIdeas() {
    els.ideaRow.innerHTML = IDEAS.map((idea) => html`<button class="idea-chip" type="button" data-idea="${idea}">${idea}</button>`).join('');
}

function renderStyleCategories() {
    const categories = [{ id: 'all', label: 'All' }, ...STYLE_CATEGORIES];
    els.styleCategories.innerHTML = categories.map((category) => html`
        <button class="chip ${state.category === category.id ? 'active' : ''}" type="button" role="tab" data-category="${category.id}">${category.label}</button>
    `).join('');
}

function renderStyles() {
    const styles = STYLE_LIBRARY.filter((style) => state.category === 'all' || style.category === state.category);
    const selected = getStyleById(state.styleId);
    const noneCard = state.category === 'all'
        ? html`
            <button class="style-card ${selected ? '' : 'active'}" type="button" data-style="" aria-pressed="${String(!selected)}" title="Follow your description exactly">
                <span class="style-thumb none">No style</span>
                <span class="style-name">Just my words</span>
            </button>`
        : '';

    els.styleGrid.innerHTML = noneCard + styles.map((style) => {
        const preview = state.stylePreviewFiles?.[style.id];
        return html`
            <button class="style-card ${style.id === state.styleId ? 'active' : ''}" type="button" data-style="${style.id}" aria-pressed="${String(style.id === state.styleId)}" title="${style.blurb}">
                <span class="style-thumb" style="background:${getStylePreviewBackground(style)}">
                    ${preview ? raw(html`<img src="/style-previews/${preview}" alt="" loading="lazy">`) : ''}
                </span>
                <span class="style-name">${style.name}</span>
            </button>
        `;
    }).join('');

    els.stylePicked.textContent = selected ? selected.name : '';
    let blurb = els.styleGrid.nextElementSibling;
    if (!blurb?.classList.contains('style-blurb')) {
        blurb = document.createElement('p');
        blurb.className = 'style-blurb';
        els.styleGrid.after(blurb);
    }
    blurb.textContent = selected ? `${selected.name}: ${selected.blurb}` : 'No style: the engine follows your description as written.';
}

function renderShapes() {
    els.shapeRow.innerHTML = SHAPES.filter((shape) => state.aspectRatios.includes(shape.id)).map((shape) => {
        const [w, h] = shape.id.split(':').map(Number);
        const scale = 26 / Math.max(w, h);
        return html`
            <button class="shape-btn ${shape.id === state.aspectRatio ? 'active' : ''}" type="button" data-shape="${shape.id}" aria-pressed="${String(shape.id === state.aspectRatio)}">
                <span class="shape-icon"><span style="width:${Math.round(w * scale)}px;height:${Math.round(h * scale)}px"></span></span>
                ${shape.label}
                <small>${shape.note}</small>
            </button>
        `;
    }).join('');
}

function renderEngines() {
    const available = state.models.filter((model) => model.configured);
    if (!available.length) {
        els.engineList.innerHTML = '<p class="empty-note">No image engines are available right now. The site owner needs to add provider API keys on the server.</p>';
        updateGenerateButton();
        return;
    }

    if (!available.some((model) => model.id === state.modelId)) {
        state.modelId = (available.find((model) => model.recommended) || available[0]).id;
    }

    els.engineList.innerHTML = available.map((model) => html`
        <button class="engine-card ${model.id === state.modelId ? 'active' : ''}" type="button" data-model="${model.id}" aria-pressed="${String(model.id === state.modelId)}">
            <span class="engine-name">${model.label}${model.recommended ? raw('<span class="badge">Recommended</span>') : ''}</span>
            <span class="engine-desc">${model.description}</span>
            <span class="engine-cost">${pluralize(model.credits, 'credit')}</span>
        </button>
    `).join('');
    updateUserUI();
}

function renderTextSpace() {
    els.textSpace.innerHTML = TEXT_SPACE_OPTIONS.map((option) => html`
        <button type="button" role="radio" data-text-space="${option.id}" class="${option.id === state.textSpace ? 'active' : ''}" aria-checked="${String(option.id === state.textSpace)}">${option.label}</button>
    `).join('');
}

function selectedModel() {
    return state.models.find((model) => model.id === state.modelId && model.configured) || null;
}

// ---------------------------------------------------------------- generation

async function handleGenerate() {
    const prompt = els.prompt.value.trim();
    if (!prompt) {
        showToast('Describe what you\'d like to see first.', 'info');
        els.prompt.focus();
        return;
    }

    if (!state.user) {
        account.open({
            mode: 'signup',
            then: () => handleGenerate(),
            message: state.freeMonthlyCredits
                ? `Create a free account to paint this. You'll get ${pluralize(state.freeMonthlyCredits, 'free credit')}.`
                : 'Create a free account to paint this.'
        });
        return;
    }

    if (state.user.emailVerificationRequired && !state.user.emailVerified) {
        showToast('Please verify your email first. We sent a link to your inbox.', 'info', { duration: 7000 });
        showView('account');
        return;
    }

    const model = selectedModel();
    if (!model) return;

    if (state.user.credits.balance < model.credits) {
        billing.open({ reason: 'insufficient', needed: model.credits });
        return;
    }

    const settings = {
        prompt,
        styleId: state.styleId,
        textSpace: state.textSpace,
        aspectRatio: state.aspectRatio,
        modelId: model.id,
        provider: model.provider
    };
    const hadImage = editor.hasImage;

    state.generating = true;
    state.abortController = new AbortController();
    showLoading(true, { cancellable: true });
    updateGenerateButton();

    try {
        const result = await api.generateImage({
            ...settings,
            model: model.id,
            signal: state.abortController.signal
        });
        await editor.loadImage(result.imageUrl);
        if (!hadImage) {
            await editor.setDesign({ layers: [], filters: DEFAULT_FILTERS });
        }

        state.imageUrl = result.imageUrl;
        state.galleryItemId = null;
        state.lastGeneration = settings;
        state.dirty = true;
        if (result.credits && state.user) {
            state.user = { ...state.user, credits: result.credits };
        }
        setHasImage(true);
        updateUserUI();
        updateSaveLabel();
        saveLocalState();
        textPanel.render();
        showToast(hadImage ? 'Here\'s your new version.' : 'Your artwork is ready! Add a title or message with "Add text".', 'success', { duration: 6000 });
    } catch (error) {
        handleGenerationError(error, model);
    } finally {
        state.generating = false;
        state.abortController = null;
        showLoading(false);
        updateGenerateButton();
    }
}

function handleGenerationError(error, model) {
    const code = error.code;
    const refundNote = ' You weren\'t charged.';

    if (error.name === 'AbortError' || code === 'generation_aborted') {
        showToast(`Canceled.${refundNote}`, 'info');
        // The server refunds once it notices the dropped request, a moment after we abort.
        setTimeout(refreshCredits, 1200);
        return;
    } else if (code === 'insufficient_credits') {
        billing.open({ reason: 'insufficient', needed: error.details?.cost ?? model.credits });
    } else if (code === 'auth_required') {
        setUser(null);
        account.open({ mode: 'login', message: 'Your session ended. Please sign in again.' });
    } else if (code === 'email_unverified') {
        showToast('Please verify your email first. We sent a link to your inbox.', 'info', { duration: 7000 });
        showView('account');
    } else if (code === 'content_policy_blocked') {
        showToast('That description can\'t be created here. Please try something different.', 'error', { duration: 7000 });
    } else if (code === 'rate_limited') {
        showToast('You\'re creating very quickly! Please wait a few minutes and try again.', 'error');
    } else {
        showToast(`${error.message || 'Something went wrong.'}${refundNote}`, 'error', { duration: 7000 });
    }

    refreshCredits();
}

async function refreshCredits() {
    if (!state.user) return;
    try {
        const status = await api.getStatus();
        if (status.user) {
            state.user = status.user;
            updateUserUI();
        }
    } catch {
        // Non-critical; the balance refreshes on the next successful request.
    }
}

let loadingTimer = null;

function showLoading(visible, { cancellable = false, message = null } = {}) {
    clearInterval(loadingTimer);
    els.stageLoading.hidden = !visible;
    els.createView.classList.toggle('generating', visible);
    if (!visible) return;

    els.cancelBtn.hidden = !cancellable;
    const startedAt = Date.now();
    let index = 0;
    els.loadingMessage.textContent = message || LOADING_MESSAGES[0];
    els.loadingElapsed.textContent = '';
    loadingTimer = setInterval(() => {
        const seconds = Math.round((Date.now() - startedAt) / 1000);
        if (!message && seconds % 4 === 0) {
            index = (index + 1) % LOADING_MESSAGES.length;
            els.loadingMessage.textContent = LOADING_MESSAGES[index];
        }
        els.loadingElapsed.textContent = cancellable ? `${seconds}s · most images take 10 to 40 seconds` : '';
    }, 1000);
    if (window.matchMedia('(max-width: 860px)').matches) {
        els.stageLoading.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
}

function setHasImage(hasImage) {
    els.canvas.hidden = !hasImage;
    els.stageEmpty.hidden = hasImage;
    els.stageToolbar.hidden = !hasImage;
    els.stageHint.hidden = !hasImage;
    els.createView.classList.toggle('has-image', hasImage);
    document.querySelectorAll('.panel-tab').forEach((tab) => {
        if (tab.dataset.tab !== 'create') tab.disabled = !hasImage;
    });
    if (!hasImage) setTab('create');
    updateHistoryButtons();
    updateGenerateButton();
}

function updateHistoryButtons() {
    els.undoBtn.disabled = !editor.canUndo;
    els.redoBtn.disabled = !editor.canRedo;
}

function updateSaveLabel() {
    els.saveLabel.textContent = state.galleryItemId ? 'Save changes' : 'Save to My Art';
}

function resetWork() {
    editor.clear();
    state.imageUrl = null;
    state.galleryItemId = null;
    state.lastGeneration = null;
    state.dirty = false;
    setHasImage(false);
    textPanel.render();
    saveLocalState();
}

// ---------------------------------------------------------------- toolbar actions

async function handleSave() {
    if (!editor.hasImage) return;
    if (!state.user) {
        account.open({ mode: 'login', then: () => handleSave() });
        return;
    }

    els.saveBtn.disabled = true;
    try {
        editor.select(null);
        await editor.fontsReady();
        const finalImage = editor.exportDataUrl('image/jpeg', 0.92);
        const design = editor.getDesign();
        if (state.galleryItemId) {
            await api.updateGalleryItem(state.galleryItemId, { finalImage, design });
            showToast('Changes saved to My Art.', 'success');
        } else {
            const item = await api.saveGalleryItem({
                originalImage: state.imageUrl,
                finalImage,
                design,
                prompt: state.lastGeneration?.prompt || els.prompt.value.trim(),
                stylePreset: state.lastGeneration?.styleId || '',
                modelUsed: state.lastGeneration?.modelId || '',
                aspectRatio: state.lastGeneration?.aspectRatio || state.aspectRatio
            });
            state.galleryItemId = item.id;
            showToast('Saved to My Art.', 'success');
        }
        state.dirty = false;
        updateSaveLabel();
        saveLocalState();
    } catch (error) {
        showToast(`Couldn't save: ${error.message}`, 'error');
    } finally {
        els.saveBtn.disabled = false;
    }
}

async function handleDownload() {
    if (!editor.hasImage) return;
    try {
        await editor.fontsReady();
        const blob = await editor.exportBlob('image/png');
        downloadBlob(blob, `${slugify(state.lastGeneration?.prompt || els.prompt.value)}.png`);
        showToast('Downloaded a full-resolution PNG.', 'success');
    } catch (error) {
        showToast(`Download failed: ${error.message}`, 'error');
    }
}

async function handleShare() {
    if (!editor.hasImage) return;
    try {
        await editor.fontsReady();
        const blob = await editor.exportBlob('image/png');
        const file = new File([blob], `${slugify(state.lastGeneration?.prompt)}.png`, { type: 'image/png' });
        if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title: 'My artwork' });
            return;
        }
        if (navigator.clipboard?.write && window.ClipboardItem) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            showToast('Copied! Paste it into a message or email.', 'success');
            return;
        }
        downloadBlob(blob, file.name);
        showToast('Sharing isn\'t available in this browser, so we downloaded it instead.', 'info');
    } catch (error) {
        if (error.name !== 'AbortError') showToast(`Couldn't share: ${error.message}`, 'error');
    }
}

function handleNewImage() {
    if (state.dirty && !window.confirm('Start a new image? Your current design will be cleared unless you\'ve saved it.')) return;
    resetWork();
    els.prompt.focus();
}

function handleAddText() {
    setTab('text');
    const preset = TEXT_PRESETS.find((candidate) => candidate.id === 'headline');
    const overrides = preset.build(getStyleById(state.lastGeneration?.styleId));
    if ((state.lastGeneration?.textSpace) === 'bottom') overrides.y = 0.84;
    editor.addLayer(overrides);
    textPanel.focusText();
}

async function openGalleryItem(item) {
    if (state.dirty && editor.hasImage && !window.confirm('Open this piece? Unsaved changes to your current design will be lost.')) return;

    showView('create');
    showLoading(true, { message: 'Opening your artwork…' });
    try {
        await editor.loadImage(item.originalImage);
        const design = Array.isArray(item.design?.layers) ? item.design : designFromLegacy(item.overlays, item.filters);
        await editor.setDesign(design);
        state.imageUrl = item.originalImage;
        state.galleryItemId = item.id;
        state.lastGeneration = {
            prompt: item.prompt,
            styleId: getStyleById(item.stylePreset)?.id || null,
            aspectRatio: item.aspectRatio,
            modelId: item.modelUsed,
            textSpace: 'none'
        };
        els.prompt.value = item.prompt || '';
        state.dirty = false;
        setHasImage(true);
        setTab('text');
        textPanel.render();
        updateSaveLabel();
        saveLocalState();
    } catch (error) {
        showToast(`Couldn't open that piece: ${error.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

async function handleImprove() {
    const prompt = els.prompt.value.trim();
    if (!prompt) {
        showToast('Type a few words first, then we\'ll help flesh them out.', 'info');
        els.prompt.focus();
        return;
    }
    if (!state.user) {
        account.open({ mode: 'signup', then: () => handleImprove() });
        return;
    }

    els.improveBtn.disabled = true;
    const original = els.improveBtn.innerHTML;
    els.improveBtn.lastChild.textContent = ' Improving…';
    try {
        els.prompt.value = await api.improveDescription(prompt, state.styleId);
        saveLocalState();
        showToast('Description improved. Edit it however you like.', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        els.improveBtn.innerHTML = original;
        els.improveBtn.disabled = false;
    }
}

// ---------------------------------------------------------------- persistence

let saveTimer = null;

function saveLocalState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeLocalState, 300);
}

function flushLocalState() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    writeLocalState();
}

function writeLocalState() {
    saveTimer = null;
    const snapshot = {
        prompt: els.prompt.value,
        styleId: state.styleId,
        category: state.category,
        aspectRatio: state.aspectRatio,
        modelId: state.modelId,
        textSpace: state.textSpace,
        imageUrl: state.imageUrl,
        galleryItemId: state.galleryItemId,
        lastGeneration: state.lastGeneration,
        dirty: state.dirty,
        design: editor.hasImage ? editor.getDesign() : null
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
        // Storage can be full or blocked (private browsing); work simply won't persist.
    }
}

function restoreLocalState() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (!saved) return;
        state.promptDraft = saved.prompt || '';
        state.styleId = getStyleById(saved.styleId)?.id || null;
        state.category = saved.category || 'all';
        state.aspectRatio = saved.aspectRatio || state.aspectRatio;
        state.modelId = saved.modelId || null;
        state.textSpace = saved.textSpace || 'none';
        state.savedWork = saved.imageUrl ? saved : null;
    } catch {
        state.savedWork = null;
    }
}

async function restoreWork() {
    const saved = state.savedWork;
    state.savedWork = null;
    if (!saved || !state.user || editor.hasImage) return;

    try {
        await editor.loadImage(saved.imageUrl);
        await editor.setDesign(saved.design || { layers: [], filters: DEFAULT_FILTERS });
        state.imageUrl = saved.imageUrl;
        state.galleryItemId = saved.galleryItemId || null;
        state.lastGeneration = saved.lastGeneration || null;
        state.dirty = Boolean(saved.dirty);
        setHasImage(true);
        textPanel.render();
        updateSaveLabel();
    } catch {
        resetWork();
    }
}

// ---------------------------------------------------------------- events

function bindEvents() {
    document.addEventListener('click', (event) => {
        const nav = event.target.closest('[data-nav]');
        if (nav) {
            event.preventDefault();
            showView(nav.dataset.nav);
            return;
        }
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'signup' && event.target.closest('#footer-note')) account.open({ mode: 'signup' });
        if (action === 'paywall' && event.target.closest('#footer-note')) billing.open({ reason: 'topup' });
    });

    window.addEventListener('hashchange', () => showView(viewFromHash(), { replace: true }));

    els.accountBtn.addEventListener('click', () => {
        if (state.user) showView('account');
        else account.open({ mode: 'login' });
    });
    els.creditsPill.addEventListener('click', () => billing.open({ reason: 'topup' }));

    document.querySelectorAll('.panel-tab').forEach((tab) => {
        tab.addEventListener('click', () => setTab(tab.dataset.tab));
    });

    els.prompt.addEventListener('input', saveLocalState);
    els.prompt.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) handleGenerate();
    });
    els.improveBtn.addEventListener('click', handleImprove);

    els.ideaRow.addEventListener('click', (event) => {
        const idea = event.target.closest('[data-idea]')?.dataset.idea;
        if (!idea) return;
        els.prompt.value = idea;
        saveLocalState();
        els.prompt.focus();
    });

    els.styleCategories.addEventListener('click', (event) => {
        const category = event.target.closest('[data-category]')?.dataset.category;
        if (!category) return;
        state.category = category;
        renderStyleCategories();
        renderStyles();
        saveLocalState();
    });

    els.styleGrid.addEventListener('click', (event) => {
        const card = event.target.closest('[data-style]');
        if (!card) return;
        state.styleId = card.dataset.style || null;
        renderStyles();
        saveLocalState();
    });

    els.shapeRow.addEventListener('click', (event) => {
        const shape = event.target.closest('[data-shape]')?.dataset.shape;
        if (!shape) return;
        state.aspectRatio = shape;
        renderShapes();
        saveLocalState();
    });

    els.engineList.addEventListener('click', (event) => {
        const model = event.target.closest('[data-model]')?.dataset.model;
        if (!model) return;
        state.modelId = model;
        renderEngines();
        saveLocalState();
    });

    els.textSpace.addEventListener('click', (event) => {
        const option = event.target.closest('[data-text-space]')?.dataset.textSpace;
        if (!option) return;
        state.textSpace = option;
        renderTextSpace();
        saveLocalState();
    });

    els.generateBtn.addEventListener('click', handleGenerate);
    els.cancelBtn.addEventListener('click', () => state.abortController?.abort());
    els.undoBtn.addEventListener('click', () => editor.undo());
    els.redoBtn.addEventListener('click', () => editor.redo());
    els.addTextBtn.addEventListener('click', handleAddText);
    els.newImageBtn.addEventListener('click', handleNewImage);
    els.shareBtn.addEventListener('click', handleShare);
    els.downloadBtn.addEventListener('click', handleDownload);
    els.saveBtn.addEventListener('click', handleSave);

    editor.addEventListener('history', updateHistoryButtons);
    editor.addEventListener('change', () => {
        state.dirty = true;
        updateHistoryButtons();
        saveLocalState();
    });
    editor.addEventListener('select', (event) => {
        if (event.detail.id && state.activeTab !== 'text') setTab('text');
    });
    editor.addEventListener('edittext', () => {
        setTab('text');
        textPanel.focusText();
    });

    document.addEventListener('keydown', (event) => {
        if (!(event.metaKey || event.ctrlKey) || state.activeView !== 'create' || !editor.hasImage) return;
        if (event.target.closest('input, textarea, [contenteditable]')) return;
        const key = event.key.toLowerCase();
        if (key === 'z' && !event.shiftKey) {
            editor.undo();
            event.preventDefault();
        } else if ((key === 'z' && event.shiftKey) || key === 'y') {
            editor.redo();
            event.preventDefault();
        }
    });

    // Checkout and emailed links navigate away; never drop a pending draft save.
    window.addEventListener('pagehide', flushLocalState);
    window.addEventListener('beforeunload', (event) => {
        flushLocalState();
        if (state.generating) {
            event.preventDefault();
        }
    });
}
