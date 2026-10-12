// 오른쪽 패널 `그래프` 보기 — 지도와 같은 3D 장면에서 노드 누르면 열기·끊긴 링크로 새 문서, WebGL2 없을 때 SVG 대체의 키보드 이동, 지도로 넘기기 (small 2026-10-11·2026-10-12)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId } from './helpers.js'

const panel = (page) => page.getByRole('complementary', { name: '오른쪽 패널' })
// 링크 칸의 끊긴 링크 버튼도 같은 이름이라 그래프 안으로 좁힌다
const graph = (page) => panel(page).getByRole('group', { name: '연결 그래프' })

async function openGraph(page) {
  await panel(page).getByRole('button', { name: '다음 보기' }).click()
  await expect(panel(page).getByRole('heading', { name: '그래프', level: 2 })).toBeVisible()
}

async function setupDocs(page) {
  await openApp(page)
  await importMarkdown(page, { name: '일지.md', content: '오늘 [[회의]] 를 했다\n' })
  const journalId = await currentDocId(page)
  await importMarkdown(page, { name: '회의.md', content: '안건은 [[새 계획]] 에 적는다\n' })
  await expect(page.locator('.doc-title')).toHaveValue('회의')
  return journalId
}

// 이웃 수가 든 캔버스 이름으로 새 가운데의 장면이 올라온 것을 안다
async function scene(page, neighbors) {
  const canvas = panel(page).getByRole('img', { name: `연결 그래프 — 이어진 문서 ${neighbors}개` })
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  return { H: box.height, cx: box.x + box.width / 2, cy: box.y + box.height / 2 }
}

const visibleLabels = (page) => panel(page).locator('.map-label:not([hidden])')

// map.spec.js 의 hoverUntil 과 같은 방식 — 3D 좌표는 알 수 없어 이름표가 뜨는 자리를 가운데부터 나선으로 훑는다
async function hoverUntil(page, { cx, cy, H }, want) {
  const step = 0.028 * H
  for (let r = 0; r <= 0.4 * H; r += step) {
    const count = r === 0 ? 1 : Math.max(6, Math.round((2 * Math.PI * r) / step))
    for (let k = 0; k < count; k++) {
      const a = (2 * Math.PI * k) / count
      await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a))
      if (want(await visibleLabels(page).count())) return
    }
  }
  throw new Error('hoverUntil: 조건을 만족하는 노드를 못 찾았다')
}

// map.spec.js 의 findNodeAboveLabel 과 같은 방식 — 이름표는 제 노드 바로 아래에 붙는다
async function clickNodeAboveLabel(page, text) {
  const box = await panel(page).locator('.map-label', { hasText: text }).first().boundingBox()
  const x = box.x + box.width / 2
  for (let dy = 2; dy <= 80; dy += 2) {
    await page.mouse.move(x, box.y - dy)
    if ((await visibleLabels(page).count()) > 0) {
      await page.mouse.click(x, box.y - dy)
      return
    }
  }
  throw new Error(`clickNodeAboveLabel: 이름표 '${text}' 위에서 노드를 못 찾았다`)
}

test.describe('그래프 보기 3D', () => {
  test.use({ reducedMotion: 'reduce' })

  test('그래프 보기 — 3D 장면에서 문서 노드를 누르면 그 문서가 가운데가 되고, 끊긴 링크 노드를 누르면 그 제목으로 새 문서를 만든다', async ({ page }) => {
    const journalId = await setupDocs(page)
    await openGraph(page)

    // 가운데를 가리키면 가운데와 이웃 둘의 이름표가 뜬다
    await hoverUntil(page, await scene(page, 2), (n) => n >= 3)
    await clickNodeAboveLabel(page, '일지')
    await expect.poll(() => currentDocId(page)).toBe(journalId)

    await hoverUntil(page, await scene(page, 1), (n) => n >= 2)
    await clickNodeAboveLabel(page, '회의')
    await expect(page.locator('.doc-title')).toHaveValue('회의')

    await hoverUntil(page, await scene(page, 2), (n) => n >= 3)
    await clickNodeAboveLabel(page, '새 계획')
    await expect(page.locator('.doc-title')).toHaveValue('새 계획')
    await expect(page.locator('.sidebar .doc-item-btn', { hasText: '새 계획' })).toHaveCount(1)
  })
})

test('그래프 보기 — WebGL2 가 없으면 SVG 그래프로 그리고, 방향키로 노드를 옮겨 다니고 Enter 로 연다', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (typeof type === 'string' && type.startsWith('webgl')) return null
      return original.call(this, type, ...rest)
    }
  })
  const journalId = await setupDocs(page)
  await openGraph(page)

  const centerNode = graph(page).getByRole('button', { name: '회의, 지금 문서' })
  await centerNode.focus()
  await page.keyboard.press('End')
  await expect(graph(page).getByRole('button', { name: '일지, 이 문서를 가리킴' })).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(graph(page).getByRole('button', { name: '새 계획, 끊긴 링크' })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect.poll(() => currentDocId(page)).toBe(journalId)
})

test('그래프 보기 — 지도에서 보기를 누르면 지금 문서를 가운데 둔 지도가 열린다', async ({ page }) => {
  await setupDocs(page)
  const meetingId = await currentDocId(page)
  await openGraph(page)
  await panel(page).getByRole('button', { name: '지도에서 보기' }).click()
  await expect(page.locator('.map-page')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#/map/${meetingId}$`))
})
