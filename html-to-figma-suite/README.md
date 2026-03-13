# HTML to Figma Suite

웹 페이지의 HTML/CSS 레이아웃을 Figma의 네이티브 레이어(특히 Auto Layout Grid)로 변환해주는 도구 모음입니다. 이 프로젝트는 브라우저 확장 프로그램(Extension)과 Figma 플러그인(Plugin)으로 구성되어 있습니다.

## 프로젝트 구조

- `extension/`: 웹 페이지에서 레이아웃 데이터를 추출하는 브라우저 확장 프로그램 소스 코드입니다. (Vite + React)
- `plugin/`: 추출된 JSON 데이터를 Figma 레이어로 변환해주는 Figma 플러그인 소스 코드입니다. (Vite + React + Figma API)

## 주요 기능 (최신 업데이트)

- **Figma Native Grid 지원**: 기존에 절대 좌표로 복제되던 복잡한 CSS Grid 레이아웃을 Figma의 최신 `GRID` 자동 레이아웃 모드로 변환합니다.
- **자동 레이아웃 매핑**: Flexbox 및 Grid의 gap, span, alignment 속성을 최대한 보존하여 변환합니다.

---

## 설치 및 실행 방법

### 1. 전제 조건
- [Node.js](https://nodejs.org/) (버전 16 이상 권장)
- [npm](https://www.npmjs.com/)

### 2. 브라우저 확장 프로그램 (Extension)
웹 페이지를 캡처하여 `.figma.json` 파일을 생성하는 역할을 합니다.

```bash
cd extension
npm install
npm run build
```
- 빌드가 완료되면 `extension/dist` 폴더가 생성됩니다.
- 브라우저(Chrome 등)의 `확장 프로그램 관리` 페이지에서 `압축해제된 확장 프로그램을 로드합니다`를 클릭한 후 `dist` 폴더를 선택하세요.

### 3. Figma 플러그인 (Plugin)
생성된 JSON 파일을 Figma로 불러와 레이어를 생성하는 역할을 합니다.

```bash
cd plugin
npm install
npm run build
```
- 빌드 후 Figma 데스크톱 앱에서 `Plugins` -> `Development` -> `Import plugin from manifest...`를 선택하고 `plugin/manifest.json` 파일을 선택하세요.

---

## 사용법

1. 브라우저에서 변환하고 싶은 웹 페이지로 이동합니다.
2. 설치한 확장 프로그램을 실행하고 **"Capture Page"** 버튼을 눌러 `.figma.json` 파일을 다운로드합니다.
3. Figma에서 **HTML to Figma** 플러그인을 실행합니다.
4. 다운로드한 JSON 파일을 플러그인 창에 드래그 앤 드롭하거나 선택하여 레이어를 생성합니다.

## 주의 사항
- 복잡한 그리드의 경우 Figma의 API 한계로 인해 일부 디자인이 다르게 보일 수 있으나, 최대한 네이티브 Grid 속성을 유지하도록 구현되었습니다.
- 종속성 설치 중 에러가 발생하면 `npm install --force`를 시도해 보세요.
