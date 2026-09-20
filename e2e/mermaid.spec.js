// Mermaid 다이어그램 (specs/features/F-258.md) — 이번 라운드는 e2e 2개로 제한(3장). F-260(다크모드) 은 e2e 1개만 이어 쓴다(색값은 사람 확인, 재렌더 여부만 스모크)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent } from './helpers.js'

const VALID_DOC = '문단\n\n```mermaid\ngraph TD; A-->B\n```\n'
const INVALID_DOC = '문단\n\n```mermaid\n이것은 mermaid 문법이 아닙니다\n```\n'

test.describe('F-258 A3 편집 모드 렌더링', () => {
  test('유효한 mermaid 코드는 svg 로 그려지고, 클릭하면 원문(펜스 포함) 진입', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: VALID_DOC })

    await expect(page.locator('.md-mermaid svg')).toBeVisible()

    await page.locator('.md-mermaid').click()
    await expect(page.locator('.md-mermaid')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('```mermaid')
    await expect(page.locator('.cm-content')).toContainText('graph TD; A-->B')
  })
})

test.describe('F-258 A4 문법 오류', () => {
  test('잘못된 mermaid 코드는 오류 문구를 보이고 원문은 그대로 남는다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: INVALID_DOC })

    await expect(page.locator('.md-mermaid-error')).toBeVisible()
    await expect(page.locator('.md-mermaid svg')).toHaveCount(0)

    await expect(page.locator('.cm-content')).toContainText('이것은 mermaid 문법이 아닙니다')

    const saved = await readSavedContent(page, docId)
    expect(saved.content).toBe(INVALID_DOC)
  })
})

test.describe('F-260 A2·A3 테마 전환 시 즉시 재렌더', () => {
  test('설정에서 테마를 다크로 바꾸면 같은 다이어그램이 다시 그려지고 원문은 그대로다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: VALID_DOC })

    const svg = page.locator('.md-mermaid svg')
    await expect(svg).toBeVisible()
    const idBefore = await svg.getAttribute('id')

    await page.getByRole('button', { name: '설정', exact: true }).click()
    await page.getByRole('radio', { name: '다크' }).click()
    await page.getByRole('button', { name: '닫기', exact: true }).click()

    // mermaid.render() 가 새 id 로 다시 실행됐는지로 재렌더를 판정한다(색값은 사람 확인)
    await expect(svg).not.toHaveAttribute('id', idBefore)

    // A2: 원문 불변
    const saved = await readSavedContent(page, docId)
    expect(saved.content).toBe(VALID_DOC)
  })
})
