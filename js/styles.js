/**
 * Curated art style library shared by the browser (style picker) and the server (prompt
 * composition). Style prompts describe a medium or visual tradition in generic terms; they
 * intentionally avoid naming living artists, studios, or brands.
 *
 * palette: colors used for the picker preview and suggested text colors.
 * fonts: suggested typography pairing when the user adds text to an image in this style.
 */
export const STYLE_CATEGORIES = [
    { id: 'painting', label: 'Painting' },
    { id: 'print', label: 'Illustration & Print' },
    { id: 'photo', label: 'Photo & Film' },
    { id: 'craft', label: '3D & Craft' },
    { id: 'fantasy', label: 'Fantasy & Digital' }
];

export const STYLE_LIBRARY = [
    // Painting
    {
        id: 'old-master-oil',
        category: 'painting',
        name: 'Old Master Oil',
        blurb: 'Rich glazes and candlelit drama.',
        prompt: 'classical oil painting in the manner of the old masters, rich layered glazes, visible confident brushwork, dramatic chiaroscuro lighting, deep warm shadows, fine craquelure canvas texture, museum-quality fine art',
        palette: ['#2b1d14', '#7a4a24', '#c9953f', '#efdcb0'],
        fonts: { title: 'Cormorant Garamond', body: 'Cormorant Garamond' }
    },
    {
        id: 'watercolor',
        category: 'painting',
        name: 'Watercolor',
        blurb: 'Soft washes on textured paper.',
        prompt: 'loose watercolor painting on textured cold-press paper, soft wet-in-wet washes, granulating pigments, luminous untouched paper whites, delicate pen-and-ink accents, gentle color blooms at the edges',
        palette: ['#f7f1e6', '#9cc5d9', '#e8a7a1', '#6b8f71'],
        fonts: { title: 'Playfair Display', body: 'Lora' }
    },
    {
        id: 'impressionist',
        category: 'painting',
        name: 'Impressionist',
        blurb: 'Dappled light, broken color.',
        prompt: 'impressionist oil painting, broken color and short visible brushstrokes, dappled sunlight, shimmering atmosphere, plein air landscape feeling, soft edges and vibrant complementary colors',
        palette: ['#3f6e9e', '#9fc1a3', '#f2d27a', '#e9967a'],
        fonts: { title: 'Cormorant Garamond', body: 'Lora' }
    },
    {
        id: 'gouache-storybook',
        category: 'painting',
        name: 'Gouache Storybook',
        blurb: 'Matte, cozy, hand-painted charm.',
        prompt: 'gouache illustration with matte opaque colors, gentle dry-brush textures, cozy whimsical storybook charm, soft rounded shapes, warm hand-painted details, classic picture-book composition',
        palette: ['#f4e3c1', '#e07a5f', '#3d405b', '#81b29a'],
        fonts: { title: 'Fraunces', body: 'Nunito' }
    },
    {
        id: 'palette-knife',
        category: 'painting',
        name: 'Palette Knife',
        blurb: 'Thick, sculpted, expressive paint.',
        prompt: 'expressive impasto painting made with a palette knife, thick sculpted ridges of paint, bold color blocks, dramatic texture catching the light, energetic contemporary fine art',
        palette: ['#1d3557', '#e63946', '#f1c453', '#f1faee'],
        fonts: { title: 'Abril Fatface', body: 'Work Sans' }
    },

    // Illustration & print
    {
        id: 'art-nouveau',
        category: 'print',
        name: 'Art Nouveau',
        blurb: 'Flowing lines and ornate borders.',
        prompt: 'art nouveau decorative poster, flowing organic whiplash lines, ornamental floral frame, elegant muted palette with gold accents, stylized natural forms, vintage color lithograph texture',
        palette: ['#e9dcc0', '#b08d57', '#5f7a61', '#7b3f3f'],
        fonts: { title: 'Cinzel Decorative', body: 'Cormorant Garamond' }
    },
    {
        id: 'vintage-travel-poster',
        category: 'print',
        name: 'Vintage Travel Poster',
        blurb: 'Bold flat shapes, 1930s glamour.',
        prompt: '1930s vintage travel poster, bold flat shapes, simplified dramatic perspective, screen-printed texture with slight ink grain, warm limited palette, strong graphic silhouette, sunlit optimism',
        palette: ['#f2e3c6', '#e76f51', '#2a9d8f', '#264653'],
        fonts: { title: 'Bebas Neue', body: 'Josefin Sans' }
    },
    {
        id: 'mid-century-modern',
        category: 'print',
        name: 'Mid-Century Modern',
        blurb: 'Atomic-age shapes and colors.',
        prompt: 'mid-century modern illustration, clean geometric shapes, atomic-age motifs, retro palette of mustard, teal, burnt orange and cream, subtle paper grain, playful balanced composition',
        palette: ['#f3e9d2', '#e0a526', '#1b7f79', '#d9572b'],
        fonts: { title: 'Josefin Sans', body: 'Work Sans' }
    },
    {
        id: 'woodblock-print',
        category: 'print',
        name: 'Woodblock Print',
        blurb: 'Carved lines, flat serene color.',
        prompt: 'traditional Japanese woodblock print style, flat areas of color, bold carved outlines, subtle wood grain and washi paper texture, limited indigo and vermilion palette, serene balanced composition',
        palette: ['#efe6d2', '#2f4b7c', '#c8553d', '#8a9a5b'],
        fonts: { title: 'Shippori Mincho', body: 'Noto Serif JP' }
    },
    {
        id: 'risograph',
        category: 'print',
        name: 'Risograph',
        blurb: 'Two-color grain, zine energy.',
        prompt: 'risograph print, two-color overprint in fluorescent pink and blue ink, visible halftone grain, slight misregistration, flat shapes, indie zine aesthetic on uncoated paper',
        palette: ['#fdf6ec', '#ff5fa2', '#3b5bdb', '#1f1f3a'],
        fonts: { title: 'Space Grotesk', body: 'Space Grotesk' }
    },
    {
        id: 'linocut',
        category: 'print',
        name: 'Linocut',
        blurb: 'Hand-carved, bold, graphic.',
        prompt: 'hand-carved linocut relief print, bold black lines with gouge marks, rough uneven ink texture, a single accent color, printed on cream paper, strong graphic contrast',
        palette: ['#f4ecd8', '#111111', '#b33a3a', '#6b6b6b'],
        fonts: { title: 'Abril Fatface', body: 'Lora' }
    },
    {
        id: 'pop-art',
        category: 'print',
        name: 'Pop Art',
        blurb: 'Halftone dots and punchy color.',
        prompt: 'bold pop art, Ben-Day halftone dots, thick black outlines, saturated primary colors, comic-print energy, high contrast graphic shapes',
        palette: ['#ffe600', '#ff2e63', '#08d9d6', '#111111'],
        fonts: { title: 'Bangers', body: 'Work Sans' }
    },
    {
        id: 'botanical-plate',
        category: 'print',
        name: 'Botanical Plate',
        blurb: 'Antique scientific illustration.',
        prompt: 'antique scientific botanical illustration, fine engraved linework, delicate hand-tinted watercolor, aged ivory paper with foxing, precise naturalist detail, elegant museum plate layout',
        palette: ['#f3ecd9', '#6d8b5a', '#b5654c', '#3d3a2f'],
        fonts: { title: 'Cormorant Garamond', body: 'Lora' }
    },
    {
        id: 'line-art',
        category: 'print',
        name: 'Minimal Line Art',
        blurb: 'One elegant continuous line.',
        prompt: 'elegant minimalist continuous single-line drawing, clean confident black line on warm off-white, generous negative space, modern gallery print',
        palette: ['#faf7f2', '#1a1a1a', '#d9c7b0', '#8c8c8c'],
        fonts: { title: 'Cormorant Garamond', body: 'Work Sans' }
    },

    // Photo & film
    {
        id: 'cinematic',
        category: 'photo',
        name: 'Cinematic Still',
        blurb: 'Anamorphic, moody, story-rich.',
        prompt: 'cinematic film still, anamorphic lens, dramatic motivated lighting, shallow depth of field, rich teal and amber color grade, subtle 35mm film grain, story-driven composition',
        palette: ['#0d1b2a', '#1b4965', '#e09f3e', '#f4d58d'],
        fonts: { title: 'Bebas Neue', body: 'Work Sans' }
    },
    {
        id: 'golden-hour',
        category: 'photo',
        name: 'Golden Hour',
        blurb: 'Warm backlight, glowing air.',
        prompt: 'professional photograph at golden hour, warm low sun backlighting, soft lens flare, glowing atmospheric haze, natural true-to-life tones, full-frame camera with 85mm lens, crisp focus on the subject',
        palette: ['#fff1d6', '#f4a261', '#e76f51', '#6d597a'],
        fonts: { title: 'Playfair Display', body: 'Work Sans' }
    },
    {
        id: 'analog-film',
        category: 'photo',
        name: 'Analog Film',
        blurb: 'Nostalgic 35mm warmth.',
        prompt: 'analog 35mm film photograph, warm natural portrait-film color palette, soft organic grain, gentle halation around highlights, candid nostalgic mood, slightly faded blacks',
        palette: ['#efe2cc', '#d99a6c', '#7a9e9f', '#4a4e4d'],
        fonts: { title: 'DM Serif Display', body: 'Work Sans' }
    },
    {
        id: 'moody-editorial',
        category: 'photo',
        name: 'Moody Editorial',
        blurb: 'Deep shadows, fashion-magazine polish.',
        prompt: 'moody low-key editorial photograph, dramatic chiaroscuro lighting, deep velvety shadows, refined styling, rich atmospheric contrast, high-end magazine polish',
        palette: ['#0b0b0f', '#3a3a48', '#a47551', '#e8e1d9'],
        fonts: { title: 'DM Serif Display', body: 'Work Sans' }
    },

    // 3D & craft
    {
        id: 'clay-diorama',
        category: 'craft',
        name: 'Clay Diorama',
        blurb: 'Handmade stop-motion charm.',
        prompt: 'handmade stop-motion clay diorama, soft plasticine textures with subtle fingerprints, miniature handcrafted set, warm studio lighting, shallow depth of field, playful charming characters',
        palette: ['#f6d6ad', '#e76f51', '#8ab17d', '#2a9d8f'],
        fonts: { title: 'Fredoka', body: 'Nunito' }
    },
    {
        id: 'paper-cut',
        category: 'craft',
        name: 'Paper Cut Layers',
        blurb: 'Stacked paper, soft shadows.',
        prompt: 'layered paper-cut art, stacked sheets of colored paper with soft drop shadows between layers, intricate hand-cut details, shadow-box depth, clean studio lighting',
        palette: ['#fef3e2', '#f4a259', '#5b8e7d', '#bc4b51'],
        fonts: { title: 'Fraunces', body: 'Nunito' }
    },
    {
        id: 'stained-glass',
        category: 'craft',
        name: 'Stained Glass',
        blurb: 'Jewel tones glowing with light.',
        prompt: 'stained glass window artwork, jewel-toned glass panes, bold dark lead lines, light glowing through the glass, rich ruby, sapphire and emerald colors, gothic cathedral craftsmanship',
        palette: ['#1b1b3a', '#9b1d20', '#1d4e89', '#2e8b57'],
        fonts: { title: 'Cinzel', body: 'Cormorant Garamond' }
    },
    {
        id: 'mosaic',
        category: 'craft',
        name: 'Mosaic',
        blurb: 'Tiny tiles and gold leaf.',
        prompt: 'ancient mosaic made of small ceramic and glass tesserae, visible grout lines, shimmering gold leaf accents, rich earthy palette, timeless handcrafted texture',
        palette: ['#e7d7b5', '#c49b3c', '#2f5d62', '#8e3b2f'],
        fonts: { title: 'Cinzel', body: 'Lora' }
    },
    {
        id: 'embroidery',
        category: 'craft',
        name: 'Embroidery',
        blurb: 'Stitched thread on linen.',
        prompt: 'hand embroidery on natural linen, satin stitch and french knots, raised glossy thread texture, delicate stitched outlines, cozy handmade craft, soft natural light',
        palette: ['#efe6d5', '#c96f53', '#5d8a66', '#e3b448'],
        fonts: { title: 'Fraunces', body: 'Nunito' }
    },
    {
        id: 'soft-3d',
        category: 'craft',
        name: 'Soft 3D',
        blurb: 'Frosted glass and pastel clay.',
        prompt: 'soft minimal 3D render, frosted glass and matte clay materials, smooth rounded forms, pastel gradient backdrop, gentle studio lighting with soft shadows, clean contemporary design',
        palette: ['#f5ecff', '#c3b1e1', '#a0e7e5', '#ffd6e0'],
        fonts: { title: 'Outfit', body: 'Outfit' }
    },
    {
        id: 'isometric-miniature',
        category: 'craft',
        name: 'Isometric Miniature',
        blurb: 'A tiny world in a box.',
        prompt: 'charming isometric miniature world, tiny detailed 3D diorama, tilt-shift depth of field, crisp clean render, cheerful lighting, every corner full of small delightful details',
        palette: ['#e8f1f2', '#7ec4cf', '#f6bd60', '#84a59d'],
        fonts: { title: 'Fredoka', body: 'Nunito' }
    },

    // Fantasy & digital
    {
        id: 'epic-fantasy',
        category: 'fantasy',
        name: 'Epic Fantasy',
        blurb: 'Sweeping vistas and god rays.',
        prompt: 'epic fantasy concept art, sweeping grand vista, volumetric god rays, painterly detail, towering scale, rich atmospheric perspective, heroic cinematic mood',
        palette: ['#10223b', '#3d6f8e', '#e2b659', '#f0e6d2'],
        fonts: { title: 'Cinzel', body: 'Cormorant Garamond' }
    },
    {
        id: 'hand-painted-anime',
        category: 'fantasy',
        name: 'Hand-Painted Anime',
        blurb: 'Lush skies, nostalgic summer light.',
        prompt: 'hand-painted anime film background art, lush painted skies with towering clouds, soft cel shading, nostalgic summer light, richly detailed scenery, gentle heartfelt atmosphere',
        palette: ['#bfe3f5', '#7cb77b', '#f6e27f', '#f4a7b9'],
        fonts: { title: 'Fredoka', body: 'Nunito' }
    },
    {
        id: 'surrealist-dream',
        category: 'fantasy',
        name: 'Surrealist Dream',
        blurb: 'Impossible, floating, poetic.',
        prompt: 'surrealist oil painting, dreamlike impossible architecture, floating objects, poetic visual metaphors, soft volumetric light, meticulous realistic rendering of an unreal scene',
        palette: ['#e8d8c3', '#7c9eb2', '#c97c5d', '#3e4a61'],
        fonts: { title: 'DM Serif Display', body: 'Lora' }
    },
    {
        id: 'neon-noir',
        category: 'fantasy',
        name: 'Neon Noir',
        blurb: 'Rain, reflections, electric glow.',
        prompt: 'neon noir cyberpunk scene, glowing ultraviolet and cyan neon lights, rain-slick reflective streets, holographic signage shapes without readable text, high contrast, atmospheric haze',
        palette: ['#0a0a1a', '#7b2ff7', '#00e5ff', '#ff2a6d'],
        fonts: { title: 'Orbitron', body: 'Space Grotesk' }
    },
    {
        id: 'synthwave',
        category: 'fantasy',
        name: 'Synthwave',
        blurb: 'Retro-future sunsets.',
        prompt: 'synthwave retro-futurist art, glowing gradient sunset, neon grid horizon, chrome highlights, magenta and electric blue palette, 1980s airbrushed poster feel',
        palette: ['#1a0b2e', '#ff2e97', '#ff9e3d', '#34d1ff'],
        fonts: { title: 'Orbitron', body: 'Space Grotesk' }
    },
    {
        id: 'pixel-art',
        category: 'fantasy',
        name: 'Pixel Art',
        blurb: 'Crisp 16-bit nostalgia.',
        prompt: 'detailed 16-bit pixel art, crisp hard-edged pixels, carefully limited palette, charming retro video game scene, clean dithering',
        palette: ['#1b1b2f', '#e43f5a', '#53a8b6', '#f9ed69'],
        fonts: { title: 'Press Start 2P', body: 'Space Grotesk' }
    }
];

export const TEXT_SPACE_OPTIONS = [
    { id: 'none', label: 'No preference' },
    { id: 'top', label: 'Room at the top' },
    { id: 'bottom', label: 'Room at the bottom' }
];

const TEXT_SPACE_HINTS = {
    top: 'Compose the scene with calm, uncluttered negative space across the top third so a headline can be placed there later.',
    bottom: 'Compose the scene with calm, uncluttered negative space across the bottom third so a caption can be placed there later.'
};

export function getStyleById(styleId) {
    if (typeof styleId !== 'string' || !styleId) {
        return null;
    }
    return STYLE_LIBRARY.find((style) => style.id === styleId) || null;
}

/**
 * Build the provider prompt from what the user described plus the chosen style.
 * @param {string} subject - the user's description, used verbatim first so it stays the focus
 * @param {object|null} style - an entry from STYLE_LIBRARY, or null for no style
 * @param {{ textSpace?: string }} options
 */
export function composeStylePrompt(subject, style, { textSpace = 'none' } = {}) {
    const parts = [String(subject || '').trim().replace(/[.\s]+$/, '')];

    if (style) {
        parts.push(`Style: ${style.prompt}`);
    }

    const textSpaceHint = TEXT_SPACE_HINTS[textSpace];
    if (textSpaceHint) {
        parts.push(textSpaceHint);
        parts.push('Do not include any text, letters, signatures, or watermarks in the image.');
    }

    return `${parts.join('. ')}.`;
}

/** CSS background used for a style's picker card until a real preview thumbnail exists. */
export function getStylePreviewBackground(style) {
    const [a, b, c, d] = style.palette;
    return `radial-gradient(circle at 25% 30%, ${c} 0 18%, transparent 19%), radial-gradient(circle at 75% 70%, ${d}cc 0 22%, transparent 23%), linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
}
