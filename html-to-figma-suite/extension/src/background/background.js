console.log('Background script running');

// ─── Image Fetch Handler (CORS Bypass) ─────────────────────
// Extension background scripts can fetch ANY URL without CORS restrictions.
// Content script sends image URLs here for Base64 conversion.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'fetchImage') {
        fetchImageAsBase64(request.url)
            .then(base64 => sendResponse({ success: true, data: base64 }))
            .catch(err => {
                console.warn('Failed to fetch image:', request.url, err.message);
                sendResponse({ success: false, error: err.message });
            });
        return true; // Keep message channel open for async response
    }
});

async function fetchImageAsBase64(url) {
    // Skip data URLs — already base64
    if (url.startsWith('data:')) {
        return url;
    }

    const response = await fetch(url, {
        mode: 'cors',
        credentials: 'omit',
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const contentType = blob.type || 'image/png';

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(blob);
    });
}
