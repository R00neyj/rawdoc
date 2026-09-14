// vitest 는 src/**/*.test.{js,jsx} 만 돈다 — 이 파일은 `node --test` 로 돌린다 (F-160.md 2.4)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { longDoc, headingsDoc, listDoc, mixedDoc } from './docs.js'

test('longDoc: 줄 수만큼 "줄 {i}" 문단', () => {
  const doc = longDoc(3)
  assert.match(doc, /줄 1/)
  assert.match(doc, /줄 2/)
  assert.match(doc, /줄 3/)
  assert.equal(doc.split('\n\n').length, 3)
})

test('headingsDoc: 제목과 문단이 번갈아 n 개', () => {
  const doc = headingsDoc(4)
  assert.equal((doc.match(/^#{1,3} 제목 \d+$/gm) ?? []).length, 4)
  assert.equal((doc.match(/^문단 \d+$/gm) ?? []).length, 4)
})

test('listDoc: 긴 항목·순서 목록·체크박스·중첩 1단 포함', () => {
  const doc = listDoc()
  assert.match(doc, /^- .{100,}/m)
  assert.match(doc, /^1\. 순서 항목 1$/m)
  assert.match(doc, /^- \[ \] 미완료 체크박스$/m)
  assert.match(doc, /^ {2}- 중첩 항목 1$/m)
})

test('mixedDoc: 프론트매터·제목·인라인 서식·인용·콜아웃·코드블록·표·구분선 포함', () => {
  const doc = mixedDoc()
  assert.match(doc, /^---\ntitle: 문서\n---/)
  for (let level = 1; level <= 6; level++) {
    assert.match(doc, new RegExp(`^#{${level}} 제목${level}$`, 'm'))
  }
  assert.match(doc, /\*\*굵게\*\*/)
  assert.match(doc, /\*기울임\*/)
  assert.match(doc, /`인라인코드`/)
  assert.match(doc, /\[링크\]\(https:\/\/example\.com\)/)
  assert.match(doc, /\[\[위키링크\]\]/)
  assert.match(doc, /^> 인용문 한 줄$/m)
  assert.match(doc, /^> \[!note\] 콜아웃$/m)
  assert.match(doc, /^```js$/m)
  assert.match(doc, /^\| a \| b \|$/m)
  assert.match(doc, /^---$/m)
})
