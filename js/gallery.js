import { reportAbuse } from './api.js';
import { getCreations, deleteCreation } from './db.js';

/**
 * Render all server-backed creations into the gallery container.
 * @param {HTMLElement} container 
 * @param {Function} onEditCreation Callback when reuse/edit button is clicked
 * @param {Function} showToast Helper to trigger toast notifications
 */
export async function renderGallery(container, onEditCreation, showToast) {
    try {
        const creations = await getCreations();
        
        if (!creations || creations.length === 0) {
            container.innerHTML = `
                <div class="gallery-empty">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="9" cy="9" r="2" />
                        <path d="M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                    </svg>
                    <h3>No creations yet</h3>
                    <p>Sign in, generate an image in the Studio tab, then save it to your account gallery.</p>
                </div>
            `;
            return;
        }

        // Build grid
        let html = '<div class="gallery-grid">';
        
        creations.forEach(item => {
            const dateStr = new Date(item.timestamp).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });

            const promptEscaped = escapeHTML(item.prompt);
            const modelName = escapeHTML(item.modelUsed || 'gemini-2.5-flash-image');

            html += `
                <div class="gallery-card" data-id="${item.id}">
                    <div class="gallery-card-img-wrapper">
                        <img class="gallery-card-img" src="${item.finalImage}" alt="${promptEscaped}" loading="lazy">
                        <div class="gallery-card-overlay">
                            <div class="gallery-card-meta">
                                <span>${modelName}</span>
                                <span>${dateStr}</span>
                            </div>
                        </div>
                    </div>
                    <div class="gallery-card-details">
                        <p class="gallery-card-prompt" title="${promptEscaped}">${promptEscaped}</p>
                        <div class="gallery-card-actions">
                            <button class="gallery-card-btn edit-btn" title="Edit text layers">
                                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z"/></svg>
                                Edit
                            </button>
                            <button class="gallery-card-btn share-btn share" title="Share or Copy image">
                                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                                Share
                            </button>
                            <button class="gallery-card-btn download-btn" title="Download PNG">
                                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                                Save
                            </button>
                            <button class="gallery-card-btn report-btn" title="Report unsafe content">
                                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1v17"/></svg>
                            </button>
                            <button class="gallery-card-btn delete-btn delete" title="Delete creation">
                                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;

        // Add event listeners
        container.querySelectorAll('.gallery-card').forEach(card => {
            const id = card.getAttribute('data-id');
            const creation = creations.find(item => String(item.id) === id);
            if (!creation) {
                return;
            }

            // Edit Button
            card.querySelector('.edit-btn').addEventListener('click', () => {
                onEditCreation(creation);
            });

            // Share Button
            card.querySelector('.share-btn').addEventListener('click', async () => {
                showToast('Preparing image to share...', 'info');
                try {
                    const status = await shareImage(creation.finalImage, creation.prompt);
                    if (status === 'shared') {
                        showToast('Shared successfully!', 'success');
                    } else {
                        showToast('Image file copied to clipboard!', 'success');
                    }
                } catch (err) {
                    showToast('Failed to share image: ' + err.message, 'error');
                }
            });

            // Download Button
            card.querySelector('.download-btn').addEventListener('click', () => {
                downloadImage(creation.finalImage, `nano-banana-${id}.png`);
                showToast('Image download started', 'success');
            });

            // Report Button
            card.querySelector('.report-btn').addEventListener('click', async () => {
                if (!confirm('Report this creation for review?')) {
                    return;
                }

                try {
                    await reportAbuse({
                        targetType: 'gallery_item',
                        targetId: id,
                        reason: 'unsafe_content',
                        details: 'Reported from the gallery card.'
                    });
                    showToast('Report submitted for review.', 'success');
                } catch (err) {
                    showToast('Report failed: ' + err.message, 'error');
                }
            });

            // Delete Button
            card.querySelector('.delete-btn').addEventListener('click', async () => {
                if (confirm('Are you sure you want to delete this creation?')) {
                    try {
                        await deleteCreation(id);
                        showToast('Creation deleted successfully', 'success');
                        // Re-render
                        renderGallery(container, onEditCreation, showToast);
                    } catch (err) {
                        showToast('Delete failed: ' + err.message, 'error');
                    }
                }
            });
        });

    } catch (err) {
        container.innerHTML = `<div class="gallery-empty"><p>Error loading gallery: ${escapeHTML(err.message)}</p></div>`;
    }
}

/**
 * Handle system sharing drawer or fall back to clipboard PNG blob copy
 */
async function shareImage(dataUrl, promptText) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    
    // Attempt Web Share API first
    if (navigator.canShare && navigator.share) {
        const file = new File([blob], 'nano-banana-creation.png', { type: blob.type });
        if (navigator.canShare({ files: [file] })) {
            await navigator.share({
                files: [file],
                title: 'Nano Banana Creative Motivational Art',
                text: `Create motivational images. My creation prompt: "${promptText}"`
            });
            return 'shared';
        }
    }

    // Clipboard Copy Fallback
    try {
        await navigator.clipboard.write([
            new ClipboardItem({
                [blob.type]: blob
            })
        ]);
        return 'copied';
    } catch (clipboardErr) {
        // Safe Text Link copy fallback
        console.error('Clipboard item copy failed, copying dataurl text:', clipboardErr);
        await navigator.clipboard.writeText(dataUrl);
        return 'copied_text';
    }
}

/**
 * Trigger file download in browser
 */
function downloadImage(dataUrl, filename) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * HTML escaper helper
 */
function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
