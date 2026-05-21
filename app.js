import { initDB, saveCreation } from './js/db.js';
import { enhancePromptAPI, generateImageAPI, generateImageHuggingFaceAPI } from './js/api.js';
import { CanvasEditor } from './js/editor.js';
import { renderGallery } from './js/gallery.js';

// DOM Element Bindings
const els = {
    // Views
    studioView: document.getElementById('studio-view'),
    galleryView: document.getElementById('gallery-view'),
    settingsView: document.getElementById('settings-view'),
    
    // Navigation Triggers
    navStudio: document.getElementById('nav-studio'),
    navGallery: document.getElementById('nav-gallery'),
    navSettings: document.getElementById('nav-settings'),
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
    
    // Settings Tab
    settingsApiKey: document.getElementById('settings-api-key-input'),
    settingsHfToken: document.getElementById('settings-hf-token-input'),
    saveSettingsBtn: document.getElementById('save-settings-btn'),
    
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
    toastContainer: document.getElementById('toast-container'),
    galleryContainer: document.getElementById('gallery-container')
};

// Global App State
let apiKey = localStorage.getItem('gemini_api_key') || '';
let hfToken = localStorage.getItem('hf_api_token') || '';
let selectedPreset = 'None';
let selectedAspect = '1:1';
let currentOriginalImageBase64 = null; // Stored to save session

// Instantiate Editor
const editor = new CanvasEditor(els.mainCanvas);

// Bind drag end to auto-save session
editor.onDragEnd = saveSessionToLocalStorage;

// Initialize DB and application
async function init() {
    try {
        await initDB();
        updateApiKeyBadge();
        
        // Load initial keys into settings input
        if (apiKey) {
            els.settingsApiKey.value = apiKey;
        }
        if (hfToken) {
            els.settingsHfToken.value = hfToken;
        }

        bindUIEvents();
        syncStateToUI(); // Initialize controls values to match editor defaults
        
        // Restore session if available
        await restoreSessionFromLocalStorage();
    } catch (err) {
        showToast('IndexedDB Init Failed: ' + err.message, 'error');
    }
}

// Update local badge UI based on key presence
function updateApiKeyBadge() {
    const keys = [];
    if (apiKey) keys.push('Gemini');
    if (hfToken) keys.push('HF');
    
    if (keys.length > 0) {
        els.apiKeyBadge.classList.add('valid');
        els.apiKeyBadge.innerHTML = `<span class="indicator">●</span> Credentials: ${keys.join(' + ')}`;
    } else {
        els.apiKeyBadge.classList.remove('valid');
        els.apiKeyBadge.innerHTML = '<span class="indicator">●</span> Setup Required';
    }
}

// Change Active App Tab (Studio, Gallery, Setup)
function switchView(viewName) {
    // Nav buttons active classes
    els.navStudio.classList.remove('active');
    els.navGallery.classList.remove('active');
    els.navSettings.classList.remove('active');
    
    // Hide all
    els.studioView.classList.remove('active');
    els.galleryView.classList.remove('active');
    els.settingsView.classList.remove('active');

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
    }
}

// Trigger creations list render
function loadGallery() {
    renderGallery(els.galleryContainer, handleEditCreation, showToast);
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
function toggleLoading(show, message = 'Processing...') {
    if (show) {
        els.loadingText.textContent = message;
        els.loadingOverlay.classList.add('active');
    } else {
        els.loadingOverlay.classList.remove('active');
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
        hfCustomModelId: document.getElementById('hf-custom-model-input')?.value || '',
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
            const hfCustomGroup = document.getElementById('hf-custom-group');
            if (hfCustomGroup) {
                hfCustomGroup.style.display = sessionState.modelSelector === 'hf-custom' ? 'block' : 'none';
            }
        }

        // Restore custom HF model ID
        if (sessionState.hfCustomModelId) {
            const hfCustomInput = document.getElementById('hf-custom-model-input');
            if (hfCustomInput) {
                hfCustomInput.value = sessionState.hfCustomModelId;
            }
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
    els.modelSelector.addEventListener('change', (e) => {
        const val = e.target.value;
        const customGroup = document.getElementById('hf-custom-group');
        if (customGroup) {
            customGroup.style.display = val === 'hf-custom' ? 'block' : 'none';
        }
        saveSessionToLocalStorage();
    });

    const customHfInput = document.getElementById('hf-custom-model-input');
    if (customHfInput) {
        customHfInput.addEventListener('input', () => {
            saveSessionToLocalStorage();
        });
    }

    // Settings save
    els.saveSettingsBtn.addEventListener('click', () => {
        const geminiVal = els.settingsApiKey.value.trim();
        const hfVal = els.settingsHfToken.value.trim();
        
        if (!geminiVal) {
            localStorage.removeItem('gemini_api_key');
            apiKey = '';
        } else {
            localStorage.setItem('gemini_api_key', geminiVal);
            apiKey = geminiVal;
        }

        if (!hfVal) {
            localStorage.removeItem('hf_api_token');
            hfToken = '';
        } else {
            localStorage.setItem('hf_api_token', hfVal);
            hfToken = hfVal;
        }
        
        updateApiKeyBadge();
        showToast('Configuration settings saved locally!', 'success');
        switchView('studio');
    });

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
        if (!apiKey) {
            showToast('Gemini API Key required to enhance prompt. Redirecting to Setup...', 'error');
            switchView('settings');
            return;
        }

        els.enhancePromptBtn.disabled = true;
        showToast('Gemini is enhancing prompt layout...', 'info');

        try {
            const enhanced = await enhancePromptAPI(apiKey, prompt, selectedPreset);
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

        const model = els.modelSelector.value;
        const isHF = !model.startsWith('gemini');

        if (isHF) {
            if (!hfToken) {
                showToast('Hugging Face Token required. Redirecting to Setup...', 'error');
                switchView('settings');
                return;
            }
        } else {
            if (!apiKey) {
                showToast('Google Gemini API Key required. Redirecting to Setup...', 'error');
                switchView('settings');
                return;
            }
        }

        let modelId = model;
        if (model === 'hf-custom') {
            const customInput = document.getElementById('hf-custom-model-input');
            modelId = customInput ? customInput.value.trim() : '';
            if (!modelId) {
                showToast('Please specify a Hugging Face Model ID.', 'error');
                return;
            }
        }

        toggleLoading(true, 'Synthesizing creative prompt...');
        
        try {
            const stylePrompt = rawPrompt + (styleAppends[selectedPreset] || '');

            let base64Url;
            if (isHF) {
                toggleLoading(true, 'Connecting to Hugging Face Inference API...');
                base64Url = await generateImageHuggingFaceAPI(
                    hfToken, 
                    modelId, 
                    stylePrompt, 
                    (progressMsg) => {
                        toggleLoading(true, progressMsg);
                    }
                );
            } else {
                toggleLoading(true, 'Connecting to Gemini Image Engine...');
                base64Url = await generateImageAPI(apiKey, modelId, stylePrompt, selectedAspect);
            }
            
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
        } catch (err) {
            showToast('Generation failed: ' + err.message, 'error');
        } finally {
            toggleLoading(false);
        }
    });

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
    bindTextControl('author', els.authorText, els.authorFont, els.authorAlign, els.authorSize, els.authorSizeVal, els.headerSpacing, els.headerSpacingVal, els.authorActive, els.authorColorCustom);

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
    
    let icon = '';
    if (type === 'success') {
        icon = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>';
    } else if (type === 'error') {
        icon = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    } else {
        icon = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    }

    toast.innerHTML = `
        <div class="toast-icon">${icon}</div>
        <div class="toast-content">${message}</div>
    `;

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
