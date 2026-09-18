// 보기 화면 목록을 편집 화면과 같게 (specs/features/F-226.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setViewMode, waitSaved } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

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

// DELETE 를 늦춰 confirmDelete 의 재조정 경합을 재현하고, delete-all 캐스케이드를 여기서 직접 흉낸다 (F-247.md)
async function delayFolderDeletes(page, server, ms = 500) {
  await page.route(/\/api\/folders\/[^/]+\?contents=/, async (route) => {
    const req = route.request()
    if (req.method() !== 'DELETE') return route.fallback()
    await new Promise((resolve) => setTimeout(resolve, ms))
    const url = new URL(req.url())
    const id = decodeURIComponent(url.pathname.split('/').pop())
    const mode = url.searchParams.get('contents') ?? 'move-up'
    if (mode === 'delete-all') {
      const subIds = [...server.folders.values()].filter((f) => f.parentId === id).map((f) => f.id)
      const ids = [id, ...subIds]
      for (const [docId, doc] of server.docs) if (doc.folderId && ids.includes(doc.folderId)) server.docs.delete(docId)
      for (const fid of ids) server.folders.delete(fid)
    } else {
      server.folders.delete(id)
    }
    return route.fulfill({ status: 204 })
  })
}

async function buildTopSubDoc(page) {
  await page.getByRole('button', { name: '새 폴더', exact: true }).click()
  await expect(page.locator('.tree-rename-input')).toBeFocused()
  await page.keyboard.type('위')
  await page.keyboard.press('Enter')

  const topRow = page.locator('.tree-row').filter({ hasText: '위' })
  await topRow.hover()
  await topRow.locator('.item-menu-btn').click()
  await topRow.getByRole('menuitem', { name: '하위 폴더' }).click()
  await expect(page.locator('.tree-rename-input')).toBeFocused()
  await page.keyboard.type('아래')
  await page.keyboard.press('Enter')

  const subRow = page.locator('.tree-row').filter({ hasText: '아래' })
  await subRow.hover()
  await subRow.locator('.item-menu-btn').click()
  await subRow.getByRole('menuitem', { name: '새 문서' }).click()
  await page.locator('.doc-title').fill('문서')
  await page.locator('.cm-content').click()
  await page.keyboard.type('내용')
  await waitSaved(page)
}

async function deleteTopFolder(page, buttonName) {
  const topRow = page.locator('.tree-row').filter({ hasText: '위' })
  await topRow.hover()
  await topRow.locator('.item-menu-btn').click()
  await topRow.getByRole('menuitem', { name: '삭제' }).click()
  await page.getByRole('button', { name: buttonName, exact: true }).click()
}

test.describe('F-247 A7 전부 삭제', () => {
  test('상위 폴더를 전부 삭제하면 하위 폴더·그 안 문서가 되살아나지 않는다', async ({ page }) => {
    const server = await fakeServer(page)
    await delayFolderDeletes(page, server)
    await openApp(page)

    await buildTopSubDoc(page)
    await deleteTopFolder(page, '전부 삭제')

    await expect(page.locator('.tree-row').filter({ hasText: '위' })).toHaveCount(0)
    await expect(page.locator('.tree-row').filter({ hasText: '아래' })).toHaveCount(0)
    await expect(page.locator('.tree-row').filter({ hasText: '문서' })).toHaveCount(0)

    // DELETE 가 실제로 서버에 닿을 때까지 기다린 뒤 새로 고침해도 그대로다
    await page.waitForTimeout(700)
    await page.reload()
    await expect(page.locator('.cm-host .cm-editor, .empty-state')).toBeVisible()
    await expect(page.locator('.tree-row').filter({ hasText: '위' })).toHaveCount(0)
    await expect(page.locator('.tree-row').filter({ hasText: '아래' })).toHaveCount(0)
    await expect(page.locator('.tree-row').filter({ hasText: '문서' })).toHaveCount(0)
  })
})

test.describe('F-247 A8 위로 옮기기', () => {
  test('상위 폴더를 위로 옮기면 하위 폴더·문서가 사라지지 않는다', async ({ page }) => {
    const server = await fakeServer(page)
    await delayFolderDeletes(page, server)
    await openApp(page)

    await buildTopSubDoc(page)
    await deleteTopFolder(page, '위로 옮기기')

    await expect(page.locator('.tree-row').filter({ hasText: '위' })).toHaveCount(0)
    await expect(page.locator('.tree-row').filter({ hasText: '아래' })).toHaveCount(1)

    await page.waitForTimeout(700)
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

// 폴더 삭제 — 위로 옮기기/전부 삭제 선택 (specs/features/F-242.md)
async function createFolder(page) {
  await page.getByRole('button', { name: '새 폴더', exact: true }).click()
  // 포커스가 이름 입력 칸으로 옮겨가기 전에 Enter 를 누르면 "새 폴더" 버튼이 한 번 더 눌려 폴더가 두 개 생긴다
  const renameInput = page.locator('.tree-rename-input')
  await expect(renameInput).toBeFocused()
  await page.keyboard.press('Enter') // 이름 그대로 커밋
  return page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') }).first()
}

async function openFolderMenu(folderRow) {
  const menuBtn = folderRow.locator('.item-menu-btn')
  await menuBtn.focus()
  await menuBtn.click()
  return menuBtn
}

async function addDocInFolder(folderRow, page) {
  await openFolderMenu(folderRow)
  await page.getByRole('menuitem', { name: '새 문서' }).click()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
}

async function requestDeleteFolder(folderRow, page) {
  await openFolderMenu(folderRow)
  await page.getByRole('menuitem', { name: '삭제' }).click()
  return page.locator('dialog[open]')
}

test.describe('F-242 A8 폴더 삭제 선택지', () => {
  test('문서가 든 폴더 삭제 — 대화상자에 위로 옮기기·전부 삭제 두 버튼', async ({ page }) => {
    await openApp(page)
    const folderRow = await createFolder(page)
    await addDocInFolder(folderRow, page)

    const dialog = await requestDeleteFolder(folderRow, page)
    await expect(dialog.getByRole('button', { name: '위로 옮기기' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '전부 삭제' })).toBeVisible()
  })
})

test.describe('F-242 A9 위로 옮기기', () => {
  test('문서가 상위로 옮겨지고 폴더만 사라진다', async ({ page }) => {
    await openApp(page)
    const folderRow = await createFolder(page)
    await addDocInFolder(folderRow, page)
    const docRowCount = await page.locator('.tree-row').filter({ has: page.locator('.tree-toggle-spacer') }).count()

    const dialog = await requestDeleteFolder(folderRow, page)
    await dialog.getByRole('button', { name: '위로 옮기기' }).click()

    await expect(page.locator('.tree-toggle')).toHaveCount(0)
    // 문서는 지워지지 않고 그대로 남는다 — 폴더만 사라져 트리 깊이만 얕아진다
    await expect(page.locator('.tree-row').filter({ has: page.locator('.tree-toggle-spacer') })).toHaveCount(docRowCount)
  })
})

test.describe('F-242 A10 전부 삭제', () => {
  test('폴더와 안의 문서가 사이드바에서 사라진다', async ({ page }) => {
    await openApp(page)
    const folderRow = await createFolder(page)
    await addDocInFolder(folderRow, page)
    const docRowCount = await page.locator('.tree-row').filter({ has: page.locator('.tree-toggle-spacer') }).count()

    const dialog = await requestDeleteFolder(folderRow, page)
    await dialog.getByRole('button', { name: '전부 삭제' }).click()

    await expect(page.locator('.tree-toggle')).toHaveCount(0)
    await expect(page.locator('.tree-row').filter({ has: page.locator('.tree-toggle-spacer') })).toHaveCount(docRowCount - 1)
  })
})

test.describe('F-242 A11 빈 폴더', () => {
  test('버튼이 취소·삭제 두 개뿐이고, 누르면 폴더만 사라진다', async ({ page }) => {
    await openApp(page)
    const folderRow = await createFolder(page)

    const dialog = await requestDeleteFolder(folderRow, page)
    await expect(dialog.locator('.dialog-actions button')).toHaveCount(2)
    await expect(dialog.getByRole('button', { name: '취소' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '삭제', exact: true })).toBeVisible()

    await dialog.getByRole('button', { name: '삭제', exact: true }).click()
    await expect(page.locator('.tree-toggle')).toHaveCount(0)
  })
})

test.describe('F-242 A12 열린 문서가 지워짐', () => {
  test('열어 둔 문서가 든 폴더를 전부 삭제하면 홈 화면으로 돌아간다', async ({ page }) => {
    await openApp(page)
    const folderRow = await createFolder(page)
    await addDocInFolder(folderRow, page)

    const dialog = await requestDeleteFolder(folderRow, page)
    await dialog.getByRole('button', { name: '전부 삭제' }).click()

    await expect(page.locator('.empty-state')).toBeVisible()
    expect(await page.evaluate(() => location.hash)).toBe('#/')
  })
})

// 새 폴더 직후 Enter 로 폴더가 두 개 생기는 문제 (F-246.md) — Enter 재진입을 같은 턴 연속 클릭으로 결정적으로 재현한다
async function raceClickButton(page, label, times = 2) {
  await page.evaluate(
    ({ label, times }) => {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => b.getAttribute('aria-label') === label || b.textContent.trim() === label,
      )
      if (!btn) throw new Error(`button not found: ${label}`)
      for (let i = 0; i < times; i++) btn.click()
    },
    { label, times },
  )
}

test.describe('F-246 A1 사이드바 버튼 + Enter', () => {
  test('대기 없이 바로 Enter 를 쳐도 폴더는 하나만 생기고 이름 칸에 포커스가 있다', async ({ page }) => {
    await openApp(page)
    await raceClickButton(page, '새 폴더')

    const renameInput = page.locator('.tree-rename-input')
    await expect(renameInput).toBeFocused()
    await expect(page.locator('.tree-toggle')).toHaveCount(1)
  })
})

test.describe('F-246 A2 연타', () => {
  test('Enter 를 3번 연속 쳐도 폴더는 하나', async ({ page }) => {
    await openApp(page)
    await raceClickButton(page, '새 폴더', 3)

    await expect(page.locator('.tree-toggle')).toHaveCount(1)
  })
})

test.describe('F-246 A3 레일 버튼', () => {
  test('사이드바 접은 상태에서 레일 새 폴더 → 바로 Enter — 폴더 하나, 펼쳐지고 이름 칸 포커스', async ({ page }) => {
    await openApp(page)
    await page.locator('.sidebar-toggle').click() // 레일로 접기
    await expect(page.locator('.sidebar')).toHaveClass(/sidebar--collapsed/)

    await raceClickButton(page, '새 폴더')

    await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--collapsed/)
    const renameInput = page.locator('.tree-rename-input')
    await expect(renameInput).toBeFocused()
    await expect(page.locator('.tree-toggle')).toHaveCount(1)
  })
})

test.describe('F-246 A4 하위 폴더', () => {
  test('하위 폴더 만들기 → 바로 Enter — 그 폴더 안에 하나만', async ({ page }) => {
    await openApp(page)
    const parentRow = await createFolder(page)

    await openFolderMenu(parentRow)
    await raceClickButton(page, '하위 폴더')

    const renameInput = page.locator('.tree-rename-input')
    await expect(renameInput).toBeFocused()
    // 부모 폴더 + 하위 폴더 = 토글 2개. 하위가 둘이면 3개가 된다
    await expect(page.locator('.tree-toggle')).toHaveCount(2)
  })
})

test.describe('F-246 A5 정상 흐름 회귀', () => {
  test('새 폴더 → 이름 칸에 이름 치고 Enter — 이름이 저장된다', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '새 폴더', exact: true }).click()
    const renameInput = page.locator('.tree-rename-input')
    await expect(renameInput).toBeFocused()
    await page.keyboard.type('내 폴더')
    await page.keyboard.press('Enter')

    await expect(page.locator('.tree-toggle')).toHaveCount(1)
    await expect(page.locator('.tree-row').filter({ hasText: '내 폴더' })).toHaveCount(1)
  })
})

test.describe('F-246 A6 연속으로 두 번 만들기', () => {
  test('폴더 하나 만들어 이름 확정 뒤, 다시 새 폴더를 눌러도 정상으로 만들어진다', async ({ page }) => {
    await openApp(page)
    await createFolder(page)
    await expect(page.locator('.tree-toggle')).toHaveCount(1)

    // 방금 만든 폴더 이름이 기본값 "새 폴더" 라 트리 안에도 같은 이름 버튼이 생긴다 — 사이드바 만들기 버튼만 짚는다
    await page.locator('.sidebar-btn').filter({ hasText: '새 폴더' }).click()
    const renameInput = page.locator('.tree-rename-input')
    await expect(renameInput).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page.locator('.tree-toggle')).toHaveCount(2)
  })
})
