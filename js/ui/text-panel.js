import { FONT_CATALOG, FONT_CATEGORIES, canItalicize, fontStack } from '../fonts.js';
import { BASE_SWATCHES, TEXT_PRESETS, TEXT_TEMPLATES } from '../presets.js';
import { html, icons, raw } from './dom.js';

/**
 * Text tab: quick templates, text styles, the layer list, and an editor for the selected layer.
 * Form controls declare the layer property they edit with data-bind (dot paths for effects)
 * and an optional data-scale, so one handler covers every slider, switch, and color.
 */
export function createTextPanel({ container, editor, getStyle, getPlacement }) {
    let fontMenuOpen = false;

    container.addEventListener('input', onInput);
    container.addEventListener('change', onInput);
    container.addEventListener('click', onClick);
    document.addEventListener('click', (event) => {
        if (fontMenuOpen && !event.target.closest('.font-picker')) {
            fontMenuOpen = false;
            container.querySelector('.font-menu')?.setAttribute('hidden', '');
        }
    });

    editor.addEventListener('select', render);
    editor.addEventListener('change', () => {
        if (container.contains(document.activeElement) && document.activeElement.matches('[data-bind]')) {
            syncLayerList();
            return;
        }
        syncForm();
        syncLayerList();
    });

    function render() {
        fontMenuOpen = false;
        const style = getStyle();
        const layer = editor.selectedLayer;

        container.innerHTML = html`
            <section class="step">
                <h2 class="step-title">Quick designs</h2>
                <div class="template-grid">
                    ${TEXT_TEMPLATES.map((template) => raw(html`
                        <button class="template-card" type="button" data-template="${template.id}">
                            <strong>${template.label}</strong>
                            <span>${template.description}</span>
                        </button>
                    `))}
                </div>
                <p class="subhead">Add a text style</p>
                <div class="preset-row">
                    ${TEXT_PRESETS.map((preset) => {
                        const family = preset.family || (preset.id === 'headline' ? style?.fonts?.title : style?.fonts?.body) || 'Playfair Display';
                        return raw(html`
                            <button class="preset-btn" type="button" data-preset="${preset.id}">
                                <span class="preset-sample" style="font-family: ${fontStack(family)}">${preset.sample}</span>
                                ${preset.label}
                            </button>
                        `);
                    })}
                </div>
            </section>

            <section class="step">
                <h2 class="step-title">Your text ${editor.layers.length ? raw(html`<span class="step-value">${editor.layers.length} ${editor.layers.length === 1 ? 'layer' : 'layers'}</span>`) : ''}</h2>
                <div class="layer-list" id="layer-list"></div>
                ${editor.layers.length ? '' : raw('<p class="panel-empty">No text yet. Pick a quick design or text style above.</p>')}
                ${layer ? raw(renderLayerEditor(layer, style)) : editor.layers.length ? raw('<p class="hint" style="margin-top:10px">Select a layer, or click text on the image, to edit it.</p>') : ''}
            </section>
        `;

        syncLayerList();
        syncForm();
    }

    function renderLayerEditor(layer, style) {
        const swatches = [...new Set([...(style?.palette || []), ...BASE_SWATCHES].map((color) => color.toLowerCase()))];
        const groupedFonts = FONT_CATEGORIES.map((category) => ({
            category,
            fonts: FONT_CATALOG.filter((font) => font.category === category)
        }));

        return html`
            <div class="layer-editor" data-layer-id="${layer.id}">
                <label class="label" for="layer-text" style="margin-top:0">Text</label>
                <textarea class="field textarea" id="layer-text" rows="2" data-bind="text" data-type="string"></textarea>

                <div class="font-row">
                    <div class="font-picker">
                        <button class="font-picker-btn" type="button" data-action="toggle-font-menu" aria-haspopup="listbox">
                            <span data-font-label></span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                        </button>
                        <div class="font-menu" role="listbox" hidden>
                            ${groupedFonts.map(({ category, fonts }) => raw(html`
                                <div class="font-menu-group">${category}</div>
                                ${fonts.map((font) => raw(html`
                                    <button class="font-option" type="button" role="option" data-font="${font.family}" style="font-family: ${fontStack(font.family)}">${font.family}</button>
                                `))}
                            `))}
                        </div>
                    </div>
                    <button class="style-toggle" type="button" data-toggle="bold" title="Bold" aria-label="Bold"><strong>B</strong></button>
                    <button class="style-toggle" type="button" data-toggle="italic" title="Italic" aria-label="Italic"><em style="font-family:Georgia,serif">I</em></button>
                    <button class="style-toggle" type="button" data-toggle="uppercase" title="All caps" aria-label="All caps" style="font-size:12px;font-weight:700">AA</button>
                </div>

                ${slider('Size', 'size', 1.2, 40, 0.2, 100)}

                <div class="segmented" style="margin-top:6px" role="radiogroup" aria-label="Alignment">
                    <button type="button" data-align="left" aria-label="Align left">${raw(icons.alignLeft)}</button>
                    <button type="button" data-align="center" aria-label="Align center">${raw(icons.alignCenter)}</button>
                    <button type="button" data-align="right" aria-label="Align right">${raw(icons.alignRight)}</button>
                </div>

                <div class="swatches" aria-label="Text color">
                    ${swatches.map((color) => raw(html`<button class="swatch" type="button" data-color="${color}" style="background:${color}" aria-label="Color ${color}"></button>`))}
                    <input type="color" data-bind="color" data-type="string" aria-label="Custom text color">
                </div>

                <details class="effect">
                    <summary>Spacing, width &amp; rotation</summary>
                    <div class="effect-controls">
                        ${slider('Letter spacing', 'letterSpacing', -5, 60, 1, 100)}
                        ${slider('Line height', 'lineHeight', 80, 250, 5, 100)}
                        ${slider('Text width', 'maxWidth', 15, 120, 1, 100)}
                        ${slider('Rotation', 'rotation', -180, 180, 1, 1)}
                        ${slider('Opacity', 'opacity', 5, 100, 1, 100)}
                    </div>
                </details>
                <details class="effect">
                    <summary>Shadow</summary>
                    <div class="effect-controls">
                        ${toggle('Soft shadow', 'shadow.enabled')}
                        ${slider('Strength', 'shadow.strength', 0, 100, 1, 100)}
                        <div class="inline-controls"><span class="hint">Color</span><input type="color" data-bind="shadow.color" data-type="string" aria-label="Shadow color"></div>
                    </div>
                </details>
                <details class="effect">
                    <summary>Outline</summary>
                    <div class="effect-controls">
                        ${toggle('Outline', 'outline.enabled')}
                        ${slider('Thickness', 'outline.width', 1, 30, 1, 100)}
                        <div class="inline-controls"><span class="hint">Color</span><input type="color" data-bind="outline.color" data-type="string" aria-label="Outline color"></div>
                    </div>
                </details>
                <details class="effect">
                    <summary>Background box</summary>
                    <div class="effect-controls">
                        ${toggle('Box behind text', 'background.enabled')}
                        ${slider('Opacity', 'background.opacity', 0, 100, 1, 100)}
                        ${slider('Padding', 'background.padding', 0, 200, 5, 100)}
                        ${slider('Roundness', 'background.radius', 0, 100, 5, 100)}
                        <div class="inline-controls"><span class="hint">Color</span><input type="color" data-bind="background.color" data-type="string" aria-label="Box color"></div>
                    </div>
                </details>
            </div>
        `;
    }

    function slider(label, bind, min, max, step, scale) {
        return raw(html`
            <label class="slider-row">
                <span>${label}</span>
                <input type="range" min="${min}" max="${max}" step="${step}" data-bind="${bind}" data-scale="${scale}" data-type="number">
                <output data-output="${bind}"></output>
            </label>
        `);
    }

    function toggle(label, bind) {
        return raw(html`
            <label class="toggle-row">
                <span>${label}</span>
                <input class="switch" type="checkbox" data-bind="${bind}" data-type="bool">
            </label>
        `);
    }

    function syncLayerList() {
        const list = container.querySelector('#layer-list');
        if (!list) return;
        const items = [...editor.layers].reverse();
        list.innerHTML = items.map((layer, index) => html`
            <div class="layer-item ${layer.id === editor.selectedId ? 'active' : ''}" data-layer="${layer.id}">
                <button class="layer-select" type="button" data-action="select" style="font-family:${fontStack(layer.family)}">${layer.text.trim() || 'Empty text'}</button>
                <div class="layer-actions">
                    <button class="icon-btn small" type="button" data-action="forward" title="Bring forward" aria-label="Bring forward" ${index === 0 ? 'disabled' : ''}>${raw(icons.up)}</button>
                    <button class="icon-btn small" type="button" data-action="backward" title="Send backward" aria-label="Send backward" ${index === items.length - 1 ? 'disabled' : ''}>${raw(icons.down)}</button>
                    <button class="icon-btn small" type="button" data-action="duplicate" title="Duplicate" aria-label="Duplicate">${raw(icons.copy)}</button>
                    <button class="icon-btn small" type="button" data-action="delete" title="Delete" aria-label="Delete">${raw(icons.trash)}</button>
                </div>
            </div>
        `).join('');
    }

    function syncForm() {
        const layer = editor.selectedLayer;
        const form = container.querySelector('.layer-editor');
        if (!layer || !form || form.dataset.layerId !== layer.id) {
            if (layer && !form) render();
            return;
        }

        for (const input of form.querySelectorAll('[data-bind]')) {
            const value = readPath(layer, input.dataset.bind);
            if (input.dataset.type === 'bool') {
                input.checked = Boolean(value);
            } else if (input.dataset.type === 'number') {
                input.value = String(Number(value) * Number(input.dataset.scale || 1));
            } else if (input !== document.activeElement) {
                input.value = value;
            }
        }
        for (const output of form.querySelectorAll('[data-output]')) {
            const value = readPath(layer, output.dataset.output);
            const bind = output.dataset.output;
            output.textContent = bind === 'rotation' ? `${Math.round(value)}°` : String(Math.round(value * 100));
        }

        form.querySelector('[data-font-label]').textContent = layer.family;
        form.querySelector('[data-font-label]').style.fontFamily = fontStack(layer.family);
        form.querySelectorAll('.font-option').forEach((option) => option.classList.toggle('active', option.dataset.font === layer.family));
        form.querySelector('[data-toggle="bold"]').classList.toggle('active', layer.weight >= 600);
        const italicButton = form.querySelector('[data-toggle="italic"]');
        italicButton.classList.toggle('active', layer.italic);
        italicButton.disabled = !canItalicize(layer.family);
        form.querySelector('[data-toggle="uppercase"]').classList.toggle('active', layer.uppercase);
        form.querySelectorAll('[data-align]').forEach((button) => button.classList.toggle('active', button.dataset.align === layer.align));
        form.querySelectorAll('.swatch').forEach((swatch) => swatch.classList.toggle('active', swatch.dataset.color === layer.color.toLowerCase()));
    }

    function onInput(event) {
        const input = event.target.closest('[data-bind]');
        const layer = editor.selectedLayer;
        if (!input || !layer) return;

        let value;
        if (input.dataset.type === 'bool') value = input.checked;
        else if (input.dataset.type === 'number') value = Number(input.value) / Number(input.dataset.scale || 1);
        else value = input.value;

        editor.updateLayer(layer.id, buildPatch(input.dataset.bind, value));
        if (input.dataset.type !== 'string') syncForm();
        if (input.dataset.bind === 'color') syncForm();
    }

    function onClick(event) {
        const target = event.target.closest('button');
        if (!target) return;
        const style = getStyle();

        if (target.dataset.template) {
            const template = TEXT_TEMPLATES.find((candidate) => candidate.id === target.dataset.template);
            editor.addLayers(template.build(style, getPlacement()));
            return;
        }

        if (target.dataset.preset) {
            const preset = TEXT_PRESETS.find((candidate) => candidate.id === target.dataset.preset);
            const overrides = preset.build(style);
            if (overrides.y < 0.3 && getPlacement() === 'bottom') overrides.y = 1 - overrides.y;
            editor.addLayer(overrides);
            focusText();
            return;
        }

        const layerId = target.closest('[data-layer]')?.dataset.layer;
        const action = target.dataset.action;
        if (layerId && action) {
            if (action === 'select') editor.select(layerId);
            if (action === 'forward') editor.reorderLayer(layerId, 'up');
            if (action === 'backward') editor.reorderLayer(layerId, 'down');
            if (action === 'duplicate') editor.duplicateLayer(layerId);
            if (action === 'delete') editor.removeLayer(layerId);
            if (action !== 'select') render();
            return;
        }

        const layer = editor.selectedLayer;
        if (!layer) return;

        if (action === 'toggle-font-menu') {
            fontMenuOpen = !fontMenuOpen;
            const menu = container.querySelector('.font-menu');
            menu.toggleAttribute('hidden', !fontMenuOpen);
            if (fontMenuOpen) menu.querySelector('.font-option.active')?.scrollIntoView({ block: 'nearest' });
        } else if (target.dataset.font) {
            editor.updateLayer(layer.id, { family: target.dataset.font }, { commit: true });
            fontMenuOpen = false;
            container.querySelector('.font-menu')?.setAttribute('hidden', '');
            syncForm();
        } else if (target.dataset.toggle === 'bold') {
            editor.updateLayer(layer.id, { weight: layer.weight >= 600 ? 400 : 700 }, { commit: true });
            syncForm();
        } else if (target.dataset.toggle === 'italic') {
            editor.updateLayer(layer.id, { italic: !layer.italic }, { commit: true });
            syncForm();
        } else if (target.dataset.toggle === 'uppercase') {
            editor.updateLayer(layer.id, { uppercase: !layer.uppercase }, { commit: true });
            syncForm();
        } else if (target.dataset.align) {
            editor.updateLayer(layer.id, { align: target.dataset.align }, { commit: true });
            syncForm();
        } else if (target.dataset.color) {
            editor.updateLayer(layer.id, { color: target.dataset.color }, { commit: true });
            syncForm();
        }
    }

    function focusText() {
        requestAnimationFrame(() => {
            const textarea = container.querySelector('#layer-text');
            if (textarea) {
                textarea.focus();
                textarea.select();
            }
        });
    }

    render();
    return { render, focusText };
}

function readPath(object, path) {
    return path.split('.').reduce((value, key) => value?.[key], object);
}

function buildPatch(path, value) {
    const [head, child] = path.split('.');
    return child ? { [head]: { [child]: value } } : { [head]: value };
}
