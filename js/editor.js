import { buildCanvasFont, ensureFontsLoaded } from './fonts.js';
import { DEFAULT_FILTERS, createLayer, createLayerId, normalizeFilters, normalizeLayer } from './presets.js';

const HISTORY_LIMIT = 80;
const SNAP_TOLERANCE = 0.015;
const HANDLE_RADIUS = 9;
const ROTATE_HANDLE_OFFSET = 30;

const supportsCanvasFilter = (() => {
    try {
        const ctx = document.createElement('canvas').getContext('2d');
        if (typeof ctx.filter !== 'string') return false;
        ctx.filter = 'blur(1px)';
        return ctx.filter === 'blur(1px)';
    } catch {
        return false;
    }
})();

const supportsLetterSpacing = typeof CanvasRenderingContext2D !== 'undefined'
    && 'letterSpacing' in CanvasRenderingContext2D.prototype;

/**
 * Layered canvas compositor: a background image with photo adjustments plus any number of
 * free-form text layers. Emits:
 *   change    the design changed (layers or filters)
 *   select    the selected layer changed (detail: { id })
 *   history   undo/redo availability changed
 *   edittext  the user double-clicked a layer (detail: { id })
 */
export class CanvasEditor extends EventTarget {
    constructor(canvas) {
        super();
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.image = null;
        this.imageObjectUrl = null;
        this.layers = [];
        this.filters = { ...DEFAULT_FILTERS };
        this.selectedId = null;
        this.backgroundCache = null;
        this.backgroundCacheKey = '';
        this.guides = { x: false, y: false };
        this.interaction = null;
        this.history = [];
        this.future = [];
        this.renderQueued = false;
        this.commitTimer = null;

        this.bindPointerEvents();
        document.fonts?.addEventListener?.('loadingdone', () => this.requestRender());
    }

    get hasImage() {
        return Boolean(this.image);
    }

    get selectedLayer() {
        return this.layers.find((layer) => layer.id === this.selectedId) || null;
    }

    get canUndo() {
        return this.history.length > 1;
    }

    get canRedo() {
        return this.future.length > 0;
    }

    /** Load a background image. Protected /api/assets URLs are fetched with the session cookie. */
    async loadImage(source) {
        let src = source;
        let objectUrl = null;
        if (typeof source === 'string' && source.startsWith('/api/assets/')) {
            const response = await fetch(source, { credentials: 'same-origin' });
            if (!response.ok) {
                throw new Error('Could not load that image. Please sign in again.');
            }
            objectUrl = URL.createObjectURL(await response.blob());
            src = objectUrl;
        }

        const image = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('The image could not be opened.'));
            img.src = src;
        });

        if (this.imageObjectUrl) {
            URL.revokeObjectURL(this.imageObjectUrl);
        }
        this.imageObjectUrl = objectUrl;
        this.image = image;
        this.canvas.width = image.naturalWidth || 1024;
        this.canvas.height = image.naturalHeight || 1024;
        this.backgroundCache = null;
        this.backgroundCacheKey = '';
        this.render();
    }

    getDesign() {
        return {
            version: 2,
            layers: this.layers.map((layer) => structuredClone(layer)),
            filters: { ...this.filters }
        };
    }

    async setDesign(design, { resetHistory = true } = {}) {
        this.layers = (design?.layers || []).map((layer) => normalizeLayer(layer));
        this.filters = normalizeFilters(design?.filters);
        this.selectedId = null;
        if (resetHistory) {
            this.history = [];
            this.future = [];
        }
        this.commit({ silent: true });
        this.render();
        this.emitSelection();
        await ensureFontsLoaded(this.layers);
        this.render();
    }

    addLayer(overrides = {}) {
        return this.addLayers([overrides])[0];
    }

    addLayers(list) {
        const created = list.map((overrides) => createLayer(overrides));
        this.layers.push(...created);
        this.selectedId = created.at(-1)?.id || this.selectedId;
        this.afterMutation({ commit: true, fonts: created });
        this.emitSelection();
        return created;
    }

    updateLayer(id, patch, { commit = 'debounced' } = {}) {
        const index = this.layers.findIndex((layer) => layer.id === id);
        if (index === -1) return;

        const current = this.layers[index];
        const next = { ...current, ...patch };
        for (const key of ['shadow', 'outline', 'background']) {
            if (patch[key]) {
                next[key] = { ...current[key], ...patch[key] };
            }
        }
        this.layers[index] = normalizeLayer(next);

        const fontChanged = ['family', 'weight', 'italic'].some((key) => key in patch);
        this.afterMutation({ commit, fonts: fontChanged ? [this.layers[index]] : null });
    }

    removeLayer(id) {
        this.layers = this.layers.filter((layer) => layer.id !== id);
        if (this.selectedId === id) {
            this.selectedId = null;
            this.emitSelection();
        }
        this.afterMutation({ commit: true });
    }

    duplicateLayer(id) {
        const source = this.layers.find((layer) => layer.id === id);
        if (!source) return null;
        const copy = normalizeLayer({
            ...structuredClone(source),
            id: createLayerId(),
            x: Math.min(1, source.x + 0.03),
            y: Math.min(1, source.y + 0.03)
        });
        this.layers.push(copy);
        this.selectedId = copy.id;
        this.afterMutation({ commit: true });
        this.emitSelection();
        return copy;
    }

    /** Move a layer up (toward the front) or down in the stacking order. */
    reorderLayer(id, direction) {
        const index = this.layers.findIndex((layer) => layer.id === id);
        const target = direction === 'up' ? index + 1 : index - 1;
        if (index === -1 || target < 0 || target >= this.layers.length) return;
        [this.layers[index], this.layers[target]] = [this.layers[target], this.layers[index]];
        this.afterMutation({ commit: true });
    }

    select(id) {
        const next = this.layers.some((layer) => layer.id === id) ? id : null;
        if (next === this.selectedId) return;
        this.selectedId = next;
        this.emitSelection();
        this.requestRender();
    }

    setFilters(patch, { commit = 'debounced' } = {}) {
        this.filters = normalizeFilters({ ...this.filters, ...patch });
        this.afterMutation({ commit });
    }

    resetFilters() {
        this.filters = { ...DEFAULT_FILTERS };
        this.afterMutation({ commit: true });
    }

    undo() {
        if (!this.canUndo) return;
        this.flushPendingCommit();
        this.future.push(this.history.pop());
        this.restoreSnapshot(this.history.at(-1));
    }

    redo() {
        if (!this.canRedo) return;
        const snapshot = this.future.pop();
        this.history.push(snapshot);
        this.restoreSnapshot(snapshot);
    }

    commit({ silent = false } = {}) {
        clearTimeout(this.commitTimer);
        this.commitTimer = null;
        const snapshot = JSON.stringify({ layers: this.layers, filters: this.filters });
        if (this.history.at(-1) === snapshot) return;
        this.history.push(snapshot);
        if (this.history.length > HISTORY_LIMIT) {
            this.history.shift();
        }
        this.future = [];
        if (!silent) {
            this.dispatchEvent(new Event('history'));
        }
    }

    flushPendingCommit() {
        if (this.commitTimer) {
            this.commit();
        }
    }

    /** Resolve once every layer's web font is ready, so exports never bake in a fallback font. */
    fontsReady() {
        return ensureFontsLoaded(this.layers);
    }

    /** Render the finished artwork (no selection chrome) at full resolution. */
    exportBlob(type = 'image/png', quality = 0.95) {
        const canvas = this.renderExportCanvas();
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Export failed.'))), type, quality);
        });
    }

    exportDataUrl(type = 'image/png', quality = 0.95) {
        return this.renderExportCanvas().toDataURL(type, quality);
    }

    clear() {
        this.image = null;
        this.layers = [];
        this.filters = { ...DEFAULT_FILTERS };
        this.selectedId = null;
        this.history = [];
        this.future = [];
        this.backgroundCache = null;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // ----- internals -----

    afterMutation({ commit, fonts }) {
        this.requestRender();
        this.dispatchEvent(new Event('change'));
        if (commit === true) {
            this.commit();
        } else if (commit === 'debounced') {
            clearTimeout(this.commitTimer);
            this.commitTimer = setTimeout(() => this.commit(), 450);
        }
        if (fonts?.length) {
            ensureFontsLoaded(fonts).then(() => this.requestRender());
        }
    }

    restoreSnapshot(snapshot) {
        const parsed = JSON.parse(snapshot);
        this.layers = parsed.layers.map((layer) => normalizeLayer(layer));
        this.filters = normalizeFilters(parsed.filters);
        if (!this.layers.some((layer) => layer.id === this.selectedId)) {
            this.selectedId = null;
        }
        this.requestRender();
        this.emitSelection();
        this.dispatchEvent(new Event('change'));
        this.dispatchEvent(new Event('history'));
    }

    emitSelection() {
        this.dispatchEvent(new CustomEvent('select', { detail: { id: this.selectedId } }));
    }

    requestRender() {
        if (this.renderQueued) return;
        this.renderQueued = true;
        requestAnimationFrame(() => {
            this.renderQueued = false;
            this.render();
        });
    }

    render() {
        if (!this.image) return;
        this.renderTo(this.ctx, this.canvas.width, this.canvas.height, { showChrome: true });
    }

    renderExportCanvas() {
        const canvas = document.createElement('canvas');
        canvas.width = this.canvas.width;
        canvas.height = this.canvas.height;
        this.renderTo(canvas.getContext('2d'), canvas.width, canvas.height, { showChrome: false });
        return canvas;
    }

    renderTo(ctx, width, height, { showChrome }) {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(this.getFilteredBackground(width, height), 0, 0);

        if (this.filters.vignette > 0) {
            drawVignette(ctx, width, height, this.filters.vignette);
        }

        for (const layer of this.layers) {
            drawTextLayer(ctx, layer, width, height);
        }

        if (showChrome) {
            this.drawChrome(ctx, width, height);
        }
    }

    /** Adjusted background, cached so dragging text does not re-run the pixel work. */
    getFilteredBackground(width, height) {
        const { brightness, contrast, saturation, warmth, blur } = this.filters;
        const key = [width, height, brightness, contrast, saturation, warmth, blur].join('|');
        if (this.backgroundCache && this.backgroundCacheKey === key) {
            return this.backgroundCache;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: !supportsCanvasFilter });
        const needsTone = brightness !== 100 || contrast !== 100 || saturation !== 100;

        if (supportsCanvasFilter) {
            const blurPx = blur * (Math.min(width, height) / 1024);
            ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)${blurPx > 0 ? ` blur(${blurPx}px)` : ''}`;
            ctx.drawImage(this.image, 0, 0, width, height);
            ctx.filter = 'none';
        } else {
            ctx.drawImage(this.image, 0, 0, width, height);
            if (needsTone) {
                applyToneFallback(ctx, width, height, brightness, contrast, saturation);
            }
        }

        if (warmth !== 0) {
            ctx.save();
            ctx.globalCompositeOperation = 'soft-light';
            ctx.globalAlpha = Math.min(1, Math.abs(warmth) / 100) * 0.7;
            ctx.fillStyle = warmth > 0 ? '#ff8a2a' : '#2a7dff';
            ctx.fillRect(0, 0, width, height);
            ctx.restore();
        }

        this.backgroundCache = canvas;
        this.backgroundCacheKey = key;
        return canvas;
    }

    drawChrome(ctx, width, height) {
        const scale = this.getScreenScale();

        if (this.guides.x || this.guides.y) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 64, 129, 0.9)';
            ctx.lineWidth = 1.5 * scale;
            ctx.setLineDash([6 * scale, 5 * scale]);
            ctx.beginPath();
            if (this.guides.x) {
                ctx.moveTo(width / 2, 0);
                ctx.lineTo(width / 2, height);
            }
            if (this.guides.y) {
                ctx.moveTo(0, height / 2);
                ctx.lineTo(width, height / 2);
            }
            ctx.stroke();
            ctx.restore();
        }

        const layer = this.selectedLayer;
        if (!layer) return;

        const layout = layoutTextLayer(ctx, layer, width, height);
        const box = getLayerBox(layout);
        ctx.save();
        ctx.translate(layout.cx, layout.cy);
        ctx.rotate(layout.rotation);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.lineWidth = 3 * scale;
        ctx.strokeRect(box.left, box.top, box.width, box.height);
        ctx.strokeStyle = '#6d5dfc';
        ctx.lineWidth = 1.5 * scale;
        ctx.setLineDash([7 * scale, 5 * scale]);
        ctx.strokeRect(box.left, box.top, box.width, box.height);
        ctx.setLineDash([]);

        const rotateY = box.top - ROTATE_HANDLE_OFFSET * scale;
        ctx.beginPath();
        ctx.moveTo(0, box.top);
        ctx.lineTo(0, rotateY);
        ctx.stroke();

        for (const [hx, hy] of [[box.right, box.bottom], [0, rotateY]]) {
            ctx.beginPath();
            ctx.arc(hx, hy, HANDLE_RADIUS * scale, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.lineWidth = 2 * scale;
            ctx.strokeStyle = '#6d5dfc';
            ctx.stroke();
        }
        ctx.restore();
    }

    getScreenScale() {
        const rect = this.canvas.getBoundingClientRect();
        return rect.width ? this.canvas.width / rect.width : 1;
    }

    toCanvasPoint(event) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: ((event.clientX - rect.left) / rect.width) * this.canvas.width,
            y: ((event.clientY - rect.top) / rect.height) * this.canvas.height
        };
    }

    hitTest(point) {
        const scale = this.getScreenScale();
        for (let i = this.layers.length - 1; i >= 0; i -= 1) {
            const layer = this.layers[i];
            const layout = layoutTextLayer(this.ctx, layer, this.canvas.width, this.canvas.height);
            const local = toLocal(point, layout);
            const box = getLayerBox(layout);
            const tolerance = 6 * scale;
            if (
                local.x >= box.left - tolerance && local.x <= box.right + tolerance &&
                local.y >= box.top - tolerance && local.y <= box.bottom + tolerance
            ) {
                return layer;
            }
        }
        return null;
    }

    hitHandle(point) {
        const layer = this.selectedLayer;
        if (!layer) return null;
        const scale = this.getScreenScale();
        const layout = layoutTextLayer(this.ctx, layer, this.canvas.width, this.canvas.height);
        const box = getLayerBox(layout);
        const local = toLocal(point, layout);
        const reach = (HANDLE_RADIUS + 6) * scale;
        if (Math.hypot(local.x - box.right, local.y - box.bottom) <= reach) {
            return { type: 'resize', layer, layout };
        }
        if (Math.hypot(local.x, local.y - (box.top - ROTATE_HANDLE_OFFSET * scale)) <= reach) {
            return { type: 'rotate', layer, layout };
        }
        return null;
    }

    bindPointerEvents() {
        const canvas = this.canvas;

        canvas.addEventListener('pointerdown', (event) => {
            if (!this.image || event.button > 0) return;
            const point = this.toCanvasPoint(event);
            const handle = this.hitHandle(point);

            if (handle?.type === 'resize') {
                this.interaction = {
                    type: 'resize',
                    id: handle.layer.id,
                    startDistance: Math.max(1, Math.hypot(point.x - handle.layout.cx, point.y - handle.layout.cy)),
                    startSize: handle.layer.size,
                    startMaxWidth: handle.layer.maxWidth,
                    moved: false
                };
            } else if (handle?.type === 'rotate') {
                this.interaction = {
                    type: 'rotate',
                    id: handle.layer.id,
                    cx: handle.layout.cx,
                    cy: handle.layout.cy,
                    moved: false
                };
            } else {
                const hit = this.hitTest(point);
                this.select(hit?.id || null);
                if (!hit) return;
                this.interaction = {
                    type: 'move',
                    id: hit.id,
                    offsetX: point.x - hit.x * canvas.width,
                    offsetY: point.y - hit.y * canvas.height,
                    moved: false
                };
            }

            canvas.setPointerCapture(event.pointerId);
            canvas.focus({ preventScroll: true });
            event.preventDefault();
        });

        canvas.addEventListener('pointermove', (event) => {
            if (!this.image) return;
            const point = this.toCanvasPoint(event);

            if (!this.interaction) {
                const handle = this.hitHandle(point);
                canvas.style.cursor = handle?.type === 'resize'
                    ? 'nwse-resize'
                    : handle?.type === 'rotate' ? 'grab' : this.hitTest(point) ? 'move' : 'default';
                return;
            }

            const layer = this.layers.find((candidate) => candidate.id === this.interaction.id);
            if (!layer) return;
            this.interaction.moved = true;

            if (this.interaction.type === 'move') {
                let x = (point.x - this.interaction.offsetX) / canvas.width;
                let y = (point.y - this.interaction.offsetY) / canvas.height;
                this.guides.x = Math.abs(x - 0.5) < SNAP_TOLERANCE;
                this.guides.y = Math.abs(y - 0.5) < SNAP_TOLERANCE;
                if (this.guides.x) x = 0.5;
                if (this.guides.y) y = 0.5;
                layer.x = Math.min(1.1, Math.max(-0.1, x));
                layer.y = Math.min(1.1, Math.max(-0.1, y));
            } else if (this.interaction.type === 'resize') {
                const layout = layoutTextLayer(this.ctx, layer, canvas.width, canvas.height);
                const ratio = Math.hypot(point.x - layout.cx, point.y - layout.cy) / this.interaction.startDistance;
                layer.size = Math.min(0.5, Math.max(0.012, this.interaction.startSize * ratio));
                layer.maxWidth = Math.min(1.2, Math.max(0.1, this.interaction.startMaxWidth * ratio));
            } else if (this.interaction.type === 'rotate') {
                let degrees = (Math.atan2(point.y - this.interaction.cy, point.x - this.interaction.cx) * 180) / Math.PI + 90;
                if (degrees > 180) degrees -= 360;
                const snapped = Math.round(degrees / 45) * 45;
                layer.rotation = Math.abs(degrees - snapped) < 4 ? snapped : Math.round(degrees);
            }

            this.requestRender();
            this.dispatchEvent(new Event('change'));
        });

        const endInteraction = () => {
            if (!this.interaction) return;
            const { moved } = this.interaction;
            this.interaction = null;
            this.guides = { x: false, y: false };
            this.requestRender();
            if (moved) this.commit();
        };
        canvas.addEventListener('pointerup', endInteraction);
        canvas.addEventListener('pointercancel', endInteraction);

        canvas.addEventListener('dblclick', (event) => {
            const hit = this.hitTest(this.toCanvasPoint(event));
            if (hit) {
                this.select(hit.id);
                this.dispatchEvent(new CustomEvent('edittext', { detail: { id: hit.id } }));
            }
        });

        canvas.addEventListener('keydown', (event) => {
            const layer = this.selectedLayer;
            if (!layer) return;
            const step = event.shiftKey ? 0.02 : 0.004;
            const moves = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step]
            };
            if (moves[event.key]) {
                const [dx, dy] = moves[event.key];
                this.updateLayer(layer.id, { x: layer.x + dx, y: layer.y + dy });
                event.preventDefault();
            } else if (event.key === 'Delete' || event.key === 'Backspace') {
                this.removeLayer(layer.id);
                event.preventDefault();
            } else if (event.key === 'Escape') {
                this.select(null);
            }
        });
    }
}

// ----- drawing helpers (pure functions of a context and a layer) -----

export function layoutTextLayer(ctx, layer, width, height) {
    const unit = Math.min(width, height);
    const px = layer.size * unit;
    const spacingPx = layer.letterSpacing * px;
    const font = buildCanvasFont(layer, px);

    ctx.save();
    ctx.font = font;
    if (supportsLetterSpacing) ctx.letterSpacing = `${spacingPx}px`;
    const measure = (text) => measureLine(ctx, text, spacingPx);
    const text = layer.uppercase ? layer.text.toUpperCase() : layer.text;
    const lines = wrapText(text, layer.maxWidth * width, measure);
    const lineWidths = lines.map(measure);
    ctx.restore();

    const lineHeightPx = px * layer.lineHeight;
    const blockWidth = Math.max(px * 0.6, ...lineWidths);
    const blockHeight = Math.max(1, lines.length) * lineHeightPx;
    const padding = layer.background.enabled ? layer.background.padding * px : px * 0.12;

    return {
        px,
        font,
        spacingPx,
        lines,
        lineWidths,
        lineHeightPx,
        blockWidth,
        blockHeight,
        padX: padding,
        padY: padding * 0.7,
        cx: layer.x * width,
        cy: layer.y * height,
        rotation: (layer.rotation * Math.PI) / 180
    };
}

function getLayerBox(layout) {
    const halfWidth = layout.blockWidth / 2 + layout.padX;
    const halfHeight = layout.blockHeight / 2 + layout.padY;
    return {
        left: -halfWidth,
        right: halfWidth,
        top: -halfHeight,
        bottom: halfHeight,
        width: halfWidth * 2,
        height: halfHeight * 2
    };
}

function toLocal(point, layout) {
    const dx = point.x - layout.cx;
    const dy = point.y - layout.cy;
    const cos = Math.cos(layout.rotation);
    const sin = Math.sin(layout.rotation);
    return {
        x: dx * cos + dy * sin,
        y: -dx * sin + dy * cos
    };
}

function measureLine(ctx, text, spacingPx) {
    if (!text) return 0;
    const width = ctx.measureText(text).width;
    // Native letterSpacing also pads after the final glyph; manual spacing only goes between glyphs.
    return supportsLetterSpacing ? width - spacingPx : width + (Array.from(text).length - 1) * spacingPx;
}

/** Greedy word wrap that also breaks words longer than the line (long names, URLs). */
export function wrapText(text, maxWidth, measure) {
    const lines = [];
    for (const paragraph of text.split('\n')) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        if (!words.length) {
            lines.push('');
            continue;
        }

        let current = '';
        for (const word of words) {
            const candidate = current ? `${current} ${word}` : word;
            if (measure(candidate) <= maxWidth) {
                current = candidate;
                continue;
            }
            if (current) lines.push(current);

            if (measure(word) <= maxWidth) {
                current = word;
                continue;
            }

            let chunk = '';
            for (const char of Array.from(word)) {
                if (chunk && measure(chunk + char) > maxWidth) {
                    lines.push(chunk);
                    chunk = char;
                } else {
                    chunk += char;
                }
            }
            current = chunk;
        }
        lines.push(current);
    }
    return lines;
}

function drawTextLayer(ctx, layer, width, height) {
    if (!layer.text.trim()) return;
    const layout = layoutTextLayer(ctx, layer, width, height);
    const { px, lines, lineWidths, lineHeightPx, blockWidth, blockHeight, spacingPx } = layout;

    ctx.save();
    ctx.translate(layout.cx, layout.cy);
    ctx.rotate(layout.rotation);
    ctx.globalAlpha = layer.opacity;

    if (layer.background.enabled && layer.background.opacity > 0) {
        const box = getLayerBox(layout);
        ctx.save();
        ctx.globalAlpha = layer.opacity * layer.background.opacity;
        ctx.fillStyle = layer.background.color;
        ctx.beginPath();
        const radius = Math.min(layer.background.radius * px, box.height / 2);
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(box.left, box.top, box.width, box.height, radius);
        } else {
            ctx.rect(box.left, box.top, box.width, box.height);
        }
        ctx.fill();
        ctx.restore();
    }

    ctx.font = layout.font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    if (supportsLetterSpacing) ctx.letterSpacing = `${spacingPx}px`;
    ctx.fillStyle = layer.color;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = layer.outline.color;
    // Strokes straddle the glyph edge and the fill covers the inner half, so double the width.
    ctx.lineWidth = layer.outline.width * px * 2;

    const positions = lines.map((line, index) => {
        const lineWidth = lineWidths[index];
        const x = layer.align === 'left'
            ? -blockWidth / 2
            : layer.align === 'right' ? blockWidth / 2 - lineWidth : -lineWidth / 2;
        return { line, x, y: -blockHeight / 2 + lineHeightPx * (index + 0.5) };
    });

    const paint = () => {
        for (const { line, x, y } of positions) {
            if (layer.outline.enabled) drawLine(ctx, line, x, y, spacingPx, 'stroke');
            drawLine(ctx, line, x, y, spacingPx, 'fill');
        }
    };

    if (layer.shadow.enabled && layer.shadow.strength > 0) {
        ctx.save();
        ctx.shadowColor = hexToRgba(layer.shadow.color, 0.35 + layer.shadow.strength * 0.5);
        ctx.shadowBlur = px * (0.08 + layer.shadow.strength * 0.45);
        ctx.shadowOffsetY = px * 0.04 * layer.shadow.strength;
        paint();
        ctx.restore();
    }
    paint();
    ctx.restore();
}

function drawLine(ctx, text, x, y, spacingPx, mode) {
    if (!text) return;
    if (supportsLetterSpacing || !spacingPx) {
        if (mode === 'stroke') ctx.strokeText(text, x, y);
        else ctx.fillText(text, x, y);
        return;
    }

    let cursor = x;
    for (const char of Array.from(text)) {
        if (mode === 'stroke') ctx.strokeText(char, cursor, y);
        else ctx.fillText(char, cursor, y);
        cursor += ctx.measureText(char).width + spacingPx;
    }
}

function drawVignette(ctx, width, height, strength) {
    const gradient = ctx.createRadialGradient(
        width / 2, height / 2, Math.min(width, height) * 0.3,
        width / 2, height / 2, Math.hypot(width, height) / 2
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, `rgba(0, 0, 0, ${Math.min(1, strength)})`);
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
}

/** Per-pixel brightness/contrast/saturation for browsers without canvas filters (Safari). */
function applyToneFallback(ctx, width, height, brightness, contrast, saturation) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const b = brightness / 100;
    const c = contrast / 100;
    const s = saturation / 100;

    for (let i = 0; i < data.length; i += 4) {
        let r = data[i] * b;
        let g = data[i + 1] * b;
        let bl = data[i + 2] * b;
        r = (r - 128) * c + 128;
        g = (g - 128) * c + 128;
        bl = (bl - 128) * c + 128;
        const gray = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
        data[i] = gray + (r - gray) * s;
        data[i + 1] = gray + (g - gray) * s;
        data[i + 2] = gray + (bl - gray) * s;
    }
    ctx.putImageData(imageData, 0, 0);
}

function hexToRgba(hex, alpha) {
    const value = parseInt(hex.slice(1), 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
