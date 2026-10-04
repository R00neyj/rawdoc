// 상대 경로 이미지 리졸버 문맥 — previewCompartment 밖에 두어 모드·테마 전환에도 남는다 (specs/features/F-2131.md 3.1)
import { StateEffect, StateField } from '@codemirror/state'
import type { ResolveImagePath } from '../../lib/imageMarkdown'

export const imagePathsChanged = StateEffect.define<ResolveImagePath | null>()

export const imagePathsField = StateField.define<ResolveImagePath | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(imagePathsChanged)) value = effect.value
    }
    return value
  },
})
