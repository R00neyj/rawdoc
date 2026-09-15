// 보기 화면 목록을 편집 화면과 같게 (specs/features/F-226.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setViewMode } from './helpers.js'

const LIST_DOC = '- 가\n  - 나\n    - 다\n1. 하나\n   1. 둘\n- [ ] 할 일\n'

// 글자 시작은 CSS 변수 대신 마커 뒤 첫 실 텍스트 자식의 실제 Range 위치로 잰다(F-152 A5 와 같은 방법)
async function editPositions(page) {
  return page.evaluate(() => {
    function firstTextX(lineEl) {
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
    const content = document.querySelector('.cm-content')
    const cLeft = content.getBoundingClientRect().left
    const lines = [...document.querySelectorAll('.cm-line')].filter((l) => l.textContent.trim() !== '')
    return lines.map((line) => {
      const bullet = line.querySelector('.md-bullet')
      const marker = line.querySelector('.md-list-marker')
      const cb = line.querySelector('.md-checkbox')
      const textX = firstTextX(line)
      const textStartX = textX !== null ? textX - cLeft : null
      const mark = bullet ?? marker ?? cb
      const markX = mark ? mark.getBoundingClientRect().left - cLeft : null
      return { text: line.textContent.trim(), textStartX, markX }
    })
  })
}

async function viewPositions(page, scope = '.markdown-body') {
  return page.evaluate((sel) => {
    const body = document.querySelector(sel)
    const bLeft = body.getBoundingClientRect().left
    const lis = [...body.querySelectorAll('li')]
    return lis.map((li) => {
      const rect = li.getBoundingClientRect()
      const pl = parseFloat(getComputedStyle(li).paddingLeft) || 0
      const textStartX = rect.left - bLeft + pl
      const cb = li.querySelector('input[type="checkbox"]')
      let markX
      if (cb) {
        markX = cb.getBoundingClientRect().left - bLeft
      } else {
        const cs = getComputedStyle(li, '::before')
        markX = rect.left - bLeft + parseFloat(cs.left)
      }
      return { text: li.textContent.trim().split('\n')[0], textStartX, markX }
    })
  }, scope)
}

test.describe('F-226 A1 가로 위치', () => {
  test('편집 모드와 보기 모드의 기호 왼쪽 x ±2px, 글자 시작 x ±4px 안', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: LIST_DOC })
    await page.keyboard.press('Control+End')

    const edit = await editPositions(page)
    expect(edit).toHaveLength(6)

    await setViewMode(page, 'view')
    const view = await viewPositions(page)
    expect(view).toHaveLength(6)

    for (let i = 0; i < edit.length; i++) {
      // 편집 모드 들여쓰기는 줄마다 JS 실측이라 정적 CSS 와 문서마다 몇 px 어긋난다 — F-152 A5 와 같은 ±4 (F-226 A1)
      expect(Math.abs(view[i].textStartX - edit[i].textStartX)).toBeLessThanOrEqual(4)
      expect(Math.abs(view[i].markX - edit[i].markX)).toBeLessThanOrEqual(2)
    }
  })
})

test.describe('F-226 A2 기호', () => {
  test('보기 모드 글머리 ::before content·color·font-weight, 중첩 3단계 모두 같다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 가\n  - 나\n    - 다\n' })
    await setViewMode(page, 'view')

    const result = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--accent)'
      document.body.appendChild(probe)
      const accent = getComputedStyle(probe).color
      probe.remove()
      const lis = [...document.querySelectorAll('.markdown-body li')]
      return lis.map((li) => {
        const cs = getComputedStyle(li, '::before')
        return { content: cs.content, color: cs.color, fontWeight: cs.fontWeight, accent }
      })
    })

    expect(result).toHaveLength(3)
    for (const item of result) {
      expect(item.content).toBe('"•"')
      expect(item.fontWeight).toBe('700')
      expect(item.color).toBe(item.accent)
    }
  })
})

test.describe('F-226 A3 숫자', () => {
  // ::before 로 그린 글자는 DOM·접근성 트리에 노출되지 않는다(Chromium 확인) — 화면에 실제로 "3."로 보이는지는 스크린샷 픽셀 비교로만 판정한다(사람 확인 필요, specs/human-checks.md 후보)
  test('카운터 식·list-style-type, 시작 값이 다른 두 목록의 캡처가 다르다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '3. 셋\n   1. 안\n\n1. 넷\n' })
    await setViewMode(page, 'view')

    const facts = await page.evaluate(() => {
      const lis = [...document.querySelectorAll('.markdown-body li')]
      return lis.map((li) => ({
        content: getComputedStyle(li, '::before').content,
        listStyleType: getComputedStyle(li).listStyleType,
      }))
    })
    for (const f of facts) {
      expect(f.content).toContain('counter(list-item')
      expect(f.content).toContain('"."')
      expect(f.listStyleType).toBe('none')
    }

    const box = { width: 24, height: 20 }
    const shot = async (li) => {
      const rect = await li.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const before = getComputedStyle(el, '::before')
        return { x: r.x + parseFloat(before.left), y: r.y }
      })
      return page.screenshot({ clip: { x: rect.x, y: rect.y, ...box } })
    }

    const threeLi = page.locator('.markdown-body li').first()
    const oneLi = page.locator('.markdown-body li').last()
    const [threeShot, oneShot] = await Promise.all([shot(threeLi), shot(oneLi)])
    expect(Buffer.compare(threeShot, oneShot)).not.toBe(0)
  })
})

test.describe('F-226 A4 세로 간격', () => {
  test('연속 항목 3개 top 차이는 줄 높이와 같다, margin-top 0', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '- 하나\n- 둘\n- 셋\n' })
    await setViewMode(page, 'view')

    const data = await page.evaluate(() => {
      const lis = [...document.querySelectorAll('.markdown-body li')]
      const tops = lis.map((li) => li.getBoundingClientRect().top)
      const lineHeight = parseFloat(getComputedStyle(lis[0]).lineHeight)
      const marginTop = parseFloat(getComputedStyle(lis[1]).marginTop) || 0
      return { tops, lineHeight, marginTop }
    })

    expect(data.marginTop).toBe(0)
    expect(Math.abs(data.tops[1] - data.tops[0] - data.lineHeight)).toBeLessThanOrEqual(1)
    expect(Math.abs(data.tops[2] - data.tops[1] - data.lineHeight)).toBeLessThanOrEqual(1)
  })
})

test.describe('F-226 A5 공개 보기', () => {
  test('공개 보기 화면도 글머리 ::before 가 A2 와 같다', async ({ page }) => {
    const doc = {
      title: '목록 문서',
      content: '- 가\n  - 나\n    - 다\n',
      lineEnding: 'lf',
      updatedAt: 1_700_000_000_000,
    }
    await page.route('**/pub/docs/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) }),
    )
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-title')).toHaveText(doc.title)

    const result = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--accent)'
      document.body.appendChild(probe)
      const accent = getComputedStyle(probe).color
      probe.remove()
      const lis = [...document.querySelectorAll('.public-view .markdown-body li')]
      return lis.map((li) => {
        const cs = getComputedStyle(li, '::before')
        return { content: cs.content, color: cs.color, fontWeight: cs.fontWeight, accent }
      })
    })

    expect(result).toHaveLength(3)
    for (const item of result) {
      expect(item.content).toBe('"•"')
      expect(item.fontWeight).toBe('700')
      expect(item.color).toBe(item.accent)
    }
  })
})
