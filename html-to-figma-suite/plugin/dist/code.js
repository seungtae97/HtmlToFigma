"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __async = (__this, __arguments, generator) => {
    return new Promise((resolve, reject) => {
      var fulfilled = (value) => {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      };
      var rejected = (value) => {
        try {
          step(generator.throw(value));
        } catch (e) {
          reject(e);
        }
      };
      var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
      step((generator = generator.apply(__this, __arguments)).next());
    });
  };

  // src/code/code.ts
  var require_code = __commonJS({
    "src/code/code.ts"(exports) {
      figma.showUI(__html__, { width: 400, height: 300 });
      figma.ui.onmessage = (msg) => __async(null, null, function* () {
        if (msg.type === "import-json") {
          console.log("--- FIGMA-PLUGIN V2.2 [DEBUG] ---");
          const data = msg.data;
          yield handleImportFiles([{ name: "Imported Page", content: data }]);
        } else if (msg.type === "import-files") {
          const files = msg.data;
          yield handleImportFiles(files);
        }
      });
      function handleImportFiles(files) {
        return __async(this, null, function* () {
          try {
            const fontPromises = files.map((f) => loadAllFonts(f.content));
            yield Promise.all(fontPromises);
            for (const file of files) {
              if (file.content.variables) {
                yield processVariables(file.content.variables);
              }
            }
            const createdSections = [];
            let nextX = Math.round(figma.viewport.center.x);
            const startY = Math.round(figma.viewport.center.y);
            const SPACING = 100;
            for (const file of files) {
              const section = figma.createSection();
              let sectionName = file.name || "Imported Page";
              const meta = file.content.meta;
              if (meta && meta.url && meta.time) {
                try {
                  const date = new Date(meta.time);
                  const timeStr = date.getFullYear() + "/" + String(date.getMonth() + 1).padStart(2, "0") + "/" + String(date.getDate()).padStart(2, "0") + " , " + String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0") + ":" + String(date.getSeconds()).padStart(2, "0");
                  sectionName = `${meta.url} (${timeStr})`;
                } catch (e) {
                }
              }
              section.name = sectionName;
              const data = file.content;
              const layers = Array.isArray(data) ? data : [data];
              for (const layerData of layers) {
                const node = yield createLayer(layerData);
                if (node) {
                  section.appendChild(node);
                }
              }
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
                section.x = nextX;
                section.y = startY - sectionH / 2;
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
              nextX += section.width + SPACING;
              createdSections.push(section);
            }
            if (createdSections.length > 0) {
              figma.currentPage.selection = createdSections;
              figma.viewport.scrollAndZoomIntoView(createdSections);
              figma.notify(`\u2705 Imported ${files.length} design(s)!`);
            }
          } catch (err) {
            console.error("Import error:", err);
            figma.notify("\u274C Import error: " + err.message, { error: true });
          }
        });
      }
      var SYSTEM_FONT_ALIASES = {
        "-apple-system": "Inter",
        "blinkmacfont": "Inter",
        "blinkmacfontsystem": "Inter",
        "system-ui": "Inter",
        "segoe ui": "Inter",
        "helvetica neue": "Inter",
        "helvetica": "Inter",
        "arial": "Inter",
        "sans-serif": "Inter",
        "serif": "Inter",
        "monospace": "Inter",
        "ui-sans-serif": "Inter",
        "ui-serif": "Inter",
        "cursive": "Inter",
        "fantasy": "Inter",
        "verdana": "Inter",
        "tahoma": "Inter",
        "geneva": "Inter",
        "apple color emoji": "Inter",
        "segoe ui emoji": "Inter",
        "noto color emoji": "Inter",
        // Korean system fonts
        "\uB9D1\uC740 \uACE0\uB515": "Noto Sans KR",
        "malgun gothic": "Noto Sans KR",
        "\uB3CB\uC6C0": "Noto Sans KR",
        "dotum": "Noto Sans KR",
        "\uAD74\uB9BC": "Noto Sans KR",
        "gulim": "Noto Sans KR",
        "\uBC14\uD0D5": "Noto Serif KR",
        "batang": "Noto Serif KR",
        "\uAD81\uC11C": "Noto Serif KR",
        "gungsuh": "Noto Serif KR",
        "apple sd gothic neo": "Noto Sans KR",
        // Japanese system fonts
        "ms pgothic": "Noto Sans JP",
        "ms gothic": "Noto Sans JP",
        "meiryo": "Noto Sans JP",
        "hiragino kaku gothic pro": "Noto Sans JP",
        // Chinese system fonts
        "microsoft yahei": "Noto Sans SC",
        "simsun": "Noto Sans SC",
        "simhei": "Noto Sans SC"
      };
      function resolveFont(family) {
        if (!family) return "Inter";
        const lower = family.toLowerCase().trim();
        return SYSTEM_FONT_ALIASES[lower] || family;
      }
      function loadAllFonts(data) {
        return __async(this, null, function* () {
          const fontSet = /* @__PURE__ */ new Set();
          function collectFonts(node) {
            if (node.type === "TEXT") {
              const family = resolveFont(node.fontFamily || "Inter");
              const style = node.fontStyle || "Regular";
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
          const interStyles = [
            "Regular",
            "Bold",
            "Medium",
            "SemiBold",
            "Light",
            "Italic",
            "Bold Italic",
            "Medium Italic"
          ];
          for (const style of interStyles) {
            try {
              yield figma.loadFontAsync({ family: "Inter", style });
            } catch (e) {
            }
          }
          const notoStyles = ["Regular", "Bold", "Medium", "Light"];
          for (const style of notoStyles) {
            try {
              yield figma.loadFontAsync({ family: "Noto Sans KR", style });
            } catch (e) {
            }
          }
          for (const style of ["Regular", "Bold"]) {
            try {
              yield figma.loadFontAsync({ family: "Noto Serif KR", style });
            } catch (e) {
            }
          }
          for (const fontStr of fontSet) {
            const { family, style } = JSON.parse(fontStr);
            try {
              yield figma.loadFontAsync({ family, style });
            } catch (e) {
              const baseStyle = style.replace(" Italic", "").replace("Italic", "Regular");
              try {
                yield figma.loadFontAsync({ family, style: baseStyle });
              } catch (e2) {
                console.warn(`Font not available: ${family} ${style}`);
              }
            }
          }
        });
      }
      function createLayer(data) {
        return __async(this, null, function* () {
          if (!data) return null;
          switch (data.type) {
            case "TEXT":
              return createTextNode(data);
            case "RICH_TEXT":
              return createRichTextNode(data);
            case "SVG":
              return createSvgNode(data);
            default:
              return createFrameNode(data);
          }
        });
      }
      function createFrameNode(data) {
        return __async(this, null, function* () {
          const hasChildren = data.children && data.children.length > 0;
          if (hasChildren || data.layoutMode) {
            const frame = figma.createFrame();
            frame.name = data.name || "frame";
            if (typeof data.x === "number") frame.x = data.x;
            if (typeof data.y === "number") frame.y = data.y;
            if (!data.layoutMode && data.width && data.height) {
              frame.resize(Math.max(1, data.width), Math.max(1, data.height));
            }
            if (typeof data.rotation === "number") frame.rotation = data.rotation;
            if (data.blendMode) frame.blendMode = data.blendMode;
            yield applyFills(frame, data);
            applyStrokes(frame, data);
            applyCornerRadius(frame, data);
            applyEffects(frame, data);
            if (typeof data.opacity === "number") frame.opacity = data.opacity;
            if (typeof data.clipsContent === "boolean") frame.clipsContent = data.clipsContent;
            else if (data.clipsContent) frame.clipsContent = true;
            if (data.layoutMode) {
              frame.layoutMode = data.layoutMode;
              if (data.width && data.height) {
                try {
                  frame.resize(Math.max(1, data.width), Math.max(1, data.height));
                } catch (e) {
                }
              }
              if (data.primaryAxisAlignItems) frame.primaryAxisAlignItems = data.primaryAxisAlignItems;
              if (data.counterAxisAlignItems) frame.counterAxisAlignItems = data.counterAxisAlignItems;
              if (data.layoutWrap) frame.layoutWrap = data.layoutWrap;
              if (typeof data.itemSpacing === "number") frame.itemSpacing = data.itemSpacing;
              if (typeof data.counterAxisSpacing === "number") {
                frame.counterAxisSpacing = data.counterAxisSpacing;
              }
              if (data.layoutMode === "GRID") {
                if (typeof data.gridRowCount === "number") frame.gridRowCount = data.gridRowCount;
                if (typeof data.gridColumnCount === "number") frame.gridColumnCount = data.gridColumnCount;
                if (typeof data.gridRowGap === "number") frame.gridRowGap = data.gridRowGap;
                if (typeof data.gridColumnGap === "number") frame.gridColumnGap = data.gridColumnGap;
              }
              if (typeof data.paddingTop === "number") frame.paddingTop = Math.max(0, data.paddingTop);
              if (typeof data.paddingRight === "number") frame.paddingRight = Math.max(0, data.paddingRight);
              if (typeof data.paddingBottom === "number") frame.paddingBottom = Math.max(0, data.paddingBottom);
              if (typeof data.paddingLeft === "number") frame.paddingLeft = Math.max(0, data.paddingLeft);
              if (data.primaryAxisSizingMode) frame.primaryAxisSizingMode = data.primaryAxisSizingMode;
              if (data.counterAxisSizingMode) frame.counterAxisSizingMode = data.counterAxisSizingMode;
              if (data.width && data.height && frame.primaryAxisSizingMode === "FIXED" && frame.counterAxisSizingMode === "FIXED") {
                try {
                  frame.resize(Math.max(1, data.width), Math.max(1, data.height));
                } catch (e) {
                }
              }
            }
            if (data.children && Array.isArray(data.children)) {
              const sortedChildren = [...data.children].sort((a, b) => {
                if ((a._order || 0) !== (b._order || 0)) return (a._order || 0) - (b._order || 0);
                return (a._zIndex || 0) - (b._zIndex || 0);
              });
              for (const childData of sortedChildren) {
                const childNode = yield createLayer(childData);
                if (childNode) {
                  frame.appendChild(childNode);
                  if (data.layoutMode && childNode.type !== "SECTION") {
                    if (childData.layoutGrow === 1) childNode.layoutGrow = 1;
                    let isAbsolute = false;
                    if (childData.layoutPositioning === "ABSOLUTE") {
                      childNode.layoutPositioning = "ABSOLUTE";
                      isAbsolute = true;
                      if (typeof childData.x === "number") childNode.x = childData.x;
                      if (typeof childData.y === "number") childNode.y = childData.y;
                      if (childData.constraints) {
                        childNode.constraints = childData.constraints;
                      }
                    }
                    if (childData.layoutAlign && !isAbsolute) {
                      const validAligns = ["STRETCH", "MIN", "CENTER", "MAX", "INHERIT"];
                      if (validAligns.includes(childData.layoutAlign)) {
                        childNode.layoutAlign = childData.layoutAlign;
                      }
                    }
                    if (data.layoutMode === "GRID" && !isAbsolute) {
                      try {
                        if (typeof childData.gridRowSpan === "number") {
                          childNode.gridRowSpan = childData.gridRowSpan;
                        }
                        if (typeof childData.gridColumnSpan === "number") {
                          childNode.gridColumnSpan = childData.gridColumnSpan;
                        }
                      } catch (e) {
                        console.warn("Failed to set grid span", e);
                      }
                      if (childData.gridChildHorizontalAlign) {
                        childNode.gridChildHorizontalAlign = childData.gridChildHorizontalAlign;
                      }
                      if (childData.gridChildVerticalAlign) {
                        childNode.gridChildVerticalAlign = childData.gridChildVerticalAlign;
                      }
                    }
                  } else if (!data.layoutMode && childNode.type !== "SECTION") {
                    if (typeof childData.x === "number") childNode.x = childData.x;
                    if (typeof childData.y === "number") childNode.y = childData.y;
                  }
                }
              }
            }
            return frame;
          } else {
            const rect = figma.createRectangle();
            rect.name = data.name || "rect";
            if (typeof data.x === "number") rect.x = data.x;
            if (typeof data.y === "number") rect.y = data.y;
            if (data.width && data.height) {
              rect.resize(Math.max(1, data.width), Math.max(1, data.height));
            }
            if (typeof data.rotation === "number") rect.rotation = data.rotation;
            if (data.blendMode) rect.blendMode = data.blendMode;
            yield applyFills(rect, data);
            applyStrokes(rect, data);
            applyCornerRadius(rect, data);
            applyEffects(rect, data);
            if (typeof data.opacity === "number") rect.opacity = data.opacity;
            return rect;
          }
        });
      }
      function createTextNode(data) {
        return __async(this, null, function* () {
          const textNode = figma.createText();
          textNode.name = data.name || "text";
          if (typeof data.x === "number") textNode.x = data.x;
          if (typeof data.y === "number") textNode.y = data.y;
          const resolvedFamily = resolveFont(data.fontFamily);
          const style = data.fontStyle || "Regular";
          let fontLoaded = false;
          try {
            yield figma.loadFontAsync({ family: resolvedFamily, style });
            textNode.fontName = { family: resolvedFamily, style };
            fontLoaded = true;
          } catch (e) {
            try {
              yield figma.loadFontAsync({ family: resolvedFamily, style: "Regular" });
              textNode.fontName = { family: resolvedFamily, style: "Regular" };
              fontLoaded = true;
            } catch (e2) {
              try {
                yield figma.loadFontAsync({ family: "Inter", style });
                textNode.fontName = { family: "Inter", style };
                fontLoaded = true;
              } catch (e3) {
                try {
                  yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
                  textNode.fontName = { family: "Inter", style: "Regular" };
                  fontLoaded = true;
                } catch (e4) {
                }
              }
            }
          }
          if (data.characters) {
            textNode.characters = data.characters;
          }
          if (data.width && data.height) {
            textNode.resize(Math.max(1, data.width), Math.max(1, data.height));
            textNode.textAutoResize = data.textAutoResize || "HEIGHT";
          }
          if (typeof data.fontSize === "number") textNode.fontSize = data.fontSize;
          if (data.fills && Array.isArray(data.fills) && data.fills.length > 0) {
            const validFills = data.fills.filter((f) => f.type === "SOLID" || f.type === "GRADIENT_LINEAR");
            if (validFills.length > 0) textNode.fills = validFills;
          }
          if (data.letterSpacing) {
            if (typeof data.letterSpacing === "object") textNode.letterSpacing = data.letterSpacing;
            else if (typeof data.letterSpacing === "number") {
              textNode.letterSpacing = { value: data.letterSpacing, unit: "PIXELS" };
            }
          }
          if (data.lineHeight) {
            if (typeof data.lineHeight === "number") {
              textNode.lineHeight = { value: data.lineHeight, unit: "PIXELS" };
            } else if (data.lineHeight.unit) {
              textNode.lineHeight = data.lineHeight;
            }
          }
          if (data.textAlignHorizontal) textNode.textAlignHorizontal = data.textAlignHorizontal;
          if (data.textAlignVertical) textNode.textAlignVertical = data.textAlignVertical;
          if (data.textDecoration) textNode.textDecoration = data.textDecoration;
          if (data.textCase) textNode.textCase = data.textCase;
          if (data.textTruncation) {
            textNode.textTruncation = data.textTruncation;
          }
          applyEffects(textNode, data);
          if (typeof data.rotation === "number") textNode.rotation = data.rotation;
          if (typeof data.opacity === "number") textNode.opacity = data.opacity;
          return textNode;
        });
      }
      function createRichTextNode(data) {
        return __async(this, null, function* () {
          const textNode = figma.createText();
          textNode.name = data.name || "rich-text";
          if (typeof data.x === "number") textNode.x = data.x;
          if (typeof data.y === "number") textNode.y = data.y;
          yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
          const uniqueFonts = /* @__PURE__ */ new Set();
          if (data.segments) {
            for (const s of data.segments) {
              const family = resolveFont(s.fontFamily);
              const style = s.fontStyle || "Regular";
              uniqueFonts.add(JSON.stringify({ family, style }));
            }
          }
          const rootFamily = resolveFont(data.fontFamily);
          uniqueFonts.add(JSON.stringify({ family: rootFamily, style: "Regular" }));
          for (const f of uniqueFonts) {
            try {
              const font = JSON.parse(f);
              yield figma.loadFontAsync(font);
            } catch (e) {
              console.warn("Failed to load font", f);
            }
          }
          textNode.characters = data.characters || "";
          if (data.width && data.height) {
            textNode.resize(Math.max(1, data.width), Math.max(1, data.height));
            textNode.textAutoResize = data.textAutoResize || "HEIGHT";
          }
          if (data.segments) {
            for (const s of data.segments) {
              const start = s.start;
              const end = s.end;
              if (start >= end) continue;
              if (end > textNode.characters.length) continue;
              const family = resolveFont(s.fontFamily);
              const style = s.fontStyle || "Regular";
              try {
                textNode.setRangeFontName(start, end, { family, style });
              } catch (e) {
                try {
                  textNode.setRangeFontName(start, end, { family: "Inter", style: "Regular" });
                } catch (e2) {
                }
              }
              if (s.fontSize) textNode.setRangeFontSize(start, end, s.fontSize);
              if (s.color) {
                textNode.setRangeFills(start, end, [{
                  type: "SOLID",
                  color: { r: s.color.r, g: s.color.g, b: s.color.b },
                  opacity: s.color.a
                }]);
              }
              if (s.textDecoration) {
                if (s.textDecoration.includes("underline")) textNode.setRangeTextDecoration(start, end, "UNDERLINE");
                else if (s.textDecoration.includes("line-through")) textNode.setRangeTextDecoration(start, end, "STRIKETHROUGH");
                else textNode.setRangeTextDecoration(start, end, "NONE");
              }
              if (s.lineHeight) {
                if (typeof s.lineHeight === "number") {
                  textNode.setRangeLineHeight(start, end, { value: s.lineHeight, unit: "PIXELS" });
                } else if (s.lineHeight.unit) {
                  textNode.setRangeLineHeight(start, end, s.lineHeight);
                }
              }
              if (s.letterSpacing) {
                if (typeof s.letterSpacing === "object" && s.letterSpacing.unit) {
                  textNode.setRangeLetterSpacing(start, end, s.letterSpacing);
                } else if (typeof s.letterSpacing === "number") {
                  textNode.setRangeLetterSpacing(start, end, { value: s.letterSpacing, unit: "PIXELS" });
                }
              }
            }
          }
          if (data.textAlignHorizontal) textNode.textAlignHorizontal = data.textAlignHorizontal;
          if (data.textAlignVertical) textNode.textAlignVertical = data.textAlignVertical;
          applyEffects(textNode, data);
          if (typeof data.rotation === "number") textNode.rotation = data.rotation;
          if (typeof data.opacity === "number") textNode.opacity = data.opacity;
          return textNode;
        });
      }
      function createSvgNode(data) {
        if (!data.svgString) return null;
        try {
          const node = figma.createNodeFromSvg(data.svgString);
          node.name = data.name || "svg";
          if (typeof data.x === "number") node.x = data.x;
          if (typeof data.y === "number") node.y = data.y;
          if (data.width && data.height) {
            node.resize(Math.max(1, data.width), Math.max(1, data.height));
          }
          if (typeof data.rotation === "number") node.rotation = data.rotation;
          if (node.type === "FRAME" || node.type === "GROUP") {
            for (const child of node.children) {
              if (child.type === "VECTOR" || child.type === "BOOLEAN_OPERATION") {
                child.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
              }
            }
          }
          return node;
        } catch (e) {
          console.warn("Failed to create SVG node", e);
          return null;
        }
      }
      function applyFills(node, data) {
        return __async(this, null, function* () {
          var _a, _b;
          if (!data.fills || !Array.isArray(data.fills) || data.fills.length === 0) {
            node.fills = [];
            return;
          }
          const newFills = [];
          for (const f of data.fills) {
            if (f.type === "SOLID") {
              newFills.push({
                type: "SOLID",
                color: f.color,
                opacity: (_a = f.opacity) != null ? _a : 1
              });
            } else if (f.type === "IMAGE" && f.imageData) {
              try {
                const base64Data = f.imageData.split(",")[1];
                if (base64Data) {
                  const bytes = figma.base64Decode(base64Data);
                  const image = figma.createImage(bytes);
                  newFills.push({
                    type: "IMAGE",
                    imageHash: image.hash,
                    scaleMode: f.scaleMode || "FILL"
                  });
                }
              } catch (e) {
                console.warn("Failed to create image from base64", e);
              }
            } else if (f.type === "GRADIENT_LINEAR") {
              if (f.gradientStops) {
                const angle = (_b = f.gradientAngle) != null ? _b : 180;
                const rad = (angle - 90) * Math.PI / 180;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);
                newFills.push({
                  type: "GRADIENT_LINEAR",
                  gradientStops: f.gradientStops,
                  gradientTransform: [
                    [cos, sin, 0.5 - cos * 0.5 - sin * 0.5],
                    [-sin, cos, 0.5 + sin * 0.5 - cos * 0.5]
                  ]
                });
              }
            } else if (f.type === "GRADIENT_RADIAL") {
              if (f.gradientStops) {
                newFills.push({
                  type: "GRADIENT_RADIAL",
                  gradientStops: f.gradientStops,
                  gradientTransform: [[1, 0, 0], [0, 1, 0]]
                  // Center
                });
              }
            }
          }
          if (newFills.length > 0) {
            node.fills = newFills;
          } else {
            node.fills = [];
          }
        });
      }
      function applyStrokes(node, data) {
        if (data.strokes && Array.isArray(data.strokes) && data.strokes.length > 0) {
          node.strokes = data.strokes.map((s) => {
            var _a;
            return {
              type: "SOLID",
              color: s.color,
              opacity: (_a = s.opacity) != null ? _a : 1
            };
          });
          if (data.strokeWeight) node.strokeWeight = data.strokeWeight;
          if (data.strokeAlign) node.strokeAlign = data.strokeAlign;
          if (data.dashPattern) node.dashPattern = data.dashPattern;
          if ((data.strokeTopWeight !== void 0 || data.strokeBottomWeight !== void 0 || data.strokeLeftWeight !== void 0 || data.strokeRightWeight !== void 0) && "strokeTopWeight" in node) {
            if (data.strokeTopWeight !== void 0) node.strokeTopWeight = data.strokeTopWeight;
            if (data.strokeBottomWeight !== void 0) node.strokeBottomWeight = data.strokeBottomWeight;
            if (data.strokeLeftWeight !== void 0) node.strokeLeftWeight = data.strokeLeftWeight;
            if (data.strokeRightWeight !== void 0) node.strokeRightWeight = data.strokeRightWeight;
          }
        }
      }
      function applyCornerRadius(node, data) {
        if (typeof data.cornerRadius === "number") {
          node.cornerRadius = data.cornerRadius;
        } else if (data.topLeftRadius || data.topRightRadius || data.bottomRightRadius || data.bottomLeftRadius) {
          node.topLeftRadius = data.topLeftRadius || 0;
          node.topRightRadius = data.topRightRadius || 0;
          node.bottomRightRadius = data.bottomRightRadius || 0;
          node.bottomLeftRadius = data.bottomLeftRadius || 0;
        }
      }
      function applyEffects(node, data) {
        if (data.effects && Array.isArray(data.effects) && data.effects.length > 0) {
          const validEffects = data.effects.filter((e) => {
            return e.type && ["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR"].includes(e.type);
          }).map((e) => {
            if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
              return {
                type: e.type,
                color: e.color || { r: 0, g: 0, b: 0, a: 0.25 },
                offset: e.offset || { x: 0, y: 0 },
                radius: e.radius || 0,
                spread: e.spread || 0,
                visible: e.visible !== false,
                blendMode: e.blendMode || "NORMAL"
              };
            }
            return {
              type: e.type,
              radius: e.radius || 0,
              visible: e.visible !== false
            };
          });
          if (validEffects.length > 0) {
            node.effects = validEffects;
          }
        }
      }
      function processVariables(variables) {
        return __async(this, null, function* () {
          if (!variables) return;
          const colors = {};
          const shadows = {};
          const dimensions = {};
          for (const [name, data] of Object.entries(variables)) {
            if (data.type === "COLOR") colors[name] = data.value;
            else if (data.type === "SHADOW") shadows[name] = data.value;
            else if (data.type === "DIMENSION") dimensions[name] = data.value;
          }
          const colorCount = yield createColorStyles(colors);
          const effectCount = yield createEffectStyles(shadows);
          const varCount = yield createLocalVariables(dimensions);
          console.log(`Created Assets: ${colorCount} Colors, ${effectCount} Effects, ${varCount} Variables`);
        });
      }
      function createColorStyles(variables) {
        return __async(this, null, function* () {
          let count = 0;
          const existingStyles = figma.getLocalPaintStyles();
          const styleMap = new Map(existingStyles.map((s) => [s.name, s]));
          for (const [name, color] of Object.entries(variables)) {
            const cleanName = formatVariableName(name);
            if (styleMap.has(cleanName)) continue;
            try {
              const style = figma.createPaintStyle();
              style.name = cleanName;
              style.paints = [{
                type: "SOLID",
                color: { r: color.r, g: color.g, b: color.b },
                opacity: color.a
              }];
              count++;
            } catch (e) {
              console.error("Failed to create paint style", cleanName, e);
            }
          }
          return count;
        });
      }
      function createEffectStyles(variables) {
        return __async(this, null, function* () {
          let count = 0;
          const existingStyles = figma.getLocalEffectStyles();
          const styleMap = new Map(existingStyles.map((s) => [s.name, s]));
          for (const [name, effects] of Object.entries(variables)) {
            const cleanName = formatVariableName(name);
            if (styleMap.has(cleanName)) continue;
            try {
              const style = figma.createEffectStyle();
              style.name = cleanName;
              style.effects = effects;
              count++;
            } catch (e) {
              console.error("Failed to create effect style", cleanName, e);
            }
          }
          return count;
        });
      }
      function createLocalVariables(variables) {
        return __async(this, null, function* () {
          if (!figma.variables) return 0;
          let count = 0;
          const collectionName = "Root Variables";
          const collections = figma.variables.getLocalVariableCollections();
          let collection = collections.find((c) => c.name === collectionName);
          if (!collection) {
            collection = figma.variables.createVariableCollection(collectionName);
          }
          const existingVars = figma.variables.getLocalVariables().filter((v) => v.variableCollectionId === (collection == null ? void 0 : collection.id));
          const varMap = new Map(existingVars.map((v) => [v.name, v]));
          for (const [name, value] of Object.entries(variables)) {
            const cleanName = formatVariableName(name);
            if (varMap.has(cleanName)) continue;
            try {
              const variable = figma.variables.createVariable(cleanName, collection.id, "FLOAT");
              variable.setValueForMode(collection.modes[0].modeId, value);
              count++;
            } catch (e) {
              console.error("Failed to create variable", cleanName, e);
            }
          }
          return count;
        });
      }
      function formatVariableName(name) {
        return name.replace(/^--/, "").split("-").map((word) => {
          return word.charAt(0).toUpperCase() + word.slice(1);
        }).join(" ");
      }
    }
  });
  require_code();
})();
