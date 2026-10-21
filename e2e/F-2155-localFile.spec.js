// 로컬 파일 화면 S-11 과 저장 (specs/features/F-2155.md 6장 E1~E3)
import { test, expect } from '@playwright/test'
import { openApp, openAppHome } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const BOM = [0xef, 0xbb, 0xbf]
const utf8 = (s) => [...Buffer.from(s, 'utf-8')]
const ORIGINAL = [...BOM, ...utf8('# 메모\r\n첫 줄\r\n')]

// 가짜 showOpenFilePicker — 고른 파일 하나의 바이트와 쓰기 기록을 그 함수의 state 에 둔다
async function installFakeFile(page, bytes = ORIGINAL) {
  await page.addInitScript((initial) => {
    const state = { bytes: new Uint8Array(initial), lastModified: 1_700_000_000_000, writes: [] }
    const handle = {
      kind: 'file',
      name: '메모.md',
      async getFile() {
        return new File([state.bytes], '메모.md', { lastModified: state.lastModified })
      },
      async createWritable() {
        const chunks = []
        return {
          async write(data) {
            chunks.push(new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data))
          },
          async close() {
            const total = chunks.reduce((n, c) => n + c.length, 0)
            const out = new Uint8Array(total)
            let at = 0
            for (const c of chunks) {
              out.set(c, at)
              at += c.length
            }
            state.bytes = out
            state.lastModified += 1000
            state.writes.push(Array.from(out))
          },
          async abort() {},
        }
      },
      async queryPermission() {
        return 'granted'
      },
      async requestPermission() {
        return 'granted'
      },
      async isSameEntry(other) {
        return other === handle
      },
    }
    window.showOpenFilePicker = Object.assign(async () => [handle], { state })
  }, bytes)
}

const writes = (page) => page.evaluate(() => window.showOpenFilePicker.state.writes)
const saveStatus = (page) => page.locator('.local-file-status .statusbar-save')

async function idbDocCount(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('md-docs')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const count = req.result.transaction('docs', 'readonly').objectStore('docs').count()
          count.onsuccess = () => resolve(count.result)
          count.onerror = () => reject(count.error)
        }
      }),
  )
}

async function openFromHome(page) {
  await page.locator('.empty-state').getByRole('button', { name: '컴퓨터 파일 바로 고치기…' }).click()
  await expect(page.locator('.local-file-screen')).toBeVisible()
  await expect(page.locator('.local-file-screen .cm-content')).toBeFocused()
}

test.describe('F-2155 로컬 파일 화면', () => {
  test('F-2155 E1 홈 파일 열기… → S-11·#/file, 열기만으론 안 쓰고 입력 1,000ms 뒤 BOM+CRLF 그대로 쓴다', async ({ page }) => {
    await installFakeFile(page)
    await page.clock.install()
    await openAppHome(page)
    const docsBefore = await idbDocCount(page)

    await openFromHome(page)
    await expect(page).toHaveURL(/#\/file$/)
    await expect(page.locator('.local-file-head')).toContainText('메모.md')
    await expect(page.locator('.local-file-head')).toContainText('컴퓨터 파일')
    await expect(saveStatus(page)).toHaveText('파일에 저장됨')
    await page.clock.runFor(2000)
    expect(await writes(page)).toEqual([])

    const now = await page.evaluate(() => Date.now())
    await page.clock.pauseAt(now + 50)
    await page.keyboard.press('Control+End')
    await page.keyboard.type('abc')
    await expect(saveStatus(page)).toHaveText('입력 중…')
    await page.clock.runFor(999)
    expect(await writes(page)).toEqual([])
    await page.clock.runFor(1)
    await expect.poll(async () => (await writes(page)).length).toBe(1)
    expect((await writes(page))[0]).toEqual([...BOM, ...utf8('# 메모\r\n첫 줄\r\nabc')])
    await page.clock.resume()
    await expect(saveStatus(page)).toHaveText('파일에 저장됨')
    expect(await idbDocCount(page)).toBe(docsBefore)
  })

  test('F-2155 E2 로그인 상태에서 고쳐 써도 올리지 않고, 문서로 가져오기 하면 새 문서 하나가 된다', async ({ page }) => {
    await installFakeFile(page)
    const server = await fakeServer(page)
    await openApp(page)
    await expect.poll(() => server.docs.size).toBeGreaterThan(0)
    const sizeBefore = server.docs.size
    const postsBefore = server.writeRequests().filter((r) => r.method === 'POST' && r.path === '/api/docs').length

    await page.locator('.sidebar').getByRole('button', { name: '가져오기', exact: true }).click()
    await page.getByRole('menuitem', { name: '컴퓨터 파일 바로 고치기…' }).click()
    await expect(page.locator('.local-file-screen')).toBeVisible()
    await page.locator('.local-file-screen .cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('abc')
    await expect(saveStatus(page)).toHaveText('파일에 저장됨')
    await expect.poll(async () => (await writes(page)).length).toBe(1)

    const posts = () => server.writeRequests().filter((r) => r.method === 'POST' && r.path === '/api/docs').length
    expect(posts()).toBe(postsBefore)
    expect(server.docs.size).toBe(sizeBefore)
    await expect(page.locator('.sidebar .tree-label').filter({ hasText: /^메모$/ })).toHaveCount(0)

    await page.locator('.local-file-head').getByRole('button', { name: /문서로 가져오기$/ }).click()
    await expect(page).toHaveURL(/#\/d\/.+$/)
    await expect(page.locator('.local-file-screen')).toHaveCount(0)
    await expect.poll(() => server.docs.size).toBe(sizeBefore + 1)
    const id = /#\/d\/(.+)$/.exec(page.url())[1]
    expect(server.docs.get(id)?.content).toBe('# 메모\r\n첫 줄\r\nabc')
    expect(posts()).toBe(postsBefore + 1)
  })

  test('F-2155 E3 Ctrl+S 는 곧바로 쓰고 내보내지 않음, 입력 직후 닫기는 그 입력까지 쓰고 #/, 앞으로 가기 #/file 은 홈', async ({ page }) => {
    await installFakeFile(page)
    await page.clock.install()
    await openAppHome(page)
    let downloads = 0
    page.on('download', () => downloads++)

    await openFromHome(page)
    const now = await page.evaluate(() => Date.now())
    await page.clock.pauseAt(now + 50)
    await page.keyboard.press('Control+End')
    await page.keyboard.type('1')
    await page.keyboard.press('Control+s')
    await expect.poll(async () => (await writes(page)).length).toBe(1)
    expect((await writes(page))[0]).toEqual([...BOM, ...utf8('# 메모\r\n첫 줄\r\n1')])
    await page.clock.runFor(1500)
    expect((await writes(page)).length).toBe(1)
    expect(downloads).toBe(0)

    await page.keyboard.type('2')
    await page.locator('.local-file-head').getByRole('button', { name: '닫기', exact: true }).click()
    await expect.poll(async () => (await writes(page)).length).toBe(2)
    expect((await writes(page))[1]).toEqual([...BOM, ...utf8('# 메모\r\n첫 줄\r\n12')])
    await page.clock.resume()
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.locator('.local-file-screen')).toHaveCount(0)
    await expect(page.locator('.empty-state')).toBeVisible()

    await openFromHome(page)
    await expect(page).toHaveURL(/#\/file$/)
    await page.goBack()
    await expect(page.locator('.local-file-screen')).toHaveCount(0)
    await expect(page.locator('.empty-state')).toBeVisible()
    await page.goForward()
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.locator('.local-file-screen')).toHaveCount(0)
    await expect(page.locator('.empty-state')).toBeVisible()
    expect(downloads).toBe(0)
  })
})
