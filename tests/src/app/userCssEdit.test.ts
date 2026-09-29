// 사용자 CSS 탭·편집 대화상자의 순수 함수 (specs/features/F-2096.md 5·7.1)
import { describe, expect, test } from 'vitest'
import {
  cleanSnippetName,
  exceedsUserCssBytes,
  newSnippetId,
  nextSnippetName,
  removeSnippet,
  replaceSnippet,
  userCssSaveMessage,
  userCssStatusLines,
} from '../../../src/app/userCssEdit'
import { validateUserCssSnippets } from '../../../src/lib/userCssPolicy'
import type { UserCssCompiled, UserCssSnippet } from '../../../src/lib/userCssPolicy'

const snip = (id: string, name: string): UserCssSnippet => ({ id, name, css: '', enabled: true, updatedAt: 1 })

describe('F-2096 A2 newSnippetId', () => {
  test('8바이트 → 소문자 16진 16자, 검증 통과', () => {
    const id = newSnippetId(new Uint8Array([0, 1, 2, 171, 205, 239, 16, 255]))
    expect(id).toBe('000102abcdef10ff')
    expect(validateUserCssSnippets([snip(id, 'a')]).ok).toBe(true)
  })
})

describe('F-2096 A3 nextSnippetName', () => {
  test('스니펫', () => {
    expect(nextSnippetName([], 'snippet')).toBe('스니펫 1')
    expect(nextSnippetName(['스니펫 1', '스니펫 3'], 'snippet')).toBe('스니펫 2')
  })
  test('템플릿', () => {
    expect(nextSnippetName([], 'template')).toBe('템플릿')
    expect(nextSnippetName(['템플릿'], 'template')).toBe('템플릿 2')
    expect(nextSnippetName(['템플릿', '템플릿 2'], 'template')).toBe('템플릿 3')
  })
})

describe('F-2096 A4 cleanSnippetName', () => {
  test('앞뒤 공백·제어 문자', () => {
    expect(cleanSnippetName('  a\u0007b ')).toBe('ab')
    expect(cleanSnippetName('   ')).toBe('')
  })
})

describe('F-2096 A5 replaceSnippet·removeSnippet', () => {
  const list = [snip('a'.repeat(16), '하나'), snip('b'.repeat(16), '둘')]
  test('순서 유지', () => {
    const next = { ...list[1], name: '바뀜' }
    expect(replaceSnippet(list, next)).toEqual([list[0], next])
  })
  test('없는 id 는 null', () => {
    expect(replaceSnippet(list, snip('c'.repeat(16), 'x'))).toBeNull()
  })
  test('removeSnippet', () => {
    expect(removeSnippet(list, list[0].id)).toEqual([list[1]])
    expect(removeSnippet(list, 'z')).toEqual(list)
  })
})

describe('F-2096 A6 exceedsUserCssBytes', () => {
  test('경계와 한글 3바이트', () => {
    expect(exceedsUserCssBytes(262_144 - 3, '가')).toBe(false)
    expect(exceedsUserCssBytes(262_144 - 2, '가')).toBe(true)
    expect(exceedsUserCssBytes(0, 'a'.repeat(262_144))).toBe(false)
    expect(exceedsUserCssBytes(1, 'a'.repeat(262_144))).toBe(true)
  })
})

describe('F-2096 A7 userCssStatusLines', () => {
  const compiled = (ruleCount: number, reasons: string[]): UserCssCompiled => ({
    css: '',
    ruleCount,
    removed: reasons.map((reason) => ({ reason, rule: 'r', property: null }) as UserCssCompiled['removed'][number]),
  })
  test('꺼짐', () => {
    expect(userCssStatusLines(compiled(3, []), false)).toEqual(['꺼져 있어 적용하지 않습니다'])
  })
  test('켜짐', () => {
    expect(userCssStatusLines(compiled(3, []), true)).toEqual(['규칙 3개 적용 중'])
  })
  test('unstable', () => {
    expect(userCssStatusLines(compiled(0, ['unstable']), true)).toEqual(['검사를 통과하지 못해 이 스니펫을 적용하지 않았습니다.'])
  })
  test('외부 요청으로 뺀 부분', () => {
    expect(userCssStatusLines(compiled(2, ['url', 'import']), true)).toEqual([
      '규칙 2개 적용 중',
      '외부 파일을 부르는 부분 2곳을 빼고 적용했습니다.',
    ])
    expect(userCssStatusLines(compiled(2, ['url']), false)).toEqual([
      '꺼져 있어 적용하지 않습니다',
      '외부 파일을 부르는 부분 1곳을 빼고 적용했습니다.',
    ])
  })
})

describe('F-2096 A8 userCssSaveMessage', () => {
  test('네 코드', () => {
    expect(userCssSaveMessage('count')).toBe('스니펫은 50개까지 만들 수 있습니다.')
    expect(userCssSaveMessage('bytes')).toBe('CSS 는 모두 합쳐 256KB 까지 저장할 수 있습니다.')
    expect(userCssSaveMessage('quota')).toBe('브라우저 저장 공간이 모자라 저장하지 못했습니다.')
    expect(userCssSaveMessage('invalid')).toBe('스니펫을 저장하지 못했습니다.')
  })
})
