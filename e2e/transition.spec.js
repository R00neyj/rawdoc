// 호버·툴팁 전환 (specs/features/F-149.md 3장)
// 나타나고 사라지는 요소 전환 (specs/features/F-172.md 3장)
// 전환 곡선·시간·중간 프레임 같은 시각 값은 e2e 로 고정하지 않는다 (CLAUDE.md "How we work", 2026-09-25 e2e 경량화) —
// 여기에는 열고 닫히는 동작, 키보드 회귀, 움직임 줄이기만 남긴다
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, resizeWindow, waitTransitionEnd, setPrefBeforeLoad, EXPORT_BUTTON_LABEL } from './helpers.js'

// 합성 드래그로 .md 파일을 사이드바에 놓아 알림 띠를 띄운다(e2e/fileDrop.spec.js 와 같은 방식)
async function dropMarkdownFile(page, targetSelector, file) {
  await page.evaluate(
    ({ targetSelector, file }) => {
      const dt = new DataTransfer()
      dt.items.add(new File([file.content], file.name, { type: 'text/markdown' }))
      const el = document.querySelector(targetSelector)
      const init = { bubbles: true, cancelable: true, dataTransfer: dt }
      el.dispatchEvent(new DragEvent('dragenter', init))
      el.dispatchEvent(new DragEvent('drop', init))
    },
    { targetSelector, file },
  )
}

// 저장 공간 보호 경고(F-118)가 알림을 선점하지 않게 미리 본 것으로 표시해 둔다(e2e/fileDrop.spec.js 와 같은 이유)
async function skipPersistNotice(page) {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
}

async function openDeleteDialog(page) {
  const row = page.locator('.tree-row').first()
  await row.hover()
  await row.locator('.item-menu-btn').click()
  // 닫히는 중(mounted+inert)인 다른 행 메뉴와 role 이 겹칠 수 있어 first() 로 지금 연 메뉴를 명시한다
  await page.getByRole('menuitem', { name: /삭제/ }).first().click()
}

test.describe('F-149 A3 툴팁 나타남', () => {
  test('상단바 버튼 — 호버하면 툴팁이 뜨고, 떠나면 사라지고, 포커스로도 뜬다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    const btn = page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true })
    const wrap = page.locator('.icon-btn-wrap').filter({ has: btn })
    const tooltip = wrap.locator('.icon-tooltip')

    await btn.hover()
    await expect(tooltip).toHaveCSS('opacity', '1')

    await page.mouse.move(10, 10)
    await expect(tooltip).toHaveCSS('opacity', '0')

    await btn.focus()
    await expect(tooltip).toHaveCSS('opacity', '1')
  })
})

test.describe('F-172 A4 닫힌 뒤 300ms', () => {
  test('공유 메뉴·⋯ 메뉴·알림 띠는 DOM 에서 없어진다', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await expect(page.locator('.share-menu-list')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await expect(page.locator('.share-menu-list')).toHaveCount(0)

    const row = page.locator('.tree-row').first()
    await row.hover()
    await row.locator('.item-menu-btn').click()
    await expect(page.locator('.item-menu-list')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await expect(page.locator('.item-menu-list')).toHaveCount(0)

    await dropMarkdownFile(page, '.sidebar', { name: 'a.md', content: '내용\n' })
    const notice = page.locator('.notice')
    await expect(notice).toBeVisible()
    await notice.locator('.icon-btn-wrap .icon-btn').click()
    await page.waitForTimeout(300)
    await expect(notice).toHaveCount(0)
  })

  test('겹침 사이드바는 inert·visibility:hidden 으로 남고, 대화상자는 open 속성이 없어진다', async ({ page }) => {
    await openApp(page)

    await resizeWindow(page, 900)
    const sidebar = page.locator('.sidebar')
    await waitTransitionEnd(sidebar) // 넓은 창 → 좁은 창 진입 때 함께 걸리는 닫힘 전환이 끝나길 기다린다
    await page.locator('.sidebar-toggle').click()
    await expect(sidebar).toBeVisible()
    await page.mouse.click(700, 400) // 바깥 클릭으로 닫기
    await page.waitForTimeout(300)
    await expect(sidebar).toHaveCount(1) // DOM 에는 남아있다
    expect(await sidebar.evaluate((el) => el.inert)).toBe(true)
    expect(await sidebar.evaluate((el) => getComputedStyle(el).visibility)).toBe('hidden')

    await resizeWindow(page, 1600)
    await openDeleteDialog(page)
    await expect(page.locator('dialog.dialog[open]')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await expect(page.locator('dialog.dialog[open]')).toHaveCount(0)
  })
})

// F-172 A5 키보드 회귀는 e2e/topbar.spec.js F-163 A1(공유 메뉴 첫 항목 포커스·Esc 뒤 버튼 포커스)과 위 F-172 A4(대화상자 Esc 닫힘)가 대신한다

// 움직임 줄이기 — F-149 A6·F-172 A6·F-173 A3·F-228 A6 을 하나로 합쳤다 (2026-09-25 e2e 경량화)
test.describe('움직임 줄이기 (F-149 A6·F-172 A6·F-173 A3·F-228 A6)', () => {
  test('reducedMotion: reduce 면 전환 토큰이 모두 0ms, 툴팁·메뉴 전환 0s, 닫자마자 닫힌 상태', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await skipPersistNotice(page)
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement)
      return {
        fast: cs.getPropertyValue('--transition-fast').trim(),
        move: cs.getPropertyValue('--transition-move').trim(),
        pop: cs.getPropertyValue('--transition-pop').trim(),
      }
    })
    expect(tokens).toEqual({ fast: '0ms', move: '0ms', pop: '0ms' })

    const allZero = (d) => d.split(',').every((s) => s.trim() === '0s')

    const btn = page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true })
    await btn.hover()
    const tooltipDuration = await page
      .locator('.icon-btn-wrap')
      .filter({ has: btn })
      .locator('.icon-tooltip')
      .evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(allZero(tooltipDuration), tooltipDuration).toBe(true)

    const row = page.locator('.tree-row').first()
    await row.hover()
    await row.locator('.item-menu-btn').click()
    const itemMenu = page.locator('.item-menu-list')
    const menuDuration = await itemMenu.evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(allZero(menuDuration), menuDuration).toBe(true)
    await page.keyboard.press('Escape')
    await expect(itemMenu).toHaveCount(0)

    // 기다리지 않아도 닫힌 상태가 된다 (F-172 A6)
    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    const menu = page.locator('.share-menu-list')
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    await dropMarkdownFile(page, '.sidebar', { name: 'a.md', content: '내용\n' })
    const notice = page.locator('.notice')
    await expect(notice).toBeVisible()
    await notice.locator('.icon-btn-wrap .icon-btn').click()
    await expect(notice).toHaveCount(0)
  })
})
