import { deleteGalleryItem, getGallery, reportAbuse } from './api.js';
import { downloadBlob, formatDate, html, icons, pluralize, raw, showToast, slugify } from './ui/dom.js';
import { getStyleById } from './styles.js';

/**
 * "My Art" page. Images are protected assets, so thumbnails are fetched with the session
 * cookie through <img> (same-origin) rather than exposed as public URLs.
 */
export function createGallery({ container, subtitle, onOpen, isSignedIn, requestSignIn }) {
    let items = [];

    async function render() {
        if (!isSignedIn()) {
            subtitle.textContent = 'Sign in to see the art you\'ve saved.';
            container.innerHTML = html`
                <div class="empty-state">
                    <h2>Your gallery is waiting</h2>
                    <p>Create a free account to save your artwork and come back to it anytime.</p>
                    <button class="btn btn-primary" type="button" data-gallery-action="signin">Sign in or create account</button>
                </div>
            `;
            return;
        }

        container.innerHTML = '<p class="page-subtitle">Loading your art…</p>';
        try {
            items = await getGallery();
        } catch (error) {
            container.innerHTML = html`<div class="empty-state"><h2>Couldn't load your gallery</h2><p>${error.message}</p></div>`;
            return;
        }

        subtitle.textContent = items.length ? `${pluralize(items.length, 'piece')} saved.` : 'Everything you save lives here.';
        if (!items.length) {
            container.innerHTML = html`
                <div class="empty-state">
                    <h2>Nothing saved yet</h2>
                    <p>Create an image, add your words, then press "Save to My Art".</p>
                    <button class="btn btn-primary" type="button" data-nav="create">Start creating</button>
                </div>
            `;
            return;
        }

        container.innerHTML = html`
            <div class="gallery-grid">
                ${items.map((item) => raw(html`
                    <article class="gallery-card" data-id="${item.id}">
                        <button class="gallery-thumb" type="button" data-gallery-action="open" aria-label="Open in editor">
                            <img src="${item.finalImage}" alt="${item.prompt || 'Saved artwork'}" loading="lazy">
                        </button>
                        <div class="gallery-meta">
                            <p class="gallery-prompt">${item.prompt || 'Untitled'}</p>
                            <p class="gallery-date">${formatDate(item.updatedAt || item.createdAt)}${getStyleById(item.stylePreset) ? ` · ${getStyleById(item.stylePreset).name}` : ''}</p>
                        </div>
                        <div class="gallery-actions">
                            <button class="btn btn-soft btn-small" type="button" data-gallery-action="open">${raw(icons.edit)} Edit</button>
                            <button class="icon-btn small" type="button" data-gallery-action="download" title="Download" aria-label="Download">${raw(icons.download)}</button>
                            <button class="icon-btn small" type="button" data-gallery-action="report" title="Report a problem with this image" aria-label="Report a problem">${raw(icons.flag)}</button>
                            <button class="icon-btn small" type="button" data-gallery-action="delete" title="Delete" aria-label="Delete">${raw(icons.trash)}</button>
                        </div>
                    </article>
                `))}
            </div>
        `;
    }

    container.addEventListener('click', async (event) => {
        const action = event.target.closest('[data-gallery-action]')?.dataset.galleryAction;
        if (!action) return;
        if (action === 'signin') {
            requestSignIn();
            return;
        }

        const card = event.target.closest('[data-id]');
        const item = items.find((candidate) => candidate.id === card?.dataset.id);
        if (!item) return;

        if (action === 'open') {
            onOpen(item);
        } else if (action === 'download') {
            try {
                const response = await fetch(item.finalImage, { credentials: 'same-origin' });
                if (!response.ok) throw new Error('Download failed.');
                const blob = await response.blob();
                const extension = blob.type === 'image/jpeg' ? 'jpg' : 'png';
                downloadBlob(blob, `${slugify(item.prompt)}.${extension}`);
            } catch (error) {
                showToast(error.message, 'error');
            }
        } else if (action === 'delete') {
            if (!window.confirm('Delete this piece from My Art? This cannot be undone.')) return;
            try {
                await deleteGalleryItem(item.id);
                showToast('Deleted.', 'info');
                render();
            } catch (error) {
                showToast(error.message, 'error');
            }
        } else if (action === 'report') {
            const details = window.prompt('What\'s wrong with this image? (Optional) This goes to the site owner for review.');
            if (details === null) return;
            try {
                await reportAbuse({ targetType: 'gallery_item', targetId: item.id, reason: 'unsafe_content', details });
                showToast('Thanks, the report was sent for review.', 'success');
            } catch (error) {
                showToast(error.message, 'error');
            }
        }
    });

    return { render };
}
