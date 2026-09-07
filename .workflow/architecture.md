# 아키텍처 — Rawdoc 에디터 코어 기술 검증

작성일: 2026-09-07
적용 범위: `spike/` 이하. 기존 `src/` 에는 적용되지 않는다.

> 여기 적힌 불변조건은 개별 task 가 마음대로 깰 수 없다.
> 깨야 한다면 이 문서를 먼저 고치고 사람의 승인을 받는다.

## 1. 구성 요소

| 이름 | 책임 | 위치 |
| --- | --- | --- |
| spike-app | 검증 화면 셸. 에디터 1개 + 이벤트 로그 패널 | `spike/src/App.jsx` |
| editor | CM6 EditorView 생성·해제, 확장 조립 | `spike/src/editor/index.js` |
| inline-deco | 인라인 마크다운 구문 → decoration 매핑 (커서 줄은 원문 노출) | `spike/src/editor/inline.js` |
| block-widget | 표·코드블록 → 위젯 치환, 커서 진입/이탈 처리 | `spike/src/editor/blocks.js` |
| ime-log | composition 이벤트·커서 위치를 화면에 기록 (검증 증거 수집용) | `spike/src/editor/imeLog.js` |
| capacitor-shell | 안드로이드 래퍼. 빌드 산출물을 감싸기만 함 | `spike/android/`, `spike/capacitor.config.json` |
| e2e | Playwright 테스트 | `spike/e2e/` |

`ime-log` 는 검증 전용이다. 본 제품으로 이식할 때 반드시 제거한다.

## 2. 의존 방향

허용된 방향만 적는다. 여기 없는 방향의 import 는 위반이다.

```
spike-app -> editor -> (inline-deco | block-widget | ime-log) -> @codemirror/*
e2e -> (빌드 산출물, HTTP 로만 접근)
capacitor-shell -> (빌드 산출물, 파일로만 접근)
```

금지:

```
spike/**  -X->  src/**      (버릴 코드가 본 코드를 물들이지 않게)
src/**    -X->  spike/**    (같은 이유, 반대 방향)
editor    -X->  spike-app   (에디터가 화면 셸을 알면 이식이 불가능해짐)
```

## 3. 불변조건

깨지면 버그가 아니라 설계 위반인 것들.

- [ ] **`spike/` 와 `src/` 는 서로 import 하지 않는다.** 이번 사이클의 코드는 버릴 전제로 만든다
- [ ] **문서 상태의 원본은 CM6 `EditorState` 하나뿐이다.** 별도 문자열 사본을 두고 동기화하지 않는다 — 프로토타입의 `state.pages[].md` 같은 이중 보관은 금지
- [ ] **decoration 은 문서 내용을 변경하지 않는다.** 표시만 바꾼다. `.md` 로 뽑았을 때 사용자가 친 원문과 바이트가 같아야 한다 — 이것이 제품의 핵심 주장이다
- [ ] **IME 조합 중에는 decoration 을 재계산하지 않는다.** `compositionstart` ~ `compositionend` 사이에는 뷰 갱신을 보류한다
      *(주: 이 항목은 확정된 규칙이 아니라 **검증 대상 가설**이다. B-002 에서 이 가설이 맞는지 확인하고, 틀리면 이 문서를 고친다)*
- [ ] **검증 결과는 3개 환경 각각에 대해 따로 기록한다.** 한 환경 통과를 전체 통과로 적지 않는다

## 4. 기술 선택과 근거

| 선택 | 대안 | 고른 이유 |
| --- | --- | --- |
| CodeMirror 6 | textarea + 오버레이 유지 | textarea 는 내부 텍스트를 부분적으로 다르게 그릴 수 없어 라이브 프리뷰가 원리적으로 불가능 (`docs/research.html` 8장) |
| CodeMirror 6 | ProseMirror / Lexical | 두 라이브러리는 문서 모델이 원문 문자열이 아니라 트리다. 원문 보존이라는 제품 주장과 정면 충돌 |
| `spike/` 분리 | `src/` 직접 수정 | 검증 실패 시 되돌리는 비용을 0으로 만든다. 사용자가 "나중에 버림" 으로 지정 |
| Playwright | Vitest 만 | 3개 환경 회귀 확인이 필요. 단 한글 IME 조합 재현 한계가 있어 사람 확인을 대체하지 못한다 |
| Capacitor | TWA / React Native 재작성 | 기존 React 코드를 그대로 감쌀 수 있음 (`docs/research.html` 8장). RN 은 에디터를 0부터 다시 만들어야 함 |

## 5. 디렉터리 구조

```
06_rawdoc/
├─ docs/                  # 기존. 조사·프로토타입 산출물. 수정하지 않음
│  ├─ research.html
│  └─ prototype.html
├─ src/                   # 기존 Vite 스캐폴드. 이번 사이클에서 손대지 않음
├─ spike/                 # 이번 사이클의 전부. 검증 후 폐기 대상
│  ├─ index.html
│  ├─ vite.config.js      # 루트와 분리된 별도 엔트리
│  ├─ src/
│  │  ├─ App.jsx
│  │  └─ editor/
│  │     ├─ index.js
│  │     ├─ inline.js
│  │     ├─ blocks.js
│  │     └─ imeLog.js
│  ├─ e2e/                # Playwright
│  └─ android/            # Capacitor 생성물
└─ .workflow/
   └─ findings/           # 환경별 검증 결과 기록
```

## 6. 위험 지점

- **IME 조합 중 decoration 재계산** — 이번 검증의 본체. 실패하면 CM6 채택 자체를 재검토해야 하므로, 대안(오버레이 유지 / 인라인만 프리뷰)을 함께 기록한다
- **블록 위젯 커서 진입·이탈** — `docs/research.html` 8장이 "커서 진입·이탈 처리가 까다로워진다" 며 1차 제외를 권한 부분이다. 이번엔 의도적으로 포함했으므로 인라인보다 실패 확률이 높다는 것을 전제로 계획한다
- **안드로이드 WebView 버전 편차** — WebView 는 Play 시스템 업데이트로 갱신돼 기기마다 다르다. 기기 1대 통과를 "안드로이드 통과" 로 적으면 안 되고, 확인한 WebView 버전을 결과에 함께 남긴다
- **Playwright 의 IME 재현 한계** — 자동 테스트가 초록이어도 그것이 IME 통과를 뜻하지 않는다. verify 단계에서 자동 체크 결과와 사람 확인 결과를 분리해 기록한다
- **`spike/` 가 본 코드로 새는 것** — 검증이 잘 되면 그대로 `src/` 로 옮기고 싶어지는데, 이 코드에는 `ime-log` 같은 검증 전용 장치가 섞여 있다. 이식 여부는 이번 사이클이 끝난 뒤 별도로 판단한다
