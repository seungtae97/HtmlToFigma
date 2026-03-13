// Viewport presets: value (checkbox id) → config
const VIEWPORTS = {
    'desktop': { type: 'desktop', label: 'Desktop' },
    '375x812': { type: 'mobile', width: 375, height: 812, deviceScaleFactor: 2, mobile: true, label: 'iPhone SE' },
    '390x844': { type: 'mobile', width: 390, height: 844, deviceScaleFactor: 3, mobile: true, label: 'iPhone 14 Pro' },
    '412x915': { type: 'mobile', width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, label: 'Android' },
};

// Load saved selections when popup opens
document.addEventListener('DOMContentLoaded', async () => {
    const { viewportSelections } = await chrome.storage.local.get('viewportSelections');
    if (viewportSelections) {
        document.querySelectorAll('.viewport-cb').forEach(cb => {
            // Fall back to default (desktop=checked, others=unchecked) if not stored
            cb.checked = viewportSelections[cb.value] ?? (cb.value === 'desktop');
        });
    }

    // Save selections whenever a checkbox changes
    document.querySelectorAll('.viewport-cb').forEach(cb => {
        cb.addEventListener('change', saveSelections);
    });
});

function saveSelections() {
    const sel = {};
    document.querySelectorAll('.viewport-cb').forEach(cb => { sel[cb.value] = cb.checked; });
    chrome.storage.local.set({ viewportSelections: sel });
}

// Main capture handler
document.getElementById('captureBtn').addEventListener('click', async () => {
    const statusDiv = document.getElementById('status');
    const captureBtn = document.getElementById('captureBtn');
    statusDiv.className = 'status';
    statusDiv.textContent = '준비 중...';
    captureBtn.disabled = true;

    // Collect checked viewports (preserve DOM order)
    const selectedKeys = [...document.querySelectorAll('.viewport-cb:checked')].map(cb => cb.value);
    if (selectedKeys.length === 0) {
        statusDiv.textContent = '하나 이상의 뷰포트를 선택해주세요.';
        captureBtn.disabled = false;
        return;
    }

    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
        statusDiv.textContent = 'Error: No active tab found.';
        captureBtn.disabled = false;
        return;
    }

    // Restricted URL check
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') ||
        tab.url.startsWith('about:') || tab.url.startsWith('https://chrome.google.com/webstore')) {
        statusDiv.textContent = 'Cannot capture this page. Try a normal website.';
        captureBtn.disabled = false;
        return;
    }

    const needsDebugger = selectedKeys.some(k => VIEWPORTS[k].type === 'mobile');
    const frames = [];

    try {
        if (needsDebugger) {
            await chrome.debugger.attach({ tabId: tab.id }, '1.3');
        }

        for (const key of selectedKeys) {
            const vp = VIEWPORTS[key];
            statusDiv.textContent = `${vp.label} 캡처 중...`;

            if (needsDebugger) {
                if (vp.type === 'desktop') {
                    // Restore actual desktop viewport
                    await chrome.debugger.sendCommand(
                        { tabId: tab.id },
                        'Emulation.clearDeviceMetricsOverride'
                    );
                } else {
                    // Apply mobile viewport via DevTools Protocol
                    await chrome.debugger.sendCommand(
                        { tabId: tab.id },
                        'Emulation.setDeviceMetricsOverride',
                        {
                            width: vp.width,
                            height: vp.height,
                            deviceScaleFactor: vp.deviceScaleFactor,
                            mobile: vp.mobile,
                            screenWidth: vp.width,
                            screenHeight: vp.height,
                        }
                    );
                }
                // Wait for re-render (CSS media queries, layout reflow, JS resize handlers)
                await new Promise(r => setTimeout(r, 700));
            }

            // Request frame data from content script (no download, data returned)
            let response = null;
            try {
                response = await sendMessageToTab(tab.id, { action: 'captureData' });
            } catch (err) {
                // Content script not loaded — inject and retry
                statusDiv.textContent = `${vp.label}: 스크립트 주입 중...`;
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js'],
                });
                await new Promise(r => setTimeout(r, 500));
                response = await sendMessageToTab(tab.id, { action: 'captureData' });
            }

            if (response?.status === 'success' && response.data) {
                const date = new Date();
                const pad = n => String(n).padStart(2, '0');
                const timestampFigma = `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} , ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

                const frame = response.data;
                frame.name = `${vp.label} (${timestampFigma})`;
                frames.push(frame);
            }
        }

    } catch (err) {
        statusDiv.textContent = '캡처 실패: ' + err.message;
        statusDiv.classList.add('error');
        captureBtn.disabled = false;
        return;
    } finally {
        // Always restore viewport and detach debugger
        if (needsDebugger) {
            try {
                await chrome.debugger.sendCommand(
                    { tabId: tab.id },
                    'Emulation.clearDeviceMetricsOverride'
                );
                await chrome.debugger.detach({ tabId: tab.id });
            } catch (e) { /* ignore cleanup errors */ }
        }
    }

    if (frames.length === 0) {
        statusDiv.textContent = '캡처된 프레임이 없습니다.';
        captureBtn.disabled = false;
        return;
    }

    // Arrange frames side by side for Figma (100px gap between each)
    let xOffset = 0;
    for (const frame of frames) {
        frame.x = xOffset;
        frame.y = 0;
        xOffset += (frame.width || 0) + 100;
    }

    // Single viewport → single object (backward compatible); multiple → array
    const outputData = frames.length === 1 ? frames[0] : frames;

    // Generate filename
    const date = new Date();
    const pad = n => String(n).padStart(2, '0');
    // For filename, use dots and underscores as / and : are invalid in filenames
    const timestampFile = `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}_${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
    const host = new URL(tab.url).hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_');
    const vpSuffix = selectedKeys.length > 1 ? '_multi' : `_${VIEWPORTS[selectedKeys[0]].label.replace(/\s+/g, '-')}`;
    const filename = `${host}${vpSuffix}_${timestampFile}.json`;

    // Download from popup context
    downloadJSON(outputData, filename);

    statusDiv.textContent = `캡처 완료 (${frames.length}개 프레임)! 다운로드 중...`;
    statusDiv.classList.add('success');
    captureBtn.disabled = false;
});

function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sendMessageToTab(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve(response);
            }
        });
    });
}
