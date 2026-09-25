// 편집 화면 자잘한 표시 결함 6가지 (specs/features/F-152.md)
// 편집 모드 목록 기호 흔들림 (specs/features/F-166.md)
// 거터 세로 정렬·목록 내어쓰기 x·알림 띠 배치·코드 바탕색 같은 시각 값은 e2e 로 고정하지 않는다 (CLAUDE.md "How we work", 2026-09-25 e2e 경량화)
// — F-152 A1·A3·A5·A7·A8a, F-166 A1~A4 는 specs/human-checks.md 로 넘겼다. 원문 모드 장식 누수(F-152 A4)는 원문 보존 쪽 보장이라 남긴다
import { test, expect } from '@playwright/test'
import {
  openApp,
  importMarkdown,
  setViewMode,
  rectOf,
  readSavedContent,
} from './helpers.js'


const A1_DOC =
  // 빈 프론트매터는 F-155 위젯 대상이 아니라 원문 상자 첫 줄(md-frontmatter-first)이 남는다
  '---\n---\n\n# 제목1\n\n## 제목2\n\n### 제목3\n\n#### 제목4\n\n' +
  '##### 제목5\n\n###### 제목6\n\n---\n\n> [!note] 콜아웃\n> 본문\n\n일반 문단\n'

/** 거터 숫자 상자·내용 줄 첫 글자 상자의 세로 가운데 차이(px)를 대상 줄마다 잰다 */
test.describe('F-152 A2 거터 회귀', () => {
  test('줄 번호 순서·개수 그대로, 문단 줄은 건드리지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: A1_DOC })

    const check = await page.evaluate(() => {
      const numberEls = [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].filter(
        (el) => el.getBoundingClientRect().height > 0,
      )
      const numbers = numberEls.map((el) => Number(el.textContent))
      const lineCount = document.querySelectorAll('.cm-content > .cm-line').length
      // 대상 클래스가 아닌 줄(문단 등)의 거터 칸은 transform 을 받지 않아야 한다
      const untouched = [...document.querySelectorAll('.cm-content > .cm-line')]
        .map((lineEl, i) => ({ lineEl, i }))
        .filter(
          ({ lineEl }) =>
            !lineEl.matches(
              '.md-h1, .md-h2, .md-h3, .md-h4, .md-h5, .md-h6, .md-hr, .md-frontmatter-first, .md-callout-title',
            ),
        )
        .every(({ i }) => !(numberEls[i]?.style.transform))
      return { numbers, lineCount, untouched }
    })
    expect(check.numbers).toEqual(Array.from({ length: check.lineCount }, (_, i) => i + 1))
    expect(check.untouched).toBe(true)
  })

  test('F-124 A2d — 거터 숫자 위치를 바꿔도 그 줄 내용 클릭 위치는 그대로', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: A1_DOC })

    // 거터 숫자에 transform 을 줘도(2.1) 내용 줄(.cm-line) 자체의 클릭 판정 위치는
    // 바뀌지 않는다 — h3 제목 글자를 클릭해 그 줄 끝에 커서가 놓이는지로 확인한다
    await page.locator('.cm-content .md-heading', { hasText: /^제목3$/ }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('X')
    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('### 제목3X')
  })
})

test.describe('F-152 A4 원문 모양 누수', () => {
  test('제목·인라인코드·링크·콜아웃·표·목록이 든 문서, 원문 모드에 바탕 있는 글자 요소 없음', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, {
      content:
        '# 제목\n\n문단 `코드` [링크](https://example.com)\n\n> [!note] 콜아웃\n> 본문\n\n' +
        '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- 목록\n- [ ] 할일\n',
    })
    await setViewMode(page, 'raw')

    const leaks = await page.evaluate(() => {
      const out = []
      for (const el of document.querySelectorAll('.cm-content *')) {
        if (el.classList.contains('cm-selectionBackground') || el.classList.contains('cm-activeLine')) continue
        if (el.tagName === 'IMG' || el.tagName === 'INPUT') continue
        const cs = getComputedStyle(el)
        // opacity:0 인 요소(F-217 제목 툴팁 등 .icon-tooltip 패턴)는 실제로 안 보이므로 누수가 아니다
        if (parseFloat(cs.opacity) === 0) continue
        if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') out.push({ cls: el.className, kind: 'bg', v: cs.backgroundColor })
        if (cs.textDecorationLine !== 'none') out.push({ cls: el.className, kind: 'underline' })
        if (parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0) {
          out.push({ cls: el.className, kind: 'border' })
        }
      }
      return out
    })
    expect(leaks).toEqual([])
  })
})

test.describe('F-152 A6 목록 원문 불변', () => {
  test('목록 줄 끝에 입력·Enter 해도 원문이 입력한 만큼만 바뀐다', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 })
    await openApp(page)
    const docId = await importMarkdown(page, { content: '문단\n\n- 목록 항목\n' })

    await page.locator('.cm-line.md-list-line').click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await page.keyboard.press('Enter')
    await page.keyboard.type('둘째')

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('- 목록 항목!')
    expect(doc.content).toContain('둘째')
  })
})

// 코드블록 클릭 진입 회귀 + 언어·복사 버튼 (specs/features/F-240.md) — 앞에 문단을 둔다(코드블록이 문서 맨 앞이면 초기 커서(pos 0)와 겹쳐 원문으로 열려 클릭 진입 재현이 안 된다)
const F240_CODE_DOC = '문단\n\n```js\nline1\nline2\nline3\n```\n'

test.describe('F-240 A1 클릭 진입 (회귀)', () => {
  test('둘째 줄 클릭 → End → ! 입력 — 그 줄에 들어가고 포커스가 유지되며 원문으로 펼쳐진다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: F240_CODE_DOC })

    await page.locator('.md-codeblock-line', { hasText: 'line2' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')

    await expect(page.locator('.cm-editor.cm-focused')).toHaveCount(1)
    // 클릭한 코드블록이 원문으로 펼쳐졌다 — 위젯(줄 span)이 더는 없다
    await expect(page.locator('.md-codeblock-line')).toHaveCount(0)

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('line2!')
  })
})

test.describe('F-240 A2 클릭 진입 — 첫 줄·마지막 줄', () => {
  test('첫 줄 클릭 → Home → ! 입력', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: F240_CODE_DOC })

    await page.locator('.md-codeblock-line', { hasText: 'line1' }).click()
    await page.keyboard.press('Home')
    await page.keyboard.type('!')

    await expect(page.locator('.cm-editor.cm-focused')).toHaveCount(1)
    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('!line1')
  })

  test('마지막 줄 클릭 → End → ! 입력', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: F240_CODE_DOC })

    await page.locator('.md-codeblock-line', { hasText: 'line3' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')

    await expect(page.locator('.cm-editor.cm-focused')).toHaveCount(1)
    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('line3!')
  })
})

test.describe('F-240 A3 여백 클릭은 그대로', () => {
  test('.cm-content 바깥 좌우 여백을 클릭하면 포커스가 풀린다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: F240_CODE_DOC })

    await page.locator('.md-codeblock-line', { hasText: 'line2' }).click()
    await expect(page.locator('.cm-editor.cm-focused')).toHaveCount(1)

    const rect = await rectOf(page.locator('.cm-scroller'))
    await page.mouse.click(rect.left + 10, rect.top + rect.height / 2)

    await expect(page.locator('.cm-editor.cm-focused')).toHaveCount(0)
  })
})

test.describe('F-240 A4 언어 표시', () => {
  test('```js — 오른쪽 위에 js', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: F240_CODE_DOC })
    await expect(page.locator('.md-codeblock-lang')).toHaveText('JavaScript')
  })

  test('```js title="a.js" — js 만', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '문단\n\n```js title="a.js"\nline1\n```\n' })
    await expect(page.locator('.md-codeblock-lang')).toHaveText('JavaScript')
  })
})

test.describe('F-240 A5 언어 없는 코드블록', () => {
  test('언어 칸 없음, 복사 버튼은 있음', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '문단\n\n```\nline1\n```\n' })
    await expect(page.locator('.md-codeblock-lang')).toHaveCount(0)
    await expect(page.locator('.md-codeblock-head .code-copy-btn')).toHaveCount(1)
  })
})

test.describe('F-240 A6 복사', () => {
  test('본문 줄만(펜스·정보 문자열 제외) \\n 으로 이어진 문자열이 클립보드에 담긴다', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    await importMarkdown(page, { content: F240_CODE_DOC })

    await page.locator('.md-codeblock-head .code-copy-btn').click()
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    // OS 클립보드 왕복(Windows)이 \n 을 \r\n 으로 바꿀 수 있다 — 앱이 쓴 값 자체를 보려면 되돌린다
    expect(clip.replace(/\r\n/g, '\n')).toBe('line1\nline2\nline3')
  })
})

test.describe('F-240 A7 복사 버튼은 편집 진입 아님', () => {
  test('복사 버튼을 눌러도 위젯이 유지되고 커서가 코드블록 안으로 들어가지 않는다', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    await importMarkdown(page, { content: F240_CODE_DOC })

    await page.locator('.md-codeblock-head .code-copy-btn').click()

    await expect(page.locator('.md-codeblock-line')).toHaveCount(3) // 위젯 유지(원문으로 펼쳐지지 않음)
    await expect(page.locator('.cm-editor.cm-focused')).toHaveCount(0)
  })
})
