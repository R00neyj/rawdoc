// 편집 화면 자잘한 표시 결함 6가지 (specs/features/F-152.md)
// 편집 모드 목록 기호 흔들림 (specs/features/F-166.md)
import { test, expect } from '@playwright/test'
import {
  openApp,
  importMarkdown,
  setViewMode,
  setPrefBeforeLoad,
  rectOf,
  computedStyle,
  readSavedContent,
  fakeImeCompose,
  fakeImeCommit,
} from './helpers.js'

// 목록 줄의 마커 뒤 실제 글자가 화면 줄마다 시작하는 x 좌표 목록 (F-152 A5, F-166 A1·A3)
async function rowStartXs(page, selector) {
  return page.evaluate((sel) => {
    const lineEl = document.querySelector(sel)
    let textNode = null
    for (const n of lineEl.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim().length > 0) {
        textNode = n
        break
      }
    }
    const skip = textNode.textContent.startsWith(' ') ? 1 : 0
    const range = document.createRange()
    range.setStart(textNode, skip)
    range.setEnd(lineEl, lineEl.childNodes.length)
    return [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0).map((r) => r.left)
  }, selector)
}

// 커서 안(원문 드러남) 목록 줄에서 원문 글자 수 offset 뒤 실제 글자가 화면 줄마다 시작하는 x 좌표 목록. 마커·내용이 여러 텍스트 노드로 나뉜 경우(체크박스 "[ ] " 등)도 문자 수로 정확히 자른다 (F-166 A4)
async function rowStartXsAtOffset(page, selector, offset) {
  return page.evaluate(
    ({ sel, offset }) => {
      const lineEl = document.querySelector(sel)
      const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT)
      let remaining = offset
      let startNode = null
      let startOffset = 0
      let node
      while ((node = walker.nextNode())) {
        if (remaining <= node.textContent.length) {
          startNode = node
          startOffset = remaining
          break
        }
        remaining -= node.textContent.length
      }
      const range = document.createRange()
      range.setStart(startNode, startOffset)
      range.setEnd(lineEl, lineEl.childNodes.length)
      return [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0).map((r) => r.left)
    },
    { sel: selector, offset },
  )
}

// 2.1 대상 줄 클래스(specs/features/F-152.md 목표 목록)
const GUTTER_ALIGN_SELECTOR =
  '.cm-line.md-h1, .cm-line.md-h2, .cm-line.md-h3, .cm-line.md-h4, .cm-line.md-h5, .cm-line.md-h6, ' +
  '.cm-line.md-hr, .cm-line.md-frontmatter-first, .cm-line.md-callout-title'

const A1_DOC =
  // 빈 프론트매터는 F-155 위젯 대상이 아니라 원문 상자 첫 줄(md-frontmatter-first)이 남는다
  '---\n---\n\n# 제목1\n\n## 제목2\n\n### 제목3\n\n#### 제목4\n\n' +
  '##### 제목5\n\n###### 제목6\n\n---\n\n> [!note] 콜아웃\n> 본문\n\n일반 문단\n'

/** 거터 숫자 상자·내용 줄 첫 글자 상자의 세로 가운데 차이(px)를 대상 줄마다 잰다 */
async function measureGutterDiffs(page) {
  return page.evaluate((SEL) => {
    const targets = [...document.querySelectorAll(SEL)]
    const allLines = [...document.querySelectorAll('.cm-content > .cm-line')]
    const numberEls = [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].filter(
      (el) => el.getBoundingClientRect().height > 0,
    )
    return targets.map((lineEl) => {
      const lineNumber = allLines.indexOf(lineEl) + 1
      const gutterEl = numberEls.find((el) => Number(el.textContent) === lineNumber)
      const cls = lineEl.className
      if (!gutterEl) return { cls, matched: false }
      const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT)
      let firstText = null
      let n
      while ((n = walker.nextNode())) {
        if (n.textContent.length > 0) {
          firstText = n
          break
        }
      }
      let contentCenter
      if (firstText) {
        const r = document.createRange()
        r.selectNodeContents(firstText)
        const tr = r.getClientRects()[0]
        contentCenter = (tr.top + tr.bottom) / 2
      } else {
        const lr = lineEl.getBoundingClientRect()
        contentCenter = (lr.top + lr.bottom) / 2
      }
      const gr = document.createRange()
      gr.selectNodeContents(gutterEl.firstChild)
      const grect = gr.getBoundingClientRect()
      const digitCenter = (grect.top + grect.bottom) / 2
      return { cls, matched: true, diff: digitCenter - contentCenter }
    })
  }, GUTTER_ALIGN_SELECTOR)
}

test.describe('F-152 A1 제목 줄 번호 세로 정렬', () => {
  test('대상 줄마다 거터 숫자 세로 가운데가 그 줄 첫 글자 세로 가운데와 2px 이내', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: A1_DOC })

    const diffs = await measureGutterDiffs(page)
    expect(diffs.length).toBe(9) // frontmatter-first·h1~h6·hr·callout-title
    for (const d of diffs) {
      expect(d.matched, `${d.cls} 거터 매칭 안 됨`).toBe(true)
      expect(Math.abs(d.diff), d.cls).toBeLessThanOrEqual(2)
    }
  })
})

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

test.describe('F-152 A3 원문 인라인코드 칩 제거', () => {
  test('원문 모드는 배경·안쪽 여백 없음, 편집 모드는 그대로', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '문단에 `인라인코드` 있음\n' })

    const code = page.locator('.md-code').first()
    const liveBg = await computedStyle(code, 'background-color')
    const livePad = await computedStyle(code, 'padding-left')
    expect(liveBg).not.toBe('rgba(0, 0, 0, 0)')
    expect(parseFloat(livePad)).toBeGreaterThan(0)

    await setViewMode(page, 'raw')
    const rawBg = await computedStyle(code, 'background-color')
    const rawPad = await computedStyle(code, 'padding-left')
    const rawRadius = await computedStyle(code, 'border-radius')
    expect(rawBg).toBe('rgba(0, 0, 0, 0)')
    expect(parseFloat(rawPad)).toBe(0)
    expect(parseFloat(rawRadius)).toBe(0)
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

test.describe('F-152 A5 목록 내어쓰기', () => {
  const LONG_ITEM = '목록 항목 글자가 아주 아주 길어서 화면 폭을 넘어 다음 줄로 접히도록 만든다 '.repeat(3)

  test('둘째 화면 줄 시작 x = 첫 줄 글자 시작 x (커서 밖)', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 })
    await openApp(page)
    await importMarkdown(page, { content: `문단\n\n- ${LONG_ITEM}\n` })

    const rows = await rowStartXs(page, '.cm-line.md-list-line')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    for (const x of rows.slice(1)) {
      expect(Math.abs(x - rows[0])).toBeLessThanOrEqual(4)
    }
  })

  test('둘째 화면 줄 시작 x = 첫 줄 글자 시작 x (커서 안 — 원문 마커 드러남)', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 })
    await openApp(page)
    await importMarkdown(page, { content: `문단\n\n- ${LONG_ITEM}\n` })

    await page.locator('.cm-line.md-list-line').click()
    await page.waitForTimeout(100)
    const rows = await rowStartXs(page, '.cm-line.md-list-line')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    for (const x of rows.slice(1)) {
      expect(Math.abs(x - rows[0])).toBeLessThanOrEqual(4)
    }
  })

  test('최상위 글자 시작 − 문단 글자 시작 값이 보기 모드와 같다 (±4px)', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await openApp(page)
    await importMarkdown(page, { content: `문단\n\n- 목록\n` })

    const editDelta = await page.evaluate(() => {
      // 문단 줄은 얕은 첫 텍스트 자식으로, 목록 줄은 마커 위젯(자식 요소) 대신
      // 그 뒤 실제 내용 텍스트 자식(선행 공백 1칸 건너뜀)으로 글자 시작을 잰다
      function firstX(lineEl) {
        for (const n of lineEl.childNodes) {
          if (n.nodeType === 3 && n.textContent.trim().length > 0) {
            const skip = n.textContent.startsWith(' ') ? 1 : 0
            const r = document.createRange()
            r.setStart(n, skip)
            r.setEnd(n, n.textContent.length)
            return r.getClientRects()[0].left
          }
        }
        return null
      }
      const lines = [...document.querySelectorAll('.cm-content > .cm-line')]
      const paraX = firstX(lines[0])
      const listX = firstX(document.querySelector('.cm-line.md-list-line'))
      return listX - paraX
    })

    await setViewMode(page, 'view')
    const viewDelta = await page.evaluate(() => {
      function firstX(el) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        let n
        while ((n = walker.nextNode())) {
          if (n.textContent.trim().length > 0) {
            const r = document.createRange()
            r.selectNodeContents(n)
            return r.getClientRects()[0].left
          }
        }
        return null
      }
      const p = document.querySelector('.markdown-body > p')
      const li = document.querySelector('.markdown-body li')
      return firstX(li) - firstX(p)
    })

    expect(Math.abs(editDelta - viewDelta)).toBeLessThanOrEqual(4)
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

test.describe('F-152 A7 알림 띠', () => {
  test('메시지가 한 줄이고, 닫기 버튼이 오른쪽 끝 − 14px(±1)에 있다', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await openApp(page)

    const notice = page.locator('.notice')
    await expect(notice).toBeVisible()

    const message = notice.locator('.notice-message')
    const messageBox = await message.evaluate((el) => el.getClientRects().length)
    expect(messageBox).toBe(1) // 한 줄

    const noticeRect = await rectOf(notice)
    const closeBtn = notice.locator('.icon-btn-wrap .icon-btn')
    const closeRect = await rectOf(closeBtn)
    expect(Math.abs(noticeRect.right - closeRect.right - 14)).toBeLessThanOrEqual(1)
  })

  test('.notice-message 만 남은 폭을 채우고 닫기 감싼 span 은 늘어나지 않는다', async ({ page }) => {
    await openApp(page)
    const notice = page.locator('.notice')
    await expect(notice).toBeVisible()

    const messageFlexGrow = await computedStyle(notice.locator('.notice-message'), 'flex-grow')
    const wrapFlexGrow = await computedStyle(notice.locator('.icon-btn-wrap'), 'flex-grow')
    expect(Number(messageFlexGrow)).toBe(1)
    expect(Number(wrapFlexGrow)).toBe(0)
  })
})

test.describe('F-152 A8a 보기 모드 코드블록', () => {
  for (const theme of ['white', 'dark', 'sepia']) {
    test(`${theme} 테마 — pre code 바탕 투명, 문단 code 바탕 유지`, async ({ page }) => {
      await setPrefBeforeLoad(page, 'md.theme', theme)
      await openApp(page)
      await importMarkdown(page, { content: '문단에 `인라인코드` 있음\n\n```js\nconst x = 1\n```\n' })
      await setViewMode(page, 'view')

      const preCodeBg = await computedStyle(page.locator('.markdown-body pre code').first(), 'background-color')
      const inlineCodeBg = await computedStyle(page.locator('.markdown-body p code').first(), 'background-color')
      expect(preCodeBg).toBe('rgba(0, 0, 0, 0)')
      expect(inlineCodeBg).not.toBe('rgba(0, 0, 0, 0)')
    })
  }
})

// 편집 모드 목록 기호 흔들림 (specs/features/F-166.md)
const F166_LONG_ITEM = '목록 항목 글자가 아주 아주 길어서 화면 폭을 넘어 다음 줄로 접히도록 만든다 '.repeat(3)

test.describe('F-166 A1 기호 위치', () => {
  const MARKER_DOC = '문단\n\n- 목록\n1. 순서목록\n- [ ] 할일\n- 부모\n  - 자식\n'

  for (const width of [1600, 800]) {
    test(`${width}×900 — 커서 밖, 기호가 내용 칸 왼쪽을 넘지 않는다`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openApp(page)
      await importMarkdown(page, { content: MARKER_DOC })

      const diffs = await page.evaluate(() => {
        const out = []
        for (const lineEl of document.querySelectorAll('.cm-line.md-list-line')) {
          const marker = lineEl.querySelector('.md-bullet, .md-list-marker, .md-checkbox')
          if (!marker) continue
          const lineLeft = lineEl.getBoundingClientRect().left
          const markerLeft = marker.getBoundingClientRect().left
          out.push({ cls: marker.className, diff: markerLeft - lineLeft })
        }
        return out
      })
      // 목록·순서목록·할일·부모·자식 다섯 줄 모두 기호를 가진다
      expect(diffs.length).toBe(5)
      for (const { cls, diff } of diffs) {
        expect(diff, cls).toBeGreaterThanOrEqual(-1)
      }
    })
  }

  test('긴 글머리 목록 — 둘째 화면 줄 시작 x = 첫 줄 글자 시작 x (커서 밖)', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 })
    await openApp(page)
    await importMarkdown(page, { content: `문단\n\n- ${F166_LONG_ITEM}\n` })

    const rows = await rowStartXs(page, '.cm-line.md-list-line')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    for (const x of rows.slice(1)) {
      expect(Math.abs(x - rows[0])).toBeLessThanOrEqual(4)
    }
  })

  test('긴 순서 목록 — 둘째 화면 줄 시작 x = 첫 줄 글자 시작 x (커서 밖)', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 })
    await openApp(page)
    await importMarkdown(page, { content: `문단\n\n1. ${F166_LONG_ITEM}\n` })

    const rows = await rowStartXs(page, '.cm-line.md-list-line')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    for (const x of rows.slice(1)) {
      expect(Math.abs(x - rows[0])).toBeLessThanOrEqual(4)
    }
  })
})

test.describe('F-166 A2 입력 중 흔들림', () => {
  test('옆 목록 줄에서 입력·Enter·커서 이동·IME 흉내 입력해도 감시줄 기호 x 는 그대로', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 })
    await openApp(page)
    await importMarkdown(page, { content: '- 감시줄\n- 편집줄\n' })

    await expect(page.locator('.cm-line.md-list-line')).toHaveCount(2)

    // rAF 로 60 프레임 동안 감시줄(첫 md-list-line) 기호 x·--md-list-indent 계산값을 기록
    const monitorPromise = page.evaluate(() => {
      return new Promise((resolve) => {
        const frames = []
        let count = 0
        function tick() {
          const lineEl = document.querySelectorAll('.cm-line.md-list-line')[0]
          const marker = lineEl?.querySelector('.md-bullet, .md-list-marker, .md-checkbox')
          const rect = marker?.getBoundingClientRect()
          const indent = lineEl ? getComputedStyle(lineEl).getPropertyValue('--md-list-indent') : ''
          frames.push({ x: rect ? rect.left : null, indent })
          count += 1
          if (count < 60) requestAnimationFrame(tick)
          else resolve(frames)
        }
        requestAnimationFrame(tick)
      })
    })

    // 편집줄 끝에서 입력·Enter
    await page.locator('.cm-line.md-list-line').nth(1).click()
    await page.keyboard.press('End')
    await page.keyboard.type('abc')
    await page.keyboard.press('Enter')
    // 커서를 감시줄 안으로 들였다 다시 밖으로 (방향키)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowDown')
    // CDP 조합 흉내 입력
    const cdp = await fakeImeCompose(page, '한')
    await fakeImeCommit(cdp, '한')

    const frames = await monitorPromise
    const xs = frames.map((f) => f.x).filter((x) => x !== null)
    expect(xs.length).toBeGreaterThan(0)
    const first = xs[0]
    for (const x of xs) {
      expect(Math.abs(x - first)).toBeLessThanOrEqual(1)
    }
    const emptyIndentFrames = frames.filter((f) => f.indent === '').length
    expect(emptyIndentFrames).toBe(0)
  })
})

test.describe('F-166 A3 되먹임', () => {
  test('1. 긴 목록 옆 줄에서 Enter 5회 — 내어쓰기 값이 커지지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 })
    await openApp(page)
    await importMarkdown(page, { content: `1. ${F166_LONG_ITEM}\n2. 둘째\n` })

    const firstLine = page.locator('.cm-line.md-list-line').first()
    // 활성 줄은 기호 폭을 2em 으로 넓히지 않아(F-152 2.3) 편집줄로 커서를 옮겨 감시줄이 비활성으로 자리잡은 뒤(값이 한 번 커지는 건 정상) 기준값을 잰다 — 문제는 그 뒤 Enter 반복마다 더 커지는 것
    await page.locator('.cm-line.md-list-line').nth(1).click()
    await page.keyboard.press('End')
    // 비활성 전환(기호 2em 폭 적용) 뒤에 기준값을 잰다 — .md-list-marker 는 비활성 줄에만 붙는다
    await firstLine.locator('.md-list-marker').waitFor()
    const initial = await firstLine.evaluate((el) => getComputedStyle(el).getPropertyValue('--md-list-indent'))

    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Enter')
    }

    const after = await firstLine.evaluate((el) => getComputedStyle(el).getPropertyValue('--md-list-indent'))
    expect(parseFloat(after)).toBeLessThanOrEqual(parseFloat(initial) + 1)

    const rows = await rowStartXs(page, '.cm-line.md-list-line')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    for (const x of rows.slice(1)) {
      expect(Math.abs(x - rows[0])).toBeLessThanOrEqual(4)
    }
  })
})

test.describe('F-166 A4 커서 줄 내어쓰기', () => {
  for (const [label, prefix] of [
    ['순서 목록', '1. '],
    ['할일', '- [ ] '],
  ]) {
    test(`${label} — 커서 안, 둘째 화면 줄 시작 x = 첫 줄 글자 시작 x`, async ({ page }) => {
      await page.setViewportSize({ width: 600, height: 900 })
      await openApp(page)
      await importMarkdown(page, { content: `문단\n\n${prefix}${F166_LONG_ITEM}\n` })

      await page.locator('.cm-line.md-list-line').click()
      // 클릭으로 활성화되며 기호 상자 폭(2em 강제 → 자연폭)이 바뀌어 줄바꿈이 다시 계산된다 — 안정될 때까지(연속 두 번 같은 결과) 기다린다
      let rows = await rowStartXsAtOffset(page, '.cm-line.md-list-line', prefix.length)
      await expect
        .poll(async () => {
          const next = await rowStartXsAtOffset(page, '.cm-line.md-list-line', prefix.length)
          const stable = JSON.stringify(next) === JSON.stringify(rows)
          rows = next
          return stable
        })
        .toBe(true)
      expect(rows.length).toBeGreaterThanOrEqual(2)
      for (const x of rows.slice(1)) {
        expect(Math.abs(x - rows[0])).toBeLessThanOrEqual(4)
      }
    })
  }
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
