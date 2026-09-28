// 읽기 전용이면 로컬 문서 변경을 모두 버린다(리뷰 E1) — EditorState.readOnly·editable=false 는 기본 명령·contentEditable 만 막고 view.dispatch 는 안 막아 체크박스·표·이미지 위젯이 직접 보내는 변경이 그대로 들어왔다
// 원격 Yjs 업데이트(ySyncAnnotation)는 막지 않는다 — 읽기 전용이어도 다른 사람 편집은 보여야 한다. changeFilter 라 선택·effect 는 남는다
import { EditorState } from '@codemirror/state'
import { ySyncAnnotation } from 'y-codemirror.next'

export const readOnlyChangeGuard = EditorState.changeFilter.of(
  (tr) => !tr.startState.readOnly || tr.annotation(ySyncAnnotation) !== undefined,
)
