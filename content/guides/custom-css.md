---
title: 사용자 CSS 로 모양 바꾸기
summary: 설정 `사용자 CSS` 탭의 스니펫과 템플릿, 약속된 변수와 훅, 테마·인쇄·HTML 파일에서 먹는 규칙, 빠지는 외부 파일, 계정 저장, 화면이 망가졌을 때 여는 법.
date: 2026-09-30
updated: 2026-09-30
---

# 사용자 CSS 로 모양 바꾸기

사이드바 `설정`의 `사용자 CSS` 탭에 직접 쓴 CSS를 넣으면 앱의 색·서체·모서리 같은 모양을 바꿀 수 있습니다. CSS는 스니펫이라는 이름 붙은 덩어리로 나눠 두고 하나씩 켜고 끕니다. 문서 원문에는 아무것도 더하지 않습니다.

## 스니펫 만들기

1. `새 스니펫`을 누르면 `스니펫 1`처럼 이름이 붙은 빈 스니펫이 켜진 채 목록 끝에 생기고 `CSS 편집` 창이 열립니다
2. `CSS` 칸에 규칙을 씁니다. 입력을 멈추면 곧 저장되고, 켜진 스니펫이면 바로 화면에 적용됩니다. `닫기`를 누를 때도 저장합니다
3. 창 아래에 `규칙 3개 적용 중`처럼 적용된 규칙 수가 나옵니다. 문법이 틀린 규칙은 알림 없이 브라우저가 버리므로, 수가 생각보다 적으면 그 부분을 다시 봅니다

- `템플릿으로 시작`은 `템플릿`이라는 스니펫을 만듭니다. 아래 표의 변수와 선택자가 설명·지금 기본값과 함께 모두 주석으로 들어 있어 켜져 있어도 화면은 그대로이고, 바꿀 줄의 주석 표시를 지우면 그 줄이 적용됩니다
- 목록의 체크 상자로 켜고 끕니다. 켠 스니펫은 위에서부터 차례로 적용되어, 같은 세기의 규칙이면 아래 스니펫이 이깁니다. 순서는 만든 순서이고 바꿀 수 없습니다
- 스니펫은 50개까지, CSS는 모든 스니펫을 합쳐 256KB(262,144바이트)까지, 이름은 60자까지입니다. 크기를 넘기는 입력은 들어가지 않고 `CSS 는 모두 합쳐 256KB 까지 저장할 수 있습니다.`가 뜹니다
- 같은 브라우저의 다른 탭에도 곧 적용됩니다

## 선택자와 우선순위

| 적용할 곳 | 선택자 |
| --- | --- |
| 모든 테마·인쇄·HTML 파일 | `:root:root` |
| 한 테마에만 | `:root[data-theme='white']` · `'sepia'` · `'dark'` |
| 설정값에 따라 | `[data-heading-font]` `[data-body-font]` `[data-font-size]` `[data-indent]` (`<html>`), `[data-view-mode]` (문서 영역, `live`·`raw`·`view`) |

- `:root`만 쓰면 세피아·다크 테마와 `글자 크기` 설정의 값에 집니다. `:root:root`는 그 값과 세기가 같고 사용자 CSS가 늘 뒤에 오므로 이깁니다
- 테마별 규칙은 공통 규칙 뒤에 둡니다. 테마가 `시스템`이어도 `data-theme`는 `white`나 `dark`입니다
- `@layer` 안에 쓴 규칙은 앱 규칙에 집니다

```css
:root:root {
  --accent: teal;
  --radius-control: 999px;
}
:root[data-theme='dark'] {
  --accent: color-mix(in srgb, teal 60%, white);
}
```

## 약속된 변수

아래 변수와 두 훅 표만 약속합니다. 그 밖의 클래스·변수·화면 구조는 새 버전에서 알림 없이 바뀔 수 있습니다.

| 묶음 | 변수 |
| --- | --- |
| 기본 색 | `--paper` 바탕 · `--panel` 대화상자·메뉴 · `--ink` 글자 · `--ink-2` 보조 글자 · `--muted` 흐린 글자 · `--rule` `--rule-2` 구분선 · `--link` 링크 · `--danger` 오류 · `--accent` 강조 |
| 파생 색 | `--accent-soft` `--accent-ring` `--selection-bg` |
| 본문 | `--md-font-size` `--md-line-height` `--md-fg-muted` `--md-border` `--md-border-muted` `--md-bg-muted` `--md-code-bg` `--md-link` `--highlight-base` `--md-highlight-bg` |
| 콜아웃 | `--callout-note` `--callout-tip` `--callout-success` `--callout-question` `--callout-warning` `--callout-danger` `--callout-example` `--callout-quote` |
| 지도 그룹 | `--map-group-1` `--map-group-2` `--map-group-3` `--map-group-4` `--map-group-5` `--map-group-6` `--map-group-7` `--map-group-8` |
| 댓글 | `--comment-anchor` `--comment-anchor-active` `--comment-anchor-line` |
| 서체 | `--font-sans` `--font-serif` `--font-mono` `--font-display` 제목 · `--font-body` 본문 · `--tracking` 자간 |
| 모양 | `--radius-control` `--radius-dialog` `--radius-image` |

- `--md-font-size`·`--font-display`·`--font-body`를 바꾸면 설정 `글자 크기`·`제목 서체`·`본문 서체`가 먹지 않습니다
- 지도 캔버스 안은 선택자가 닿지 않고, `--panel` `--ink` `--ink-2` `--muted` `--rule` `--accent`와 지도 그룹 색만 읽어 칠합니다

## 화면 뼈대 훅

`:root:root [data-ui="sidebar"]`처럼 씁니다. 요소가 그 자리에 있다는 것만 약속하므로, 앱 규칙에 지면 선택자를 더 구체적으로 쓰거나 `!important`를 붙입니다.

| 값 | 자리 |
| --- | --- |
| `app` · `home` · `map` | 앱 화면 전체 · 홈 화면 · 지도 화면 |
| `sidebar` · `sidebar-list` | 사이드바 · 그 안의 문서·폴더 목록 |
| `topbar` · `statusbar` · `notice` | 상단바 · 상태바 · 알림 띠 |
| `content` · `doc-title` | 문서 영역 · 문서 제목 |
| `editor` · `viewer` · `print` | `편집`·`원문` 편집기 · `보기` 본문 틀 · 인쇄 영역 |
| `outline` · `comments` | 목차 · 댓글 레일 |
| `dialog` · `menu` | 대화상자 · 오른쪽 버튼·드롭다운 메뉴 |

## 본문 훅

선택자는 모두 `:root:root `로 시작하며 표에는 그 뒤만 적었습니다. 그대로 쓰면 앱 규칙을 이깁니다.

| 대상 | `편집`·`원문` | `보기`·인쇄·HTML 파일 |
| --- | --- | --- |
| 제목 | `.cm-editor .cm-line.md-h1` ~ `.md-h6` | `.markdown-body h1` ~ `h6` |
| 인용 | `.cm-editor .cm-line.md-quote` | `.markdown-body blockquote` |
| 콜아웃 | `.cm-editor .cm-line.md-callout` | `.markdown-body .markdown-callout` |
| 코드블록 | `.cm-editor .cm-line.md-fence-line`, `.md-block.md-codeblock` | `.markdown-body pre` |
| 인라인 코드 | `.cm-editor .cm-line:not(.md-fence-line) .md-code` | `.markdown-body :not(pre) > code` |
| 표 | `.md-block.md-table table` | `.markdown-body table` |
| 링크 | `.cm-editor .cm-line .md-link` | `.markdown-body a` |
| 하이라이트 | `.cm-editor .md-highlight` | `.markdown-body mark` |
| 목록 항목 | `.cm-editor .cm-line.md-list-line` | `.markdown-body li` |
| 구분선 | `.cm-editor .cm-line.md-hr` | `.markdown-body hr` |
| 본문 전체 | `.cm-editor .cm-content` | `.markdown-body` |

콜아웃 종류는 두 모드 모두 `.md-callout--note`처럼 붙습니다.

## 인쇄와 HTML 파일

- 상단바 `내보내기`의 `HTML 파일`과 `PDF (A4 인쇄)`에도 켠 스니펫이 들어갑니다. 파일에는 검사를 거친 CSS가 스니펫 이름 주석과 함께 담깁니다
- 인쇄와 HTML 파일에는 `data-theme`가 없어 테마별 규칙이 먹지 않습니다. 인쇄에만 쓸 규칙은 `@media print`나 `:root[data-printing]`에 둡니다
- HTML 파일에는 앱 화면이 없어 `data-ui` 규칙은 먹지 않고, `:root:root` 변수와 보기 쪽 선택자만 먹습니다
- `서식 있는 복사`에는 들어가지 않습니다

## 외부 파일은 빠집니다

외부 주소를 부르는 CSS는 화면에 무엇이 있는지를 그 주소로 알릴 수 있고, 오프라인이나 HTML 파일에서는 열리지도 않습니다. 그래서 적용하기 전에 아래를 잘라 냅니다.

- `@import`
- `url()` 주소가 `data:`나 `#`으로 시작하지 않는 선언, `image-set()`·`image()`·`src()`를 쓴 선언
- `src`가 `data:`나 `local()`이 아닌 `@font-face` 규칙 통째
- `--`로 시작하는 변수 값에 `url(`이나 `\`가 든 선언(`data:`여도), `var()`와 `url()`을 한 값에 쓴 선언
- 목록에 없는 `@` 규칙. 쓸 수 있는 것은 `@media` `@supports` `@container` `@layer` `@scope` `@starting-style` `@keyframes` `@font-face` `@page`

잘라 낸 곳이 있으면 `외부 파일을 부르는 부분 2곳을 빼고 적용했습니다.`가, 검사가 CSS를 읽어 내지 못하면 `검사를 통과하지 못해 이 스니펫을 적용하지 않았습니다.`가 뜹니다. 웹 글꼴 대신 이 기기에 설치된 글꼴을 이름으로 쓰세요.

## 계정과 다른 사람

- 로그인하지 않으면 이 브라우저에만 저장합니다. 로그인하면 계정에 저장해 같은 계정의 다른 기기에도 적용합니다
- 고친 내용은 마지막으로 고친 지 2초 뒤, `CSS 편집` 창을 닫을 때, 연결이 돌아올 때 서버로 보냅니다. 다른 기기의 변경은 앱을 열 때, `사용자 CSS` 탭을 열 때, 창으로 돌아왔는데 받은 지 10분이 지났을 때 받아 옵니다
- 두 기기가 같은 스니펫을 함께 고치면 나중에 보낸 쪽이 남습니다
- 이 브라우저에서 그 계정으로 처음 로그인하면 로그인 전 스니펫 가운데 계정에 없는 것을 끝에 붙이고, 이름만 같으면 `(이 브라우저)`를 붙입니다. 로그아웃하면 로그인 전 스니펫이 다시 적용됩니다
- 사용자 CSS는 금고처럼 암호화하지 않고 서버에 저장하므로 비밀을 적지 마세요. 계정을 지우면 함께 지워집니다
- 문서·공유·초대에는 실리지 않아 다른 사람 화면에는 적용되지 않습니다. 내가 읽기 전용 링크를 열 때도 빼서 남이 보는 모양 그대로 봅니다. 내보낸 HTML 파일은 예외입니다

## 화면이 망가졌을 때

`* { display: none }`처럼 설정 창까지 가리는 CSS를 켰다면 주소 끝에 `?safe`를 붙여(`/?safe`) 엽니다. 그 창에서는 사용자 CSS를 적용하지 않고 알림 띠에 `사용자 CSS 를 끄고 열었습니다.`와 `다시 켜기`가 뜹니다.

- `사용자 CSS` 탭에서 문제 스니펫을 끄거나 고칩니다. 저장은 되지만 이 창에는 적용하지 않으니, 다 고친 뒤 `다시 켜기`로 `safe`를 뺀 주소를 다시 엽니다
- `/?safe`가 소개 페이지로 가면 `/?app=1&safe`로 엽니다
- 앱이 이상하게 보이면 먼저 `?safe`로 열어 사용자 CSS 때문인지 가려 봅니다
