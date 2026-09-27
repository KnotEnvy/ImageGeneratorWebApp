import { DEFAULT_FILTERS, LOOKS } from '../presets.js';
import { html, raw } from './dom.js';

const SLIDERS = [
    { key: 'brightness', label: 'Brightness', min: 50, max: 150, format: (value) => `${value}%` },
    { key: 'contrast', label: 'Contrast', min: 50, max: 150, format: (value) => `${value}%` },
    { key: 'saturation', label: 'Color', min: 0, max: 200, format: (value) => `${value}%` },
    { key: 'warmth', label: 'Warmth', min: -50, max: 50, format: (value) => (value > 0 ? `+${value}` : `${value}`) },
    { key: 'blur', label: 'Softness', min: 0, max: 10, step: 0.5, format: (value) => `${value}` },
    { key: 'vignette', label: 'Vignette', min: 0, max: 80, scale: 100, format: (value) => `${value}%` }
];

export function createAdjustPanel({ container, editor }) {
    container.innerHTML = html`
        <section class="step">
            <h2 class="step-title">Looks</h2>
            <div class="look-row">
                ${LOOKS.map((look) => raw(html`<button class="chip" type="button" data-look="${look.id}">${look.label}</button>`))}
            </div>
        </section>
        <section class="step">
            <h2 class="step-title">Fine-tune</h2>
            ${SLIDERS.map((slider) => raw(html`
                <label class="slider-row">
                    <span>${slider.label}</span>
                    <input type="range" min="${slider.min}" max="${slider.max}" step="${slider.step || 1}" data-filter="${slider.key}">
                    <output data-filter-output="${slider.key}"></output>
                </label>
            `))}
            <button class="btn btn-ghost btn-small" type="button" data-action="reset" style="margin-top:8px">Reset adjustments</button>
            <p class="hint" style="margin-top:12px">Adjustments apply to the picture only. Your text stays crisp.</p>
        </section>
    `;

    container.addEventListener('input', (event) => {
        const input = event.target.closest('[data-filter]');
        if (!input) return;
        const slider = SLIDERS.find((candidate) => candidate.key === input.dataset.filter);
        editor.setFilters({ [slider.key]: Number(input.value) / (slider.scale || 1) });
        sync();
    });

    container.addEventListener('click', (event) => {
        const lookButton = event.target.closest('[data-look]');
        if (lookButton) {
            const look = LOOKS.find((candidate) => candidate.id === lookButton.dataset.look);
            editor.setFilters({ ...DEFAULT_FILTERS, ...look.filters }, { commit: true });
            sync();
            return;
        }
        if (event.target.closest('[data-action="reset"]')) {
            editor.resetFilters();
            sync();
        }
    });

    editor.addEventListener('change', sync);

    function sync() {
        for (const slider of SLIDERS) {
            const value = editor.filters[slider.key] * (slider.scale || 1);
            const input = container.querySelector(`[data-filter="${slider.key}"]`);
            if (input !== document.activeElement) input.value = String(value);
            container.querySelector(`[data-filter-output="${slider.key}"]`).textContent = slider.format(Math.round(value * 10) / 10);
        }
        const activeLook = LOOKS.find((look) => {
            const expected = { ...DEFAULT_FILTERS, ...look.filters };
            return Object.entries(expected).every(([key, value]) => editor.filters[key] === value);
        });
        container.querySelectorAll('[data-look]').forEach((button) => button.classList.toggle('active', button.dataset.look === activeLook?.id));
    }

    sync();
    return { sync };
}
