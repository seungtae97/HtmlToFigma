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
          const data = msg.data;
          console.log("Received JSON data", data);
          const rootFrame = figma.createFrame();
          rootFrame.name = "Imported Page";
          rootFrame.resize(1440, 1024);
          const layers = Array.isArray(data) ? data : [data];
          yield loadFonts(layers);
          for (const layer of layers) {
            const node = yield createLayer(layer);
            if (node) {
              rootFrame.appendChild(node);
            }
          }
          figma.currentPage.selection = [rootFrame];
          figma.viewport.scrollAndZoomIntoView([rootFrame]);
          figma.notify("Import completed!");
        }
      });
      function loadFonts(layers) {
        return __async(this, null, function* () {
          const fontsStr = /* @__PURE__ */ new Set();
          function traverse(node) {
            if (node.type === "TEXT" && node.fontFamily) {
              fontsStr.add(JSON.stringify({ family: node.fontFamily, style: node.fontWeight || "Regular" }));
            }
            if (node.children) {
              node.children.forEach(traverse);
            }
          }
          layers.forEach(traverse);
          yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
          yield figma.loadFontAsync({ family: "Inter", style: "Bold" });
          yield figma.loadFontAsync({ family: "Inter", style: "Medium" });
        });
      }
      function createLayer(data) {
        return __async(this, null, function* () {
          if (!data) return null;
          let node;
          switch (data.type) {
            case "FRAME":
            case "RECTANGLE":
            case "DIV":
              if (data.children && data.children.length > 0) {
                node = figma.createFrame();
              } else {
                node = figma.createRectangle();
              }
              break;
            case "TEXT":
              node = figma.createText();
              break;
            case "IMAGE":
              node = figma.createRectangle();
              break;
            case "SVG":
              if (data.svgString) {
                node = figma.createNodeFromSvg(data.svgString);
              } else {
                node = figma.createFrame();
              }
              break;
            default:
              node = figma.createFrame();
          }
          node.name = data.name || data.type;
          if ("x" in data && "y" in data) {
            node.x = data.x;
            node.y = data.y;
          }
          if ("width" in data && "height" in data) {
            node.resize(data.width, data.height);
          }
          const geometryNodeCandidate = node;
          if (geometryNodeCandidate.type === "FRAME" || geometryNodeCandidate.type === "RECTANGLE" || geometryNodeCandidate.type === "TEXT" || geometryNodeCandidate.type === "VECTOR") {
            const geometryNode = geometryNodeCandidate;
            if (data.fills && Array.isArray(data.fills) && data.fills.length > 0) {
              geometryNode.fills = data.fills;
            }
            if (data.strokes && Array.isArray(data.strokes) && data.strokes.length > 0) {
              geometryNode.strokes = data.strokes;
              if (data.strokeWeight) geometryNode.strokeWeight = data.strokeWeight;
              if (data.strokeAlign) geometryNode.strokeAlign = data.strokeAlign;
            }
            if (data.effects && Array.isArray(data.effects) && data.effects.length > 0) {
              geometryNode.effects = data.effects;
            }
            if (typeof data.opacity === "number") {
              geometryNode.opacity = data.opacity;
            }
            if (data.blendMode) {
              geometryNode.blendMode = data.blendMode;
            }
          }
          if (node.type === "FRAME" || node.type === "RECTANGLE") {
            const cornerNode = node;
            if (typeof data.cornerRadius === "number") {
              cornerNode.cornerRadius = data.cornerRadius;
            } else if (data.topLeftRadius || data.topRightRadius || data.bottomLeftRadius || data.bottomRightRadius) {
              cornerNode.topLeftRadius = data.topLeftRadius || 0;
              cornerNode.topRightRadius = data.topRightRadius || 0;
              cornerNode.bottomLeftRadius = data.bottomLeftRadius || 0;
              cornerNode.bottomRightRadius = data.bottomRightRadius || 0;
            }
          }
          if (node.type === "TEXT") {
            const textNode = node;
            if (data.textContent) {
              try {
                yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
                textNode.characters = data.textContent;
              } catch (e) {
                console.error("Font loading failed", e);
              }
            }
            if (data.fontSize) textNode.fontSize = data.fontSize;
          }
          if (node.type === "FRAME" && data.layoutMode) {
            const frameNode = node;
            frameNode.layoutMode = data.layoutMode;
            if (data.primaryAxisSizingMode) frameNode.primaryAxisSizingMode = data.primaryAxisSizingMode;
            if (data.counterAxisSizingMode) frameNode.counterAxisSizingMode = data.counterAxisSizingMode;
            if (data.paddingTop) frameNode.paddingTop = data.paddingTop;
            if (data.paddingRight) frameNode.paddingRight = data.paddingRight;
            if (data.paddingBottom) frameNode.paddingBottom = data.paddingBottom;
            if (data.paddingLeft) frameNode.paddingLeft = data.paddingLeft;
            if (data.itemSpacing) frameNode.itemSpacing = data.itemSpacing;
          }
          if ("children" in data && node.type === "FRAME") {
            const parent = node;
            for (const childData of data.children) {
              const childNode = yield createLayer(childData);
              if (childNode) {
                parent.appendChild(childNode);
              }
            }
          }
          return node;
        });
      }
    }
  });
  require_code();
})();
