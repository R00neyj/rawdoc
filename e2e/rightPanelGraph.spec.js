// 오른쪽 패널 `그래프` 보기 — 노드 누르면 열기·끊긴 링크로 새 문서, 키보드 이동, 지도로 넘기기 (small 2026-10-11)
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

test('그래프 보기 — 문서 노드를 누르면 그 문서가 가운데가 되고, 끊긴 링크 노드를 누르면 그 제목으로 새 문서를 만든다', async ({ page }) => {
  const journalId = await setupDocs(page)
  await openGraph(page)

  await graph(page).getByRole('button', { name: '일지, 이 문서를 가리킴' }).click()
  await expect.poll(() => currentDocId(page)).toBe(journalId)
  await expect(graph(page).getByRole('button', { name: '일지, 지금 문서' })).toBeVisible()

  await graph(page).getByRole('button', { name: '회의, 이 문서가 가리킴' }).click()
  await expect(page.locator('.doc-title')).toHaveValue('회의')
  await graph(page).getByRole('button', { name: '새 계획, 끊긴 링크' }).click()
  await expect(page.locator('.doc-title')).toHaveValue('새 계획')
  await expect(page.locator('.sidebar .doc-item-btn', { hasText: '새 계획' })).toHaveCount(1)
})

test('그래프 보기 — 방향키로 노드를 옮겨 다니고 Enter 로 연다', async ({ page }) => {
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
