// 공개 사이트 글 페이지 문서 목록·목차 (specs/features/F-2036.md 8.2 A11~A18)
import { test, expect } from '@playwright/test'

test('F-2036 A11 목차 링크로 절 이동', async ({ page }) => {
  await page.goto('/help')
  // 접는 목차 안에도 같은 aria-label 의 nav 가 있어(6.1) class 로 좁힌다
  const toc = page.locator('nav.site-toc')
  await toc.getByRole('link', { name: '단축키', exact: true }).click()

  const hash = await page.evaluate(() => decodeURIComponent(location.hash))
  expect(hash).toBe('#단축키')

  // 여백의 ## 기호는 대체 글자를 비워(content: '##' / '') 접근성 이름에 섞이지 않는다 — exact 로 확인
  const heading = page.getByRole('heading', { level: 2, name: '단축키', exact: true })
  await expect(heading).toBeInViewport()
})
