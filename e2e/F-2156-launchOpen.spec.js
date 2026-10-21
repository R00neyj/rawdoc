// OS 열기 설정 (specs/features/F-2156.md 6장 E1~E3)
import { test, expect } from '@playwright/test'
import { openApp, setPrefBeforeLoad } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

async function installLaunchQueue(page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'launchQueue', {
      configurable: true,
      value: { consumer: null, setConsumer(c) { this.consumer = c } },
    })
  })
}

// 파일 하나 = { name, text 또는 bytes } — 가짜 handle 로 launch 를 흘려 넣는다
async function launch(page, files) {
  await expect.poll(() => page.evaluate(() => window.launchQueue.consumer !== null)).toBe(true)
  await page.evaluate((list) => {
    window.permissionRequests = 0
    const handles = list.map(({ name, bytes }) => {
      const handle = {
        kind: 'file',
        name,
        getFile: async () => new File([new Uint8Array(bytes)], name, { lastModified: 1_700_000_000_000 }),
        createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }),
        queryPermission: async () => 'prompt',
        requestPermission: async () => {
          window.permissionRequests++
          return 'granted'
        },
        isSameEntry: async (other) => other === handle,
      }
      return handle
    })
    window.launchQueue.consumer({ files: handles })
  }, files)
}

const utf8 = (s) => [...Buffer.from(s, 'utf-8')]

test.describe('F-2156 OS 열기 설정', () => {
  test('F-2156 E1 edit 설정에서 launch 하면 S-11 + 저장 권한 필요, 권한 창 없음·업로드 없음', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await setPrefBeforeLoad(page, 'md.localFileOpen', 'edit')
    await installLaunchQueue(page)
    const server = await fakeServer(page)
    await openApp(page)
    await expect.poll(() => server.docs.size).toBeGreaterThan(0)
    const sizeBefore = server.docs.size
    const posts = () => server.writeRequests().filter((r) => r.method === 'POST' && r.path === '/api/docs').length
    const postsBefore = posts()

    await launch(page, [{ name: '실행.md', bytes: utf8('# 실행\n') }])

    await expect(page.locator('.local-file-screen')).toBeVisible()
    await expect(page).toHaveURL(/#\/file$/)
    await expect(page.locator('.local-file-status')).toContainText('저장 권한 필요')
    expect(await page.evaluate(() => window.permissionRequests)).toBe(0)
    expect(posts()).toBe(postsBefore)
    expect(server.docs.size).toBe(sizeBefore)
  })

  test('F-2156 E2 설정에서 고르면 새로고침 없이 launch 에 적용, 여러 개는 마지막 하나만 열고 알린다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await installLaunchQueue(page)
    await openApp(page)
    const before = await page.locator('.tree-row').count()

    await page.getByRole('button', { name: '설정', exact: true }).click()
    const dialog = page.locator('dialog[aria-labelledby="settings-title"]')
    await dialog.getByRole('tab', { name: '데이터' }).click()
    await dialog.getByRole('radio', { name: /이 파일만 고치기/ }).check()
    expect(await page.evaluate(() => localStorage.getItem('md.localFileOpen'))).toBe('edit')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await launch(page, [
      { name: '실행1.md', bytes: utf8('# 실행1\n') },
      { name: '실행2.md', bytes: utf8('# 실행2\n') },
    ])

    await expect(page.locator('.local-file-screen')).toBeVisible()
    await expect(page.locator('.local-file-head')).toContainText('실행2.md')
    await expect(page.locator('.notice-message')).toHaveText('파일은 한 번에 하나만 고칠 수 있어 "실행2.md" 만 열었습니다.')
    await expect(page.locator('.tree-row')).toHaveCount(before)
  })

  test('F-2156 E3 edit 설정에서 열기 실패해도 가져오기로 안 떨어진다', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await setPrefBeforeLoad(page, 'md.localFileOpen', 'edit')
    await installLaunchQueue(page)
    await openApp(page)
    const before = await page.locator('.tree-row').count()

    await launch(page, [{ name: '깨짐.md', bytes: [0xff, 0xfe, 0x00] }])

    await expect(page.locator('.notice-message')).toContainText('UTF-8')
    await expect(page.locator('.local-file-screen')).toHaveCount(0)
    await expect(page).not.toHaveURL(/#\/file$/)
    await expect(page.locator('.tree-row')).toHaveCount(before)
  })
})
