// 에디터마다 만드는 로컬 Y.Doc — 씨앗 심기, CM6 연결, 내 편집만 되돌리기 (specs/features/F-302.md 3장·5.1)
import * as Y from 'yjs'
import { yCollab } from 'y-codemirror.next'
import { Facet } from '@codemirror/state'
import type { Extension, StateCommand } from '@codemirror/state'
import { ViewPlugin } from '@codemirror/view'
import type { KeyBinding } from '@codemirror/view'

import { toEditorText } from '../lib/lineEnding'
import { nextUndoGroup } from './undoGroup'
import type { UndoGroupState } from './undoGroup'

// F-304 이후 DO 에 영속되는 식별자 — 제품명과 무관하게 고정
export const Y_TEXT_NAME = 'content'

export type YBinding = {
  ydoc: Y.Doc
  ytext: Y.Text
  undoManager: Y.UndoManager
  extension: Extension
  destroy(): void
}

const undoManagerFacet = Facet.define<Y.UndoManager, Y.UndoManager | null>({
  combine: (values) => values[values.length - 1] ?? null,
})

// ySync.update 의 transact 보다 먼저 돌아야 한다 — 그래서 yCollab 보다 배열 앞에 둔다(5.2)
function undoGroupPlugin(undoManager: Y.UndoManager): Extension {
  return ViewPlugin.define(() => {
    let group: UndoGroupState = null
    return {
      update(update) {
        let startNew = false
        for (const tr of update.transactions) {
          const next = nextUndoGroup(group, tr)
          group = next.state
          if (next.startNew) startNew = true
        }
        if (startNew) undoManager.stopCapturing()
      },
    }
  })
}

// 받은 상태를 적용하는 트랜잭션의 origin — 씨앗(null)과 구별된다 (F-305 9.1)
const FROM_STATE = { seed: 'from-state' }

export function createYBinding(text: string): YBinding {
  const ydoc = new Y.Doc()
  const ytext = ydoc.getText(Y_TEXT_NAME)
  const seed = toEditorText(text)
  if (seed) ytext.insert(0, seed)
  return bind(ydoc, ytext)
}

// 방 Doc 이 서버에서 받은 상태를 그대로 옮겨 만든다 — 씨앗을 넣지 않는다 (F-305 5.3·9.1)
export function createYBindingFromState(state: Uint8Array): YBinding {
  const ydoc = new Y.Doc()
  const ytext = ydoc.getText(Y_TEXT_NAME)
  Y.applyUpdate(ydoc, state, FROM_STATE)
  return bind(ydoc, ytext)
}

function bind(ydoc: Y.Doc, ytext: Y.Text): YBinding {
  // 씨앗 뒤에 만들고 null origin 을 추적하지 않는다 — 둘 다 첫 Ctrl+Z 가 본문을 지우지 않게 한다(3.4)
  const undoManager = new Y.UndoManager(ytext, {
    trackedOrigins: new Set(),
    captureTimeout: Number.POSITIVE_INFINITY,
  })
  return {
    ydoc,
    ytext,
    undoManager,
    extension: [undoGroupPlugin(undoManager), undoManagerFacet.of(undoManager), yCollab(ytext, null, { undoManager })],
    destroy() {
      if (!ydoc.isDestroyed) ydoc.destroy()
    },
  }
}

function stackCommand(side: 'undo' | 'redo'): StateCommand {
  return ({ state }) => {
    if (state.readOnly) return false
    const undoManager = state.facet(undoManagerFacet)
    if (!undoManager) return false
    const stack = side === 'undo' ? undoManager.undoStack : undoManager.redoStack
    if (stack.length === 0) return false
    if (side === 'undo') undoManager.undo()
    else undoManager.redo()
    return true
  }
}

export const undoLocal: StateCommand = stackCommand('undo')
export const redoLocal: StateCommand = stackCommand('redo')

export const undoKeymap: readonly KeyBinding[] = [
  { key: 'Mod-z', run: undoLocal, preventDefault: true },
  { key: 'Mod-y', mac: 'Mod-Shift-z', run: redoLocal, preventDefault: true },
  { key: 'Mod-Shift-z', run: redoLocal, preventDefault: true },
]
