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

// 코드블록 클릭 진입 회귀 + 복사 버튼 (specs/features/F-240.md) — 앞에 문단을 둔다(코드블록이 문서 맨 앞이면 초기 커서(pos 0)와 겹쳐 원문으로 열려 클릭 진입 재현이 안 된다)
const F240_CODE_DOC = '문단\n\n```js\nline1\nline2\nline3\n```\n'
const F240_THREE_BLOCKS = ['a', 'b', 'c'].map((p) => `\`\`\`js\n${p}1\n${p}2\n${p}3\n\`\`\`\n`).join('\n문단\n\n')

test.describe('F-240 코드블록', () => {
  test('F-240 A1·A2·A3 클릭 진입(둘째·첫·마지막 줄) 회귀, 여백 클릭은 포커스를 푼다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: `문단\n\n${F240_THREE_BLOCKS}` })
    const lines = page.locator('.md-codeblock-line')
    const focused = page.locator('.cm-editor.cm-focused')

    await lines.filter({ hasText: 'a2' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await expect(focused).toHaveCount(1)
    await expect(lines).toHaveCount(6)

    await lines.filter({ hasText: 'b1' }).click()
    await page.keyboard.press('Home')
    await page.keyboard.type('!')
    await expect(focused).toHaveCount(1)

    await lines.filter({ hasText: 'c3' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await expect(focused).toHaveCount(1)

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('a2!')
    expect(doc.content).toContain('!b1')
    expect(doc.content).toContain('c3!')

    const rect = await rectOf(page.locator('.cm-scroller'))
    await page.mouse.click(rect.left + 10, rect.top + rect.height / 2)
    await expect(focused).toHaveCount(0)
  })

  test('F-240 A6·A7 복사 버튼 — 본문 줄만 클립보드에 담기고 편집 진입은 아니다', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    await importMarkdown(page, { content: F240_CODE_DOC })

    await page.locator('.md-codeblock-head .code-copy-btn').click()
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip.replace(/\r\n/g, '\n')).toBe('line1\nline2\nline3')
    await expect(page.locator('.md-codeblock-line')).toHaveCount(3)
    await expect(page.locator('.cm-editor.cm-focused')).toHaveCount(0)
  })
})
