// 표 위젯 — 버튼 위치, 가로 스크롤, 칸 표시, 편집 도중 손실 회귀 (F-150.md 3.3)
import { test, expect } from '@playwright/test'
import {
  openApp,
  importMarkdown,
  readSavedContent,
  setViewMode,
  rectOf,
  fakeImeCompose,
  fakeImeCommit,
} from './helpers.js'

// 문서 첫 줄에 표를 바로 두지 않는다 — 가져오기 직후 커서가 문서 맨 앞(0)에 있는데,
// 그 자리가 표 원문 범위 안이면 F-139 3.1 규칙으로 표가 원문(위젯 아님)으로 보인다.
// 앞에 줄 하나를 둬 커서가 "표 앞 줄"에 있게 한다(F-139 3.1 "표 앞 줄 → 위젯 있음")
const LEAD = '표\n\n'
// 머리 행 + 데이터 2행 = tr 3개(F-140 A13·A14 가 "마지막 행" 을 가리키는 데 쓴다)
const NARROW_TABLE = `${LEAD}| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n`

// 칸 안에 이미 <br> 이 든 표 (F-162 A3·A4 용)
const BR_TABLE = `${LEAD}| a | b |\n| --- | --- |\n| x<br>y | 2 |\n| 3 | 4 |\n`

function wideTable(cols) {
  const head = `| ${Array.from({ length: cols }, (_, i) => `h${i}`).join(' | ')} |`
  const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
  const row = `| ${Array.from({ length: cols }, (_, i) => `v${i}`).join(' | ')} |`
  return `${LEAD}${head}\n${sep}\n${row}\n`
}

test.describe('F-140 표 추가 버튼 위치와 칸 인라인 표시', () => {
  test('F-140 A2 열 추가 버튼이 표 오른쪽 테두리 세로 가운데에 온다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: NARROW_TABLE })
    const wrap = page.locator('.md-table-widget')
    await wrap.hover()
    const colBtn = wrap.locator('.md-table-add-col')
    const rowBtn = wrap.locator('.md-table-add-row')
    const table = wrap.locator('table')
    const [colRect, rowRect, tableRect] = await Promise.all([rectOf(colBtn), rectOf(rowBtn), rectOf(table)])

    const colCenterY = colRect.top + colRect.height / 2
    const tableCenterY = tableRect.top + tableRect.height / 2
    expect(Math.abs(colRect.x + colRect.width / 2 - tableRect.right)).toBeLessThanOrEqual(2)
    expect(Math.abs(colCenterY - tableCenterY)).toBeLessThanOrEqual(2)

    const rowCenterX = rowRect.x + rowRect.width / 2
    const tableCenterX = tableRect.x + tableRect.width / 2
    expect(Math.abs(rowCenterX - tableCenterX)).toBeLessThanOrEqual(2)
  })

  for (const [label, content] of [
    ['좁은 표', NARROW_TABLE],
    ['20열 표', wideTable(20)],
  ]) {
    test(`F-140 A3 ${label} 는 편집 영역에 가로 스크롤을 만들지 않는다`, async ({ page }) => {
      await openApp(page)
      await importMarkdown(page, { content })
      const scroller = page.locator('.cm-scroller')
      const wrap = page.locator('.md-table-widget')
      await wrap.hover()
      const colBtn = wrap.locator('.md-table-add-col')
      await colBtn.focus()
      const sizes = await scroller.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
      expect(sizes.scrollWidth).toBe(sizes.clientWidth)

      const tooltipVisible = await colBtn.evaluate((el) => getComputedStyle(el, '::after').opacity !== '0')
      if (tooltipVisible) {
        const btnRect = await rectOf(colBtn)
        const scrollerRect = await rectOf(scroller)
        expect(btnRect.right).toBeLessThanOrEqual(scrollerRect.right + 1)
      }
    })
  }

  test('F-140 A4 넓은 표를 가로 스크롤해도 버튼이 보이는 영역 안에 남는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: wideTable(20) })
    const wrap = page.locator('.md-table-widget')
    const scroll = wrap.locator('.md-table-scroll')
    const scroller = page.locator('.cm-scroller')

    for (const fraction of [0, 0.5, 1]) {
      await scroll.evaluate((el, f) => {
        el.scrollLeft = (el.scrollWidth - el.clientWidth) * f
      }, fraction)
      await wrap.hover()
      const colRect = await rectOf(wrap.locator('.md-table-add-col'))
      const rowRect = await rectOf(wrap.locator('.md-table-add-row'))
      const scrollerRect = await rectOf(scroller)
      expect(colRect.right).toBeLessThanOrEqual(scrollerRect.right + 1)
      expect(colRect.left).toBeGreaterThanOrEqual(scrollerRect.left - 1)
      expect(rowRect.left).toBeGreaterThanOrEqual(scrollerRect.left - 1)
      expect(rowRect.right).toBeLessThanOrEqual(scrollerRect.right + 1)
    }
  })

  test('F-140 A6 원문 보존 — 편집하지 않은 칸은 바이트가 그대로다', async ({ page }) => {
    const content = `${LEAD}| **굵게** | [링크](https://example.com) |\n| --- | --- |\n| \`a*b\` | [[없는 문서]] |\n`
    await openApp(page)
    const docId = await importMarkdown(page, { content })
    const wrap = page.locator('.md-table-widget')
    const cells = wrap.locator('td, th')
    // 서식 표시(기호 없음) 확인
    // 머리 행(th): [0]=굵게, [1]=링크. 데이터 행(td): [2]=코드, [3]=위키링크
    await expect(cells.nth(0)).toHaveText('굵게')
    await expect(cells.nth(0).locator('.md-strong')).toBeVisible()
    await expect(cells.nth(1)).toHaveText('링크')

    // 링크 클릭 시 새 탭이 열리지 않고 칸 편집이 시작된다
    let opened = false
    page.once('popup', () => {
      opened = true
    })
    await cells.nth(1).click()
    await expect(wrap.locator('.md-table-cell-editing')).toHaveCount(1)
    await page.keyboard.press('Escape')
    expect(opened).toBe(false)

    // 다른 칸(코드)을 편집해도 첫 칸은 그대로다
    await cells.nth(2).click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await page.keyboard.press('Escape')

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('**굵게**')
    expect(doc.content).toContain('[링크](https://example.com)')
  })

  test('F-140 A11 칸 편집 시작 전후로 글자·칸 크기가 바뀌지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: NARROW_TABLE })
    const cell = page.locator('.md-table-widget td, .md-table-widget th').first()
    const before = await rectOf(cell)
    await cell.click()
    const after = await rectOf(cell)
    expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(before.height - after.height)).toBeLessThanOrEqual(1)
    expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(1)
  })

  test('F-140 A13 빈 칸 높이는 글자 든 행과 같다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: NARROW_TABLE })
    const rows = page.locator('.md-table-widget table tr')
    const filledHeight = (await rectOf(rows.nth(2))).height

    // 행 추가 직후 — 모든 칸이 빈 행
    const rowBtn = page.locator('.md-table-add-row')
    await page.locator('.md-table-widget').hover()
    await rowBtn.click()
    const emptyHeight = (await rectOf(rows.nth(3))).height
    expect(Math.abs(filledHeight - emptyHeight)).toBeLessThanOrEqual(1)

    // 빈 칸 편집 중에도 같다
    await rows.nth(3).locator('td').first().click()
    const editingHeight = (await rectOf(rows.nth(3))).height
    expect(Math.abs(filledHeight - editingHeight)).toBeLessThanOrEqual(1)
  })

  test('F-140 A14 마지막 행에서 Enter — 글자 있으면 행 추가, 비어 있으면 표 밖으로', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: NARROW_TABLE })
    const table = page.locator('.md-table-widget table')

    // 3행 표: 마지막 행(2번째, 0-index) 2열 편집 후 Enter
    await table.locator('tr').nth(2).locator('td').nth(1).click()
    await page.keyboard.type('x')
    await page.keyboard.press('Enter')
    await expect(table.locator('tr')).toHaveCount(4)
    // 같은 열(1) 편집 중이어야 한다
    await expect(page.locator('.md-table-cell-editing[data-col="1"]')).toHaveCount(1)

    // 아무것도 안 치고 Enter — 빈 행이므로 행 추가 없이 표를 빠져나간다
    await page.keyboard.press('Enter')
    await expect(table.locator('tr')).toHaveCount(4)

    // Ctrl+Z 한 번으로 행 추가 취소
    await page.keyboard.press('Control+z')
    await expect(table.locator('tr')).toHaveCount(3)

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toMatch(/4x|x4/)
  })
})

test.describe('F-124 A2d 위젯 아래 줄 클릭 위치', () => {
  test('코드블록·표 아래 줄을 클릭하면 그 줄에 커서가 놓인다', async ({ page }) => {
    const content = [
      '```js',
      'x'.repeat(300),
      '```',
      '아래줄A',
      '',
      NARROW_TABLE.trimEnd(),
      '아래줄B',
      '',
    ].join('\n')
    await openApp(page)
    const docId = await importMarkdown(page, { content })

    // 코드블록 바로 아래 줄 클릭 후 타이핑 — 그 줄에 글자가 들어가야 한다
    const belowCode = page.getByText('아래줄A', { exact: true })
    await belowCode.click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')

    const belowTable = page.getByText('아래줄B', { exact: true })
    await belowTable.click()
    await page.keyboard.press('End')
    await page.keyboard.type('?')

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('아래줄A!')
    expect(doc.content).toContain('아래줄B?')
  })
})

test.describe('F-139 표를 치는 도중 내용 손실', () => {
  test('F-139 A2 새 줄에서 표를 이어 쳐도 세 줄이 그대로 남는다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('| a | b |\n| --- | --- |\n| 1 | 2 |')

    await setViewMode(page, 'raw')
    const doc = await readSavedContent(page, docId)
    expect(doc.content.replace(/\r\n/g, '\n')).toContain('| a | b |\n| --- | --- |\n| 1 | 2 |')
  })
})

test.describe('F-138 표 칸 역슬래시 왕복', () => {
  test('F-138 A2 칸 끝에 글자를 입력해도 역슬래시가 유지된다', async ({ page }) => {
    const content = `${LEAD}| C:\\Users | a\\*b |\n| --- | --- |\n| x | y |\n`
    await openApp(page)
    const docId = await importMarkdown(page, { content })
    const cell = page.locator('.md-table-widget td, .md-table-widget th').first()
    await cell.click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await page.keyboard.press('Escape')

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('C:\\Users!')
    // 표 열 수(칸 개수)가 그대로 — 원문이 3칸씩 유지된다
    expect((doc.content.match(/\|/g) ?? []).length).toBe((content.match(/\|/g) ?? []).length)
  })
})

test.describe('F-161 표 칸 입력 결함', () => {
  test('F-161 A1 칸 안에서 실제 키로 띄어쓰기가 그대로 들어간다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: NARROW_TABLE })
    const wrap = page.locator('.md-table-widget')
    const cell = wrap.locator('td, th').nth(2) // 2행 1열, "1"

    await cell.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Home')
    await page.keyboard.type('a b c')
    await page.keyboard.press('Escape')

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('| a b c | 2 |')
    // 다른 줄은 바이트가 그대로다
    expect(doc.content).toContain('| a | b |')
    expect(doc.content).toContain('| --- | --- |')
    expect(doc.content).toContain('| 3 | 4 |')
  })

  test('F-161 A2 칸에 키보드로 포커스한 뒤 Enter·Space 로 편집을 시작한다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: NARROW_TABLE })
    const wrap = page.locator('.md-table-widget')

    // Tab 으로 포커스한 뒤 Enter — 그 칸 편집 시작
    const cellA = wrap.locator('td, th').nth(0) // 머리 행 "a"
    await cellA.focus()
    await page.keyboard.press('Enter')
    await expect(wrap.locator('.md-table-cell-editing[data-row="0"][data-col="0"]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(wrap.locator('.md-table-cell-editing')).toHaveCount(0)

    // 다른 칸에 포커스한 뒤 Space — 그 칸 편집 시작, Space 가 글자로 들어가지 않는다
    const cellB = wrap.locator('td, th').nth(2) // "1"
    await cellB.focus()
    await page.keyboard.press(' ')
    await expect(wrap.locator('.md-table-cell-editing[data-row="1"][data-col="0"]')).toHaveCount(1)
    await page.keyboard.press('Escape')

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('| 1 | 2 |') // Space 가 칸에 들어가지 않아 "1" 그대로
  })

  test('F-161 A3 조합 확정 뒤 스페이스로 이어 조합해도 칸에 그대로 남는다', async ({ page }) => {
    const content = `${LEAD}| a | b |\n| --- | --- |\n|  | y |\n`
    await openApp(page)
    const docId = await importMarkdown(page, { content })
    const wrap = page.locator('.md-table-widget')
    const cell = wrap.locator('td, th').nth(2) // 빈 칸

    await cell.click()
    const cdp1 = await fakeImeCompose(page, '한')
    await fakeImeCommit(cdp1, '한')
    await page.keyboard.press(' ')
    const cdp2 = await fakeImeCompose(page, '글')
    await fakeImeCommit(cdp2, '글')
    await page.keyboard.press('Escape')

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('| 한 글 | y |')
  })

  test('F-161 A4 조합 중에는 Tab 이 칸을 이동시키지 않는다', async ({ page }) => {
    const content = `${LEAD}| a | b |\n| --- | --- |\n|  | y |\n`
    await openApp(page)
    const docId = await importMarkdown(page, { content })
    const wrap = page.locator('.md-table-widget')
    const cell = wrap.locator('td, th').nth(2) // 빈 칸, row=1 col=0

    await cell.click()
    await expect(wrap.locator('.md-table-cell-editing[data-row="1"][data-col="0"]')).toHaveCount(1)

    const cdp = await fakeImeCompose(page, '한')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(50)
    // 다른 칸(row=1 col=1)으로 옮겨가지 않았어야 한다
    await expect(wrap.locator('.md-table-cell-editing[data-row="1"][data-col="1"]')).toHaveCount(0)

    await fakeImeCommit(cdp, '한')
    await page.keyboard.press('Escape')

    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('한')
    expect(doc.content).toContain('| y |')
  })

  test('F-161 A5 표를 줄 단위로 한글 포함해 쳐도 세 줄이 그대로 남는다', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: '\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')

    await page.keyboard.type('| ')
    const cdp1 = await fakeImeCompose(page, '이름')
    await fakeImeCommit(cdp1, '이름')
    await page.keyboard.type(' | ')
    const cdp2 = await fakeImeCompose(page, '값')
    await fakeImeCommit(cdp2, '값')
    await page.keyboard.type(' |\n| --- | --- |\n| ')
    const cdp3 = await fakeImeCompose(page, '가')
    await fakeImeCommit(cdp3, '가')
    await page.keyboard.type(' | ')
    const cdp4 = await fakeImeCompose(page, '나')
    await fakeImeCommit(cdp4, '나')
    await page.keyboard.type(' |')

    await setViewMode(page, 'raw')
    const doc = await readSavedContent(page, docId)
    expect(doc.content.replace(/\r\n/g, '\n')).toContain('| 이름 | 값 |\n| --- | --- |\n| 가 | 나 |')
  })

  test('F-161 A6 회귀 — 방향키·Tab 으로 칸 사이를 옮긴다 (F-125 2.3)', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: NARROW_TABLE })
    const wrap = page.locator('.md-table-widget')

    await wrap.locator('td, th').nth(0).click() // row0 col0
    await page.keyboard.press('Tab')
    await expect(wrap.locator('.md-table-cell-editing[data-row="0"][data-col="1"]')).toHaveCount(1)

    await page.keyboard.press('ArrowDown')
    await expect(wrap.locator('.md-table-cell-editing[data-row="1"][data-col="1"]')).toHaveCount(1)

    await page.keyboard.press('ArrowLeft')
    await expect(wrap.locator('.md-table-cell-editing[data-row="1"][data-col="0"]')).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(wrap.locator('.md-table-cell-editing')).toHaveCount(0)
  })
})

test.describe('F-162 표 칸 안 줄바꿈 (Alt+Enter → <br>)', () => {
  test('F-162 A2 Alt+Enter 로 칸에 <br> 를 넣는다 — 원문 반영과 되돌리기', async ({ page }) => {
    await openApp(page)
    const docId = await importMarkdown(page, { content: NARROW_TABLE })
    const wrap = page.locator('.md-table-widget')
    const cell = wrap.locator('td, th').nth(2) // row1 col0, "1"

    await cell.click()
    await page.keyboard.press('End')
    await page.keyboard.type('a')
    await page.keyboard.press('Alt+Enter')
    // 편집 중인 칸은 원문 그대로 <br> 글자가 보인다 (F-162 2.2)
    await expect(wrap.locator('.md-table-cell-editing .cm-content')).toHaveText('1a<br>')

    // Ctrl+Z 한 번 — <br> 삽입만 되돌아가고 앞서 친 a 는 남는다(F-162 2.1)
    await page.keyboard.press('Control+z')
    let doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('| 1a | 2 |')

    // 이어서 다시 Alt+Enter 로 넣고 b 를 이어 쳐 "1a<br>b" 를 만든다
    await cell.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Alt+Enter')
    await page.keyboard.type('b')
    await page.keyboard.press('Escape')

    doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('| 1a<br>b | 2 |')
    // 다른 줄은 바이트가 그대로다
    expect(doc.content).toContain('| a | b |')
    expect(doc.content).toContain('| --- | --- |')
    expect(doc.content).toContain('| 3 | 4 |')
  })

  test('F-162 A3 편집 중이 아닌 칸의 <br> 은 줄바꿈으로 보이고 칸 높이가 늘어난다', async ({ page }) => {
    const content = `${BR_TABLE}아래줄\n`
    await openApp(page)
    const docId = await importMarkdown(page, { content })
    const wrap = page.locator('.md-table-widget')
    const rows = wrap.locator('table tr')
    const brCell = rows.nth(1).locator('td').first() // "x<br>y"

    await expect(brCell.locator('br')).toHaveCount(1)

    const oneLineHeight = (await rectOf(rows.nth(2))).height // "3" 칸(줄바꿈 없음)
    const twoLineHeight = (await rectOf(rows.nth(1))).height
    expect(twoLineHeight).toBeGreaterThan(oneLineHeight * 1.5)

    // 표 아래 줄 클릭 위치가 F-124 3.4 규칙대로 맞는다(F-124 A2d 방법)
    const belowTable = page.getByText('아래줄', { exact: true })
    await belowTable.click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    const doc = await readSavedContent(page, docId)
    expect(doc.content).toContain('아래줄!')
  })

  test('F-162 A4 보기 모드 — 표 칸의 <br> 은 줄바꿈, 문단의 <br> 은 글자', async ({ page }) => {
    const content = `${BR_TABLE}\n문단 x<br>y\n`
    await openApp(page)
    await importMarkdown(page, { content })
    await setViewMode(page, 'view')

    const cell = page.locator('.viewer table td').first() // "x<br>y"
    await expect(cell.locator('br')).toHaveCount(1)

    const paragraph = page.locator('.viewer p', { hasText: '문단' })
    await expect(paragraph).toContainText('x<br>y')
    await expect(paragraph.locator('br')).toHaveCount(0)
  })
})
