// 호버·툴팁 전환 전부 적용 (specs/features/F-149.md 3장)
// 나타나고 사라지는 요소 전환 (specs/features/F-172.md 3장)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, resizeWindow, waitTransitionEnd, setPrefBeforeLoad, EXPORT_BUTTON_LABEL } from './helpers.js'

// 색·바탕·테두리·그림자·투명도 전환 곡선 — --transition-fast(F-173) (cubic-bezier(0, 0, 0.2, 1)) 가 튕기지 않는다
const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)'
// 크기·위치(transform) 전환 곡선 — --transition-move(F-173), 끝에서 살짝 넘쳤다 돌아온다
const EASE_SPRING = 'cubic-bezier(0.51, 0.08, 0.5, 1.23)'
const DURATION = '0.18s'
// 툴팁·메뉴·대화상자 나타남 전용 곡선 — --transition-pop(F-228, 2026-09-15 H86 로 넘침 폭 키움), 끝에서 뚜렷하게 넘쳤다 돌아온다
const EASE_POP = 'cubic-bezier(0.32, 1.9, 0.5, 1)'
const POP_DURATION = '0.24s'
// 튀어나오는 요소의 opacity 전용 — --transition-pop-fade(F-228, 2026-09-15 H86), scale·translate 보다 짧게 끝난다
const POP_FADE_DURATION = '0.1s'

// cubic-bezier(...) 값은 괄호 안에도 콤마가 있어 단순 split(',') 로 못 나눈다 — 괄호 깊이를 세어 최상위 콤마에서만 자른다
function splitTopLevel(value) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of value) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

// transition-property 목록에서 prop 을 찾아 duration·timing 이 기대 곡선과 같은지 잰다
async function expectTransition(locator, props, ease = EASE_OUT, duration = DURATION) {
  const info = await locator.evaluate((el) => {
    const cs = getComputedStyle(el)
    return {
      properties: cs.transitionProperty,
      durations: cs.transitionDuration,
      timings: cs.transitionTimingFunction,
    }
  })
  const properties = splitTopLevel(info.properties)
  const durations = splitTopLevel(info.durations)
  const timings = splitTopLevel(info.timings)
  for (const prop of props) {
    const idx = properties.indexOf(prop)
    expect(idx, `${prop} 전환 없음 (가진 속성: ${properties.join(', ')})`).toBeGreaterThanOrEqual(0)
    expect(durations[idx], `${prop} duration`).toBe(duration)
    expect(timings[idx], `${prop} timing`).toBe(ease)
  }
}

// 색·바탕·테두리·그림자·투명도 전환 — --transition-fast(EASE_OUT) 기대
async function expectColorTransition(locator, props) {
  return expectTransition(locator, props, EASE_OUT)
}

// 크기·위치(transform) 전환 — --transition-move(EASE_SPRING) 기대 (F-173 A2)
async function expectMoveTransition(locator, props) {
  return expectTransition(locator, props, EASE_SPRING)
}

// 툴팁·메뉴·대화상자 나타남 전용 — --transition-pop(EASE_POP) 기대 (F-228 2.1)
async function expectPopTransition(locator, props) {
  return expectTransition(locator, props, EASE_POP, POP_DURATION)
}

// 튀어나오는 요소의 opacity — --transition-pop-fade(EASE_OUT, 더 짧은 duration) 기대 (F-228 2.1, H86)
async function expectPopFadeTransition(locator, props) {
  return expectTransition(locator, props, EASE_OUT, POP_FADE_DURATION)
}

test.describe('F-149 A2 계산값 — 상단바·제목·설정', () => {
  test('상단바 아이콘 버튼·제목 입력·설정 세그먼트에 색 전환이 있다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    await expectColorTransition(page.getByRole('button', { name: '편집 — 서식을 보며 편집' }), [
      'background-color',
      'color',
    ])
    // 제목 입력은 본문 맨 위로 옮겨가 테두리·바탕 없는 글자다 — 색 전환 대상이 아니다 (F-217.md 2.1)

    await page.getByRole('button', { name: '설정', exact: true }).click()
    const segBtn = page.locator('#theme-label').locator('..').getByRole('radio', { name: '시스템' })
    await expectColorTransition(segBtn, ['background-color', 'color'])
    await page.getByRole('button', { name: '닫기', exact: true }).click()

    const dialogBtn = page.locator('.dialog-actions button').first()
    // 대화상자 버튼 판정용 — 삭제 대화상자를 잠깐 연다
    const row = page.locator('.tree-row').first()
    await row.hover()
    await row.locator('.item-menu-btn').click()
    await page.getByRole('menuitem', { name: /삭제/ }).click()
    await expectColorTransition(dialogBtn, ['background-color'])
    await page.keyboard.press('Escape')
  })
})

test.describe('F-149 A2 계산값 — 사이드바', () => {
  test('사이드바 동작 버튼·레일 버튼·트리 행·토글·⋯ 버튼에 색 전환이 있다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '문서.md', content: '내용\n' })

    await expectColorTransition(page.getByRole('button', { name: '새 문서', exact: true }), [
      'background-color',
      'color',
    ])

    const row = page.locator('.tree-row').filter({ hasText: '문서' }).first()
    await expectColorTransition(row, ['background-color'])

    await row.hover()
    await expectColorTransition(row.locator('.item-menu-btn'), ['background-color', 'color', 'opacity'])
    await row.locator('.item-menu-btn').click()
    await expectColorTransition(page.locator('.item-menu-list button').first(), ['background-color', 'color'])
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: '새 폴더', exact: true }).click()
    await page.keyboard.press('Enter')
    const folderRow = page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') }).first()
    await expectColorTransition(folderRow.locator('.tree-toggle'), ['background-color', 'color'])

    await page.getByRole('button', { name: '사이드바 접기' }).click()
    await waitTransitionEnd(page.locator('.sidebar'))
    await expectColorTransition(page.locator('.rail-btn').first(), ['background-color', 'color'])
  })
})

test.describe('F-149 A2 계산값 — 공유·표·자동완성·목차', () => {
  test('공유 메뉴 항목·표 + 버튼·자동완성 항목·목차 항목에 색 전환이 있다', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, {
      name: '다른문서.md',
      content: '내용\n',
    })
    await importMarkdown(page, {
      content: '# 제목\n\n표\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n## 부제\n',
    })

    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await expectColorTransition(page.locator('.share-menu-list button').first(), ['background-color', 'color'])
    await page.keyboard.press('Escape')

    const wrap = page.locator('.md-table-widget')
    await wrap.hover()
    await expectColorTransition(wrap.locator('.md-table-add-col'), ['opacity', 'border-color', 'color'])

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\n[[다')
    const item = page.locator('.cm-tooltip-autocomplete ul li').first()
    await expect(item).toBeVisible()
    await expectColorTransition(item, ['background-color', 'color'])
    await page.keyboard.press('Escape')

    const nav = page.locator('nav.outline')
    await nav.hover()
    await expect(nav).toHaveClass(/outline--expanded/)
    await expectColorTransition(page.locator('.outline-item').first(), ['background-color', 'color'])
  })
})

test.describe('F-149 A2 계산값 — 빈 상태', () => {
  test('빈 상태 버튼에 색 전환이 있다', async ({ page }) => {
    await openApp(page)
    const row = page.locator('.tree-row').first()
    await row.hover()
    await row.locator('.item-menu-btn').click()
    await page.getByRole('menuitem', { name: /삭제/ }).click()
    await page.getByRole('button', { name: '삭제', exact: true }).click()

    await expect(page.locator('.empty-state')).toBeVisible()
    await expectColorTransition(page.locator('.empty-state button').first(), ['background-color'])
  })
})

test.describe('F-149 A3 툴팁 전환·지연', () => {
  test('상단바 버튼 — 호버는 지연 뒤 나타나고, 포커스는 지연 없이, 사라짐도 지연 없다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    const btn = page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true })
    const wrap = page.locator('.icon-btn-wrap').filter({ has: btn })
    const tooltip = wrap.locator('.icon-tooltip')

    // hover() 는 실제 경과 시간을 예측할 수 없어 opacity 진행값 대신 정적 transition-delay 로 지연 유무를 잰다
    await btn.hover()
    const hoverDelay = await tooltip.evaluate((el) => getComputedStyle(el).transitionDelay)
    expect(hoverDelay).toBe('0.4s')
    await page.waitForTimeout(600) // 450ms·600ms 두 시점 모두 지난 뒤에도 보임
    await expect(tooltip).toHaveCSS('opacity', '1')

    await page.mouse.move(10, 10)
    const leaveDelay = await tooltip.evaluate((el) => getComputedStyle(el).transitionDelay)
    expect(leaveDelay).toBe('0s')
    await expect(tooltip).toHaveCSS('opacity', '0')

    await btn.focus()
    const focusDelay = await tooltip.evaluate((el) => getComputedStyle(el).transitionDelay)
    expect(focusDelay).toBe('0s')
    await expect(tooltip).toHaveCSS('opacity', '1', { timeout: 300 })
  })

  test('표 + 버튼 툴팁도 같은 지연 규칙을 따른다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '표\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n' })

    const wrap = page.locator('.md-table-widget')
    await wrap.hover()
    const addBtn = wrap.locator('.md-table-add-row')
    await addBtn.hover()
    const hoverDelay = await addBtn.evaluate((el) => getComputedStyle(el, '::after').transitionDelay)
    expect(hoverDelay).toBe('0.4s')
    await page.waitForTimeout(600)
    expect(Number(await addBtn.evaluate((el) => getComputedStyle(el, '::after').opacity))).toBe(1)

    await addBtn.focus()
    const focusDelay = await addBtn.evaluate((el) => getComputedStyle(el, '::after').transitionDelay)
    expect(focusDelay).toBe('0s')
    await expect
      .poll(async () => Number(await addBtn.evaluate((el) => getComputedStyle(el, '::after').opacity)))
      .toBe(1)
  })
})

test.describe('F-149 A4 기존 전환 유지', () => {
  test('사이드바 레일 폭·폴더 토글 회전 전환이 그대로 있다', async ({ page }) => {
    await openApp(page)
    const widthTransition = await page.locator('.sidebar').evaluate((el) => getComputedStyle(el).transitionProperty)
    expect(widthTransition.split(',').map((s) => s.trim())).toContain('width')

    await page.getByRole('button', { name: '새 폴더', exact: true }).click()
    await page.keyboard.press('Enter')
    const icon = page.locator('.tree-toggle-icon').first()
    const iconTransition = await icon.evaluate((el) => getComputedStyle(el).transitionProperty)
    expect(iconTransition.split(',').map((s) => s.trim())).toContain('transform')
  })
})

test.describe('F-149 A5 입력 반응 — 전환 제외', () => {
  test('CM6 커서·선택·줄, 표 칸 편집 하위 에디터 글자에는 전환이 없다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '문단\n\n표\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n' })

    // drawSelection() 을 안 써 .cm-cursor·.cm-selectionBackground 가 DOM 에 없다(e2e/theme.spec.js F-141 A5) — .cm-line 만 확인한다
    await page.locator('.cm-content').click()

    for (const selector of ['.cm-line']) {
      const duration = await page.locator(selector).first().evaluate((el) => getComputedStyle(el).transitionDuration)
      expect(duration.split(',').every((d) => d.trim() === '0s'), `${selector}: ${duration}`).toBe(true)
    }

    const cell = page.locator('.md-table td').first()
    await cell.click()
    const subEditorLine = page.locator('.md-table-cell-editing .cm-line').first()
    await expect(subEditorLine).toBeVisible()
    const duration = await subEditorLine.evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(duration.split(',').every((d) => d.trim() === '0s')).toBe(true)
  })
})

test.describe('F-149 A6 움직임 줄이기', () => {
  test('prefers-reduced-motion: reduce 이면 전환 시간이 0', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    const tokenValue = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--transition-fast').trim(),
    )
    expect(tokenValue).toBe('0ms')

    const btn = page.getByRole('button', { name: '편집 — 서식을 보며 편집' })
    const duration = await btn.evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(duration.split(',').every((d) => d.trim() === '0s')).toBe(true)

    const wrap = page.locator('.icon-btn-wrap').filter({ has: page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true }) })
    const tooltipDuration = await wrap
      .locator('.icon-tooltip')
      .evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(tooltipDuration).toBe('0s')
  })
})

// ===== F-172 나타나고 사라지는 요소 전환 =====

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

// 여는 조작과 opacity 표본을 한 evaluate 안에서 같이 한다 — IPC 왕복 시간이 들쭉날쭉해 180ms 전환을 놓치는 것을 막는다 (F-172.md 3장 A3)
async function sampleOpacityFrames(page, { kind, selector, frames = 15 }) {
  return page.evaluate(
    ({ kind, selector, frames }) =>
      new Promise((resolve) => {
        const values = []
        function waitForTarget() {
          const el = document.querySelector(selector)
          if (!el) {
            requestAnimationFrame(waitForTarget)
            return
          }
          function tick() {
            values.push(parseFloat(getComputedStyle(el).opacity))
            if (values.length < frames) requestAnimationFrame(tick)
            else resolve(values)
          }
          requestAnimationFrame(tick)
        }

        if (kind === 'share-menu') {
          document.querySelector('.share-menu-btn').click()
        } else if (kind === 'item-menu') {
          document.querySelector('.item-menu-btn').click()
        } else if (kind === 'dialog') {
          document.querySelector('.item-menu-btn').click()
          // 메뉴 열림 커밋 완료를 보장할 수 없어 삭제 항목이 나타날 때까지 기다렸다가 누른다
          function clickDelete() {
            const del = [...document.querySelectorAll('[role="menuitem"]')].find((b) =>
              b.textContent.includes('삭제'),
            )
            if (del) {
              del.click()
              return
            }
            requestAnimationFrame(clickDelete)
          }
          clickDelete()
        } else if (kind === 'notice') {
          const dt = new DataTransfer()
          dt.items.add(new File(['내용\n'], 'a.md', { type: 'text/markdown' }))
          const el = document.querySelector('.sidebar')
          const init = { bubbles: true, cancelable: true, dataTransfer: dt }
          el.dispatchEvent(new DragEvent('dragenter', init))
          el.dispatchEvent(new DragEvent('drop', init))
        } else if (kind === 'sidebar') {
          document.querySelector('.sidebar-toggle').click()
        }

        requestAnimationFrame(waitForTarget)
      }),
    { kind, selector, frames },
  )
}

test.describe('F-172 A2 계산값 — 열린 상태 opacity 전환', () => {
  test('알림 띠·겹침 사이드바에 opacity 전환(0.18s)이 있다', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    await dropMarkdownFile(page, '.sidebar', { name: 'a.md', content: '내용\n' })
    await expect(page.locator('.notice')).toBeVisible()
    await expectColorTransition(page.locator('.notice'), ['opacity'])

    await resizeWindow(page, 900)
    await page.locator('.sidebar-toggle').click()
    await expectColorTransition(page.locator('.sidebar'), ['opacity'])
  })

  // 공유 메뉴·⋯ 메뉴·대화상자는 F-228(H86)에서 opacity 가 --transition-pop-fade(0.1s)로 바뀌었다
  test('공유 메뉴·⋯ 메뉴·대화상자에 opacity 전환(0.1s, --transition-pop-fade)이 있다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await expectPopFadeTransition(page.locator('.share-menu-list'), ['opacity'])
    await page.keyboard.press('Escape')

    const row = page.locator('.tree-row').first()
    await row.hover()
    await row.locator('.item-menu-btn').click()
    await expectPopFadeTransition(page.locator('.item-menu-list'), ['opacity'])
    await page.keyboard.press('Escape')

    await openDeleteDialog(page)
    const dialog = page.locator('dialog.dialog[open]')
    await expect(dialog).toBeVisible()
    await expectPopFadeTransition(dialog, ['opacity'])
    await page.keyboard.press('Escape')
  })
})

test.describe('F-173 A2 계산값 — 열린 상태 transform 전환 곡선', () => {
  test('알림 띠·겹침 사이드바의 transform 전환은 튕기는 곡선(--transition-move) 그대로다', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    await dropMarkdownFile(page, '.sidebar', { name: 'a.md', content: '내용\n' })
    await expect(page.locator('.notice')).toBeVisible()
    await expectMoveTransition(page.locator('.notice'), ['transform'])

    await resizeWindow(page, 900)
    await page.locator('.sidebar-toggle').click()
    await expectMoveTransition(page.locator('.sidebar'), ['transform'])
  })

  // 공유 메뉴·⋯ 메뉴·대화상자는 F-228 에서 --transition-pop 으로 바뀌었다 — F-228 A5 참고
  test('공유 메뉴·⋯ 메뉴·대화상자의 transform 전환은 더 뚜렷하게 튕기는 곡선(--transition-pop)이다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await expectPopTransition(page.locator('.share-menu-list'), ['transform'])
    await page.keyboard.press('Escape')

    const row = page.locator('.tree-row').first()
    await row.hover()
    await row.locator('.item-menu-btn').click()
    await expectPopTransition(page.locator('.item-menu-list'), ['transform'])
    await page.keyboard.press('Escape')

    await openDeleteDialog(page)
    const dialog = page.locator('dialog.dialog[open]')
    await expect(dialog).toBeVisible()
    await expectPopTransition(dialog, ['transform'])
    await page.keyboard.press('Escape')
  })
})

test.describe('F-172 A3 중간 상태 — 열린 직후 0 과 1 사이 프레임', () => {
  test('공유 메뉴가 열리는 동안 중간 opacity 프레임이 있다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    const values = await sampleOpacityFrames(page, { kind: 'share-menu', selector: '.share-menu-list' })
    expect(values.some((v) => v > 0 && v < 1), `표본: ${values.join(', ')}`).toBe(true)
  })

  test('⋯ 메뉴가 열리는 동안 중간 opacity 프레임이 있다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '문서.md', content: '내용\n' })
    const values = await sampleOpacityFrames(page, { kind: 'item-menu', selector: '.item-menu-list' })
    expect(values.some((v) => v > 0 && v < 1), `표본: ${values.join(', ')}`).toBe(true)
  })

  test('알림 띠가 열리는 동안 중간 opacity 프레임이 있다', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)
    const values = await sampleOpacityFrames(page, { kind: 'notice', selector: '.notice' })
    expect(values.some((v) => v > 0 && v < 1), `표본: ${values.join(', ')}`).toBe(true)
  })

  test('대화상자가 열리는 동안 중간 opacity 프레임이 있다', async ({ page }) => {
    await openApp(page)
    const values = await sampleOpacityFrames(page, { kind: 'dialog', selector: 'dialog.dialog[open]' })
    expect(values.some((v) => v > 0 && v < 1), `표본: ${values.join(', ')}`).toBe(true)
  })

  test('좁은 창 겹침 사이드바가 열리는 동안 중간 opacity 프레임이 있다', async ({ page }) => {
    await openApp(page)
    await resizeWindow(page, 900)
    // 넓은→좁은 리사이즈로 걸린 닫힘 전환이 끝나길 기다린다 — 안 그러면 여는 전환이 그걸 가로채 중간값이 안 보인다
    await waitTransitionEnd(page.locator('.sidebar'))
    const values = await sampleOpacityFrames(page, { kind: 'sidebar', selector: '.sidebar' })
    expect(values.some((v) => v > 0 && v < 1), `표본: ${values.join(', ')}`).toBe(true)
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

test.describe('F-172 A5 키보드 회귀', () => {
  test('공유 메뉴 열기 → 첫 항목 포커스, Esc 로 닫기 → 버튼 포커스로 복귀한다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    const shareBtn = page.getByRole('button', { name: '공유 — 링크·마크다운 복사' })
    await shareBtn.click()
    const items = page.locator('.share-menu-list [role="menuitem"]')
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(shareBtn).toBeFocused()
  })

  test('대화상자는 Esc 로 닫힌다', async ({ page }) => {
    await openApp(page)
    await openDeleteDialog(page)
    await expect(page.locator('dialog.dialog[open]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('dialog.dialog[open]')).toHaveCount(0)
  })
})

test.describe('F-172 A6 움직임 줄이기', () => {
  test('prefers-reduced-motion: reduce 면 닫자마자 닫힌 상태가 된다', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await skipPersistNotice(page)
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    const menu = page.locator('.share-menu-list')
    await expect(menu).toBeVisible()
    const duration = await menu.evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(duration.split(',').every((d) => d.trim() === '0s')).toBe(true)

    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    await dropMarkdownFile(page, '.sidebar', { name: 'a.md', content: '내용\n' })
    const notice = page.locator('.notice')
    await expect(notice).toBeVisible()
    await notice.locator('.icon-btn-wrap .icon-btn').click()
    await expect(notice).toHaveCount(0)
  })
})

test.describe('F-173 A3 움직임 줄이기 — 두 곡선 토큰 모두 0', () => {
  test('reducedMotion: reduce 면 --transition-fast·--transition-move 둘 다 0ms', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement)
      return {
        fast: cs.getPropertyValue('--transition-fast').trim(),
        move: cs.getPropertyValue('--transition-move').trim(),
      }
    })
    expect(tokens.fast).toBe('0ms')
    expect(tokens.move).toBe('0ms')
  })
})

// ===== F-228 툴팁·메뉴 튀어나오는 움직임 =====

test.describe('F-228 A1 토큰', () => {
  test('--ease-pop·--transition-pop·--transition-pop-fade 계산값', async ({ page }) => {
    await openApp(page)
    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement)
      return {
        easePop: cs.getPropertyValue('--ease-pop').trim(),
        transitionPop: cs.getPropertyValue('--transition-pop').trim(),
        transitionPopFade: cs.getPropertyValue('--transition-pop-fade').trim(),
      }
    })
    // 커스텀 프로퍼티 원문 값은 브라우저가 0 을 뺀 소수(.32)로 정규화한다 — transitionTimingFunction 계산값과 다르다
    const stripLeadingZero = (s) => s.replace(/(?<![\d])0(\.\d)/g, '$1')
    expect(tokens.easePop).toBe(stripLeadingZero(EASE_POP))
    expect(tokens.transitionPop).toBe(`.24s ${stripLeadingZero(EASE_POP)}`)
    expect(tokens.transitionPopFade).toBe(`.1s ${stripLeadingZero(EASE_OUT)}`)
  })
})

test.describe('F-228 A2 툴팁 곡선', () => {
  test('상단바 아이콘 버튼 호버 상태 .icon-tooltip 의 scale·translate 는 --ease-pop, opacity 는 --transition-pop-fade', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    const btn = page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true })
    const wrap = page.locator('.icon-btn-wrap').filter({ has: btn })
    const tooltip = wrap.locator('.icon-tooltip')

    await btn.hover()
    await expectPopTransition(tooltip, ['scale', 'translate'])
    await expectPopFadeTransition(tooltip, ['opacity'])
  })
})

test.describe('F-228 A3 툴팁 넘침', () => {
  test('호버 뒤 scale 이 1 을 넘는 프레임이 있고 마지막은 1', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    const btn = page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true })
    const wrap = page.locator('.icon-btn-wrap').filter({ has: btn })

    const sample = wrap.locator('.icon-tooltip').evaluate(
      (el) =>
        new Promise((resolve) => {
          const samples = []
          const start = performance.now()
          function tick() {
            samples.push(parseFloat(getComputedStyle(el).scale))
            // 지연 400ms + 전환 240ms 이 다 지나가고도 넉넉히 기다린다
            if (performance.now() - start < 1200) requestAnimationFrame(tick)
            else resolve(samples)
          }
          requestAnimationFrame(tick)
        }),
    )
    await btn.hover()
    const values = await sample
    expect(values.some((v) => v > 1), `표본: ${values.join(', ')}`).toBe(true)
    expect(values[values.length - 1]).toBeCloseTo(1, 2)
  })
})

test.describe('F-228 A4 가운데 정렬 유지', () => {
  test('가운데 툴팁 다 나타난 뒤 rect 중심 x 와 버튼 중심 x 가 ±1px', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    const btn = page.getByRole('button', { name: '편집 — 서식을 보며 편집' })
    const wrap = page.locator('.icon-btn-wrap').filter({ has: btn })
    const tooltip = wrap.locator('.icon-tooltip')

    await btn.hover()
    await page.waitForTimeout(700) // 지연 400ms + 전환 240ms 이 다 지나가게
    const btnBox = await btn.boundingBox()
    const tipBox = await tooltip.boundingBox()
    const btnCenter = btnBox.x + btnBox.width / 2
    const tipCenter = tipBox.x + tipBox.width / 2
    expect(Math.abs(tipCenter - btnCenter)).toBeLessThanOrEqual(1)
  })
})

test.describe('F-228 A5 메뉴·대화상자 곡선', () => {
  test('.item-menu-list·.share-menu-list·설정 대화상자 열린 상태 transform 전환이 --ease-pop 이다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await expectPopTransition(page.locator('.share-menu-list'), ['transform'])
    await page.keyboard.press('Escape')

    const row = page.locator('.tree-row').first()
    await row.hover()
    await row.locator('.item-menu-btn').click()
    await expectPopTransition(page.locator('.item-menu-list'), ['transform'])
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: '설정', exact: true }).click()
    await expectPopTransition(page.locator('.dialog[open]'), ['transform'])
  })
})

test.describe('F-228 A6 움직임 줄이기', () => {
  test('reducedMotion: reduce 면 툴팁·메뉴 전환이 0s', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })

    const tokenValue = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--transition-pop').trim(),
    )
    expect(tokenValue).toBe('0ms')

    const btn = page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true })
    const wrap = page.locator('.icon-btn-wrap').filter({ has: btn })
    await btn.hover()
    const tooltipDuration = await wrap
      .locator('.icon-tooltip')
      .evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(tooltipDuration.split(',').every((d) => d.trim() === '0s')).toBe(true)

    const row = page.locator('.tree-row').first()
    await row.hover()
    await row.locator('.item-menu-btn').click()
    const menuDuration = await page
      .locator('.item-menu-list')
      .evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(menuDuration.split(',').every((d) => d.trim() === '0s')).toBe(true)
  })
})
