// scripts/lib/filesTable.mjs 단위 테스트 — specs/files.md 표와 실제 파일 대조
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { checkFilesTable } from '../../../scripts/lib/filesTable.mjs'

const TABLE = [
  '## `src/app/kanban/` 칸반 (2)',
  '',
  '소개',
  '',
  '|파일|하는 일|',
  '|---|---|',
  '|`src/app/kanban/BoardInput.tsx`|입력칸|',
  '|`src/app/kanban/kanbanDrag.ts`|끌기 계산|',
  '',
  '## `src/lib/` 공통 (1)',
  '',
  '|파일|하는 일|',
  '|---|---|',
  '|`src/lib/truncate.ts`|글자 자르기|',
].join('\n')

const FILES = ['src/app/kanban/BoardInput.tsx', 'src/app/kanban/kanbanDrag.ts', 'src/lib/truncate.ts']

describe('checkFilesTable', () => {
  it('F1 표와 파일이 같으면 문제가 없다', () => {
    assert.deepEqual(checkFilesTable(TABLE, FILES), [])
  })

  it('F2 표에 없는 파일과 파일이 없는 행을 각각 알린다', () => {
    const problems = checkFilesTable(TABLE, [...FILES.slice(0, 2), 'src/lib/newThing.ts'])
    assert.ok(problems.includes('src/lib/newThing.ts: 표에 없음'))
    assert.ok(problems.includes('src/lib/truncate.ts: 표에는 있지만 파일이 없음'))
  })

  it('F3 섹션 폴더와 다른 곳에 놓인 행을 알린다', () => {
    const moved = TABLE.replace('|`src/lib/truncate.ts`|', '|`src/app/truncate.ts`|')
    const problems = checkFilesTable(moved, ['src/app/kanban/BoardInput.tsx', 'src/app/kanban/kanbanDrag.ts', 'src/app/truncate.ts'])
    assert.ok(problems.some((p) => p.startsWith('src/app/truncate.ts: src/lib/ 섹션')))
  })

  it('F4 제목 개수가 행 수와 다르면 알린다', () => {
    assert.ok(checkFilesTable(TABLE.replace('칸반 (2)', '칸반 (3)'), FILES).some((p) => p.includes('제목 개수 3 ≠ 표 행 2')))
  })

  it('F5 이름순이 어긋나면 대소문자를 무시하고 알린다', () => {
    const swapped = TABLE.replace(
      '|`src/app/kanban/BoardInput.tsx`|입력칸|\n|`src/app/kanban/kanbanDrag.ts`|끌기 계산|',
      '|`src/app/kanban/kanbanDrag.ts`|끌기 계산|\n|`src/app/kanban/BoardInput.tsx`|입력칸|',
    )
    assert.ok(checkFilesTable(swapped, FILES).some((p) => p.includes('이름순')))
  })
})
