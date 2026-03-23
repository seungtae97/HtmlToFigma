# HTML to Figma Suite

웹 페이지의 HTML/CSS 레이아웃을 **Figma 네이티브 레이어**로 변환해주는 도구 모음입니다.

브라우저 확장 프로그램으로 웹 페이지를 캡처하고, Figma 플러그인으로 불러오면 Auto Layout(Flexbox/Grid)이 그대로 재현됩니다.

---

## 작동 원리

```
[웹 브라우저]                  [JSON 파일]                [Figma]
  웹 페이지      →  확장 프로그램  →  .figma.json  →  플러그인  →  네이티브 레이어
 (HTML/CSS)         (캡처)          (다운로드)        (임포트)    (Auto Layout)
```

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| **Multi-Viewport 캡처** | Desktop / iPhone SE / iPhone 14 Pro / Android 뷰포트 동시 캡처 |
| **Auto Layout 변환** | CSS Flexbox → Figma Auto Layout, CSS Grid → Figma Native Grid |
| **이미지 임베딩** | CORS 우회 처리로 외부 이미지도 Base64로 변환하여 포함 |
| **폰트 매핑** | 한국어(NanumGothic 등) 포함 시스템 폰트 자동 매핑 |
| **그라디언트/그림자** | CSS gradient, box-shadow → Figma 스타일 변환 |
| **CSS 변수** | CSS 커스텀 프로퍼티 → Figma Styles 변환 |

---

## 시스템 요구사항

- **Node.js** 16 이상 + npm
- **Chrome** 또는 **Edge** 브라우저 (확장 프로그램 설치용)
- **Figma Desktop** 앱 (플러그인 개발 모드 실행용)

---

## 설치 방법

### 1. 저장소 클론

```bash
git clone https://github.com/seungtae97/HtmlToFigma.git
cd HtmlToFigma/html-to-figma-suite
```

---

### 2. 브라우저 확장 프로그램 (Extension)

웹 페이지를 캡처하여 `.figma.json` 파일을 생성합니다.

#### 빌드

```bash
cd extension
npm install
npm run build
```

빌드가 완료되면 `extension/dist/` 폴더가 생성됩니다.

#### Chrome/Edge에 로드

1. Chrome 주소창에 `chrome://extensions` 입력
2. 우측 상단 **"개발자 모드"** 토글 활성화
3. **"압축해제된 확장 프로그램을 로드합니다"** 클릭
4. `extension/dist` 폴더 선택
5. 확장 프로그램 목록에 **"HTML to Figma"** 가 추가되면 완료

> Edge의 경우 `edge://extensions` 에서 동일하게 진행합니다.

---

### 3. Figma 플러그인 (Plugin)

캡처한 JSON 파일을 Figma 레이어로 변환합니다.

#### 빌드

```bash
cd plugin
npm install
npm run build
```

빌드가 완료되면 `plugin/dist/` 폴더와 함께 `plugin/manifest.json`이 준비됩니다.

#### Figma에 등록

1. **Figma Desktop 앱** 실행 (Web 버전은 개발용 플러그인 미지원)
2. 임의의 파일 열기
3. 메뉴 **Plugins → Development → Import plugin from manifest...**
4. `plugin/manifest.json` 파일 선택
5. 플러그인 목록에 **"HTML to Figma"** 가 나타나면 완료

---

## 사용법

### Step 1 — 웹 페이지 캡처

1. 변환하고 싶은 웹 페이지로 이동합니다.
2. Chrome 툴바에서 **HTML to Figma** 확장 아이콘 클릭
3. 팝업에서 원하는 **뷰포트** 선택:

   | 옵션 | 해상도 |
   |------|--------|
   | Desktop | 현재 브라우저 크기 |
   | iPhone SE | 375 × 812 |
   | iPhone 14 Pro | 390 × 844 |
   | Android | 412 × 915 |

4. **"Capture Page"** 버튼 클릭
5. `.figma.json` 파일이 자동으로 다운로드됩니다.

> **Multi-Viewport 캡처**: 여러 뷰포트를 동시에 체크하면 한 번의 클릭으로 각 해상도별 JSON이 생성됩니다.

---

### Step 2 — Figma에 임포트

1. **Figma Desktop** 에서 빈 파일(또는 원하는 파일) 열기
2. 메뉴 **Plugins → Development → HTML to Figma** 실행
3. 플러그인 창이 열리면 다음 중 하나로 JSON 파일 불러오기:
   - **드래그 앤 드롭**: 파일 탐색기에서 `.figma.json` 파일을 플러그인 창으로 끌어다 놓기
   - **파일 선택**: 플러그인 창의 "파일 선택" 버튼 클릭
4. 잠시 후 Figma 캔버스에 레이어가 자동 생성됩니다.

---

### Step 3 — 결과 확인

- **프레임**: 뷰포트 크기의 프레임으로 생성됩니다.
- **Auto Layout**: Flexbox 요소는 Figma Auto Layout(HORIZONTAL/VERTICAL)으로 변환됩니다.
- **Native Grid**: CSS Grid 요소는 Figma의 GRID Auto Layout 모드로 변환됩니다.
- **이미지**: 배경 이미지 및 `<img>` 태그가 Fill로 포함됩니다.
- **텍스트**: 폰트, 크기, 색상, 두께가 보존됩니다.

---

## 프로젝트 구조

```
html-to-figma-suite/
├── extension/                  # 브라우저 확장 프로그램
│   ├── src/
│   │   ├── manifest.json       # Chrome Extension Manifest v3
│   │   ├── background/
│   │   │   └── background.js   # CORS 우회 이미지 fetch 처리
│   │   ├── content/
│   │   │   └── content.js      # 핵심 DOM/CSS 파싱 로직 (2600+ lines)
│   │   └── popup/
│   │       ├── index.html      # 팝업 UI
│   │       └── popup.js        # 뷰포트 선택 & 파일 다운로드
│   ├── vite.config.js
│   └── package.json
│
└── plugin/                     # Figma 플러그인
    ├── src/
    │   ├── code/
    │   │   └── code.ts         # 핵심 JSON→Figma 레이어 변환 로직
    │   └── ui/
    │       ├── App.tsx         # React 드래그앤드롭 UI
    │       └── main.tsx        # React 진입점
    ├── manifest.json           # Figma Plugin Manifest
    ├── index.html
    ├── vite.config.js
    └── package.json
```

---

## 기술 스택

| 구성요소 | 기술 |
|----------|------|
| 확장 프로그램 | Vite, Vanilla JavaScript, Chrome Manifest v3 |
| Figma 플러그인 | Vite, React 19, TypeScript, @figma/plugin-typings |
| 빌드 도구 | Vite 7, esbuild |

---

## 알려진 제한사항

- **복잡한 Grid**: `grid-template-areas`, `subgrid` 등 일부 고급 CSS Grid 속성은 Figma API의 한계로 완벽하게 재현되지 않을 수 있습니다.
- **CSS 애니메이션**: 정적 레이아웃만 캡처되며, CSS transition/animation은 반영되지 않습니다.
- **SVG**: 인라인 SVG는 이미지로 처리될 수 있습니다.
- **iframe 내부**: 동일 출처(Same-Origin)가 아닌 iframe 내용은 캡처되지 않습니다.
- **의존성 설치 오류**: `npm install` 실패 시 `npm install --force` 를 시도하세요.

---

## 개발 모드 실행

빌드 없이 핫 리로드로 개발하려면:

```bash
# 확장 프로그램
cd extension
npm run dev    # 변경사항 감지 후 자동 재빌드

# Figma 플러그인
cd plugin
npm run dev    # Vite dev 서버 (UI 개발 시)
npm run watch  # code.ts 변경사항 감지 후 자동 재빌드
```

---

## 라이선스

MIT License
