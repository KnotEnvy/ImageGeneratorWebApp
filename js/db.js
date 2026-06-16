import { deleteGalleryItem, getGallery, saveGalleryItem } from './api.js';

/**
 * Compatibility layer for the old IndexedDB module.
 * The gallery is now server-backed so creations belong to the signed-in user.
 */
export async function initDB() {
    return true;
}

export async function saveCreation(creation) {
    return saveGalleryItem(creation);
}

export async function getCreations() {
    return getGallery();
}

export async function getCreation(id) {
    const creations = await getGallery();
    return creations.find((creation) => creation.id === id) || null;
}

export async function deleteCreation(id) {
    return deleteGalleryItem(id);
}
