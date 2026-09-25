// 중첩 목록 깊이 안내선 (specs/features/F-236.md, F-251)
// 안내선 x·두께·색, 단계 간격 px 같은 시각 값은 e2e 로 고정하지 않는다 (CLAUDE.md "How we work", 2026-09-25 e2e 경량화) —
// 안내선이 그려지는지, 원문이 바뀌지 않는지, 들여쓰기 설정이 원문에 반영되는지만 남긴다
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setViewMode, readSavedContent, setPrefBeforeLoad } from './helpers.js'

test.describe('F-236 A1 보기 모드 2단계', () => {
  test('2단계 항목의 부모 목록에 안내선이 그려진다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 가\n  - 나\n' })
    await setViewMode(page, 'view')

    const nestedUl = page.locator('.markdown-body li ul').first()
    const content = await nestedUl.evaluate((el) => getComputedStyle(el, '::before').content)
    expect(content).not.toBe('none')
  })
})

test.describe('F-236 A7 원문 불변', () => {
  test('목록 줄 끝에 입력하면 원문이 입력한 글자만큼만 바뀐다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '- 가\n  - 나\n' })
    await setViewMode(page, 'live')
    await page.locator('.cm-line').filter({ hasText: '나' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')

    const saved = await readSavedContent(page, docId)
    expect(saved.content).toBe('- 가\n  - 나!\n')
  })
})

test.describe('F-251 A8 Tab 뒤 원문', () => {
  // 2칸·4칸 두 번 돌던 것을 2칸 하나로 줄이고 화면 깊이 px 단언은 뺐다 (2026-09-25 e2e 경량화)
  test('설정 2칸 — 둘째 항목에서 Tab 하면 원문 들여쓰기가 2칸', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.indent', '2')
    await openApp(page)
    const docId = await importMarkdown(page, { content: '- 가\n- 나\n마침\n' })

    await page.locator('.cm-line', { hasText: '나' }).click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Tab')

    const saved = await readSavedContent(page, docId)
    const naLine = saved.content.split('\n')[1]
    expect(naLine.match(/^( *)-/)[1].length).toBe(2)
  })
})
