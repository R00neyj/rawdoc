// 서식 바 '이미지' 버튼의 숨은 파일 입력 — 서식 바 밖(TopBar)에 둔다
// 휴대폰은 고르기 창이 뜨면 키보드가 내려가 서식 바가 사라지는데, 입력이 그 안에 있으면 change 를 못 받는다
import type { ChangeEvent, RefObject } from 'react'
import type { Command } from '@codemirror/view'
import { insertPickedImages } from '../editor/imageInsert'

type ToolbarImageInputProps = {
  inputRef: RefObject<HTMLInputElement | null>
  onRunCommand: (cmd: Command) => void
}

export default function ToolbarImageInput({ inputRef, onRunCommand }: ToolbarImageInputProps) {
  // 같은 파일을 다시 골라도 change 가 오도록 값을 비운다
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length > 0) onRunCommand((view) => insertPickedImages(view, files))
  }

  return <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={handleChange} />
}
