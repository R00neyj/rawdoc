// 사이드바 접기·레일, 검색 버튼, 목록 행 모양, 편집 영역 개방, 문서 여백 (F-150.md 3.3)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, resizeWindow, rectOf, computedStyle, waitTransitionEnd, tokenAsRgb } from './helpers.js'

// F-143 A3·A6 은 토글·검색이 상단바로 옮겨가 (F-151) e2e/topbar.spec.js 의
// F-151 A2·A3·A5·A6 테스트로 옮겼다. 레일 폭·유지만 여기 남긴다
test.describe('F-143 사이드바 접기', () => {
  test('F-143 A3 접으면 48px 레일이 되고 새로고침 뒤에도 유지된다', async ({ page }) => {
    await openApp(page)
    const toggle = page.getByRole('button', { name: '사이드바 접기' })
    await toggle.click()

    const sidebar = page.locator('.sidebar')
    await expect(sidebar).toHaveClass(/sidebar--collapsed/)
    await waitTransitionEnd(sidebar)
    const width = (await rectOf(sidebar)).width
    expect(Math.abs(width - 48)).toBeLessThanOrEqual(1)

    await expect(page.getByRole('button', { name: '사이드바 펴기' })).toBeVisible()
    await expect(page.getByRole('button', { name: '새 문서' })).toBeVisible()
    await expect(page.getByRole('button', { name: '새 폴더' })).toBeVisible()
    await expect(page.getByRole('button', { name: '가져오기' })).toBeVisible()

    await page.reload()
    await expect(page.locator('.sidebar')).toHaveClass(/sidebar--collapsed/)

    const openBtn = page.getByRole('button', { name: '사이드바 펴기' })
    await openBtn.click()
    await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--collapsed/)
    // F-151 2.2 — 버튼이 사라지지 않으므로 누른 뒤 포커스는 그대로 토글 버튼에 남는다
    await expect(page.getByRole('button', { name: '사이드바 접기' })).toBeFocused()
  })
})

test.describe('F-143 A5 좁은 창(900px)', () => {
  test('상단바 토글로 사이드바를 열고 닫을 수 있고, 넓히면 저장된 상태로 돌아간다', async ({ page }) => {
    await openApp(page)
    await resizeWindow(page, 900)
    await expect(page.locator('.sidebar')).toBeHidden()

    const openToggle = page.locator('.sidebar-toggle')
    await expect(openToggle).toHaveAttribute('aria-label', '사이드바 열기')
    await openToggle.click()
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--collapsed/)

    // 바깥 클릭으로 닫힌다 — 사이드바가 화면 왼쪽 일부를 덮으므로 그 밖(오른쪽)을 클릭한다
    await page.mouse.click(700, 400)
    await expect(page.locator('.sidebar')).toBeHidden()

    await resizeWindow(page, 1280)
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--collapsed/)
  })
})

test.describe('F-143 A7 행 호버', () => {
  test('호버·현재 표시가 행 전체 폭에 칠해진다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '문서.md', content: '내용\n' })
    const row = page.locator('.tree-row').filter({ hasText: '문서' }).first()
    const sidebarRect = await rectOf(page.locator('.doc-list'))
    const rowRect = await rectOf(row)
    expect(Math.abs(rowRect.width - sidebarRect.width)).toBeLessThanOrEqual(4)

    await row.hover()
    const bg = await computedStyle(row, 'background-color')
    expect(bg).not.toBe('rgba(0, 0, 0, 0)')

    // 현재 문서 행은 호버해도 유지된다
    const btnBgBefore = await computedStyle(row.locator('.doc-item-btn'), 'background-color')
    expect(btnBgBefore).toBe('rgba(0, 0, 0, 0)')
  })
})

test.describe('F-143 A8 행 여백', () => {
  test('왼쪽 0px(최상위)·오른쪽 4px·토글-글자 간격 6px', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '문서.md', content: '내용\n' })
    const row = page.locator('.tree-row').filter({ hasText: '문서' }).first()
    const rowRect = await rectOf(row)
    const toggleSpacer = row.locator('.tree-toggle-spacer')
    const label = row.locator('.tree-label')
    const menuBtn = row.locator('.item-menu-btn')

    // 최상위(depth 0) 행 왼쪽 여백 0 — 사이드바 동작 버튼과 글자 시작선을 맞춘다 (F-153 2.3)
    const spacerRect = await rectOf(toggleSpacer)
    expect(Math.abs(spacerRect.left - rowRect.left)).toBeLessThanOrEqual(1)

    const labelRect = await rectOf(label)
    expect(labelRect.left).toBeGreaterThan(spacerRect.right - 1)

    const menuRect = await rectOf(menuBtn)
    expect(Math.abs(rowRect.right - menuRect.right)).toBeLessThanOrEqual(4)
  })
})

test.describe('F-143 A14 편집 영역 개방', () => {
  test('메인 열 바탕이 한 가지고 세로 스크롤바가 메인 열 오른쪽 끝에 붙는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: Array.from({ length: 200 }, (_, i) => `줄 ${i}`).join('\n') })

    const mainColumn = page.locator('.main-column')
    const contentArea = page.locator('.content-area')
    const scroller = page.locator('.cm-scroller')

    const contentBg = await computedStyle(contentArea, 'background-color')
    const panelRgb = await tokenAsRgb(page, '--panel')
    // 메인 열 전체(편집 영역 포함)가 --panel 한 가지 바탕이어야 한다(구분 없음, F-143 3.8)
    expect(contentBg).toBe(panelRgb)

    const scrollerRect = await rectOf(scroller)
    const mainRect = await rectOf(mainColumn)
    expect(Math.abs(scrollerRect.right - mainRect.right)).toBeLessThanOrEqual(1)

    // 문서 전체 가로 스크롤은 없다
    const sizes = await scroller.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
    expect(sizes.scrollWidth).toBe(sizes.clientWidth)
  })
})

test.describe('F-143 A16 아이콘 크기·가이드 선', () => {
  test('토글 svg 가 줄어들지 않고, 펼친 폴더에 가이드 선이 보인다', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '새 폴더', exact: true }).click()
    await page.keyboard.press('Enter') // 이름 그대로 커밋

    // 폴더 안에 문서를 만들어야 펼친 폴더에 하위 항목(가이드 선 조건)이 생긴다.
    // 폴더 행만 `.tree-toggle` 버튼을 갖는다(문서 행은 `.tree-toggle-spacer`) — 이걸로 가른다
    // hover 는 병렬 실행 중 재렌더로 풀릴 수 있어(F-152 A16 불안정 원인) 대신 focus 로 연다 —
    // .item-menu-btn 은 :hover 외 :focus-within 에서도 보인다(app.css 407~410행)
    const folderRow = page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') }).first()
    const menuBtn = folderRow.locator('.item-menu-btn')
    await menuBtn.focus()
    await menuBtn.click()
    await page.getByRole('menuitem', { name: '새 문서' }).click()

    const folderToggle = page.locator('.tree-toggle').first()
    const svg = folderToggle.locator('svg')
    const svgSize = await svg.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { width: r.width, height: r.height }
    })
    expect(Math.abs(svgSize.width - 16)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(svgSize.height - 16)).toBeLessThanOrEqual(0.5)

    const guideBox = await page.locator('.tree-group').first().evaluate((el) => {
      const cs = getComputedStyle(el, '::before')
      return { width: parseFloat(cs.width), height: el.getBoundingClientRect().height, content: cs.content }
    })
    expect(guideBox.content).not.toBe('none')
    expect(guideBox.width).toBeCloseTo(1, 0)
    expect(guideBox.height).toBeGreaterThan(0)
  })
})

test.describe('F-159 사이드바 너비 조절', () => {
  async function dragHandleBy(page, dx) {
    const handle = page.locator('.sidebar-resize-handle')
    const box = await handle.boundingBox()
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + dx, startY, { steps: 5 })
    await page.mouse.up()
  }

  test('F-159 A5 +100px 끌기 → 324px, 저장', async ({ page }) => {
    await openApp(page)
    await dragHandleBy(page, 100)
    const width = (await rectOf(page.locator('.sidebar'))).width
    expect(Math.abs(width - 324)).toBeLessThanOrEqual(2)
    expect(await page.evaluate(() => window.localStorage.getItem('md.sidebarWidth'))).toBe('324')
  })

  test('F-159 A5 -200px 끌기 → 최소 200px', async ({ page }) => {
    await openApp(page)
    await dragHandleBy(page, -200)
    const width = (await rectOf(page.locator('.sidebar'))).width
    expect(Math.abs(width - 200)).toBeLessThanOrEqual(2)
  })

  test('F-159 A5 +600px 끌기 → min(480, 창 폭-560) (1600px 창 → 480)', async ({ page }) => {
    await openApp(page)
    await dragHandleBy(page, 600)
    const width = (await rectOf(page.locator('.sidebar'))).width
    expect(Math.abs(width - 480)).toBeLessThanOrEqual(2)
  })

  test('F-159 A7 창 줄이기 — 저장값 480 유지, 화면만 464 로 줄고 1600px 에서 되돌아온다', async ({ page }) => {
    await openApp(page)
    await dragHandleBy(page, 600) // 480 으로 저장
    await waitTransitionEnd(page.locator('.sidebar'))
    expect(await page.evaluate(() => window.localStorage.getItem('md.sidebarWidth'))).toBe('480')

    await resizeWindow(page, 1024)
    await waitTransitionEnd(page.locator('.sidebar'))
    const narrowWidth = (await rectOf(page.locator('.sidebar'))).width
    expect(Math.abs(narrowWidth - 464)).toBeLessThanOrEqual(1)
    expect(await page.evaluate(() => window.localStorage.getItem('md.sidebarWidth'))).toBe('480')

    await resizeWindow(page, 1600)
    await waitTransitionEnd(page.locator('.sidebar'))
    const backWidth = (await rectOf(page.locator('.sidebar'))).width
    expect(Math.abs(backWidth - 480)).toBeLessThanOrEqual(1)
  })

  test('F-159 A8 좁은 창 — 손잡이 없음, 겹쳐 열린 폭 = 저장 너비(창 폭-48 이하)', async ({ page }) => {
    await openApp(page)
    await dragHandleBy(page, 100) // 324 로 저장
    await waitTransitionEnd(page.locator('.sidebar'))

    await resizeWindow(page, 900)
    await page.locator('.sidebar-toggle').click() // 겹쳐 열기
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('.sidebar-resize-handle')).toHaveCount(0)
    const overlayWidth = (await rectOf(page.locator('.sidebar'))).width
    expect(Math.abs(overlayWidth - 324)).toBeLessThanOrEqual(2)
  })
})

// canvas 로 실제 rgba 값을 읽는다 (Chrome 이 color-mix() 를 color(srgb ...) 로 줄 때가 있어서, F-153)
async function colorOf(locator, prop = 'backgroundColor') {
  return locator.evaluate((el, p) => {
    const cs = getComputedStyle(el)
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = cs[p]
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return { r, g, b, a: a / 255 }
  }, prop)
}

test.describe('F-153 A3 사이드바 현재 문서 행', () => {
  test('테두리 없이 --ink 7% 바탕, 호버해도 같은 바탕', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '첫문서.md', content: '내용\n' })
    await importMarkdown(page, { name: '둘째문서.md', content: '내용\n' })

    const currentRow = page.locator('.tree-row').filter({ has: page.locator('[aria-current="page"]') })
    const boxShadow = await computedStyle(currentRow, 'box-shadow')
    expect(boxShadow).toBe('none')

    const color = await colorOf(currentRow)
    // --panel 불투명 흰색이 아니라 --ink 를 섞은 반투명 바탕이어야 한다 (F-153 2.3)
    expect(color.a).toBeGreaterThan(0)
    expect(color.a).toBeLessThan(1)

    await currentRow.hover()
    const hoverColor = await colorOf(currentRow)
    expect(hoverColor).toEqual(color)
  })
})

test.describe('F-153 A4 사이드바 글자 시작선', () => {
  async function textStartX(locator) {
    return locator.evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      return range.getBoundingClientRect().x
    })
  }

  test('최상위 문서·폴더·고정 행 글자 시작 x = 새 문서 버튼 글자 시작 x (±1px)', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '문서.md', content: '내용\n' })
    await page.getByRole('button', { name: '새 폴더', exact: true }).click()
    await page.keyboard.press('Enter')

    const docRow = page.locator('.tree-row').filter({ has: page.locator('.tree-toggle-spacer') }).first()
    await docRow.hover()
    await docRow.locator('.item-menu-btn').click()
    await page.getByRole('menuitem', { name: '상단 고정' }).click()

    const newDocLabel = page.getByRole('button', { name: '새 문서', exact: true }).locator('.sidebar-btn-label')
    const newDocX = await textStartX(newDocLabel)

    const folderRow = page.locator('.doc-list .tree-row').filter({ has: page.locator('.tree-toggle') }).first()
    const folderLabelX = await textStartX(folderRow.locator('.tree-label'))
    const pinnedLabelX = await textStartX(page.locator('.pinned-list .tree-label').first())
    const docRowLabelX = await textStartX(
      page.locator('.doc-list .tree-row').filter({ has: page.locator('.tree-toggle-spacer') }).first().locator('.tree-label'),
    )

    expect(Math.abs(folderLabelX - newDocX)).toBeLessThanOrEqual(1)
    expect(Math.abs(pinnedLabelX - newDocX)).toBeLessThanOrEqual(1)
    expect(Math.abs(docRowLabelX - newDocX)).toBeLessThanOrEqual(1)
  })

  test('가이드 선 x = 토글 아이콘 가로 가운데', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '새 폴더', exact: true }).click()
    await page.keyboard.press('Enter')
    const folderRow = page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') }).first()
    const menuBtn = folderRow.locator('.item-menu-btn')
    await menuBtn.focus()
    await menuBtn.click()
    await page.getByRole('menuitem', { name: '새 문서' }).click()

    const folderToggle = page.locator('.tree-toggle').first()
    const toggleBox = await rectOf(folderToggle)
    const toggleCenter = (toggleBox.left + toggleBox.right) / 2

    const guideLeft = await page.locator('.tree-group').first().evaluate((el) => {
      const cs = getComputedStyle(el, '::before')
      return el.getBoundingClientRect().left + parseFloat(cs.left)
    })
    expect(Math.abs(guideLeft - toggleCenter)).toBeLessThanOrEqual(1)
  })
})

test.describe('F-143 A17 / F-124 A2d 문서 여백', () => {
  test('첫 줄 위 48px, 마지막 줄 아래 50dvh, Ctrl+End 커서가 화면 안', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: Array.from({ length: 300 }, (_, i) => `줄 ${i}`).join('\n') })

    const scroller = page.locator('.cm-scroller')
    // F-217 이후 문서 맨 위는 본문 제목 블록 — 48px 는 그 위에 있다
    const firstLine = page.locator('.cm-content > :first-child')
    const scrollerTop = (await rectOf(scroller)).top
    const firstLineTop = (await rectOf(firstLine)).top
    expect(Math.abs(firstLineTop - scrollerTop - 48)).toBeLessThanOrEqual(2)

    await page.keyboard.press('Control+End')
    const viewportHeight = await page.evaluate(() => window.innerHeight)
    const expectedBottomPad = viewportHeight * 0.5
    const scrollerRect = await rectOf(scroller)
    const lastLine = page.locator('.cm-line').last()
    const lastLineRect = await rectOf(lastLine)
    // 커서가 화면(스크롤 영역) 안에 있어야 한다
    expect(lastLineRect.top).toBeGreaterThanOrEqual(scrollerRect.top - 2)
    expect(lastLineRect.top).toBeLessThanOrEqual(scrollerRect.bottom + 2)
    void expectedBottomPad
  })
})
