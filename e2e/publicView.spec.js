// 공개 보기 화면 S-5 (specs/features/F-210.md 2.4·2.5)
import { test, expect } from '@playwright/test'

const DOC = {
  title: '공개 문서',
  content: '# 제목1\n\n본문\n\n## 제목2\n\n```js\nconsole.log(1)\n```\n\n### 제목3\n',
  lineEnding: 'lf',
  updatedAt: 1_700_000_000_000,
}

async function mockPublicDoc(page, body = DOC, status = 200) {
  await page.route('**/pub/docs/**', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  )
}

async function indexedDbDocCount(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('md-docs')
        req.onerror = () => resolve(0)
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('docs')) {
            resolve(0)
            return
          }
          const tx = db.transaction('docs', 'readonly')
          const countReq = tx.objectStore('docs').count()
          countReq.onsuccess = () => resolve(countReq.result)
          countReq.onerror = () => resolve(0)
        }
      }),
  )
}

test.describe('F-210 A5 공개 보기 화면', () => {
  test('제목·본문·목차가 보이고 사이드바·상단바 없음, 저장소를 열지 않는다', async ({ page }) => {
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')

    await expect(page.locator('.public-view-title')).toHaveText(DOC.title)
    await expect(page.locator('.viewer h1')).toHaveText('제목1')
    await expect(page.locator('.outline-rail-item')).toHaveCount(3)
    await expect(page.locator('.sidebar')).toHaveCount(0)
    await expect(page.locator('.topbar')).toHaveCount(0)
    await expect(page.locator('.statusbar')).toHaveCount(0)
    await expect(page).toHaveTitle(DOC.title)

    expect(await indexedDbDocCount(page)).toBe(0)
  })
})

test.describe('F-210 A6 코드블록 복사 버튼', () => {
  test('누르면 클립보드에 원문이 담기고 아이콘이 바뀐다', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')

    const btn = page.locator('.code-copy-btn')
    await expect(btn).toBeVisible()
    await btn.click()

    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip.trim()).toBe('console.log(1)')
    await expect(btn.locator('svg')).toBeVisible()
  })
})

test.describe('F-210 A7 오류', () => {
  test('404 — 링크가 없거나 끊겼습니다', async ({ page }) => {
    await mockPublicDoc(page, { error: 'not_found' }, 404)
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-body')).toContainText('링크가 없거나 끊겼습니다.')
  })

  test('네트워크 오류 — 문구 + 다시 시도로 재요청', async ({ page }) => {
    let calls = 0
    await page.route('**/pub/docs/**', (route) => {
      calls++
      if (calls === 1) return route.abort('failed')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DOC) })
    })
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-body')).toContainText('링크를 불러오지 못했습니다. 연결을 확인하세요.')

    await page.getByRole('button', { name: '다시 시도' }).click()
    await expect(page.locator('.public-view-title')).toHaveText(DOC.title)
    expect(calls).toBe(2)
  })
})

test.describe('F-210 A8 내보내기', () => {
  test('.md 내보내기 — 응답 content 바이트 그대로', async ({ page }) => {
    await mockPublicDoc(page)
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-title')).toHaveText(DOC.title)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '.md 내보내기' }).click(),
    ])
    expect(download.suggestedFilename()).toBe(`${DOC.title}.md`)
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    expect(Buffer.concat(chunks).toString('utf-8')).toBe(DOC.content)
  })
})
