/**
 * Typeface catalog for text layers. Every family here is requested from Google Fonts in
 * index.html; font files only download when a face is actually used.
 */
export const FONT_CATEGORIES = ['Serif', 'Sans', 'Script', 'Display'];

export const FONT_CATALOG = [
    { family: 'Playfair Display', category: 'Serif', weights: [400, 700], italic: true },
    { family: 'Cormorant Garamond', category: 'Serif', weights: [400, 600], italic: true },
    { family: 'DM Serif Display', category: 'Serif', weights: [400], italic: true },
    { family: 'Fraunces', category: 'Serif', weights: [400, 700], italic: true },
    { family: 'Lora', category: 'Serif', weights: [400, 600], italic: true },
    { family: 'Cinzel', category: 'Serif', weights: [400, 700], italic: false },
    { family: 'Cinzel Decorative', category: 'Serif', weights: [400, 700], italic: false },
    { family: 'Work Sans', category: 'Sans', weights: [400, 500, 700], italic: false },
    { family: 'Josefin Sans', category: 'Sans', weights: [400, 600, 700], italic: false },
    { family: 'Outfit', category: 'Sans', weights: [400, 600, 800], italic: false },
    { family: 'Nunito', category: 'Sans', weights: [400, 700, 800], italic: false },
    { family: 'Space Grotesk', category: 'Sans', weights: [400, 600, 700], italic: false },
    { family: 'Fredoka', category: 'Sans', weights: [400, 600], italic: false },
    { family: 'Great Vibes', category: 'Script', weights: [400], italic: false },
    { family: 'Dancing Script', category: 'Script', weights: [400, 700], italic: false },
    { family: 'Caveat', category: 'Script', weights: [400, 700], italic: false },
    { family: 'Pacifico', category: 'Script', weights: [400], italic: false },
    { family: 'Bebas Neue', category: 'Display', weights: [400], italic: false },
    { family: 'Abril Fatface', category: 'Display', weights: [400], italic: false },
    { family: 'Bangers', category: 'Display', weights: [400], italic: false },
    { family: 'Orbitron', category: 'Display', weights: [400, 700], italic: false },
    { family: 'Press Start 2P', category: 'Display', weights: [400], italic: false }
];

const FALLBACKS = {
    Serif: 'Georgia, "Times New Roman", serif',
    Sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    Script: '"Brush Script MT", cursive',
    Display: 'Impact, system-ui, sans-serif'
};

export function getFont(family) {
    return FONT_CATALOG.find((font) => font.family === family) || FONT_CATALOG[0];
}

export function fontStack(family) {
    const font = getFont(family);
    return `"${font.family}", ${FALLBACKS[font.category]}`;
}

/** Closest weight the family actually ships, so bold toggles never synthesize faux bold. */
export function resolveWeight(family, requestedWeight) {
    const weights = getFont(family).weights;
    const target = Number(requestedWeight) || 400;
    return weights.reduce((best, weight) => (
        Math.abs(weight - target) < Math.abs(best - target) ? weight : best
    ), weights[0]);
}

export function canItalicize(family) {
    return getFont(family).italic;
}

export function buildCanvasFont({ family, weight, italic }, pixelSize) {
    const style = italic && canItalicize(family) ? 'italic' : 'normal';
    return `${style} ${resolveWeight(family, weight)} ${Math.max(1, Math.round(pixelSize))}px ${fontStack(family)}`;
}

/**
 * Wait for the faces used by the given layers. Canvas text silently falls back to a system
 * font when a web font has not finished loading, so callers redraw once this resolves.
 */
export async function ensureFontsLoaded(layers) {
    if (!document.fonts?.load) {
        return;
    }

    const requests = new Set(layers.map((layer) => buildCanvasFont(layer, 48)));
    await Promise.all([...requests].map((font) => document.fonts.load(font).catch(() => [])));
}
