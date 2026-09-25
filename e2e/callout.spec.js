// 콜아웃 종류 아이콘 (specs/features/F-148.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, setViewMode, rectOf } from './helpers.js'

// note·info·todo 는 note 색 묶음, DANGER 는 danger 색 묶음, 모르는 이름도 note 색 묶음 (F-128 2.1)
const A2_DOC = `# 문서

> [!note] 노트 제목
> 본문

> [!tip] 팁 제목
> 본문

> [!warning] 경고 제목
> 본문

> [!DANGER] 위험 제목
> 본문

> [!unknown] 모르는 종류
> 본문

> [!info]
> 제목 없음
`

const KINDS = [
  { title: '노트 제목' },
  { title: '팁 제목' },
  { title: '경고 제목' },
  { title: '위험 제목' },
  { title: '모르는 종류' },
]

test.describe('F-148 A2 편집 모드', () => {
  test('머리 줄마다 svg 1개, 모르는 종류는 note 아이콘, [! 없음, 원문 불변', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: A2_DOC })

    // 커서를 콜아웃 밖(맨 앞 제목 줄)에 둔다 — 모든 콜아웃 머리 줄이 비활성 상태
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')

    for (const { title } of KINDS) {
      const line = page.locator('.cm-content .cm-line', { hasText: title })
      await expect(line).toHaveCount(1)
      await expect(line).not.toContainText('[!')

      const svg = line.locator('.md-callout-icon svg')
      await expect(svg).toHaveCount(1)
    }

    // 제목 없는 [!info] — 위젯이 기본 제목 글자(Info)를 보여준다
    const infoLine = page.locator('.cm-content .cm-line', { hasText: 'Info' })
    await expect(infoLine).toHaveCount(1)
    await expect(infoLine.locator('.md-callout-icon svg')).toHaveCount(1)

    // 노트와 모르는 종류(unknown)는 같은 아이콘(edit) — svg 안쪽 마크업이 같다
    const noteSvgHtml = await page.locator('.cm-content .cm-line', { hasText: '노트 제목' }).locator('.md-callout-icon svg').innerHTML()
    const unknownSvgHtml = await page.locator('.cm-content .cm-line', { hasText: '모르는 종류' }).locator('.md-callout-icon svg').innerHTML()
    expect(unknownSvgHtml).toBe(noteSvgHtml)

    // 원문 불변
    const doc = await readSavedContent(page, docId)
    expect(doc.content).toBe(A2_DOC)
  })
})

const A3_DOC = '> [!note] 제목\n> 본문\nx\n'

test.describe('F-148 A3 활성 줄', () => {
  test('커서가 머리 줄에 있으면 [!type] 이 보이고 아이콘이 없다, 나가면 다시 아이콘만', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: A3_DOC })

    const headerLine = page.locator('.cm-line.md-callout-title')

    // 다른 줄('x')에 커서 — 머리 줄은 비활성, 아이콘만
    await page.locator('.cm-content .cm-line', { hasText: 'x' }).click()
    await expect(headerLine.locator('.md-callout-icon svg')).toHaveCount(1)
    await expect(headerLine).not.toContainText('[!note]')

    // 머리 줄을 클릭 — 활성, 원문 그대로
    await headerLine.click()
    await expect(headerLine).toContainText('[!note]')
    await expect(headerLine.locator('.md-callout-icon svg')).toHaveCount(0)

    // 다시 다른 줄로 — 아이콘으로 복귀
    await page.locator('.cm-content .cm-line', { hasText: 'x' }).click()
    await expect(headerLine.locator('.md-callout-icon svg')).toHaveCount(1)
  })

  test('편집기 포커스를 해제하면 머리 줄에 커서가 있어도 아이콘만 보인다 (F-146 규칙)', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: A3_DOC })

    const headerLine = page.locator('.cm-line.md-callout-title')
    await headerLine.click()
    await expect(headerLine).toContainText('[!note]')

    // 문서 칸 왼쪽 여백을 클릭해 포커스만 없앤다 (e2e/margin.spec.js 와 같은 방식)
    const scrollerRect = await rectOf(page.locator('.cm-scroller'))
    await page.mouse.click(scrollerRect.left + 10, scrollerRect.top + scrollerRect.height / 2)

    await expect(headerLine.locator('.md-callout-icon svg')).toHaveCount(1)
    await expect(headerLine).not.toContainText('[!note]')
  })
})

test.describe('F-148 A4 보기 모드·공유 화면', () => {
  test('제목 앞에 아이콘이 보인다 — 보기 모드·공유 화면', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    await importMarkdown(page, { content: A3_DOC })

    await setViewMode(page, 'view')
    const title = page.locator('.viewer .markdown-callout-title')
    const svg = title.locator('.markdown-callout-icon svg')
    await expect(svg).toHaveCount(1)

    // 공유 화면도 같은 렌더러 (F-148 3.2)
    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await page.getByRole('menuitem', { name: '링크 복사' }).click()
    const link = await page.evaluate(() => navigator.clipboard.readText())
    const hash = new URL(link).hash
    await page.evaluate((h) => {
      location.hash = h
    }, hash)
    await expect(page.locator('.shared-view')).toBeVisible()

    const sharedSvg = page.locator('.shared-view .markdown-callout-title .markdown-callout-icon svg')
    await expect(sharedSvg).toHaveCount(1)
  })
})

// F-148 아이콘 크기(18×18)·색(콜아웃 색, 세 테마)은 시각 값이라 e2e 에서 뺐다 — specs/human-checks.md (2026-09-25 e2e 경량화)
