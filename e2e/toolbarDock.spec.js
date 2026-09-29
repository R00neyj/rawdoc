// 휴대폰 폭 서식 바를 키보드 위로 (specs/features/F-2084.md 4장)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, fakeImeCompose, setPrefBeforeLoad } from './helpers.js'

const BODY = '선택\n\n둘째\n\n셋째\n'

async function blurAll(page) {
  await page.evaluate(() => /** @type {HTMLElement | null} */ (document.activeElement)?.blur())
}

async function editorHasFocus(page) {
  return page.evaluate(() => document.activeElement === document.querySelector('.cm-host .cm-content'))
}

test.describe('F-2084 휴대폰 폭 (390×844, 터치)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('F-2084 E1 포커스 때만 보인다', async ({ page }) => {
    // F-2085 부터 저장 공간 알림은 알약 아래 떠 있는 카드라 제목 입력칸을 덮는다 — 이 테스트는 서식 바만 본다
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    await importMarkdown(page, { content: BODY })
    await blurAll(page)
    await expect(page.locator('.editor-toolbar')).toHaveCount(0)

    await page.locator('.cm-content .cm-line', { hasText: '둘째' }).tap()
    const row = page.locator('.editor-toolbar-row.editor-toolbar-row--docked')
    await expect(row).toBeVisible()

    await page.locator('textarea.doc-title').tap()
    await expect(page.locator('.editor-toolbar')).toHaveCount(0)
  })

  test('F-2084 E2 누르면 포커스 유지, 조합 중 탭은 조합을 먼저 끝낸다, 분류 메뉴도 포커스 유지', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: BODY })
    await page.locator('.cm-content .cm-line', { hasText: '선택' }).tap()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')

    await page.evaluate(() => {
      const w = /** @type {any} */ (window)
      w.__f2084Events = []
      const content = document.querySelector('.cm-host .cm-content')
      content.addEventListener('focusout', () => w.__f2084Events.push('focusout'))
      content.addEventListener('compositionend', (e) => w.__f2084Events.push(`compositionend:${e.data}`))
      document.addEventListener('click', (e) => {
        if (/** @type {Element} */ (e.target).closest('.editor-toolbar-row')) w.__f2084Events.push('click')
      }, true)
    })

    // A3 — 버튼을 눌러도 본문이 blur 되지 않는다
    const row = page.locator('.editor-toolbar-row--docked')
    await row.getByRole('button', { name: '볼드체' }).tap()
    await expect(page.locator('.cm-line').first()).toHaveText('**선택**')
    expect(await page.evaluate(() => /** @type {any} */ (window).__f2084Events)).toEqual(['click'])
    await expect(row).toBeVisible()

    // A3 — 줄의 빈 곳(왼쪽 padding)
    await row.tap({ position: { x: 4, y: 20 } })
    expect(await editorHasFocus(page)).toBe(true)
    await expect(row).toBeVisible()

    // A4 — 조합 중 탭
    await page.locator('.cm-content .cm-line', { hasText: '둘째' }).tap()
    await page.keyboard.press('End')
    await page.evaluate(() => {
      const w = /** @type {any} */ (window)
      w.__f2084Events = []
    })
    await fakeImeCompose(page, '한')
    await expect(page.locator('.cm-line', { hasText: '둘째한' })).toHaveCount(1)
    await row.getByRole('button', { name: '볼드체' }).tap()

    await expect(page.locator('.cm-line', { hasText: '둘째' })).toHaveText('둘째한****')
    const events = await page.evaluate(() => /** @type {any} */ (window).__f2084Events)
    const endAt = events.indexOf('compositionend:한')
    expect(endAt).toBeGreaterThanOrEqual(0)
    expect(endAt).toBeLessThan(events.indexOf('click'))
    await expect.poll(() => editorHasFocus(page)).toBe(true)

    // 서식 분류 한 칸 메뉴 (2026-09-29 tweak) — 메뉴를 눌러도 포커스 유지
    await row.getByRole('button', { name: '서식 분류: 서식' }).tap()
    await expect(page.getByRole('menuitemradio')).toHaveCount(3)
    expect(await editorHasFocus(page)).toBe(true)
    await page.getByRole('menuitemradio', { name: '삽입' }).tap()
    expect(await editorHasFocus(page)).toBe(true)
  })
})
