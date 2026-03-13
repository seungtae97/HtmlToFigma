console.log('HTML to Figma Content Script v2.2 Loaded');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'capture' || request.action === 'captureData') {
        processCapture()
            .then(data => {
                if (request.action === 'captureData') {
                    // Return data to caller (popup orchestrates download)
                    sendResponse({ status: 'success', data });
                } else {
                    // Legacy single-capture flow: download directly from page
                    const date = new Date();
                    const pad = n => String(n).padStart(2, '0');
                    const timestamp = `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}_${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;

                    const host = window.location.hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_');
                    const filename = `${host}_${timestamp}.json`;

                    downloadJSON(data, filename);
                    sendResponse({ status: 'success' });
                }
            })
            .catch(err => {
                console.error('Capture error:', err);
                sendResponse({ status: 'error', message: err.toString() });
            });
        return true;
    }
});

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const SYSTEM_FONTS = [
    '-apple-system', 'BlinkMacSystemFont', 'system-ui',
    'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif',
    'Helvetica', 'Geneva', 'Tahoma', 'Verdana',
    'ui-sans-serif', 'ui-serif', 'ui-monospace',
    'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol',
    'Noto Color Emoji', 'monospace', 'serif', 'cursive', 'fantasy',
];

// Korean system font → Figma font mapping
const KOREAN_FONT_MAP = {
    '맑은 고딕': 'Noto Sans KR',
    'malgun gothic': 'Noto Sans KR',
    '돋움': 'Noto Sans KR',
    'dotum': 'Noto Sans KR',
    '굴림': 'Noto Sans KR',
    'gulim': 'Noto Sans KR',
    '바탕': 'Noto Serif KR',
    'batang': 'Noto Serif KR',
    '궁서': 'Noto Serif KR',
    'gungsuh': 'Noto Serif KR',
    '나눔고딕': 'Nanum Gothic',
    'nanum gothic': 'Nanum Gothic',
    '나눔바른고딕': 'Nanum Gothic',
    '나눔명조': 'Nanum Myeongjo',
    'nanum myeongjo': 'Nanum Myeongjo',
    'apple sd gothic neo': 'Noto Sans KR',
    'appleSDGothicNeo': 'Noto Sans KR',
    'noto sans cjk kr': 'Noto Sans KR',
    'noto sans korean': 'Noto Sans KR',
    'microsoft yahei': 'Noto Sans SC',
    'ms pgothic': 'Noto Sans JP',
    'ms gothic': 'Noto Sans JP',
    'meiryo': 'Noto Sans JP',
    'hiragino kaku gothic pro': 'Noto Sans JP',
};

const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'HEAD',
    'BR', 'WBR', 'TEMPLATE', 'SLOT',
]);

// Tags that should be treated as leaf nodes (no recursive children)
const LEAF_TAGS = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME', 'HR']);

// Maximum depth to prevent infinite recursion
const MAX_DEPTH = 50;

// Image fetch concurrency limiter
let pendingImageFetches = 0;
const MAX_CONCURRENT_FETCHES = 10;

// ═══════════════════════════════════════════════════════════════
// HELPERS — Color / Parse
// ═══════════════════════════════════════════════════════════════

function getRgba(cssColor) {
    if (!cssColor || cssColor === 'transparent' || cssColor === 'rgba(0, 0, 0, 0)') return null;

    const tmp = document.createElement('div');
    tmp.style.color = cssColor;
    tmp.style.display = 'none';
    document.body.appendChild(tmp);
    const computed = getComputedStyle(tmp).color;
    document.body.removeChild(tmp);

    const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a: m[4] !== undefined ? +m[4] : 1 };
}

function px(v) {
    const n = parseFloat(v);
    return isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function buildName(el, suffix = '') {
    if (!el || !el.tagName) return 'element' + suffix;
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = el.classList && el.classList.length > 0
        ? `.${Array.from(el.classList).slice(0, 3).join('.')}`
        : '';
    return `${tag}${id}${cls}` + suffix;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS — Font
// ═══════════════════════════════════════════════════════════════

function resolveFontFamily(rawFontFamily) {
    if (!rawFontFamily) return 'Inter';
    const families = rawFontFamily.split(',').map(f => f.trim().replace(/^['"]|['"]$/g, ''));

    // First pass: check for Korean/CJK font mappings
    for (const f of families) {
        const lower = f.toLowerCase();
        const mapped = KOREAN_FONT_MAP[lower] || KOREAN_FONT_MAP[f];
        if (mapped) return mapped;
    }

    // Second pass: return first non-system font
    for (const f of families) {
        const lower = f.toLowerCase();
        if (SYSTEM_FONTS.some(sf => sf.toLowerCase() === lower)) continue;
        return f;
    }
    return 'Inter';
}

function getFontStyle(weight, style) {
    let w = 400;
    if (weight === 'bold') w = 700;
    else if (weight === 'bolder') w = 900; // rough mapping
    else if (weight === 'lighter') w = 300; // rough mapping
    else w = parseInt(weight) || 400;

    const isItalic = style === 'italic' || style === 'oblique';

    if (w >= 900) return isItalic ? 'Black Italic' : 'Black';
    if (w >= 800) return isItalic ? 'ExtraBold Italic' : 'ExtraBold';
    if (w >= 700) return isItalic ? 'Bold Italic' : 'Bold';
    if (w >= 600) return isItalic ? 'SemiBold Italic' : 'SemiBold';
    if (w >= 500) return isItalic ? 'Medium Italic' : 'Medium';
    if (w >= 300) return isItalic ? 'Light Italic' : 'Light';
    if (w >= 200) return isItalic ? 'ExtraLight Italic' : 'ExtraLight';
    if (w >= 100) return isItalic ? 'Thin Italic' : 'Thin';
    return isItalic ? 'Italic' : 'Regular';
}

// ═══════════════════════════════════════════════════════════════
// HELPERS — Box Shadow Parser
// ═══════════════════════════════════════════════════════════════

function parseBoxShadow(raw) {
    if (!raw || raw === 'none') return [];
    const shadows = [];
    const rawShadows = raw.split(/,(?![^(]*\))/);

    rawShadows.forEach(shadowStr => {
        shadowStr = shadowStr.trim();
        if (!shadowStr) return;

        let inset = false;
        let color = { r: 0, g: 0, b: 0, a: 0.2 };
        const lengths = [];

        const parts = shadowStr.match(/((?:inset)|(?:rgba?\([^)]+\)|#[0-9a-fA-F]+|[a-z]+)|(?:-?\d+(?:\.\d+)?(?:px|em|rem)?))/gi);
        if (!parts) return;

        parts.forEach(part => {
            if (part === 'inset') {
                inset = true;
            } else if (/^(-?\d+(?:\.\d+)?)/.test(part)) {
                lengths.push(px(part));
            } else {
                const c = getRgba(part);
                if (c) color = c;
            }
        });

        if (lengths.length >= 2) {
            shadows.push({
                type: inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
                color: color,
                offset: { x: lengths[0], y: lengths[1] },
                radius: lengths[2] || 0,
                spread: lengths[3] || 0,
                visible: true,
                blendMode: 'NORMAL',
            });
        }
    });
    return shadows;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS — Text Shadow Parser
// ═══════════════════════════════════════════════════════════════

function parseTextShadow(raw) {
    if (!raw || raw === 'none') return [];
    const shadows = [];
    const rawShadows = raw.split(/,(?![^(]*\))/);

    rawShadows.forEach(shadowStr => {
        shadowStr = shadowStr.trim();
        if (!shadowStr) return;

        let color = { r: 0, g: 0, b: 0, a: 0.5 };
        const lengths = [];

        const parts = shadowStr.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]+|[a-z]+|-?\d+(?:\.\d+)?(?:px|em|rem)?)/gi);
        if (!parts) return;

        parts.forEach(part => {
            if (/^-?\d/.test(part)) {
                lengths.push(px(part));
            } else {
                const c = getRgba(part);
                if (c) color = c;
            }
        });

        if (lengths.length >= 2) {
            shadows.push({
                type: 'DROP_SHADOW',
                color: color,
                offset: { x: lengths[0], y: lengths[1] },
                radius: lengths[2] || 0,
                spread: 0,
                visible: true,
                blendMode: 'NORMAL',
            });
        }
    });
    return shadows;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS — Transform, Blur
// ═══════════════════════════════════════════════════════════════

function getRotation(transform) {
    if (!transform || transform === 'none') return 0;
    try {
        const value = transform.split('(')[1].split(')')[0].split(',');
        const a = parseFloat(value[0]);
        const b = parseFloat(value[1]);
        return Math.round(Math.atan2(b, a) * (180 / Math.PI));
    } catch {
        return 0;
    }
}

function parseBlur(filter) {
    if (!filter || filter === 'none') return 0;
    const match = filter.match(/blur\((\d+(?:\.\d+)?)(px|em|rem)?\)/);
    if (match) return px(match[1]);
    return 0;
}

// ═══════════════════════════════════════════════════════════════
// IMAGE CAPTURE (via Background Worker — CORS bypass)
// ═══════════════════════════════════════════════════════════════

async function imageToBase64(url, width, height) {
    if (!url) return null;

    // Data URLs are already base64
    if (url.startsWith('data:')) return url;

    // Skip blob URLs
    if (url.startsWith('blob:')) return null;

    try {
        // Use background worker to bypass CORS
        const response = await chrome.runtime.sendMessage({
            action: 'fetchImage',
            url: url
        });

        if (response && response.success && response.data) {
            return response.data;
        }
    } catch (e) {
        console.warn('Background fetch failed, trying canvas fallback:', url);
    }

    // Fallback: canvas approach (works for same-origin images)
    return new Promise((resolve) => {
        try {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || width || 100;
                canvas.height = img.naturalHeight || height || 100;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                try {
                    resolve(canvas.toDataURL('image/png'));
                } catch (e) {
                    resolve(null);
                }
            };
            img.onerror = () => resolve(null);
            img.src = url;
        } catch (e) {
            resolve(null);
        }
    });
}

// ═══════════════════════════════════════════════════════════════
// GRADIENT PARSER (Linear + Radial + Conic)
// ═══════════════════════════════════════════════════════════════

function parseGradient(bgImage) {
    const fills = [];

    // Match all gradient functions
    const gradientRegex = /(linear-gradient|radial-gradient|conic-gradient|repeating-linear-gradient|repeating-radial-gradient)\(([^)]+(?:\([^)]*\))*[^)]*)\)/g;
    let match;

    while ((match = gradientRegex.exec(bgImage)) !== null) {
        const type = match[1];
        const content = match[2];

        const colors = [];
        const colorRegex = /(rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-fA-F]{3,8})\s*(\d+%)?/g;
        let cMatch;
        while ((cMatch = colorRegex.exec(content)) !== null) {
            const c = getRgba(cMatch[0].split(/\s+\d+%/)[0].trim());
            if (c) {
                const pos = cMatch[2] ? parseInt(cMatch[2]) / 100 : null;
                colors.push({ color: c, position: pos });
            }
        }

        if (colors.length < 2) continue;

        // Auto-distribute positions
        colors.forEach((c, i) => {
            if (c.position === null) {
                c.position = i / (colors.length - 1);
            }
        });

        const gradientStops = colors.map(c => ({
            position: c.position,
            color: { ...c.color, a: c.color.a !== undefined ? c.color.a : 1 },
        }));

        if (type.includes('radial')) {
            fills.push({
                type: 'GRADIENT_RADIAL',
                gradientStops: gradientStops,
            });
        } else {
            // Parse angle for linear gradient
            let angle = 180; // default top to bottom
            const angleMatch = content.match(/(\d+(?:\.\d+)?)deg/);
            if (angleMatch) angle = parseFloat(angleMatch[1]);

            const dirMatch = content.match(/to\s+(top|bottom|left|right|top\s+left|top\s+right|bottom\s+left|bottom\s+right)/);
            if (dirMatch) {
                const dir = dirMatch[1].trim();
                if (dir === 'top') angle = 0;
                else if (dir === 'right') angle = 90;
                else if (dir === 'bottom') angle = 180;
                else if (dir === 'left') angle = 270;
                else if (dir === 'top right') angle = 45;
                else if (dir === 'bottom right') angle = 135;
                else if (dir === 'bottom left') angle = 225;
                else if (dir === 'top left') angle = 315;
            }

            fills.push({
                type: 'GRADIENT_LINEAR',
                gradientStops: gradientStops,
                gradientAngle: angle,
            });
        }
    }

    return fills;
}

// ═══════════════════════════════════════════════════════════════
// MAIN CAPTURE
// ═══════════════════════════════════════════════════════════════

async function processCapture() {
    console.log('--- HTML-TO-FIGMA V2.1 [DEBUG] ---');
    console.log('Timestamp:', new Date().toLocaleString());
    console.log('Starting capture v2.1 (Hybrid Layout + Variables) ...');

    // ─── 1. 스크롤 기반 애니메이션 요소 활성화 + 최상단 스크롤 ───
    // .reveal 등 Intersection Observer로 스크롤 시에만 .active가 붙는 요소를
    // 강제 활성화하기 위해, 캡처 전 페이지 전체를 한 번 스크롤합니다.
    const savedScrollX = window.scrollX;
    const savedScrollY = window.scrollY;

    // 전체 페이지를 빠르게 스크롤하여 모든 reveal/scroll 트리거 활성화
    const totalHeight = document.documentElement.scrollHeight;
    const viewportHeight = window.innerHeight;
    for (let y = 0; y < totalHeight; y += Math.floor(viewportHeight * 0.7)) {
        window.scrollTo({ top: y, behavior: 'instant' });
        await new Promise(r => setTimeout(r, 80));
    }
    // 최상단으로 복귀 (캡처는 항상 scrollTo(0,0) 상태에서 수행)
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await new Promise(r => setTimeout(r, 150));

    // --- 2. 애니메이션/전환 비활성화 + 스크롤 숨김 요소 강제 노출 ---

    // 2-a. 스크롤 기반 애니메이션 요소에 .active 클래스 강제 추가
    const forcedActiveElements = [];
    document.querySelectorAll('.reveal:not(.active), [data-aos]:not(.aos-animate), [class*="animate"]:not(.animated), [class*="fade"]:not(.show)').forEach(el => {
        el.setAttribute('data-html-to-figma-forced', 'true');
        el.classList.add('active', 'aos-animate', 'animated', 'show', 'visible', 'in-view');
        forcedActiveElements.push(el);
    });

    // 2-b. CSS animation으로 최종 상태가 결정되는 요소 처리
    //      animation-fill-mode: forwards 를 사용하는 요소는
    //      animation을 끄면 초기값(ex: opacity:0)에서 멈춤.
    //      → 모든 animated 요소의 "현재 computed 상태"를 inline으로 고정한 후,
    //        animation/transition을 비활성화.
    const animatedElements = [];
    document.querySelectorAll('*').forEach(el => {
        const cs = getComputedStyle(el);
        const animName = cs.animationName;
        if (animName && animName !== 'none') {
            // animation이 적용된 요소의 현재 computed 값을 inline으로 고정
            const currentOpacity = cs.opacity;
            const currentTransform = cs.transform;
            const currentVisibility = cs.visibility;

            el.setAttribute('data-html-to-figma-anim', 'true');
            el.setAttribute('data-html-to-figma-orig-style', el.style.cssText);

            // 현재 computed 값을 inline으로 설정 (animation 끈 후에도 유지)
            el.style.setProperty('opacity', currentOpacity, 'important');
            if (currentTransform && currentTransform !== 'none') {
                el.style.setProperty('transform', currentTransform, 'important');
            } else {
                el.style.setProperty('transform', 'none', 'important');
            }
            el.style.setProperty('visibility', currentVisibility, 'important');

            animatedElements.push(el);
        }
    });

    const prepStyle = document.createElement('style');
    prepStyle.id = 'html-to-figma-capture-prep';
    prepStyle.innerHTML = `
        * {
            transition: none !important;
            animation: none !important;
            animation-delay: 0s !important;
            animation-duration: 0s !important;
            transition-delay: 0s !important;
            transition-duration: 0s !important;
        }
        /* 스크롤/애니메이션으로 숨겨진 요소 강제 노출 */
        [class*="scroll-hidden"],
        [class*="js-scroll"],
        [data-aos],
        [class*="reveal"],
        .reveal,
        .reveal.active,
        [class*="fade-in"],
        [data-scroll] {
            opacity: 1 !important;
            transform: none !important;
            visibility: visible !important;
        }
    `;
    document.head.appendChild(prepStyle);

    try {
        // 스크롤 이동 + 스타일 적용 후 브라우저 렌더링 대기
        await new Promise(resolve => setTimeout(resolve, 500));

        const body = document.body;
        const html = document.documentElement;

        // Check both html and body backgrounds
        const htmlBg = getRgba(getComputedStyle(html).backgroundColor);
        const bodyBg = getRgba(getComputedStyle(body).backgroundColor);

        let rootBg = { r: 68 / 255, g: 68 / 255, b: 68 / 255, a: 1 }; // Default #444444

        // Prioritize body background as per user request
        if (bodyBg && bodyBg.a > 0) {
            rootBg = bodyBg;
        } else if (htmlBg && htmlBg.a > 0) {
            rootBg = htmlBg;
        }

        // Capture using body as root, but apply combined background
        const data = await captureElement(body, 0);

        if (data && data.fills) {
            // If root element is transparent, apply the detected background
            const hasSolidFill = data.fills.some(f => f.type === 'SOLID' && f.opacity === 1);
            if (!hasSolidFill) {
                // Insert background at the beginning
                data.fills.unshift({
                    type: 'SOLID',
                    color: { r: rootBg.r, g: rootBg.g, b: rootBg.b },
                    opacity: rootBg.a
                });
            }

            // scrollTo(0,0) 했으므로 scrollX/Y는 0. 좌표 보정값도 0.
            data.x += window.scrollX;
            data.y += window.scrollY;
        }

        console.log('Capture complete', data);

        // Add Metadata
        data.meta = {
            url: window.location.href,
            title: document.title,
            time: new Date().toISOString(),
            agent: navigator.userAgent,
        };

        // Extract CSS variables (colors)
        data.variables = extractCssVariables();

        return data;

    } finally {
        // 강제 추가한 .active 등의 클래스 복원
        document.querySelectorAll('[data-html-to-figma-forced]').forEach(el => {
            el.classList.remove('active', 'aos-animate', 'animated', 'show', 'visible', 'in-view');
            el.removeAttribute('data-html-to-figma-forced');
        });

        // animation 고정용 inline 스타일 복원
        document.querySelectorAll('[data-html-to-figma-anim]').forEach(el => {
            const origStyle = el.getAttribute('data-html-to-figma-orig-style') || '';
            el.style.cssText = origStyle;
            el.removeAttribute('data-html-to-figma-anim');
            el.removeAttribute('data-html-to-figma-orig-style');
        });

        // 성공/실패 무관하게 항상 임시 스타일 제거 + 스크롤 위치 복원
        const prepStyleEl = document.getElementById('html-to-figma-capture-prep');
        if (prepStyleEl && prepStyleEl.parentElement) {
            prepStyleEl.parentElement.removeChild(prepStyleEl);
        }
        window.scrollTo({ top: savedScrollY, left: savedScrollX, behavior: 'instant' });
    }
}

function extractCssVariables() {
    const variables = {};
    const root = document.documentElement;
    const computed = getComputedStyle(root);

    const parseVariableValue = (val) => {
        // 1. Check for Color
        const color = getRgba(val);
        if (color) return { type: 'COLOR', value: color };

        // 2. Check for Shadow
        if (val.includes('px') && (val.includes('rgba') || val.includes('#') || val.includes('rgb'))) {
            const shadow = parseBoxShadow(val);
            if (shadow && shadow.length > 0) return { type: 'SHADOW', value: shadow };
        }

        // 3. Check for Dimension/Number
        const numMatch = val.match(/^(-?[\d.]+)(px|rem|em|%)?$/);
        if (numMatch) {
            const num = parseFloat(numMatch[1]);
            const unit = numMatch[2] || 'number';

            // Convert rem/em to px (approximation)
            let pxVal = num;
            if (unit === 'rem' || unit === 'em') pxVal = num * 16;

            return { type: 'DIMENSION', value: pxVal, unit: unit, originalValue: val };
        }

        return { type: 'STRING', value: val };
    };

    try {
        const processStyles = (styleObj) => {
            for (let i = 0; i < styleObj.length; i++) {
                const prop = styleObj[i];
                if (prop.startsWith('--')) {
                    const val = computed.getPropertyValue(prop).trim();
                    if (val) {
                        variables[prop] = parseVariableValue(val);
                    }
                }
            }
        };

        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) {
                    if (rule.selectorText === ':root' || rule.selectorText === 'html' || rule.selectorText === 'body') {
                        processStyles(rule.style);
                    }
                }
            } catch (e) { continue; }
        }
        processStyles(root.style);
    } catch (e) {
        console.warn('Error extracting CSS variables', e);
    }
    return variables;
}

// ═══════════════════════════════════════════════════════════════
// VISIBILITY CHECK
// ═══════════════════════════════════════════════════════════════

function isElementVisible(el, cs) {
    // Skip hidden elements
    if (cs.display === 'none') return false;
    if (cs.visibility === 'hidden' && !hasVisibleChildren(el)) return false;
    if (cs.visibility === 'collapse') return false;
    if (parseFloat(cs.opacity) === 0) return false;

    // Skip hover/focus 전용 요소 (mega-menu, dropdown 등)
    // 마우스 hover 시에만 표시되는 요소가 height:0 등으로 숨겨진 상태면 스킵
    const className = (typeof el.className === 'string') ? el.className : (el.className?.baseVal || '');
    if (/mega-menu|dropdown-menu|dropdown-content|submenu(?!-)|tooltip(?!-)|popover/i.test(className)) {
        const h = parseFloat(cs.height);
        const maxH = parseFloat(cs.maxHeight);
        if (h <= 0 || maxH <= 0 || cs.pointerEvents === 'none') return false;
        // hover 전용 요소: opacity:0이거나 visibility:hidden이면 스킵
        if (parseFloat(cs.opacity) < 0.01 || cs.visibility === 'hidden') return false;
    }

    // Skip elements completely clipped
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) {
        // But allow elements with overflow:visible that might have visible children
        if (cs.overflow !== 'visible') return false;
    }

    // Skip off-screen elements (far beyond viewport)
    if (rect.right < -1000 || rect.bottom < -1000 ||
        rect.left > window.innerWidth + 1000 || rect.top > document.documentElement.scrollHeight + 1000) {
        return false;
    }

    return true;
}

function hasVisibleChildren(el) {
    for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) return true;
        if (child.nodeType === Node.ELEMENT_NODE) {
            const cs = getComputedStyle(child);
            if (cs.visibility !== 'hidden') return true;
        }
    }
    return false;
}

// ═══════════════════════════════════════════════════════════════
// ELEMENT CAPTURE (Core)
// ═══════════════════════════════════════════════════════════════

async function captureElement(el, depth = 0) {
    if (!(el instanceof Element)) return null;
    if (depth > MAX_DEPTH) return null;

    const cs = getComputedStyle(el);
    const tagName = el.tagName.toUpperCase();

    // ─── SVG Handling (Vector) ───
    if (tagName === 'SVG') {
        try {
            const clone = el.cloneNode(true);

            // Inline critical styles for Figma parser
            const stylesToInline = ['fill', 'stroke', 'stroke-width', 'color', 'opacity', 'display'];
            function inlineStyles(source, target) {
                const computed = getComputedStyle(source);
                for (const prop of stylesToInline) {
                    const val = computed[prop];
                    if (val && val !== '0px' && val !== 'auto' && val !== 'rgba(0, 0, 0, 0)') {
                        // For fill/stroke: only set if not 'none' to preserve SVG vector outlines
                        if ((prop === 'fill' || prop === 'stroke') && val === 'none') continue;
                        target.style[prop] = val;
                    }
                }
                // Handle currentColor for fill/stroke on attributes
                // Also check parent element's color as fallback (html.to.design pattern)
                const inheritedColor = computed.color || (el.parentElement ? getComputedStyle(el.parentElement).color : null) || 'black';
                if (target.getAttribute('fill') === 'currentColor') {
                    target.setAttribute('fill', inheritedColor);
                }
                if (target.getAttribute('stroke') === 'currentColor') {
                    target.setAttribute('stroke', inheritedColor);
                }
                // If stroke is not set at all but parent has color, inherit it for stroke-based SVGs
                if (!target.getAttribute('stroke') && !target.style.stroke) {
                    const computedStroke = computed.stroke;
                    if (computedStroke && computedStroke !== 'none') {
                        target.style.stroke = computedStroke;
                    }
                }
            }

            inlineStyles(el, clone);
            const sourceDescendants = el.querySelectorAll('*');
            const targetDescendants = clone.querySelectorAll('*');
            for (let i = 0; i < sourceDescendants.length; i++) {
                inlineStyles(sourceDescendants[i], targetDescendants[i]);
            }

            // Ensure dimensions
            if (!clone.getAttribute('width') && cs.width) clone.setAttribute('width', cs.width);
            if (!clone.getAttribute('height') && cs.height) clone.setAttribute('height', cs.height);

            const serializer = new XMLSerializer();
            const svgString = serializer.serializeToString(clone);
            const rect = el.getBoundingClientRect();

            return {
                type: 'SVG',
                name: el.getAttribute('name') || 'svg',
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                svgString: svgString,
                rotation: 0,
                opacity: parseFloat(cs.opacity) || 1,
            };
        } catch (e) {
            console.warn('SVG capture failed, falling back to frame', e);
        }
    }

    if (SKIP_TAGS.has(tagName)) return null;
    if (!isElementVisible(el, cs)) return null;

    const rect = el.getBoundingClientRect();
    const w = rect.width;
    // ─── Scroll Height: overflow 컨테이너의 전체 컨텐츠 높이 사용 ───
    const isScrollContainer = (cs.overflowY === 'auto' || cs.overflowY === 'scroll' ||
        cs.overflow === 'auto' || cs.overflow === 'scroll') &&
        el.scrollHeight > rect.height + 5;
    const h = isScrollContainer ? el.scrollHeight : rect.height;

    const node = {
        type: 'FRAME',
        name: buildName(el),
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.max(1, Math.round(w)),
        height: Math.max(1, Math.round(h)),
        clipsContent: false,
        children: [],
        fills: [],
        strokes: [],
        effects: [],
    };

    // ─── Transform ─────────────────────────────────────
    const rotation = getRotation(cs.transform);
    if (rotation !== 0) node.rotation = -rotation;

    // ─── Blend Mode ────────────────────────────────────
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') {
        node.blendMode = cs.mixBlendMode.toUpperCase().replace(/-/g, '_');
    }

    // ─── Opacity ───────────────────────────────────────
    const opacity = parseFloat(cs.opacity);
    if (isFinite(opacity) && opacity < 1) node.opacity = opacity;

    // ─── Fills ─────────────────────────────────────────
    await captureFills(el, cs, node, w, h);

    // ─── Borders ───────────────────────────────────────
    captureBorders(cs, node);

    // ─── Corner Radius ─────────────────────────────────
    captureCornerRadius(cs, node);

    // ─── Effects (shadows, blur) ───────────────────────
    captureEffects(cs, node);

    // ─── Clips Content ─────────────────────────────────
    // overflow:hidden 또는 overflow:clip인 요소에 clipsContent:true 적용
    // overflow:auto/scroll은 isScrollContainer에서 height를 확장했으므로 제외
    // body/html은 페이지 루트이므로 clipsContent 적용하지 않음
    const maxSpread = parseSpreadFromBoxShadow(cs.boxShadow);
    const isRootElement = tagName === 'BODY' || tagName === 'HTML';
    // Fix: c-tab-menu contents getting clipped by being too aggressive with clipsContent
    // Only clip if explicitly set to hidden, AND not highly likely to overlap (like absolute children inside relative boxes)
    const hasOverflowClip = !isRootElement && ((cs.overflow === 'hidden' || cs.overflow === 'clip') && cs.position !== 'relative');

    node.clipsContent = maxSpread > 0 || hasOverflowClip ||
        tagName === 'INPUT' || tagName === 'TEXTAREA';

    // ─── Auto Layout (Flex / Grid) ─────────────────────
    // NOTE: hasGrowChild now checks DOM directly (el.children), not node.children,
    // so this can safely run before captureChildren without losing accuracy.
    captureLayout(el, cs, node);



    // ─── Scroll Container: Expand height to capture ALL children ──────────
    // getBoundingClientRect()는 overflow 컨테이너 밖 자식에 대해 0 높이를 반환함.
    // 캡처 전에 컨테이너의 CSS 높이를 scrollHeight로 임시 확장하고, 
    // overflow를 visible로 변경하여 모든 자식이 visible 상태가 되도록 함.
    let savedScrollTop = 0;
    let savedHeight = '';
    let savedOverflow = '';
    let savedMaxHeight = '';
    if (isScrollContainer) {
        savedScrollTop = el.scrollTop;
        savedHeight = el.style.height;
        savedOverflow = el.style.overflow;
        savedMaxHeight = el.style.maxHeight;

        const fullHeight = el.scrollHeight; // 변경 전에 캡처
        el.scrollTop = 0;
        el.style.height = fullHeight + 'px';
        el.style.maxHeight = 'none';
        el.style.overflow = 'visible';
    }

    // ─── Pseudo-elements ::before / ::after ─────────────
    await capturePseudoElements(el, node, depth);

    // ─── Children Capture ──────────────────────────────
    await captureChildren(el, cs, node, depth);

    // ─── Restore scroll container ────────────────────────
    if (isScrollContainer) {
        el.style.height = savedHeight;
        el.style.maxHeight = savedMaxHeight;
        el.style.overflow = savedOverflow;
        el.scrollTop = savedScrollTop;
    }

    return node;
}

// ═══════════════════════════════════════════════════════════════
// FILL CAPTURE (BG color, BG image, gradients, <img>, <video>)
// ═══════════════════════════════════════════════════════════════

async function captureFills(el, cs, node, w, h) {
    // Background Color
    const bgColor = getRgba(cs.backgroundColor);
    if (bgColor && bgColor.a > 0) {
        node.fills.push({
            type: 'SOLID',
            color: { r: bgColor.r, g: bgColor.g, b: bgColor.b },
            opacity: bgColor.a,
        });
    }

    // Background Image (gradients + images)
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        // Gradients
        if (cs.backgroundImage.includes('gradient')) {
            const gradientFills = parseGradient(cs.backgroundImage);
            node.fills.push(...gradientFills);
        }

        // URL-based background images
        const urlMatches = cs.backgroundImage.matchAll(/url\(['"]?(.*?)['"]?\)/g);
        for (const urlMatch of urlMatches) {
            if (urlMatch[1] && !urlMatch[1].includes('gradient')) {
                const base64 = await imageToBase64(urlMatch[1], Math.round(w), Math.round(h));
                if (base64) {
                    let scaleMode = 'FILL';
                    if (cs.backgroundSize === 'contain') scaleMode = 'FIT';
                    else if (cs.backgroundSize === 'cover') scaleMode = 'FILL';
                    node.fills.push({ type: 'IMAGE', imageData: base64, scaleMode });
                }
            }
        }
    }

    // <img> element
    if (el.tagName === 'IMG' && el.src) {
        const base64 = await imageToBase64(el.src, Math.round(w), Math.round(h));
        if (base64) {
            node.fills.push({
                type: 'IMAGE',
                imageData: base64,
                scaleMode: cs.objectFit === 'contain' ? 'FIT' : 'FILL',
            });
        }
    }

    // <video> element — capture poster or current frame
    if (el.tagName === 'VIDEO') {
        if (el.poster) {
            const base64 = await imageToBase64(el.poster, Math.round(w), Math.round(h));
            if (base64) {
                node.fills.push({ type: 'IMAGE', imageData: base64, scaleMode: 'FILL' });
            }
        } else if (el.readyState >= 2) {
            // Capture current video frame
            try {
                const canvas = document.createElement('canvas');
                canvas.width = el.videoWidth || w;
                canvas.height = el.videoHeight || h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/png');
                node.fills.push({ type: 'IMAGE', imageData: dataUrl, scaleMode: 'FILL' });
            } catch (e) {
                // Video might be cross-origin
            }
        }
    }

    // <canvas> element
    if (el.tagName === 'CANVAS') {
        try {
            const dataUrl = el.toDataURL('image/png');
            if (dataUrl && dataUrl !== 'data:,') {
                node.fills.push({ type: 'IMAGE', imageData: dataUrl, scaleMode: 'FILL' });
            }
        } catch (e) {
            // canvas might be tainted
        }
    }
    // <input> with type=image
    if (el.tagName === 'INPUT' && el.type === 'image' && el.src) {
        const base64 = await imageToBase64(el.src, Math.round(w), Math.round(h));
        if (base64) {
            node.fills.push({ type: 'IMAGE', imageData: base64, scaleMode: 'FILL' });
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// BORDER CAPTURE
// ═══════════════════════════════════════════════════════════════

function captureBorders(cs, node) {
    const borderTopW = px(cs.borderTopWidth);
    const borderRightW = px(cs.borderRightWidth);
    const borderBottomW = px(cs.borderBottomWidth);
    const borderLeftW = px(cs.borderLeftWidth);

    // Helper to check visibility and get color
    function getBorderInfo(width, style, colorStr) {
        if (width > 0 && style !== 'none' && style !== 'hidden') {
            const color = getRgba(colorStr);
            if (color && color.a > 0) return { width, style, color };
        }
        return null;
    }

    const top = getBorderInfo(borderTopW, cs.borderTopStyle, cs.borderTopColor);
    const right = getBorderInfo(borderRightW, cs.borderRightStyle, cs.borderRightColor);
    const bottom = getBorderInfo(borderBottomW, cs.borderBottomStyle, cs.borderBottomColor);
    const left = getBorderInfo(borderLeftW, cs.borderLeftStyle, cs.borderLeftColor);

    // Any visible border?
    // Prioritize bottom/top/left/right based on existence.
    // If multiple exist, we just pick the first one found for the Stroke Color (Figma limitation).
    const visibleBorder = top || right || bottom || left;

    if (visibleBorder) {
        node.strokes.push({
            type: 'SOLID',
            color: { r: visibleBorder.color.r, g: visibleBorder.color.g, b: visibleBorder.color.b },
            opacity: visibleBorder.color.a,
        });

        const maxBorderW = Math.max(borderTopW, borderRightW, borderBottomW, borderLeftW);
        node.strokeWeight = maxBorderW;
        node.strokeAlign = 'INSIDE';

        if (visibleBorder.style === 'dashed') node.dashPattern = [maxBorderW * 3, maxBorderW * 2];
        else if (visibleBorder.style === 'dotted') node.dashPattern = [maxBorderW, maxBorderW];

        node.strokeTopWeight = borderTopW;
        node.strokeRightWeight = borderRightW;
        node.strokeBottomWeight = borderBottomW;
        node.strokeLeftWeight = borderLeftW;
    }

    // Outline (additional border-like effect)
    const outlineWidth = px(cs.outlineWidth);
    const outlineColor = getRgba(cs.outlineColor);
    if (outlineWidth > 0 && outlineColor && outlineColor.a > 0 && cs.outlineStyle !== 'none') {
        // Capture as an effect since Figma doesn't support outline separately
        node.effects.push({
            type: 'DROP_SHADOW',
            color: outlineColor,
            offset: { x: 0, y: 0 },
            radius: 0,
            spread: outlineWidth,
            visible: true,
            blendMode: 'NORMAL',
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// CORNER RADIUS
// ═══════════════════════════════════════════════════════════════

function captureCornerRadius(cs, node) {
    const tlr = px(cs.borderTopLeftRadius);
    const trr = px(cs.borderTopRightRadius);
    const brr = px(cs.borderBottomRightRadius);
    const blr = px(cs.borderBottomLeftRadius);
    if (tlr === trr && trr === brr && brr === blr && tlr > 0) {
        node.cornerRadius = tlr;
    } else if (tlr || trr || brr || blr) {
        node.topLeftRadius = tlr;
        node.topRightRadius = trr;
        node.bottomRightRadius = brr;
        node.bottomLeftRadius = blr;
    }
}

// ═══════════════════════════════════════════════════════════════
// EFFECTS (box-shadow, text-shadow, filters)
// ═══════════════════════════════════════════════════════════════

function captureEffects(cs, node) {
    // Box shadows
    const shadows = parseBoxShadow(cs.boxShadow);
    if (shadows.length > 0) node.effects.push(...shadows);

    // Text shadow (html.to.design captures these as effects on the text node)
    const textShadows = parseTextShadow(cs.textShadow);
    if (textShadows.length > 0) node.effects.push(...textShadows);

    // Filter blur
    const blurRadius = parseBlur(cs.filter);
    if (blurRadius > 0) node.effects.push({ type: 'LAYER_BLUR', radius: blurRadius, visible: true });

    // Backdrop filter blur
    const bgBlurRadius = parseBlur(cs.backdropFilter || cs.webkitBackdropFilter);
    if (bgBlurRadius > 0) node.effects.push({ type: 'BACKGROUND_BLUR', radius: bgBlurRadius, visible: true });
}

// ═══════════════════════════════════════════════════════════════
// LAYOUT CAPTURE (Flex + Grid)
// ═══════════════════════════════════════════════════════════════

function captureLayout(el, cs, node) {
    const display = cs.display;
    const tagName = el.tagName;

    // ─── Selective Auto Layout (Matching Reference) ────────────────
    const isInteractive = tagName === 'BUTTON' || tagName === 'A' || tagName === 'LABEL';
    const hasPadding = px(cs.paddingTop) > 0 || px(cs.paddingRight) > 0 || px(cs.paddingBottom) > 0 || px(cs.paddingLeft) > 0;
    const hasMultipleChildren = el.children.length >= 2;
    const hasVisibleBackground = (getRgba(cs.backgroundColor)?.a > 0) || (cs.backgroundImage && cs.backgroundImage !== 'none');

    // Force Auto Layout for interactive elements if they act as containers
    const shouldForceAutoLayout = isInteractive && (hasPadding || hasMultipleChildren || hasVisibleBackground);

    const isFlex = display === 'flex' || display === 'inline-flex';
    const isGrid = display === 'grid' || display === 'inline-grid';

    if (!isFlex && !isGrid && !shouldForceAutoLayout) return;

    node.layoutMode = (cs.flexDirection === 'column' || isGrid) ? 'VERTICAL' : 'HORIZONTAL';

    const mapAlign = (val, textAlign) => {
        val = val ? val.trim().toLowerCase() : '';
        if (val === 'center' || textAlign === 'center') return 'CENTER';
        if (val === 'flex-end' || val === 'end' || val === 'right' || val === 'bottom' || textAlign === 'right') return 'MAX';
        if (val === 'space-between') return 'SPACE_BETWEEN';
        if (val === 'space-around' || val === 'space-evenly') return 'SPACE_BETWEEN';
        return 'MIN';
    };

    const textAlign = cs.textAlign;
    node.primaryAxisAlignItems = mapAlign(cs.justifyContent, textAlign);

    if (display === 'flex' || display === 'inline-flex') {
        const dir = cs.flexDirection || 'row';
        node.layoutMode = dir.includes('column') ? 'VERTICAL' : 'HORIZONTAL';

        const columnGap = px(cs.columnGap || cs.gap || '0');
        const rowGap = px(cs.rowGap || cs.gap || '0');

        // Check if any child has flex-grow
        let hasGrowChild = false;
        for (const child of el.children) {
            const childCs = getComputedStyle(child);
            if (parseFloat(childCs.flexGrow) > 0) {
                hasGrowChild = true;
                break;
            }
        }

        // JUSTIFY CONTENT (Primary Axis)
        const justifyContent = cs.justifyContent;
        if (justifyContent && (justifyContent.includes('space-between') || justifyContent.includes('space-around'))) {
            // Fix: Allow SPACE_BETWEEN even if there is a gap. 
            // Figma's "Auto" spacing acts like space-between.
            // Only force MIN if we have growing children (which consume all space anyway).
            if (hasGrowChild) {
                node.primaryAxisAlignItems = 'MIN';
            } else {
                node.primaryAxisAlignItems = 'SPACE_BETWEEN';
            }
        } else {
            node.primaryAxisAlignItems = mapAlign(justifyContent);
        }

        // ALIGN ITEMS (Counter Axis)
        node.counterAxisAlignItems = mapAlign(cs.alignItems);

        if (cs.flexWrap === 'wrap' || cs.flexWrap === 'wrap-reverse') {
            node.layoutWrap = 'WRAP';
        }

        // Responsive Sizing / Fill Logic
        const w = cs.width;
        const h = cs.height;
        if (w === '100%' || w === '100vw') {
            if (node.layoutMode === 'HORIZONTAL') node.layoutGrow = 1;
            else node.layoutAlign = 'STRETCH';
        }
        if (h === '100%' || h === '100vh') {
            if (node.layoutMode === 'VERTICAL') node.layoutGrow = 1;
            else node.layoutAlign = 'STRETCH';
        }

        captureLayoutSpacing(el, cs, node);

    } else if (display === 'grid' || display === 'inline-grid') {
        const cols = cs.gridTemplateColumns;
        const rows = cs.gridTemplateRows;

        // Count columns match (e.g. "100px 100px" -> 2)
        const colCount = cols ? cols.split(/\s+/).filter(c => c && c !== 'none').length : 1;
        // Count rows match
        const rowCount = rows ? rows.split(/\s+/).filter(r => r && r !== 'none').length : 1;

        node.layoutMode = 'GRID';
        node.gridColumnCount = Math.max(1, colCount);
        node.gridRowCount = Math.max(1, rowCount);

        node.primaryAxisAlignItems = mapAlign(cs.justifyItems || cs.justifyContent);
        node.counterAxisAlignItems = mapAlign(cs.alignItems || cs.alignContent);

        captureLayoutSpacing(el, cs, node);

    } else {
        // Block elements with block-level children → Vertical Auto Layout
        if (hasBlockChildren(el)) {
            node.layoutMode = 'VERTICAL';
            node.primaryAxisAlignItems = 'MIN';

            // Check for centering (margin: 0 auto on children)
            // If the first significant block child is centered, we center the parent's generic alignment
            let isCentered = false;
            for (const child of el.children) {
                const s = getComputedStyle(child);
                // Check if it's a layout participant
                if (['block', 'flex', 'grid', 'table'].includes(s.display)) {
                    if (s.marginLeft === 'auto' && s.marginRight === 'auto') {
                        isCentered = true;
                    }
                    break; // Only check the first flow content to determine container alignment intent
                }
            }
            node.counterAxisAlignItems = isCentered ? 'CENTER' : 'MIN';

            captureLayoutSpacing(el, cs, node);


        }
    }
}

function hasBlockChildren(el) {
    if (!el) return false;
    let blockCount = 0;
    for (const child of el.children) {
        const style = getComputedStyle(child);
        if (style.display === 'none') continue;
        // Skip out-of-flow elements
        if (style.position === 'absolute' || style.position === 'fixed') continue;

        const display = style.display;
        if (display === 'block' || display === 'flex' || display === 'grid' || display === 'table' || display === 'list-item') {
            blockCount++;
            // html.to.design applies mode:column even with a single block child
            if (blockCount >= 1) return true;
        }
    }
    return false;
}



function captureLayoutSpacing(el, cs, node) {
    // Gap
    // Gap - layoutMode가 있을 때만 적용 (flex/grid 컨테이너)
    if (node.layoutMode) {
        // 'normal' 값을 명시적으로 필터링 (브라우저에서 normal = 0)
        const gapValue = (cs.gap === 'normal' || !cs.gap) ? '0' : cs.gap;
        const columnGapValue = (cs.columnGap === 'normal' || !cs.columnGap) ? gapValue : cs.columnGap;
        const rowGapValue = (cs.rowGap === 'normal' || !cs.rowGap) ? gapValue : cs.rowGap;

        const columnGap = px(columnGapValue);
        const rowGap = px(rowGapValue);

        if (node.layoutMode === 'HORIZONTAL') {
            if (columnGap > 0.01) node.itemSpacing = columnGap;
            if (rowGap > 0.01 && node.layoutWrap === 'WRAP') node.counterAxisSpacing = rowGap;
        } else if (node.layoutMode === 'VERTICAL') {
            if (rowGap > 0.01) node.itemSpacing = rowGap;
            if (columnGap > 0.01 && node.layoutWrap === 'WRAP') node.counterAxisSpacing = columnGap;
        } else if (node.layoutMode === 'GRID') {
            if (rowGap > 0.01) node.gridRowGap = rowGap;
            if (columnGap > 0.01) node.gridColumnGap = columnGap;
        }
    }

    // Padding
    const pt = px(cs.paddingTop);
    const pr = px(cs.paddingRight);
    const pb = px(cs.paddingBottom);
    const pl = px(cs.paddingLeft);

    node.paddingTop = Math.max(0, pt || 0);
    node.paddingRight = Math.max(0, pr || 0);
    node.paddingBottom = Math.max(0, pb || 0);
    node.paddingLeft = Math.max(0, pl || 0);

    // Sizing Modes (Hug vs Fixed)
    const w = cs.width;
    const h = cs.height;
    const display = cs.display;

    // Use Computed Style for parent
    const parentCs = el && el.parentElement ? window.getComputedStyle(el.parentElement) : null;
    const parentDisplay = parentCs ? parentCs.display : '';

    // Width Sizing
    if (w === 'auto' || w === 'min-content' || w === 'max-content' || w === 'fit-content') {
        const isBlock = display === 'block' || display === 'flex' || display === 'grid' || display === 'table';

        // CSS Block elements take 100% width by default in normal flow
        // html.to.design maps this as sizing.horizontal: fill + alignSelf: stretch
        if (isBlock && !parentDisplay.includes('flex') && !parentDisplay.includes('grid')) {
            if (node.layoutMode === 'HORIZONTAL') {
                node.primaryAxisSizingMode = 'FIXED';
            } else if (node.layoutMode === 'VERTICAL') {
                node.counterAxisSizingMode = 'FIXED';
            }
            // Mark that this block element should stretch to fill parent width
            node._shouldStretch = true;
        } else {
            if (node.layoutMode === 'HORIZONTAL') {
                node.primaryAxisSizingMode = 'AUTO';
            }
        }

        if (node.layoutMode === 'VERTICAL' && !isBlock) node.counterAxisSizingMode = 'AUTO';
    } else if (w.includes('%') || w.includes('vw')) {
        // Percentage width → should stretch/fill in parent Auto Layout
        node._shouldStretch = true;
    } else {
        if (node.layoutMode === 'HORIZONTAL') node.primaryAxisSizingMode = 'FIXED';
    }

    // Height Sizing
    if (h === 'auto' || h === 'min-content' || h === 'max-content' || h === 'fit-content') {
        if (node.layoutMode === 'VERTICAL') node.primaryAxisSizingMode = 'AUTO';
        if (node.layoutMode === 'HORIZONTAL') node.counterAxisSizingMode = 'AUTO';

        // Inline 요소(span 등)는 부모 Auto Layout에서 counter-axis를 AUTO로 설정
        // 이렇게 하면 부모가 자식의 실제 크기를 인식하여 잘리지 않음
        const isInline = display === 'inline' || display === 'inline-block';
        if (isInline && !node.layoutMode) {
            // Span이 프레임으로 캡처되었지만 layoutMode가 없는 경우
            // 부모가 Horizontal이면 height를, Vertical이면 width를 AUTO로
            // 하지만 여기서는 부모 정보가 없으므로, captureChildren에서 처리
        }
    } else {
        if (node.layoutMode === 'VERTICAL') node.primaryAxisSizingMode = 'FIXED';
    }
}

// ═══════════════════════════════════════════════════════════════
// PSEUDO-ELEMENTS (::before, ::after)
// ═══════════════════════════════════════════════════════════════

async function capturePseudoElements(el, parentNode, depth) {
    for (const pseudo of ['::before', '::after']) {
        const ps = getComputedStyle(el, pseudo);
        const content = ps.content;

        // Skip if strictly no content keyword, or display none. 
        // Note: '""' and "''" are allowed because they are often used for drawing shapes/borders.
        if (!content || content === 'none' || content === 'normal') continue;
        if (ps.display === 'none') continue;

        const pseudoNode = {
            type: 'FRAME',
            name: buildName(el, pseudo),
            x: 0,
            y: 0,
            width: Math.max(1, px(ps.width) || 0),
            height: Math.max(1, px(ps.height) || 0),
            clipsContent: false,
            children: [],
            fills: [],
            strokes: [],
            effects: [],
            _zIndex: parseInt(ps.zIndex) || 0,
            _order: pseudo === '::before' ? -10000 : 1000000, // Before is behind, After is front
        };

        // Try to get actual position
        // Pseudo-elements don't have getBoundingClientRect, estimate from parent
        let pseudoW = px(ps.width);
        let pseudoH = px(ps.height);

        const isAbs = ps.position === 'absolute' || ps.position === 'fixed';
        const top = px(ps.top);
        const bottom = px(ps.bottom);
        const left = px(ps.left);
        const right = px(ps.right);

        // Unquote text content early
        let textContent = content.replace(/^['"]|['"]$/g, '');
        if (textContent === 'none' || textContent === 'normal') textContent = '';

        const hasText = textContent && textContent.length > 0 && textContent !== ' ';

        // Infer from absolute positioning constraints if auto
        if (pseudoW === null) {
            if (hasText) {
                // Precise measure for text content
                const span = document.createElement('span');
                span.style.font = ps.font;
                span.style.visibility = 'hidden';
                span.style.position = 'absolute';
                span.textContent = textContent;
                document.body.appendChild(span);
                pseudoW = span.getBoundingClientRect().width;
                document.body.removeChild(span);
            } else if (isAbs && left !== null && right !== null) {
                pseudoW = parentNode.width - left - right;
            } else {
                pseudoW = 0; // Shapes usually have explicit sizes
            }
        }

        if (pseudoH === null) {
            if (hasText) {
                pseudoH = px(ps.lineHeight) || px(ps.fontSize);
            } else if (isAbs && top !== null && bottom !== null) {
                pseudoH = parentNode.height - top - bottom;
            } else {
                pseudoH = 0;
            }
        }

        pseudoW = pseudoW || 0;
        pseudoH = pseudoH || 0;

        if (pseudoW > 0 || pseudoH > 0) {
            pseudoNode.width = Math.max(1, pseudoW);
            pseudoNode.height = Math.max(1, pseudoH);
        } else {
            // Skip pseudo-elements with no size at all
            continue;
        }

        // Position
        if (isAbs) {
            if (top !== null) pseudoNode.y = top;
            else if (bottom !== null && parentNode.height) pseudoNode.y = parentNode.height - bottom - pseudoNode.height;

            if (left !== null) pseudoNode.x = left;
            else if (right !== null && parentNode.width) pseudoNode.x = parentNode.width - right - pseudoNode.width;

            // Fix: Explicitly set absolute positioning for Auto Layout parents
            pseudoNode.layoutPositioning = 'ABSOLUTE';
        }

        // Background
        const bgColor = getRgba(ps.backgroundColor);
        if (bgColor && bgColor.a > 0) {
            pseudoNode.fills.push({
                type: 'SOLID',
                color: { r: bgColor.r, g: bgColor.g, b: bgColor.b },
                opacity: bgColor.a,
            });
        }

        // Background image / gradients
        if (ps.backgroundImage && ps.backgroundImage !== 'none') {
            if (ps.backgroundImage.includes('gradient')) {
                pseudoNode.fills.push(...parseGradient(ps.backgroundImage));
            }
            const urlMatch = ps.backgroundImage.match(/url\(['"]?(.*?)['"]?\)/);
            if (urlMatch && urlMatch[1]) {
                const base64 = await imageToBase64(urlMatch[1], pseudoNode.width, pseudoNode.height);
                if (base64) {
                    pseudoNode.fills.push({ type: 'IMAGE', imageData: base64, scaleMode: 'FILL' });
                }
            }
        }

        // Border radius
        captureCornerRadius(ps, pseudoNode);

        // Opacity
        const pOpacity = parseFloat(ps.opacity);
        if (isFinite(pOpacity) && pOpacity < 1) pseudoNode.opacity = pOpacity;

        // Text content from pseudo-element
        if (hasText) {
            const textNode = {
                type: 'TEXT',
                name: textContent.substring(0, 20) || 'pseudo-text',
                x: 0,
                y: 0,
                width: pseudoNode.width,
                height: pseudoNode.height,
                characters: textContent,
                fills: [],
                fontSize: px(ps.fontSize),
                fontFamily: resolveFontFamily(ps.fontFamily),
                fontStyle: getFontStyle(ps.fontWeight, ps.fontStyle),
            };

            const color = getRgba(ps.color);
            if (color) {
                textNode.fills.push({
                    type: 'SOLID',
                    color: { r: color.r, g: color.g, b: color.b },
                    opacity: color.a,
                });
            }

            pseudoNode.children.push(textNode);
        }

        // Only add if it has visual content
        if (pseudoNode.fills.length > 0 || pseudoNode.children.length > 0) {
            parentNode.children.push(pseudoNode);
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// CHILDREN CAPTURE
// ═══════════════════════════════════════════════════════════════

async function captureChildren(el, cs, node, depth) {
    // ─── Special Form Element Handling ───
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
        // 체크박스와 라디오 버튼은 시각적 요소로 캡처
        if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
            const cs = getComputedStyle(el);
            const appearance = cs.appearance || cs.webkitAppearance; // Check for standard and webkit prefix

            console.log(`[HTML-TO-FIGMA] Input ${el.type}: checked=${el.checked}, appearance=${appearance}`);

            // If appearance is 'none', it means the user has a custom style.
            // We should NOT generate a fake checkbox, but let the element be captured as a Frame (with its actual BG/Border).
            if (appearance === 'none') {
                return;
            }

            const rect = el.getBoundingClientRect();
            const size = Math.min(rect.width, rect.height);

            // Get accent color
            let accentColor = { r: 0.106, g: 0.49, b: 0.9 }; // Default Blue #1B7AF6

            // 1. Try accent-color
            const accent = getRgba(cs.accentColor);
            if (accent && accent.a > 0) {
                accentColor = accent;
            } else {
                // 2. Try generic color (often used for custom brand theming on inputs)
                const textColor = getRgba(cs.color);
                const isBlackOrGray = textColor && (textColor.r === textColor.g && textColor.g === textColor.b && textColor.r < 0.3); // Simple check for likely black
                if (textColor && textColor.a > 0 && !isBlackOrGray) {
                    accentColor = textColor;
                }
            }

            const checkboxNode = {
                type: 'FRAME',
                name: el.type === 'checkbox' ? 'checkbox' : 'radio',
                x: 0,
                y: 0,
                width: size,
                height: size,
                fills: [{
                    type: 'SOLID',
                    color: el.checked ? { r: accentColor.r, g: accentColor.g, b: accentColor.b } : { r: 1, g: 1, b: 1 },
                    opacity: el.checked ? (accentColor.a !== undefined ? accentColor.a : 1) : 1
                }],
                strokes: [{
                    type: 'SOLID',
                    color: el.checked ? { r: accentColor.r, g: accentColor.g, b: accentColor.b } : { r: 0.8, g: 0.8, b: 0.8 },
                    opacity: el.checked ? (accentColor.a !== undefined ? accentColor.a : 1) : 1
                }],
                strokeWeight: 1,
                strokeAlign: 'INSIDE',
                children: []
            };

            // Round for Radio
            if (el.type === 'radio') {
                checkboxNode.cornerRadius = size / 2;
            } else {
                checkboxNode.cornerRadius = Math.min(4, size * 0.2); // Mild rounding for checkbox
            }

            // Checked State
            if (el.checked) {
                if (el.type === 'checkbox') {
                    // SVG Checkmark
                    // M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z (Standard Material Check)
                    // Scaled to 24px viewbox. We need to scale it to 'size'.

                    const checkMarkSvg = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M9 16.17L4.83 12L3.41 13.41L9 19L21 7L19.59 5.59L9 16.17Z" fill="white"/>
                    </svg>`;

                    // Use createSvgNode logic via fake data passed to children
                    // But here we construct the object directly for the Figma plugin to consumer (node structure)
                    // We'll use a FRAME with VECTOR for simplicity if we can, or just an SVG image fill?
                    // The simplest way to get a vector in Figma from here is to use the SVG type we support.

                    checkboxNode.children.push({
                        type: 'SVG',
                        name: 'check-icon',
                        x: 0,
                        y: 0,
                        width: size,
                        height: size,
                        svgString: checkMarkSvg,
                        rotation: 0,
                        opacity: 1
                    });

                } else {
                    // Radio Dot
                    const dotSize = size * 0.4;
                    const radioDot = {
                        type: 'ELLIPSE', // Figma uses ELLIPSE for circles usually, but our converter uses FRAME for most things. 
                        // Actually our converter might not support ELLIPSE type directly in 'createLayer' unless we added it?
                        // Checking createLayer... it calls createFrameNode for default.
                        // Let's use FRAME with cornerRadius = width/2
                        type: 'FRAME',
                        name: 'radio-dot',
                        x: (size - dotSize) / 2,
                        y: (size - dotSize) / 2,
                        width: dotSize,
                        height: dotSize,
                        fills: [{
                            type: 'SOLID',
                            color: { r: 1, g: 1, b: 1 },
                            opacity: 1
                        }],
                        strokes: [],
                        cornerRadius: dotSize / 2
                    };
                    checkboxNode.children.push(radioDot);
                }
            }

            node.children.push(checkboxNode);
            return;
        }

        // 다른 input 요소는 기존 처리
        const textNode = createInputTextNode(el, cs, node);
        if (textNode) node.children.push(textNode);
        return;
    }

    const directTextContent = getDirectTextContent(el);
    const hasElementChildren = hasChildElements(el);

    if (directTextContent && !hasElementChildren && px(cs.fontSize) > 0) {
        // Leaf text element → single merged text node using Range for geometry
        const textNode = createMergedTextNode(el, cs, node);
        if (textNode) node.children.push(textNode);
    } else if (checkRichTextCandidate(el)) {
        // Rich Text (User Request: merge b, span tags into one text node)
        const richTextNode = createRichTextNode(el, cs, node);
        if (richTextNode) node.children.push(richTextNode);
    } else {
        // Mixed content: iterate child nodes
        let orderIdx = 0;
        for (const child of el.childNodes) {
            let childNode = null;
            let zIndex = 0;

            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent.trim();
                if (text.length > 0 && px(cs.fontSize) > 0) {
                    childNode = captureTextNode(child, el, cs, node);
                }
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const childCs = getComputedStyle(child);
                zIndex = parseInt(childCs.zIndex);
                if (isNaN(zIndex)) zIndex = 0;

                if (child.tagName === 'SVG' || child.tagName === 'svg') {
                    childNode = captureSvg(child, node);
                    // SVG도 margin 처리를 받도록 childNode가 있으면 아래 로직 계속 진행
                } else {
                    childNode = await captureElement(child, depth + 1);
                }

                if (childNode) {
                    // Auto Layout child props
                    if (node.layoutMode) {
                        if (parseFloat(childCs.flexGrow) > 0 && child.tagName !== 'SPAN') {
                            childNode.layoutGrow = 1;
                            // No buffering needed: Figma's Fill mode auto-adjusts within parent frame
                        }

                        // Handle align-self for cross-axis alignment
                        const alignSelf = childCs.alignSelf;
                        if (alignSelf === 'stretch' && child.tagName !== 'SPAN') {
                            childNode.layoutAlign = 'STRETCH';
                        } else if (alignSelf === 'flex-end' || alignSelf === 'end') {
                            childNode.layoutAlign = 'MAX';
                        } else if (alignSelf === 'center') {
                            childNode.layoutAlign = 'CENTER';
                        } else if (alignSelf === 'flex-start' || alignSelf === 'start') {
                            childNode.layoutAlign = 'MIN';
                        } else if (alignSelf === 'auto' || !alignSelf) {
                            // Inherit from parent align-items
                            const parentAlign = cs.alignItems || 'stretch'; // default flex/grid alignment is stretch
                            // Fix: 'normal' in Flexbox usually behaves like 'stretch' but check aspect ratio
                            if ((parentAlign.includes('stretch') || parentAlign === 'normal') && child.tagName !== 'SPAN') {
                                childNode.layoutAlign = 'STRETCH';
                            }
                        }

                        // _shouldStretch: Block/percentage elements should fill parent width
                        // (html.to.design maps these as alignSelf: stretch + sizing.horizontal: fill)
                        if (childNode._shouldStretch && child.tagName !== 'SPAN') {
                            childNode.layoutAlign = 'STRETCH';
                        }

                        // ─── NEW: Handle Cross-Axis Margin Auto (Overrides align-self) ───
                        let mt = px(childCs.marginTop);
                        let mr = px(childCs.marginRight);
                        let mb = px(childCs.marginBottom);
                        let ml = px(childCs.marginLeft);

                        if (node.layoutMode === 'VERTICAL') {
                            // Detect horizontal centering (e.g. margin: 0 auto)
                            // If margins are roughly equal and > 0, we can use CENTER alignment instead of wrappers
                            if (ml > 0 && Math.abs(ml - mr) <= 2) {
                                childNode.layoutAlign = 'CENTER';
                                ml = 0; // consumed by CENTER alignment
                                mr = 0;
                            }
                        } else if (node.layoutMode === 'HORIZONTAL') {
                            // Detect vertical centering
                            if (mt > 0 && Math.abs(mt - mb) <= 2) {
                                childNode.layoutAlign = 'CENTER';
                                mt = 0; // consumed by CENTER alignment
                                mb = 0;
                            }
                        }

                        // Handle Margins by wrapping in a Frame
                        // childCs는 ELEMENT_NODE일 때만 정의됨 (TEXT_NODE는 margin 없음)
                        // 부모가 Auto Layout(node.layoutMode)이고 자식이 absolute가 아닐 때만 Margin Wrapper 적용
                        const isChildAbsolute = childCs && ['fixed', 'absolute'].includes(childCs.position);

                        if (childCs && node.layoutMode && !isChildAbsolute) {
                            if (mt || mr || mb || ml) {
                                // Create a Margin Wrapper Frame
                                const marginWrapper = {
                                    type: 'FRAME',
                                    name: `${childNode.name || 'node'}:margin`,
                                    x: childNode.x - Math.max(0, ml),
                                    y: childNode.y - Math.max(0, mt),
                                    width: Math.max(1, childNode.width + Math.max(0, ml) + Math.max(0, mr)),
                                    height: Math.max(1, childNode.height + Math.max(0, mt) + Math.max(0, mb)),
                                    clipsContent: false,
                                    layoutMode: node.layoutMode, // Inherit parent's mode for easier debugging
                                    primaryAxisSizingMode: 'AUTO',
                                    counterAxisSizingMode: childNode.layoutAlign === 'STRETCH' ? 'FIXED' : 'AUTO',
                                    itemSpacing: 0,
                                    paddingTop: Math.max(0, mt),
                                    paddingRight: Math.max(0, mr),
                                    paddingBottom: Math.max(0, mb),
                                    paddingLeft: Math.max(0, ml),
                                    children: [childNode],
                                    fills: [],
                                    strokes: [],
                                    effects: [],
                                    _zIndex: childNode._zIndex,
                                    _order: childNode._order
                                };

                                // 특수 요소 (margin: 0 auto 등) 넓이 보정 (util-menu 오류 대응)
                                if (node.layoutMode === 'VERTICAL' && ml > 0 && mr > 0) {
                                    // wrapper가 부모 넓이를 다 차지할 경우 내용물이 압착되는 것을 방지
                                    marginWrapper.layoutAlign = 'STRETCH';
                                    marginWrapper.counterAxisSizingMode = 'FIXED';
                                }

                                // Child should hug inside its margin wrapper
                                childNode.x = 0;
                                childNode.y = 0;

                                // Re-apply Grow/Align to wrapper
                                if (childNode.layoutGrow) {
                                    marginWrapper.layoutGrow = 1;
                                    marginWrapper.primaryAxisSizingMode = 'FIXED';
                                }
                                if (childNode.layoutAlign) {
                                    marginWrapper.layoutAlign = childNode.layoutAlign;
                                    // childNode.layoutAlign 유지 (안 뺏어가도록)
                                }
                                childNode = marginWrapper;
                            }
                        }

                        // ─── Inline 요소(span) sizing 조정 ───
                        // Inline 요소가 Auto Layout 부모의 자식일 때,
                        // counter-axis를 FIXED로 설정 (사용자 요청: Fill 대신 Fixed)
                        if (childCs) {
                            const childDisplay = childCs.display;
                            const isInlineChild = childDisplay === 'inline' || childDisplay === 'inline-block';

                            if (isInlineChild && !childNode.layoutMode) {
                                // Span 프레임이 layoutMode가 없는 경우 (일반 프레임)
                                // Height를 Fixed로 설정하여 정확한 크기 유지
                                if (!childNode.counterAxisSizingMode) {
                                    childNode.counterAxisSizingMode = 'FIXED';
                                }
                                if (!childNode.primaryAxisSizingMode) {
                                    childNode.primaryAxisSizingMode = 'FIXED';
                                }
                            }
                        }
                    }

                    // ─── GRID Child Properties ───
                    if (node.layoutMode === 'GRID' && childCs && !['fixed', 'absolute'].includes(childCs.position)) {
                        // Justify/Align Self
                        if (childCs.justifySelf && childCs.justifySelf !== 'auto') {
                            const js = childCs.justifySelf.toLowerCase();
                            if (js.includes('center')) childNode.gridChildHorizontalAlign = 'CENTER';
                            else if (js.includes('end') || js.includes('right')) childNode.gridChildHorizontalAlign = 'MAX';
                            else if (js.includes('start') || js.includes('left')) childNode.gridChildHorizontalAlign = 'MIN';
                        }
                        if (childCs.alignSelf && childCs.alignSelf !== 'auto') {
                            const as = childCs.alignSelf.toLowerCase();
                            if (as.includes('center')) childNode.gridChildVerticalAlign = 'CENTER';
                            else if (as.includes('end') || as.includes('bottom')) childNode.gridChildVerticalAlign = 'MAX';
                            else if (as.includes('start') || as.includes('top')) childNode.gridChildVerticalAlign = 'MIN';
                        }

                        // Column Span
                        if (childCs.gridColumn && childCs.gridColumn !== 'auto') {
                            const match = childCs.gridColumn.match(/span\s+(\d+)/i);
                            if (match) {
                                childNode.gridColumnSpan = parseInt(match[1], 10);
                            } else if (childCs.gridColumn.includes('/')) {
                                const parts = childCs.gridColumn.split('/');
                                const start = parseInt(parts[0], 10);
                                const end = parseInt(parts[1], 10);
                                if (!isNaN(start) && !isNaN(end)) {
                                    childNode.gridColumnSpan = Math.max(1, end - start);
                                }
                            }
                        }

                        // Row Span
                        if (childCs.gridRow && childCs.gridRow !== 'auto') {
                            const match = childCs.gridRow.match(/span\s+(\d+)/i);
                            if (match) {
                                childNode.gridRowSpan = parseInt(match[1], 10);
                            } else if (childCs.gridRow.includes('/')) {
                                const parts = childCs.gridRow.split('/');
                                const start = parseInt(parts[0], 10);
                                const end = parseInt(parts[1], 10);
                                if (!isNaN(start) && !isNaN(end)) {
                                    childNode.gridRowSpan = Math.max(1, end - start);
                                }
                            }
                        }
                    }

                    // Fixed / Absolute (sticky is treated as in-flow relative)
                    if (childCs && ['fixed', 'absolute'].includes(childCs.position)) {
                        if (node.layoutMode) childNode.layoutPositioning = 'ABSOLUTE';

                        // ─── Constraints Detection (STRETCH) ───
                        const l = childCs.left;
                        const r = childCs.right;
                        const t = childCs.top;
                        const b = childCs.bottom;
                        const stretchH = (l === '0px' && r === '0px') || childCs.width === '100%';
                        const stretchV = (t === '0px' && b === '0px') || childCs.height === '100%';
                        if (stretchH || stretchV) {
                            childNode.constraints = {
                                horizontal: stretchH ? 'STRETCH' : 'MIN',
                                vertical: stretchV ? 'STRETCH' : 'MIN'
                            };
                        }

                        if (childCs.position === 'fixed') {
                            childNode.x = childNode.x - (node.x - window.scrollX);
                            childNode.y = childNode.y - (node.y - window.scrollY);
                        } else {
                            // For absolute/sticky, relative to parent
                            const scrollX = el.scrollLeft || 0;
                            const scrollY = el.scrollTop || 0;
                            childNode.x = childNode.x - node.x + scrollX;
                            childNode.y = childNode.y - node.y + scrollY;
                        }
                    } else {
                        // Normal flow elements
                        const scrollX = el.scrollLeft || 0;
                        const scrollY = el.scrollTop || 0;
                        childNode.x = childNode.x - node.x + scrollX;
                        childNode.y = childNode.y - node.y + scrollY;
                    }
                }
            }

            if (childNode) {
                childNode._zIndex = zIndex;
                childNode._order = orderIdx++;
                node.children.push(childNode);
            }
        }
    }

    // Sort children by z-index and DOM order
    if (node.children && node.children.length > 1) {
        node.children.sort((a, b) => {
            // When using Auto Layout, we must preserve DOM order for flow elements
            // to maintain the correct visual sequence (Top to Bottom / Left to Right).
            if (node.layoutMode) {
                const isAbsA = a.layoutPositioning === 'ABSOLUTE';
                const isAbsB = b.layoutPositioning === 'ABSOLUTE';

                // Absolute elements go to the end of the array to be on top stacking-wise
                if (isAbsA !== isAbsB) return isAbsA ? 1 : -1;

                // If both are absolute, we respect z-index among themselves
                if (isAbsA && isAbsB) {
                    const zA = a._zIndex || 0;
                    const zB = b._zIndex || 0;
                    if (zA !== zB) return zA - zB;
                }

                // Default: preserve DOM order for layout flow
                return (a._order || 0) - (b._order || 0);
            } else {
                // For standard frames, sort strictly by stacking order (painter's algorithm)
                // Bottom-most (lowest z-index) first, Top-most last.
                const zA = a._zIndex || 0;
                const zB = b._zIndex || 0;
                if (zA !== zB) return zA - zB;
                return (a._order || 0) - (b._order || 0);
            }
        });
    }
}


// ═══════════════════════════════════════════════════════════════
// TEXT HELPERS
// ═══════════════════════════════════════════════════════════════

function getDirectTextContent(el) {
    let text = '';
    for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            text += child.textContent;
        }
    }
    // Collapse consecutive whitespace and newlines, preserving single spaces
    return text.replace(/[\n\t\r]+/g, ' ').replace(/  +/g, ' ').trim();
}

function hasChildElements(el) {
    for (const child of el.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) return true;
    }
    return false;
}

/**
 * Create text node specifically for Input/Textarea/Select
 */
function createInputTextNode(el, cs, parentNode) {
    let text = '';
    let isPlaceholder = false;

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        text = el.value;
        if (!text) {
            text = el.placeholder || '';
            isPlaceholder = true;
        }
        if (el.type === 'password' && text) {
            text = '•'.repeat(Math.max(1, text.length));
        }
    } else if (el.tagName === 'SELECT') {
        const idx = el.selectedIndex;
        if (idx >= 0 && el.options.length > 0) {
            text = el.options[idx].text;
        }
    }

    if (!text) return null;

    const fontFamily = resolveFontFamily(cs.fontFamily);
    const fontStyle = getFontStyle(cs.fontWeight, cs.fontStyle);
    const fontSize = px(cs.fontSize);

    // Padding logic (Same as mergedTextNode)
    let textX = 0;
    let textY = 0;
    let textW = parentNode.width;
    let textH = parentNode.height;

    if (!parentNode.layoutMode) {
        const pt = px(cs.paddingTop);
        const pr = px(cs.paddingRight);
        const pb = px(cs.paddingBottom);
        const pl = px(cs.paddingLeft);
        textX = pl;
        textY = pt;
        textW = Math.max(1, parentNode.width - pl - pr);
        textH = Math.max(1, parentNode.height - pt - pb);
    }

    const result = {
        type: 'TEXT',
        name: isPlaceholder ? 'placeholder' : 'value',
        x: textX,
        y: textY,
        width: textW + 2, // Buffer
        height: textH,
        characters: text,
        fills: [],
        effects: [],
        fontSize: fontSize,
        fontFamily: fontFamily,
        fontStyle: fontStyle,
        textAutoResize: 'NONE', // Default
    };

    // Auto Width for single line inputs
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || (el.tagName === 'TEXTAREA' && !text.includes('\n'))) {
        if (parentNode.height < fontSize * 2.5) {
            result.textAutoResize = 'WIDTH_AND_HEIGHT';
        }
    }



    // Color
    const color = getRgba(cs.color);
    if (color) {
        const finalColor = { ...color };
        if (isPlaceholder) finalColor.a *= 0.6; // Dim placeholder

        result.fills.push({
            type: 'SOLID',
            color: { r: finalColor.r, g: finalColor.g, b: finalColor.b },
            opacity: finalColor.a
        });
    }

    // Line Height — convert to em ratio (PERCENT) like html.to.design
    const lhStr = cs.lineHeight;
    const lh = parseFloat(lhStr);
    const fontSizeVal = parseFloat(cs.fontSize);
    if (lhStr !== 'normal' && isFinite(lh) && lh > 0 && isFinite(fontSizeVal) && fontSizeVal > 0) {
        const ratio = lh / fontSizeVal * 100;
        result.lineHeight = { value: Math.round(ratio * 100) / 100, unit: 'PERCENT' };
    } else {
        result.lineHeight = { unit: 'AUTO' };
    }

    // Letter Spacing — convert to % relative to fontSize like html.to.design
    if (cs.letterSpacing !== 'normal') {
        const ls = parseFloat(cs.letterSpacing);
        if (isFinite(ls) && isFinite(fontSizeVal) && fontSizeVal > 0) {
            const percentVal = (ls / fontSizeVal) * 100;
            result.letterSpacing = { value: Math.round(percentVal * 1000) / 1000, unit: 'PERCENT' };
        }
    }

    // Alignment
    applyTextAlignment(cs, result, el, parentNode);

    // Ensure vertical centering for inputs if not detected
    if (!result.textAlignVertical) result.textAlignVertical = 'CENTER';

    return result;
}

/**
 * Create a single merged text node from all direct text in an element.
 */
function createMergedTextNode(el, cs, parentNode) {
    const text = getDirectTextContent(el);
    if (!text) return null;

    const range = document.createRange();
    range.selectNodeContents(el);
    const rect = range.getBoundingClientRect();

    const fontFamily = resolveFontFamily(cs.fontFamily);
    const fontStyle = getFontStyle(cs.fontWeight, cs.fontStyle);
    const fontSize = px(cs.fontSize);

    // Geometry-based positioning
    // We make them parent-relative.
    const parentEl = el.parentElement;
    const scrollX = parentEl ? parentEl.scrollLeft : 0;
    const scrollY = parentEl ? parentEl.scrollTop : 0;

    const result = {
        type: 'TEXT',
        name: text.substring(0, 20).trim() || 'text',
        x: Math.round(rect.left) - parentNode.x + scrollX,
        y: Math.round(rect.top) - parentNode.y + scrollY,
        width: Math.ceil(rect.width) + 1, // Minimal buffer for rounding
        height: Math.ceil(rect.height) + 1,
        characters: text,
        fills: [],
        effects: [],
        fontSize: fontSize,
        fontFamily: fontFamily,
        fontStyle: fontStyle,
        textAutoResize: 'NONE',
    };

    // Hug contents (WIDTH_AND_HEIGHT) for span as requested or single line
    // 단, text-align: center 등이 적용되어 있고 부모 컨테이너가 충분히 넓을 경우 가로 꽉 채우기(HEIGHT 모드) 유지
    const isTextAlignCenterOrRight = cs.textAlign === 'center' || cs.textAlign === 'right';
    const isSingleLine = rect.height < fontSize * 1.8;

    if (el.tagName === 'SPAN' || (isSingleLine && !isTextAlignCenterOrRight)) {
        result.textAutoResize = 'WIDTH_AND_HEIGHT';
    }

    // Color
    const color = getRgba(cs.color);
    if (color) {
        result.fills.push({
            type: 'SOLID',
            color: { r: color.r, g: color.g, b: color.b },
            opacity: color.a
        });
    }

    // Line Height — convert to em ratio (PERCENT) like html.to.design
    const mergedFontSize = parseFloat(cs.fontSize);
    result.lineHeight = parseLineHeight(cs.lineHeight, mergedFontSize);

    // Letter Spacing — convert to % relative to fontSize
    if (cs.letterSpacing !== 'normal') {
        const ls = parseFloat(cs.letterSpacing);
        if (isFinite(ls) && isFinite(mergedFontSize) && mergedFontSize > 0) {
            const percentVal = (ls / mergedFontSize) * 100;
            result.letterSpacing = { value: Math.round(percentVal * 1000) / 1000, unit: 'PERCENT' };
        }
    }

    // Alignment
    applyTextAlignment(cs, result, el, parentNode);

    // Text Transform
    applyTextTransform(cs, result);

    // Decoration
    applyTextDecoration(cs, result);

    // Text Shadow
    const textShadows = parseTextShadow(cs.textShadow);
    if (textShadows.length > 0) result.effects.push(...textShadows);

    // White space / text overflow
    if (cs.whiteSpace === 'nowrap' || cs.textOverflow === 'ellipsis') {
        result.textTruncation = 'ENDING';
    }

    return result;
}

// ═══════════════════════════════════════════════════════════════
// RICH TEXT HANDLING
// ═══════════════════════════════════════════════════════════════

function checkRichTextCandidate(el) {
    if (!hasChildElements(el)) return false; // Handled by mergedTextNode

    // Allow only inline text tags
    const allowedTags = ['B', 'STRONG', 'I', 'EM', 'U', 'SPAN', 'A', 'BR', 'CODE', 'MARK', 'SUB', 'SUP', 'SMALL'];

    // Deep check for block elements
    function hasBlockElement(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            if (!allowedTags.includes(node.tagName)) return true;
            // Treat inline tags as blocks if they have layout properties
            const display = getComputedStyle(node).display;
            if (display === 'block' || display === 'flex' ||
                display === 'inline-flex' || display === 'grid' ||
                display === 'inline-block') {
                return true; // Treat as block, do not merge into rich text
            }

            for (const child of node.childNodes) {
                if (hasBlockElement(child)) return true;
            }
        }
        return false;
    }

    for (const child of el.childNodes) {
        if (hasBlockElement(child)) return false;
    }

    return true;
}

function createRichTextNode(el, cs, parentNode) {
    let fullText = '';
    const segments = [];

    function traverse(node, currentStyle) {
        if (node.nodeType === Node.TEXT_NODE) {
            let text = node.textContent;
            if (!text) return;

            // Collapse HTML formatting newlines and spaces
            text = text.replace(/[\n\t\r]+/g, ' ').replace(/  +/g, ' ');

            // Replace spaces with non-breaking spaces to prevent wrapping
            // especially for short phrases like "Step 1"
            if (text.length < 50) {
                text = text.replace(/ /g, '\u00A0');
            }

            const start = fullText.length;
            fullText += text;
            const end = fullText.length;

            // Use current style
            segments.push({
                start,
                end,
                ...currentStyle
            });
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'BR') {
                fullText += '\n';
            } else {
                const childCs = getComputedStyle(node);
                // Calculate Figma Style Name (e.g. "Bold", "Bold Italic") immediately
                const figmaStyle = getFontStyle(childCs.fontWeight, childCs.fontStyle);

                const childFontSize = px(childCs.fontSize);
                const style = {
                    fontFamily: resolveFontFamily(childCs.fontFamily),
                    fontSize: childFontSize,
                    fontWeight: childCs.fontWeight,
                    fontStyle: figmaStyle, // Store Figma style name, not CSS font-style
                    textDecoration: childCs.textDecorationLine,
                    color: getRgba(childCs.color),
                    lineHeight: parseLineHeight(childCs.lineHeight, parseFloat(childCs.fontSize)),
                    letterSpacing: (() => {
                        if (childCs.letterSpacing === 'normal') return undefined;
                        const ls = parseFloat(childCs.letterSpacing);
                        const fs = parseFloat(childCs.fontSize);
                        if (isFinite(ls) && isFinite(fs) && fs > 0) {
                            return { value: Math.round((ls / fs) * 100 * 1000) / 1000, unit: 'PERCENT' };
                        }
                        return isFinite(ls) ? ls : undefined;
                    })()
                };

                for (const child of node.childNodes) {
                    traverse(child, style);
                }
            }
        }
    }

    const rootFontSize = px(cs.fontSize);
    const rootStyle = {
        fontFamily: resolveFontFamily(cs.fontFamily),
        fontSize: rootFontSize,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        textDecoration: cs.textDecorationLine,
        color: getRgba(cs.color),
        lineHeight: parseLineHeight(cs.lineHeight, parseFloat(cs.fontSize)),
        letterSpacing: (() => {
            if (cs.letterSpacing === 'normal') return undefined;
            const ls = parseFloat(cs.letterSpacing);
            const fs = parseFloat(cs.fontSize);
            if (isFinite(ls) && isFinite(fs) && fs > 0) {
                return { value: Math.round((ls / fs) * 100 * 1000) / 1000, unit: 'PERCENT' };
            }
            return isFinite(ls) ? ls : undefined;
        })()
    };

    // Traverse children
    for (const child of el.childNodes) {
        traverse(child, rootStyle);
    }

    // Simplify segments (merge adjacent identical segments is optional, but Figma handles per-range so it's fine)
    const validSegments = segments.filter(s => s.start < s.end);

    // Padding logic (Same as mergedTextNode)
    let textX = 0;
    let textY = 0;
    let textW = parentNode.width;
    let textH = parentNode.height;

    if (!parentNode.layoutMode) {
        const pt = px(cs.paddingTop);
        const pr = px(cs.paddingRight);
        const pb = px(cs.paddingBottom);
        const pl = px(cs.paddingLeft);
        textX = pl;
        textY = pt;
        textW = Math.max(1, parentNode.width - pl - pr);
        textH = Math.max(1, parentNode.height - pt - pb);
    }

    const isSingleLine = textH < px(cs.fontSize) * 1.8;
    const isHeading = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(el.tagName);

    // Auto Resize Logic
    let autoResize = 'HEIGHT';
    if (el.tagName === 'SPAN' || isSingleLine || isHeading) {
        autoResize = 'WIDTH_AND_HEIGHT'; // Prevent wrap on short elements and headings
    }

    const richNode = {
        type: 'RICH_TEXT',
        name: fullText.substring(0, 20).trim() || 'rich-text',
        x: textX,
        y: textY,
        width: Math.ceil(textW) + 1, // Minimal buffer for rounding
        height: textH,
        characters: fullText,
        segments: validSegments,
        textAutoResize: autoResize,
        textAlignHorizontal: 'LEFT', // Default, will be updated by applyTextAlignment
        textAlignVertical: 'TOP',    // Default, will be updated by applyTextAlignment
        // Root range properties (fallback)
        fontSize: px(cs.fontSize),
        fontFamily: rootStyle.fontFamily,
        effects: [], // Initialize effects array
    };

    // Apply sophisticated alignment logic
    applyTextAlignment(cs, richNode, el, parentNode);

    return richNode;
}

/**
 * Capture a single text node
 */
function captureTextNode(textNode, parentEl, parentCs, parentNode) {
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rect = range.getBoundingClientRect();
    range.detach();

    // Collapse whitespace properly
    let text = textNode.textContent.replace(/[\n\t\r]+/g, ' ').replace(/  +/g, ' ').trim();
    if (!text) return null;

    if (text.length < 50) {
        text = text.replace(/ /g, '\u00A0');
    }

    let x = Math.round(rect.left) - parentNode.x;
    let y = Math.round(rect.top) - parentNode.y;
    let widthVal = Math.max(1, Math.ceil(rect.width)); // Buffer removed
    let heightVal = Math.max(1, Math.round(rect.height));

    // Fallback if size is 0 but text exists
    if (rect.width <= 0 || rect.height <= 0) {
        x = 0;
        y = 0;
        widthVal = parentNode.width;
        heightVal = Math.max(heightVal, px(parentCs.fontSize) + 4);
    }

    const fontFamily = resolveFontFamily(parentCs.fontFamily);
    const fontStyle = getFontStyle(parentCs.fontWeight, parentCs.fontStyle);

    const result = {
        type: 'TEXT',
        name: text.substring(0, 20).trim() || 'text',
        x: x,
        y: y,
        width: widthVal,
        height: heightVal,
        characters: text,
        fills: [],
        effects: [],
        fontSize: px(parentCs.fontSize),
        fontFamily: fontFamily,
        fontStyle: fontStyle,
    };

    const color = getRgba(parentCs.color);
    if (color) {
        result.fills.push({
            type: 'SOLID',
            color: { r: color.r, g: color.g, b: color.b },
            opacity: color.a
        });
    }

    // Line Height — convert to em ratio (PERCENT) like html.to.design
    const textFontSize = parseFloat(parentCs.fontSize);
    const lhStr = parentCs.lineHeight;
    const lh = parseFloat(lhStr);
    if (lhStr !== 'normal' && isFinite(lh) && lh > 0 && isFinite(textFontSize) && textFontSize > 0) {
        const ratio = lh / textFontSize * 100;
        result.lineHeight = { value: Math.round(ratio * 100) / 100, unit: 'PERCENT' };
    } else {
        result.lineHeight = { unit: 'AUTO' };
    }

    // Letter Spacing — convert to % relative to fontSize
    if (parentCs.letterSpacing !== 'normal') {
        const ls = parseFloat(parentCs.letterSpacing);
        if (isFinite(ls) && isFinite(textFontSize) && textFontSize > 0) {
            const percentVal = (ls / textFontSize) * 100;
            result.letterSpacing = { value: Math.round(percentVal * 1000) / 1000, unit: 'PERCENT' };
        }
    }

    // Alignment
    applyTextAlignment(parentCs, result, parentEl, parentNode);

    // Text Transform
    applyTextTransform(parentCs, result);

    // Decoration
    applyTextDecoration(parentCs, result);

    // Text Shadow
    const textShadows = parseTextShadow(parentCs.textShadow);
    if (textShadows.length > 0) result.effects.push(...textShadows);

    // Standalone text nodes use HEIGHT auto-resize
    result.textAutoResize = 'HEIGHT';

    return result;
}

// ═══════════════════════════════════════════════════════════════
// TEXT STYLE HELPERS
// ═══════════════════════════════════════════════════════════════

function applyTextAlignment(cs, result, el, parentNode) {
    // Horizontal alignment
    const align = cs.textAlign;
    if (align === 'center') result.textAlignHorizontal = 'CENTER';
    else if (align === 'right' || align === 'end') result.textAlignHorizontal = 'RIGHT';
    else if (align === 'justify') result.textAlignHorizontal = 'JUSTIFIED';
    else result.textAlignHorizontal = 'LEFT';

    // ─── Vertical alignment detection ───
    // Method 1: display:flex + align-items:center
    const display = cs.display;
    const alignItems = cs.alignItems;
    if ((display === 'flex' || display === 'inline-flex') &&
        (alignItems === 'center')) {
        result.textAlignVertical = 'CENTER';
        return;
    }

    // Method 2: line-height equals element height (single-line centering trick)
    if (el && parentNode) {
        const lh = parseFloat(cs.lineHeight);
        const elH = parentNode.height;
        if (isFinite(lh) && elH > 0 && Math.abs(lh - elH) < 4) {
            result.textAlignVertical = 'CENTER';
            return;
        }
    }

    // Method 3: equal top/bottom padding (visual centering)
    const pt = px(cs.paddingTop);
    const pb = px(cs.paddingBottom);
    if (pt > 0 && pb > 0 && Math.abs(pt - pb) <= 2) {
        result.textAlignVertical = 'CENTER';
        return;
    }

    // Method 4: button, a, input tags default to center
    if (el) {
        const tag = el.tagName;
        if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT') {
            result.textAlignVertical = 'CENTER';
            return;
        }
    }

    // Method 5: vertical-align
    const vAlign = cs.verticalAlign;
    if (vAlign === 'middle') {
        result.textAlignVertical = 'CENTER';
        return;
    }
    if (vAlign === 'bottom' || vAlign === 'text-bottom') {
        result.textAlignVertical = 'BOTTOM';
        return;
    }

    // Default: TOP
    result.textAlignVertical = 'TOP';
}

function applyTextTransform(cs, result) {
    if (cs.textTransform === 'uppercase') result.textCase = 'UPPER';
    else if (cs.textTransform === 'lowercase') result.textCase = 'LOWER';
    else if (cs.textTransform === 'capitalize') result.textCase = 'TITLE';
}

function applyTextDecoration(cs, result) {
    const deco = cs.textDecorationLine || cs.textDecoration;
    if (deco && deco.includes('underline')) result.textDecoration = 'UNDERLINE';
    else if (deco && deco.includes('line-through')) result.textDecoration = 'STRIKETHROUGH';
}

// ═══════════════════════════════════════════════════════════════
// SVG CAPTURE
// ═══════════════════════════════════════════════════════════════

function captureSvg(svgEl, parentNode) {
    const rect = svgEl.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;

    // Clone and inline computed styles for correct colors
    try {
        const clone = svgEl.cloneNode(true);
        const stylesToInline = ['fill', 'stroke', 'stroke-width', 'color', 'opacity'];

        function inlineSvgStyles(source, target) {
            const computed = getComputedStyle(source);
            for (const prop of stylesToInline) {
                const val = computed[prop];
                if (val && val !== '0px' && val !== 'auto' && val !== 'rgba(0, 0, 0, 0)') {
                    if ((prop === 'fill' || prop === 'stroke') && val === 'none') continue;
                    target.style[prop] = val;
                }
            }
            // Handle currentColor
            if (target.getAttribute('fill') === 'currentColor') {
                target.setAttribute('fill', computed.color || 'black');
            }
            if (target.getAttribute('stroke') === 'currentColor') {
                target.setAttribute('stroke', computed.color || 'black');
            }
            // Inherit stroke from CSS color if not explicitly set
            if (!target.getAttribute('stroke') && !target.style.stroke) {
                const computedStroke = computed.stroke;
                if (computedStroke && computedStroke !== 'none') {
                    target.style.stroke = computedStroke;
                }
            }
        }

        inlineSvgStyles(svgEl, clone);
        const sourceDescendants = svgEl.querySelectorAll('*');
        const targetDescendants = clone.querySelectorAll('*');
        for (let i = 0; i < sourceDescendants.length; i++) {
            inlineSvgStyles(sourceDescendants[i], targetDescendants[i]);
        }

        // Ensure dimensions
        const cs = getComputedStyle(svgEl);
        if (!clone.getAttribute('width') && cs.width) clone.setAttribute('width', cs.width);
        if (!clone.getAttribute('height') && cs.height) clone.setAttribute('height', cs.height);

        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(clone);

        return {
            type: 'SVG',
            name: buildName(svgEl),
            x: Math.round(rect.left) - parentNode.x,
            y: Math.round(rect.top) - parentNode.y,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            svgString: svgString,
        };
    } catch (e) {
        console.warn('captureSvg: failed to inline styles, using raw outerHTML', e);
        return {
            type: 'SVG',
            name: buildName(svgEl),
            x: Math.round(rect.left) - parentNode.x,
            y: Math.round(rect.top) - parentNode.y,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            svgString: svgEl.outerHTML,
        };
    }
}

// ═══════════════════════════════════════════════════════════════
// DOWNLOAD
// ═══════════════════════════════════════════════════════════════

function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
// ═══════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════

function parseLineHeight(str, fontSize) {
    const val = parseFloat(str);
    if (str !== 'normal' && isFinite(val) && val > 0) {
        // If fontSize is provided, convert to em ratio (PERCENT) like html.to.design
        if (fontSize && fontSize > 0) {
            const ratio = val / fontSize * 100;
            return { value: Math.round(ratio * 100) / 100, unit: 'PERCENT' };
        }
        return { value: val, unit: 'PIXELS' };
    }
    return { unit: 'AUTO' };
}

function mapTextAlign(align) {
    if (align === 'center') return 'CENTER';
    if (align === 'right' || align === 'end') return 'RIGHT';
    if (align === 'justify') return 'JUSTIFIED';
    return 'LEFT';
}

function mapTextAlignVertical(align) {
    if (align === 'middle') return 'CENTER';
    if (align === 'bottom' || align === 'text-bottom') return 'BOTTOM';
    return 'TOP';
}

function parseSpreadFromBoxShadow(str) {
    if (!str || str === 'none') return 0;

    // Split comma separated shadows, respecting parentheses
    const shadows = str.split(/,(?![^(]*\))/);
    let maxSpread = 0;

    for (const shadow of shadows) {
        if (shadow.includes('inset')) continue; // Drop Shadow only

        let cleaner = shadow
            .replace(/rgba?\([^)]+\)/gi, '')
            .replace(/hsla?\([^)]+\)/gi, '')
            .replace(/#[0-9a-fA-F]+/g, '');

        const lengths = cleaner.match(/-?[\d.]+(?:px|em|rem|%)?/g);

        // Expected order: x, y, blur, spread.
        // If 4 lengths found, 4th is spread.
        if (lengths && lengths.length >= 4) {
            const spread = parseFloat(lengths[3]);
            if (!isNaN(spread) && spread > maxSpread) {
                maxSpread = spread;
            }
        }
    }
    return maxSpread;
}
