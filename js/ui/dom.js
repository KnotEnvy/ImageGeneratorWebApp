/** Small DOM helpers shared by the UI modules. */

export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/** Tagged template that escapes interpolated values; wrap trusted markup with raw(). */
export function html(strings, ...values) {
    return strings.reduce((output, part, index) => {
        if (index >= values.length) return output + part;
        const value = values[index];
        const rendered = Array.isArray(value)
            ? value.map((item) => (item?.__raw ? item.value : escapeHtml(item))).join('')
            : value?.__raw ? value.value : escapeHtml(value);
        return output + part + rendered;
    }, '');
}

export function raw(value) {
    return { __raw: true, value: String(value) };
}

export function showToast(message, type = 'info', { duration = 4200 } = {}) {
    const region = document.getElementById('toast-region');
    if (!region) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.textContent = message;
    region.appendChild(toast);
    while (region.children.length > 3) {
        region.firstElementChild.remove();
    }
    setTimeout(() => {
        toast.classList.add('leaving');
        setTimeout(() => toast.remove(), 220);
    }, duration);
}

export function formatDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, options);
}

export function pluralize(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
}

export function slugify(value, fallback = 'artwork') {
    const slug = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return slug || fallback;
}

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function wireDialogClose(dialog) {
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog || event.target.closest('[data-close]')) {
            dialog.close();
        }
    });
}

export const icons = {
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>',
    flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/></svg>',
    alignLeft: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h12M3 18h16"/></svg>',
    alignCenter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M6 12h12M4 18h16"/></svg>',
    alignRight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 12h12M5 18h16"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
};
