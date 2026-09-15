// 본문 맨 위 제목 상태 리듀서 — DOM 없이도(vitest environment: node) 검증 가능한 부분만 (specs/features/F-217.md 2.2·2.4, widget DOM·키보드는 e2e/docTitle.spec.js)
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'

import { createTitleField, setBreadcrumbEffect, setTitleEffect, setTitleReadOnlyEffect } from './docTitle'

function buildState(title: string, readOnly: boolean) {
  const field = createTitleField({ title, readOnly, onChange: () => {}, onCommit: () => {} })
  return { field, state: EditorState.create({ extensions: [field] }) }
}

describe('본문 제목 필드', () => {
  it('초기값을 그대로 가진다', () => {
    const { field, state } = buildState('제목', false)
    expect(state.field(field)).toMatchObject({ title: '제목', readOnly: false })
  })

  it('setTitleEffect 로 값만 바뀐다', () => {
    const { field, state } = buildState('', false)
    const next = state.update({ effects: setTitleEffect.of('새 제목') }).state
    expect(next.field(field)).toMatchObject({ title: '새 제목', readOnly: false })
  })

  it('setTitleReadOnlyEffect 로 읽기 전용만 바뀐다', () => {
    const { field, state } = buildState('제목', false)
    const next = state.update({ effects: setTitleReadOnlyEffect.of(true) }).state
    expect(next.field(field)).toMatchObject({ title: '제목', readOnly: true })
  })

  it('문서 편집 트랜잭션만으로는 값이 바뀌지 않는다(불변조건 — decoration 은 문서 내용을 바꾸지 않는다)', () => {
    const { field, state } = buildState('제목', false)
    const next = state.update({ changes: { from: 0, insert: '본문' } }).state
    expect(next.field(field)).toMatchObject({ title: '제목', readOnly: false })
  })

  it('경로는 기본값이 빈 배열이다', () => {
    const { field, state } = buildState('제목', false)
    expect(state.field(field).breadcrumb).toEqual([])
  })

  it('setBreadcrumbEffect 로 경로·이동 콜백이 함께 바뀐다', () => {
    const { field, state } = buildState('제목', false)
    const onNavigateFolder = () => {}
    const breadcrumb = [{ id: 'f1', name: 'A' }]
    const next = state.update({ effects: setBreadcrumbEffect.of({ breadcrumb, onNavigateFolder }) }).state
    const result = next.field(field)
    expect(result.breadcrumb).toEqual(breadcrumb)
    expect(result.onNavigateFolder).toBe(onNavigateFolder)
    expect(result.title).toBe('제목')
  })
})
