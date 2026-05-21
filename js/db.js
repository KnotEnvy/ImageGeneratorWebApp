const DB_NAME = 'NanoBananaDB';
const DB_VERSION = 1;
const STORE_NAME = 'creations';

let dbInstance = null;

export function initDB() {
    return new Promise((resolve, reject) => {
        if (dbInstance) {
            resolve(dbInstance);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };

        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            resolve(dbInstance);
        };

        request.onerror = (event) => {
            console.error('IndexedDB open error:', event.target.error);
            reject(event.target.error);
        };
    });
}

export async function saveCreation(creation) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        // Add timestamp if not exists
        if (!creation.timestamp) {
            creation.timestamp = Date.now();
        }

        const request = store.put(creation);

        request.onsuccess = (event) => {
            resolve(event.target.result); // Returns the generated ID
        };

        request.onerror = (event) => {
            console.error('Error saving creation:', event.target.error);
            reject(event.target.error);
        };
    });
}

export async function getCreations() {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            // Sort by timestamp descending (newest first)
            const sorted = request.result.sort((a, b) => b.timestamp - a.timestamp);
            resolve(sorted);
        };

        request.onerror = (event) => {
            console.error('Error fetching creations:', event.target.error);
            reject(event.target.error);
        };
    });
}

export async function getCreation(id) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(Number(id));

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = (event) => {
            console.error('Error fetching creation by id:', event.target.error);
            reject(event.target.error);
        };
    });
}

export async function deleteCreation(id) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(Number(id));

        request.onsuccess = () => {
            resolve(true);
        };

        request.onerror = (event) => {
            console.error('Error deleting creation:', event.target.error);
            reject(event.target.error);
        };
    });
}
