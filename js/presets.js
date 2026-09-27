/**
 * Design model helpers: text layer defaults, one-click text presets, multi-layer templates,
 * and photo "looks". All geometry is stored relative to the canvas so a design renders the
 * same at any resolution:
 *   x, y       center of the text block as a fraction of canvas width / height
 *   size       font size as a fraction of the canvas's shorter side
 *   maxWidth   wrap width as a fraction of canvas width
 */
export const DEFAULT_FILTERS = Object.freeze({
    brightness: 100,
    contrast: 100,
    saturation: 100,
    warmth: 0,
    blur: 0,
    vignette: 0
});

export const BASE_SWATCHES = ['#ffffff', '#111111', '#f5e6c8', '#d4a017', '#c2562f', '#2f4b7c'];

let layerCounter = 0;

export function createLayerId() {
    layerCounter += 1;
    return `layer-${Date.now().toString(36)}-${layerCounter}`;
}

export function createLayer(overrides = {}) {
    return normalizeLayer({
        id: createLayerId(),
        text: 'Your text',
        x: 0.5,
        y: 0.5,
        family: 'Playfair Display',
        weight: 700,
        italic: false,
        size: 0.08,
        color: '#ffffff',
        align: 'center',
        lineHeight: 1.15,
        letterSpacing: 0,
        uppercase: false,
        opacity: 1,
        rotation: 0,
        maxWidth: 0.84,
        shadow: { enabled: true, color: '#000000', strength: 0.35 },
        outline: { enabled: false, color: '#000000', width: 0.06 },
        background: { enabled: false, color: '#000000', opacity: 0.55, padding: 0.45, radius: 0.25 },
        ...overrides
    });
}

export function normalizeLayer(layer) {
    const clamp = (value, min, max, fallback) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    };

    return {
        id: typeof layer.id === 'string' && layer.id ? layer.id : createLayerId(),
        text: typeof layer.text === 'string' ? layer.text.slice(0, 2000) : '',
        x: clamp(layer.x, -0.2, 1.2, 0.5),
        y: clamp(layer.y, -0.2, 1.2, 0.5),
        family: typeof layer.family === 'string' ? layer.family : 'Playfair Display',
        weight: clamp(layer.weight, 100, 900, 400),
        italic: Boolean(layer.italic),
        size: clamp(layer.size, 0.01, 0.5, 0.08),
        color: isHexColor(layer.color) ? layer.color : '#ffffff',
        align: ['left', 'center', 'right'].includes(layer.align) ? layer.align : 'center',
        lineHeight: clamp(layer.lineHeight, 0.8, 2.5, 1.15),
        letterSpacing: clamp(layer.letterSpacing, -0.1, 0.6, 0),
        uppercase: Boolean(layer.uppercase),
        opacity: clamp(layer.opacity, 0, 1, 1),
        rotation: clamp(layer.rotation, -180, 180, 0),
        maxWidth: clamp(layer.maxWidth, 0.1, 1.2, 0.84),
        shadow: {
            enabled: Boolean(layer.shadow?.enabled),
            color: isHexColor(layer.shadow?.color) ? layer.shadow.color : '#000000',
            strength: clamp(layer.shadow?.strength, 0, 1, 0.35)
        },
        outline: {
            enabled: Boolean(layer.outline?.enabled),
            color: isHexColor(layer.outline?.color) ? layer.outline.color : '#000000',
            width: clamp(layer.outline?.width, 0.01, 0.3, 0.06)
        },
        background: {
            enabled: Boolean(layer.background?.enabled),
            color: isHexColor(layer.background?.color) ? layer.background.color : '#000000',
            opacity: clamp(layer.background?.opacity, 0, 1, 0.55),
            padding: clamp(layer.background?.padding, 0, 2, 0.45),
            radius: clamp(layer.background?.radius, 0, 1, 0.25)
        }
    };
}

export function normalizeFilters(filters = {}) {
    const output = { ...DEFAULT_FILTERS };
    for (const key of Object.keys(DEFAULT_FILTERS)) {
        const value = Number(filters[key]);
        if (Number.isFinite(value)) {
            output[key] = value;
        }
    }
    return output;
}

export function isHexColor(value) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

/** Suggested fonts for new text, taken from the active art style when there is one. */
function styleFonts(style) {
    return {
        title: style?.fonts?.title || 'Playfair Display',
        body: style?.fonts?.body || 'Lora'
    };
}

export const TEXT_PRESETS = [
    {
        id: 'headline',
        label: 'Headline',
        sample: 'Aa',
        build: (style) => ({
            text: 'Your Title',
            family: styleFonts(style).title,
            weight: 700,
            size: 0.1,
            letterSpacing: 0.02,
            y: 0.16
        })
    },
    {
        id: 'script',
        label: 'Elegant script',
        sample: 'Aa',
        family: 'Great Vibes',
        build: () => ({
            text: 'Happy Birthday',
            family: 'Great Vibes',
            weight: 400,
            size: 0.12,
            y: 0.2
        })
    },
    {
        id: 'quote',
        label: 'Quote',
        sample: '"Aa"',
        build: (style) => ({
            text: '"Every moment is a fresh beginning."',
            family: styleFonts(style).body,
            weight: 400,
            italic: true,
            size: 0.052,
            lineHeight: 1.35,
            maxWidth: 0.76,
            y: 0.5
        })
    },
    {
        id: 'caption',
        label: 'Caption box',
        sample: 'Aa',
        family: 'Work Sans',
        build: () => ({
            text: 'Add a caption',
            family: 'Work Sans',
            weight: 500,
            size: 0.036,
            y: 0.9,
            shadow: { enabled: false },
            background: { enabled: true, color: '#000000', opacity: 0.55 }
        })
    },
    {
        id: 'label',
        label: 'Small label',
        sample: 'AA',
        family: 'Josefin Sans',
        build: () => ({
            text: 'Limited edition',
            family: 'Josefin Sans',
            weight: 700,
            uppercase: true,
            letterSpacing: 0.22,
            size: 0.028,
            y: 0.08,
            shadow: { enabled: false },
            background: { enabled: true, color: '#111111', opacity: 0.7, padding: 0.8 }
        })
    },
    {
        id: 'signature',
        label: 'Signature',
        sample: 'Aa',
        family: 'Caveat',
        build: () => ({
            text: 'With love',
            family: 'Caveat',
            weight: 400,
            size: 0.05,
            align: 'right',
            x: 0.78,
            y: 0.9
        })
    }
];

/**
 * Multi-layer starting points. `placement` is where the image was composed to leave room
 * for text ('top' or 'bottom'); templates respect it when the layout allows.
 */
export const TEXT_TEMPLATES = [
    {
        id: 'poster',
        label: 'Poster title',
        description: 'Big title with a subtitle',
        build: (style, placement) => {
            const fonts = styleFonts(style);
            const top = placement !== 'bottom';
            return [
                {
                    text: 'Summer Nights',
                    family: fonts.title,
                    weight: 700,
                    uppercase: true,
                    letterSpacing: 0.06,
                    size: 0.11,
                    y: top ? 0.13 : 0.8
                },
                {
                    text: 'An evening of music and stars',
                    family: fonts.body,
                    weight: 400,
                    letterSpacing: 0.04,
                    size: 0.038,
                    y: top ? 0.23 : 0.9
                }
            ];
        }
    },
    {
        id: 'greeting',
        label: 'Greeting card',
        description: 'Script greeting and a message',
        build: (style, placement) => {
            const top = placement !== 'bottom';
            return [
                {
                    text: 'Happy Birthday',
                    family: 'Great Vibes',
                    weight: 400,
                    size: 0.13,
                    y: top ? 0.16 : 0.78
                },
                {
                    text: 'Wishing you a wonderful year ahead',
                    family: styleFonts(style).body,
                    weight: 400,
                    italic: true,
                    size: 0.04,
                    y: top ? 0.27 : 0.89
                }
            ];
        }
    },
    {
        id: 'quote-card',
        label: 'Quote card',
        description: 'Centered quote with an author',
        build: (style) => {
            const fonts = styleFonts(style);
            return [
                {
                    text: '"The earth has music for those who listen."',
                    family: fonts.body,
                    weight: 400,
                    italic: true,
                    size: 0.058,
                    lineHeight: 1.35,
                    maxWidth: 0.74,
                    y: 0.46,
                    background: { enabled: true, color: '#000000', opacity: 0.35, padding: 0.7, radius: 0.3 }
                },
                {
                    text: 'George Santayana',
                    family: 'Josefin Sans',
                    weight: 600,
                    uppercase: true,
                    letterSpacing: 0.18,
                    size: 0.026,
                    y: 0.62
                }
            ];
        }
    },
    {
        id: 'caption-bar',
        label: 'Caption bar',
        description: 'A clean band along the bottom',
        build: () => [
            {
                text: 'Our first home, spring 2026',
                family: 'Work Sans',
                weight: 500,
                size: 0.04,
                y: 0.91,
                maxWidth: 1,
                shadow: { enabled: false },
                background: { enabled: true, color: '#111111', opacity: 0.65, padding: 0.6, radius: 0 }
            }
        ]
    }
];

export const LOOKS = [
    { id: 'natural', label: 'Natural', filters: {} },
    { id: 'warm', label: 'Warm', filters: { warmth: 25, saturation: 108 } },
    { id: 'cool', label: 'Cool', filters: { warmth: -22, saturation: 96 } },
    { id: 'vivid', label: 'Vivid', filters: { saturation: 132, contrast: 108 } },
    { id: 'faded', label: 'Faded', filters: { contrast: 84, brightness: 108, saturation: 78 } },
    { id: 'noir', label: 'Noir', filters: { saturation: 0, contrast: 126, vignette: 0.35 } },
    { id: 'dramatic', label: 'Dramatic', filters: { contrast: 122, brightness: 94, vignette: 0.45 } }
];

/** Convert gallery items saved by the original three-slot editor into layers. */
export function designFromLegacy(overlays = {}, filters = {}) {
    const legacyFamilies = {
        Outfit: 'Outfit',
        Orbitron: 'Orbitron',
        Inter: 'Work Sans',
        'Playfair Display': 'Playfair Display',
        Merriweather: 'Lora',
        Pacifico: 'Pacifico'
    };

    const layers = ['header', 'quote', 'author']
        .map((key) => overlays[key])
        .filter((overlay) => overlay && overlay.active !== false && typeof overlay.text === 'string' && overlay.text.trim())
        .map((overlay) => {
            const fontSize = Number(overlay.fontSize) || 32;
            return createLayer({
                text: overlay.text,
                y: Number(overlay.yPct) || 0.5,
                family: legacyFamilies[overlay.fontFamily] || 'Playfair Display',
                weight: Number(overlay.fontWeight) || 400,
                size: fontSize / 1024,
                color: overlay.color,
                align: overlay.alignment,
                lineHeight: overlay.lineHeight,
                letterSpacing: (Number(overlay.letterSpacing) || 0) / fontSize,
                shadow: { enabled: (Number(overlay.shadowBlur) || 0) > 0, color: overlay.shadowColor || '#000000', strength: 0.35 },
                outline: { enabled: Boolean(overlay.outlineActive), color: overlay.outlineColor, width: (Number(overlay.outlineWidth) || 3) / fontSize },
                background: { enabled: Boolean(overlay.bgActive), color: overlay.bgColor, opacity: (Number(overlay.bgOpacity) || 50) / 100 }
            });
        });

    return {
        version: 2,
        layers,
        filters: normalizeFilters(filters)
    };
}
