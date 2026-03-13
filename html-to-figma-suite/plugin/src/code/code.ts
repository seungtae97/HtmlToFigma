figma.showUI(__html__, { width: 400, height: 300 });

figma.ui.onmessage = async (msg) => {
    if (msg.type === 'import-json') {
        console.log('--- FIGMA-PLUGIN V2.2 [DEBUG] ---');
        const data = msg.data;
        await handleImportFiles([{ name: 'Imported Page', content: data }]);
    } else if (msg.type === 'import-files') {
        const files = msg.data;
        await handleImportFiles(files);
    }
};

async function handleImportFiles(files: { name: string, content: any }[]) {
    try {
        // Collect and load all fonts from all files first
        const fontPromises = files.map(f => loadAllFonts(f.content));
        await Promise.all(fontPromises);

        // Create Styles and Variables from CSS Variables
        for (const file of files) {
            if (file.content.variables) {
                await processVariables(file.content.variables);
            }
        }

        const createdSections: SectionNode[] = [];
        let nextX = Math.round(figma.viewport.center.x);
        const startY = Math.round(figma.viewport.center.y);
        const SPACING = 100;

        // If it's the first import, we might want to start from a clean position?
        // But respecting viewport center is good for UX.

        for (const file of files) {
            // Create a Figma Section to contain everything
            const section = figma.createSection();

            // Name section based on metadata if available
            let sectionName = file.name || 'Imported Page';
            const meta = file.content.meta;
            if (meta && meta.url && meta.time) {
                try {
                    const date = new Date(meta.time);
                    const timeStr = date.getFullYear() + '/' +
                        String(date.getMonth() + 1).padStart(2, '0') + '/' +
                        String(date.getDate()).padStart(2, '0') + ' , ' +
                        String(date.getHours()).padStart(2, '0') + ':' +
                        String(date.getMinutes()).padStart(2, '0') + ':' +
                        String(date.getSeconds()).padStart(2, '0');
                    sectionName = `${meta.url} (${timeStr})`;
                } catch (e) {
                    // Fallback to file name if date parsing fails
                }
            }
            section.name = sectionName;

            // Build the layer tree
            const data = file.content;
            const layers = Array.isArray(data) ? data : [data];

            for (const layerData of layers) {
                const node = await createLayer(layerData);
                if (node) {
                    section.appendChild(node);

                    // HYBRID APPROACH: Respect the layoutMode sent from content.js
                    // If content.js sends layoutMode=undefined (NONE), it means it should be a fixed frame with absolute children.
                    // Do NOT force Auto Layout here.
                }
            }

            // Resize section to fit content
            const children = section.children;
            if (children.length > 0) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const child of children) {
                    minX = Math.min(minX, child.x);
                    minY = Math.min(minY, child.y);
                    maxX = Math.max(maxX, child.x + child.width);
                    maxY = Math.max(maxY, child.y + child.height);
                }

                const contentW = maxX - minX;
                const contentH = maxY - minY;
                const sectionPadding = 100;
                const sectionW = contentW + sectionPadding * 2;
                const sectionH = contentH + sectionPadding * 2;

                section.resizeWithoutConstraints(sectionW, sectionH);

                // Position section
                section.x = nextX;
                section.y = startY - (sectionH / 2); // Center vertically relative to start Y

                // Center content horizontally/vertically within section
                const shiftX = (sectionW - contentW) / 2 - minX;
                const shiftY = sectionPadding - minY;

                for (const child of children) {
                    child.x += shiftX;
                    child.y += shiftY;
                }
            } else {
                section.resizeWithoutConstraints(2200, 1400);
                section.x = nextX;
                section.y = startY;
            }

            // Update nextX for next section
            nextX += section.width + SPACING;
            createdSections.push(section);
        }

        if (createdSections.length > 0) {
            figma.currentPage.selection = createdSections;
            figma.viewport.scrollAndZoomIntoView(createdSections);
            figma.notify(`✅ Imported ${files.length} design(s)!`);
        }
    } catch (err: any) {
        console.error('Import error:', err);
        figma.notify('❌ Import error: ' + err.message, { error: true });
    }
}

// ─── System Font Mapping ───────────────────────────────────

const SYSTEM_FONT_ALIASES: Record<string, string> = {
    '-apple-system': 'Inter',
    'blinkmacfont': 'Inter',
    'blinkmacfontsystem': 'Inter',
    'system-ui': 'Inter',
    'segoe ui': 'Inter',
    'helvetica neue': 'Inter',
    'helvetica': 'Inter',
    'arial': 'Inter',
    'sans-serif': 'Inter',
    'serif': 'Inter',
    'monospace': 'Inter',
    'ui-sans-serif': 'Inter',
    'ui-serif': 'Inter',
    'cursive': 'Inter',
    'fantasy': 'Inter',
    'verdana': 'Inter',
    'tahoma': 'Inter',
    'geneva': 'Inter',
    'apple color emoji': 'Inter',
    'segoe ui emoji': 'Inter',
    'noto color emoji': 'Inter',
    // Korean system fonts
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
    'apple sd gothic neo': 'Noto Sans KR',
    // Japanese system fonts
    'ms pgothic': 'Noto Sans JP',
    'ms gothic': 'Noto Sans JP',
    'meiryo': 'Noto Sans JP',
    'hiragino kaku gothic pro': 'Noto Sans JP',
    // Chinese system fonts
    'microsoft yahei': 'Noto Sans SC',
    'simsun': 'Noto Sans SC',
    'simhei': 'Noto Sans SC',
};

function resolveFont(family: string): string {
    if (!family) return 'Inter';
    const lower = family.toLowerCase().trim();
    return SYSTEM_FONT_ALIASES[lower] || family;
}

// ─── Font Loading ──────────────────────────────────────────

async function loadAllFonts(data: any) {
    const fontSet = new Set<string>();

    function collectFonts(node: any) {
        if (node.type === 'TEXT') {
            const family = resolveFont(node.fontFamily || 'Inter');
            const style = node.fontStyle || 'Regular';
            fontSet.add(JSON.stringify({ family, style }));
        }
        if (node.children) {
            for (const child of node.children) {
                collectFonts(child);
            }
        }
    }

    if (Array.isArray(data)) data.forEach(collectFonts);
    else collectFonts(data);

    // Always load Inter variants as fallback
    const interStyles = ['Regular', 'Bold', 'Medium', 'SemiBold', 'Light',
        'Italic', 'Bold Italic', 'Medium Italic'];
    for (const style of interStyles) {
        try {
            await figma.loadFontAsync({ family: 'Inter', style });
        } catch { }
    }

    // Pre-load Noto Sans KR for Korean content
    const notoStyles = ['Regular', 'Bold', 'Medium', 'Light'];
    for (const style of notoStyles) {
        try {
            await figma.loadFontAsync({ family: 'Noto Sans KR', style });
        } catch { }
    }
    // Pre-load Noto Serif KR
    for (const style of ['Regular', 'Bold']) {
        try {
            await figma.loadFontAsync({ family: 'Noto Serif KR', style });
        } catch { }
    }

    // Try to load all collected fonts
    for (const fontStr of fontSet) {
        const { family, style } = JSON.parse(fontStr);
        try {
            await figma.loadFontAsync({ family, style });
        } catch {
            // Try without italic modifier
            const baseStyle = style.replace(' Italic', '').replace('Italic', 'Regular');
            try {
                await figma.loadFontAsync({ family, style: baseStyle });
            } catch {
                console.warn(`Font not available: ${family} ${style}`);
            }
        }
    }
}

// ─── Layer Creation ────────────────────────────────────────

async function createLayer(data: any): Promise<SceneNode | null> {
    if (!data) return null;

    switch (data.type) {
        case 'TEXT':
            return createTextNode(data);
        case 'RICH_TEXT':
            return createRichTextNode(data);
        case 'SVG':
            return createSvgNode(data);
        default:
            return createFrameNode(data);
    }
}

// ─── Frame / Rectangle Node ───────────────────────────────

async function createFrameNode(data: any): Promise<SceneNode | null> {
    const hasChildren = data.children && data.children.length > 0;

    if (hasChildren || data.layoutMode) {
        const frame = figma.createFrame();
        frame.name = data.name || 'frame';

        if (typeof data.x === 'number') frame.x = data.x;
        if (typeof data.y === 'number') frame.y = data.y;

        if (!data.layoutMode && data.width && data.height) {
            frame.resize(Math.max(1, data.width), Math.max(1, data.height));
        }

        if (typeof data.rotation === 'number') frame.rotation = data.rotation;
        if (data.blendMode) frame.blendMode = data.blendMode as BlendMode;

        await applyFills(frame, data);
        applyStrokes(frame, data);
        applyCornerRadius(frame, data);
        applyEffects(frame, data);

        if (typeof data.opacity === 'number') frame.opacity = data.opacity;
        if (typeof data.clipsContent === 'boolean') frame.clipsContent = data.clipsContent;
        else if (data.clipsContent) frame.clipsContent = true;

        // Auto Layout
        if (data.layoutMode) {
            frame.layoutMode = data.layoutMode;
            // Resize BEFORE setting SizingMode to AUTO to avoid errors
            if (data.width && data.height) {
                try {
                    frame.resize(Math.max(1, data.width), Math.max(1, data.height));
                } catch (e) { /* Ignore resize errors if constraints conflict */ }
            }

            if (data.primaryAxisAlignItems) frame.primaryAxisAlignItems = data.primaryAxisAlignItems;
            if (data.counterAxisAlignItems) frame.counterAxisAlignItems = data.counterAxisAlignItems;
            if (data.layoutWrap) frame.layoutWrap = data.layoutWrap;
            if (typeof data.itemSpacing === 'number') frame.itemSpacing = data.itemSpacing;
            if (typeof data.counterAxisSpacing === 'number') {
                (frame as any).counterAxisSpacing = data.counterAxisSpacing;
            }

            if (data.layoutMode === 'GRID') {
                if (typeof data.gridRowCount === 'number') (frame as any).gridRowCount = data.gridRowCount;
                if (typeof data.gridColumnCount === 'number') (frame as any).gridColumnCount = data.gridColumnCount;
                if (typeof data.gridRowGap === 'number') (frame as any).gridRowGap = data.gridRowGap;
                if (typeof data.gridColumnGap === 'number') (frame as any).gridColumnGap = data.gridColumnGap;
            }

            if (typeof data.paddingTop === 'number') frame.paddingTop = Math.max(0, data.paddingTop);
            if (typeof data.paddingRight === 'number') frame.paddingRight = Math.max(0, data.paddingRight);
            if (typeof data.paddingBottom === 'number') frame.paddingBottom = Math.max(0, data.paddingBottom);
            if (typeof data.paddingLeft === 'number') frame.paddingLeft = Math.max(0, data.paddingLeft);

            // Sizing Modes (Set LAST)
            if (data.primaryAxisSizingMode) frame.primaryAxisSizingMode = data.primaryAxisSizingMode;
            if (data.counterAxisSizingMode) frame.counterAxisSizingMode = data.counterAxisSizingMode;

            // Re-apply resize one more time if sizing modes are fixed (to ensure Figma respects bounds)
            if (data.width && data.height && frame.primaryAxisSizingMode === 'FIXED' && frame.counterAxisSizingMode === 'FIXED') {
                try {
                    frame.resize(Math.max(1, data.width), Math.max(1, data.height));
                } catch (e) { }
            }
        }

        // Children - Sorted by _order and _zIndex
        if (data.children && Array.isArray(data.children)) {
            const sortedChildren = [...data.children].sort((a, b) => {
                if ((a._order || 0) !== (b._order || 0)) return (a._order || 0) - (b._order || 0);
                return (a._zIndex || 0) - (b._zIndex || 0);
            });

            for (const childData of sortedChildren) {
                const childNode = await createLayer(childData);
                if (childNode) {
                    (frame as FrameNode).appendChild(childNode);
                    if (data.layoutMode && childNode.type !== 'SECTION') {
                        if (childData.layoutGrow === 1) (childNode as any).layoutGrow = 1;

                        // Absolute Positioning (Must check first to conditionally skip layoutAlign)
                        let isAbsolute = false;
                        if (childData.layoutPositioning === 'ABSOLUTE') {
                            (childNode as any).layoutPositioning = 'ABSOLUTE';
                            isAbsolute = true;
                            // Restore absolute coordinates
                            if (typeof childData.x === 'number') childNode.x = childData.x;
                            if (typeof childData.y === 'number') childNode.y = childData.y;

                            // Apply physical constraints (e.g. STRETCH for full backgrounds)
                            if (childData.constraints) {
                                (childNode as any).constraints = childData.constraints;
                            }
                        }

                        // Align properties shouldn't be set on ABSOLUTE positioned nodes in Figma
                        if (childData.layoutAlign && !isAbsolute) {
                            const validAligns = ['STRETCH', 'MIN', 'CENTER', 'MAX', 'INHERIT'];
                            if (validAligns.includes(childData.layoutAlign)) {
                                (childNode as any).layoutAlign = childData.layoutAlign;
                            }
                        }

                        if (data.layoutMode === 'GRID' && !isAbsolute) {
                            try {
                                if (typeof childData.gridRowSpan === 'number') {
                                    (childNode as any).gridRowSpan = childData.gridRowSpan;
                                }
                                if (typeof childData.gridColumnSpan === 'number') {
                                    (childNode as any).gridColumnSpan = childData.gridColumnSpan;
                                }
                            } catch (e) {
                                console.warn('Failed to set grid span', e);
                            }
                            if (childData.gridChildHorizontalAlign) {
                                (childNode as any).gridChildHorizontalAlign = childData.gridChildHorizontalAlign;
                            }
                            if (childData.gridChildVerticalAlign) {
                                (childNode as any).gridChildVerticalAlign = childData.gridChildVerticalAlign;
                            }
                        }
                    } else if (!data.layoutMode && childNode.type !== 'SECTION') {
                        // 일반 프레임 자식이면 appendChild 이후에 좌표를 확실히 복원
                        if (typeof childData.x === 'number') childNode.x = childData.x;
                        if (typeof childData.y === 'number') childNode.y = childData.y;

                        // 일반 프레임 안의 자식에게는 layoutAlign, layoutPositioning 등 AutoLayout 전용 속성을 설정하면 에러가 날 수 있음.
                        // content.js 에서 잘못 들어왔을 경우를 대비한 방어 로직 제거
                    }
                }
            }
        }

        return frame;
    } else {
        const rect = figma.createRectangle();
        rect.name = data.name || 'rect';

        if (typeof data.x === 'number') rect.x = data.x;
        if (typeof data.y === 'number') rect.y = data.y;
        if (data.width && data.height) {
            rect.resize(Math.max(1, data.width), Math.max(1, data.height));
        }

        if (typeof data.rotation === 'number') rect.rotation = data.rotation;
        if (data.blendMode) rect.blendMode = data.blendMode as BlendMode;

        await applyFills(rect, data);
        applyStrokes(rect, data);
        applyCornerRadius(rect, data);
        applyEffects(rect, data);

        if (typeof data.opacity === 'number') rect.opacity = data.opacity;
        return rect;
    }
}

// ─── Text Node ─────────────────────────────────────────────

async function createTextNode(data: any): Promise<SceneNode | null> {
    const textNode = figma.createText();
    textNode.name = data.name || 'text';

    if (typeof data.x === 'number') textNode.x = data.x;
    if (typeof data.y === 'number') textNode.y = data.y;

    // Resolve font with fallback chain
    const resolvedFamily = resolveFont(data.fontFamily);
    const style = data.fontStyle || 'Regular';

    let fontLoaded = false;
    // Try resolved font first
    try {
        await figma.loadFontAsync({ family: resolvedFamily, style });
        textNode.fontName = { family: resolvedFamily, style };
        fontLoaded = true;
    } catch {
        // Try just Regular style of the font
        try {
            await figma.loadFontAsync({ family: resolvedFamily, style: 'Regular' });
            textNode.fontName = { family: resolvedFamily, style: 'Regular' };
            fontLoaded = true;
        } catch {
            // Try Inter with same style
            try {
                await figma.loadFontAsync({ family: 'Inter', style });
                textNode.fontName = { family: 'Inter', style };
                fontLoaded = true;
            } catch {
                // Final fallback: Inter Regular
                try {
                    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
                    textNode.fontName = { family: 'Inter', style: 'Regular' };
                    fontLoaded = true;
                } catch { }
            }
        }
    }

    // Set characters
    if (data.characters) {
        textNode.characters = data.characters;
    }

    // Size — respect the autoResize strategy from content.js
    if (data.width && data.height) {
        textNode.resize(Math.max(1, data.width), Math.max(1, data.height));
        // NONE: For merged text that fills parent (buttons, spans) — keeps exact size + uses textAlignVertical
        // HEIGHT: For standalone text nodes — width fixed, height auto-expands
        textNode.textAutoResize = data.textAutoResize || 'HEIGHT';
    }

    // Font Size
    if (typeof data.fontSize === 'number') textNode.fontSize = data.fontSize;

    // Fills
    if (data.fills && Array.isArray(data.fills) && data.fills.length > 0) {
        const validFills = data.fills.filter((f: any) => f.type === 'SOLID' || f.type === 'GRADIENT_LINEAR');
        if (validFills.length > 0) textNode.fills = validFills;
    }

    // Letter Spacing
    if (data.letterSpacing) {
        if (typeof data.letterSpacing === 'object') textNode.letterSpacing = data.letterSpacing;
        else if (typeof data.letterSpacing === 'number') {
            textNode.letterSpacing = { value: data.letterSpacing, unit: 'PIXELS' };
        }
    }

    // Line Height
    if (data.lineHeight) {
        if (typeof data.lineHeight === 'number') {
            textNode.lineHeight = { value: data.lineHeight, unit: 'PIXELS' };
        } else if (data.lineHeight.unit) {
            textNode.lineHeight = data.lineHeight;
        }
    }

    // Alignment
    if (data.textAlignHorizontal) textNode.textAlignHorizontal = data.textAlignHorizontal;
    if (data.textAlignVertical) textNode.textAlignVertical = data.textAlignVertical;
    if (data.textDecoration) textNode.textDecoration = data.textDecoration;
    if (data.textCase) textNode.textCase = data.textCase;

    // Text truncation
    if (data.textTruncation) {
        (textNode as any).textTruncation = data.textTruncation;
    }

    // Effects (text-shadow etc.)
    applyEffects(textNode, data);

    // Transforms
    if (typeof data.rotation === 'number') textNode.rotation = data.rotation;
    if (typeof data.opacity === 'number') textNode.opacity = data.opacity;

    return textNode;
}

// ═══════════════════════════════════════════════════════════════
// RICH TEXT NODE
// ═══════════════════════════════════════════════════════════════

async function createRichTextNode(data: any): Promise<SceneNode | null> {
    const textNode = figma.createText();
    textNode.name = data.name || 'rich-text';

    if (typeof data.x === 'number') textNode.x = data.x;
    if (typeof data.y === 'number') textNode.y = data.y;

    // Load Fallback Font
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

    // 1. Collect all unique fonts needed
    const uniqueFonts = new Set<string>();
    if (data.segments) {
        for (const s of data.segments) {
            const family = resolveFont(s.fontFamily);
            const style = s.fontStyle || 'Regular';
            uniqueFonts.add(JSON.stringify({ family, style }));
        }
    }
    // Also add root font
    const rootFamily = resolveFont(data.fontFamily);
    uniqueFonts.add(JSON.stringify({ family: rootFamily, style: 'Regular' }));

    // 2. Load all fonts
    for (const f of uniqueFonts) {
        try {
            const font = JSON.parse(f);
            await figma.loadFontAsync(font);
        } catch (e) {
            console.warn('Failed to load font', f);
        }
    }

    // 3. Set Characters
    textNode.characters = data.characters || '';

    // 4. Resize strategy
    if (data.width && data.height) {
        textNode.resize(Math.max(1, data.width), Math.max(1, data.height));
        textNode.textAutoResize = data.textAutoResize || 'HEIGHT';
    }

    // 5. Apply Styles per Segment
    if (data.segments) {
        for (const s of data.segments) {
            const start = s.start;
            const end = s.end;
            if (start >= end) continue;
            if (end > textNode.characters.length) continue;

            const family = resolveFont(s.fontFamily);
            const style = s.fontStyle || 'Regular';

            // Font
            try {
                textNode.setRangeFontName(start, end, { family, style });
            } catch (e) {
                // Fallback to Inter Regular if specific font failed
                try {
                    textNode.setRangeFontName(start, end, { family: 'Inter', style: 'Regular' });
                } catch { }
            }

            // Size
            if (s.fontSize) textNode.setRangeFontSize(start, end, s.fontSize);

            // Color
            if (s.color) {
                textNode.setRangeFills(start, end, [{
                    type: 'SOLID',
                    color: { r: s.color.r, g: s.color.g, b: s.color.b },
                    opacity: s.color.a
                }]);
            }

            // Decoration
            if (s.textDecoration) {
                if (s.textDecoration.includes('underline')) textNode.setRangeTextDecoration(start, end, 'UNDERLINE');
                else if (s.textDecoration.includes('line-through')) textNode.setRangeTextDecoration(start, end, 'STRIKETHROUGH');
                else textNode.setRangeTextDecoration(start, end, 'NONE');
            }

            // Line Height
            if (s.lineHeight) {
                if (typeof s.lineHeight === 'number') {
                    textNode.setRangeLineHeight(start, end, { value: s.lineHeight, unit: 'PIXELS' });
                } else if (s.lineHeight.unit) {
                    textNode.setRangeLineHeight(start, end, s.lineHeight);
                }
            }

            // Letter Spacing
            if (s.letterSpacing) {
                if (typeof s.letterSpacing === 'object' && s.letterSpacing.unit) {
                    textNode.setRangeLetterSpacing(start, end, s.letterSpacing);
                } else if (typeof s.letterSpacing === 'number') {
                    textNode.setRangeLetterSpacing(start, end, { value: s.letterSpacing, unit: 'PIXELS' });
                }
            }
        }
    }

    // Alignment
    if (data.textAlignHorizontal) textNode.textAlignHorizontal = data.textAlignHorizontal;
    if (data.textAlignVertical) textNode.textAlignVertical = data.textAlignVertical;

    // Effects
    applyEffects(textNode, data);

    // Transforms
    if (typeof data.rotation === 'number') textNode.rotation = data.rotation;
    if (typeof data.opacity === 'number') textNode.opacity = data.opacity;

    return textNode;
}

// ─── SVG Node ──────────────────────────────────────────────

function createSvgNode(data: any): SceneNode | null {
    if (!data.svgString) return null;

    try {
        const node = figma.createNodeFromSvg(data.svgString);
        node.name = data.name || 'svg';

        // Initial positioning
        if (typeof data.x === 'number') node.x = data.x;
        if (typeof data.y === 'number') node.y = data.y;

        // Resize to match bounding box from browser
        if (data.width && data.height) {
            node.resize(Math.max(1, data.width), Math.max(1, data.height));
        }

        if (typeof data.rotation === 'number') node.rotation = data.rotation;

        // Ensure vector contents stretch if the node is resized later
        if (node.type === 'FRAME' || node.type === 'GROUP') {
            for (const child of (node as any).children) {
                if (child.type === 'VECTOR' || child.type === 'BOOLEAN_OPERATION') {
                    child.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' };
                }
            }
        }

        return node;
    } catch (e) {
        console.warn('Failed to create SVG node', e);
        return null;
    }
}

// ─── Style Helpers ─────────────────────────────────────────

async function applyFills(node: GeometryMixin & SceneNode, data: any) {
    // CRITICAL: Clear default Figma fills when data has no fills
    if (!data.fills || !Array.isArray(data.fills) || data.fills.length === 0) {
        (node as any).fills = [];
        return;
    }

    const newFills: Paint[] = [];

    for (const f of data.fills) {
        if (f.type === 'SOLID') {
            newFills.push({
                type: 'SOLID',
                color: f.color,
                opacity: f.opacity ?? 1,
            });
        } else if (f.type === 'IMAGE' && f.imageData) {
            // Base64 image support
            try {
                const base64Data = f.imageData.split(',')[1]; // Remove data:image/...;base64, prefix
                if (base64Data) {
                    const bytes = figma.base64Decode(base64Data);
                    const image = figma.createImage(bytes);
                    newFills.push({
                        type: 'IMAGE',
                        imageHash: image.hash,
                        scaleMode: f.scaleMode || 'FILL',
                    } as ImagePaint);
                }
            } catch (e) {
                console.warn('Failed to create image from base64', e);
            }
        } else if (f.type === 'GRADIENT_LINEAR') {
            if (f.gradientStops) {
                // Calculate gradient transform from angle
                const angle = f.gradientAngle ?? 180;
                const rad = (angle - 90) * Math.PI / 180;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);

                newFills.push({
                    type: 'GRADIENT_LINEAR',
                    gradientStops: f.gradientStops,
                    gradientTransform: [
                        [cos, sin, 0.5 - cos * 0.5 - sin * 0.5],
                        [-sin, cos, 0.5 + sin * 0.5 - cos * 0.5]
                    ],
                });
            }
        } else if (f.type === 'GRADIENT_RADIAL') {
            if (f.gradientStops) {
                newFills.push({
                    type: 'GRADIENT_RADIAL',
                    gradientStops: f.gradientStops,
                    gradientTransform: [[1, 0, 0], [0, 1, 0]], // Center
                } as any);
            }
        }
    }

    if (newFills.length > 0) {
        (node as any).fills = newFills;
    } else {
        (node as any).fills = [];
    }
}

function applyStrokes(node: GeometryMixin & SceneNode, data: any) {
    if (data.strokes && Array.isArray(data.strokes) && data.strokes.length > 0) {
        (node as any).strokes = data.strokes.map((s: any) => ({
            type: 'SOLID' as const,
            color: s.color,
            opacity: s.opacity ?? 1,
        }));
        if (data.strokeWeight) (node as any).strokeWeight = data.strokeWeight;
        if (data.strokeAlign) (node as any).strokeAlign = data.strokeAlign;
        if (data.dashPattern) (node as any).dashPattern = data.dashPattern;

        if (
            (data.strokeTopWeight !== undefined ||
                data.strokeBottomWeight !== undefined ||
                data.strokeLeftWeight !== undefined ||
                data.strokeRightWeight !== undefined) &&
            'strokeTopWeight' in node
        ) {
            if (data.strokeTopWeight !== undefined) (node as any).strokeTopWeight = data.strokeTopWeight;
            if (data.strokeBottomWeight !== undefined) (node as any).strokeBottomWeight = data.strokeBottomWeight;
            if (data.strokeLeftWeight !== undefined) (node as any).strokeLeftWeight = data.strokeLeftWeight;
            if (data.strokeRightWeight !== undefined) (node as any).strokeRightWeight = data.strokeRightWeight;
        }
    }
}

function applyCornerRadius(node: FrameNode | RectangleNode, data: any) {
    if (typeof data.cornerRadius === 'number') {
        node.cornerRadius = data.cornerRadius;
    } else if (data.topLeftRadius || data.topRightRadius || data.bottomRightRadius || data.bottomLeftRadius) {
        node.topLeftRadius = data.topLeftRadius || 0;
        node.topRightRadius = data.topRightRadius || 0;
        node.bottomRightRadius = data.bottomRightRadius || 0;
        node.bottomLeftRadius = data.bottomLeftRadius || 0;
    }
}

function applyEffects(node: BlendMixin & SceneNode, data: any) {
    if (data.effects && Array.isArray(data.effects) && data.effects.length > 0) {
        // Validate effects before applying
        const validEffects = data.effects.filter((e: any) => {
            return e.type && ['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR'].includes(e.type);
        }).map((e: any) => {
            // Ensure all required properties exist
            if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
                return {
                    type: e.type,
                    color: e.color || { r: 0, g: 0, b: 0, a: 0.25 },
                    offset: e.offset || { x: 0, y: 0 },
                    radius: e.radius || 0,
                    spread: e.spread || 0,
                    visible: e.visible !== false,
                    blendMode: e.blendMode || 'NORMAL',
                };
            }
            return {
                type: e.type,
                radius: e.radius || 0,
                visible: e.visible !== false,
            };
        });
        if (validEffects.length > 0) {
            (node as any).effects = validEffects;
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// COLOR STYLES
// ═══════════════════════════════════════════════════════════════

async function processVariables(variables: { [key: string]: any }) {
    if (!variables) return;

    const colors: { [key: string]: any } = {};
    const shadows: { [key: string]: any } = {};
    const dimensions: { [key: string]: any } = {};

    for (const [name, data] of Object.entries(variables)) {
        if (data.type === 'COLOR') colors[name] = data.value;
        else if (data.type === 'SHADOW') shadows[name] = data.value;
        else if (data.type === 'DIMENSION') dimensions[name] = data.value;
    }

    const colorCount = await createColorStyles(colors);
    const effectCount = await createEffectStyles(shadows);
    const varCount = await createLocalVariables(dimensions);

    console.log(`Created Assets: ${colorCount} Colors, ${effectCount} Effects, ${varCount} Variables`);
}

async function createColorStyles(variables: { [key: string]: any }) {
    let count = 0;
    const existingStyles = figma.getLocalPaintStyles();
    const styleMap = new Map(existingStyles.map(s => [s.name, s]));

    for (const [name, color] of Object.entries(variables)) {
        const cleanName = formatVariableName(name);
        if (styleMap.has(cleanName)) continue;

        try {
            const style = figma.createPaintStyle();
            style.name = cleanName;
            style.paints = [{
                type: 'SOLID',
                color: { r: color.r, g: color.g, b: color.b },
                opacity: color.a
            }];
            count++;
        } catch (e) { console.error('Failed to create paint style', cleanName, e); }
    }
    return count;
}

async function createEffectStyles(variables: { [key: string]: any }) {
    let count = 0;
    const existingStyles = figma.getLocalEffectStyles();
    const styleMap = new Map(existingStyles.map(s => [s.name, s]));

    for (const [name, effects] of Object.entries(variables)) {
        const cleanName = formatVariableName(name);
        if (styleMap.has(cleanName)) continue;

        try {
            const style = figma.createEffectStyle();
            style.name = cleanName;
            style.effects = effects;
            count++;
        } catch (e) { console.error('Failed to create effect style', cleanName, e); }
    }
    return count;
}

async function createLocalVariables(variables: { [key: string]: any }) {
    if (!figma.variables) return 0; // Not supported in all Figma versions

    let count = 0;
    const collectionName = "Root Variables";
    const collections = figma.variables.getLocalVariableCollections();
    let collection = collections.find(c => c.name === collectionName);

    if (!collection) {
        collection = figma.variables.createVariableCollection(collectionName);
    }

    const existingVars = figma.variables.getLocalVariables().filter(v => v.variableCollectionId === collection?.id);
    const varMap = new Map(existingVars.map(v => [v.name, v]));

    for (const [name, value] of Object.entries(variables)) {
        const cleanName = formatVariableName(name);
        if (varMap.has(cleanName)) continue;

        try {
            const variable = figma.variables.createVariable(cleanName, collection.id, 'FLOAT');
            variable.setValueForMode(collection.modes[0].modeId, value);
            count++;
        } catch (e) { console.error('Failed to create variable', cleanName, e); }
    }
    return count;
}

function formatVariableName(name: string) {
    return name.replace(/^--/, '').split('-').map(word => {
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
}
