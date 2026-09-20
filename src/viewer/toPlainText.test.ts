// F-278.md 7장 A1~A14 — 마크다운 원문 → 평문 변환 규칙
import { describe, expect, it } from 'vitest'
import { toPlainText } from './toPlainText'
import { buildImageBlock } from '../lib/imageBlock'

describe('toPlainText — 제목·문단 (A1)', () => {
  it('# 없이 인라인 글자만, 앞뒤 빈 줄은 블록 잇기로 생긴다', () => {
    expect(toPlainText('앞\n\n## 소개\n\n뒤', 'lf')).toBe('앞\n\n소개\n\n뒤\n')
  })
})

describe('toPlainText — 인라인 서식 (A2)', () => {
  it('굵게·기울임·취소선·하이라이트·인라인코드 기호가 없다', () => {
    expect(toPlainText('**굵게** *기울임* ~~취소~~ ==강조== `코드`', 'lf')).toBe('굵게 기울임 취소 강조 코드\n')
  })
})

describe('toPlainText — 링크 (A3)', () => {
  it('라벨 (주소) 형태', () => {
    expect(toPlainText('[글](https://a.com)', 'lf')).toBe('글 (https://a.com)\n')
  })
  it('라벨과 주소가 같으면 주소만', () => {
    expect(toPlainText('[https://a.com](https://a.com)', 'lf')).toBe('https://a.com\n')
  })
  it('자동 링크(linkify)도 주소만', () => {
    expect(toPlainText('https://a.com', 'lf')).toBe('https://a.com\n')
  })
})

describe('toPlainText — 위키링크 (A4)', () => {
  it('별칭이 있으면 별칭, [[ ]] | 없음', () => {
    const out = toPlainText('[[제목|보이는 글]]', 'lf')
    expect(out).toBe('보이는 글\n')
    expect(out).not.toContain('[[')
    expect(out).not.toContain(']]')
    expect(out).not.toContain('|')
  })
  it('별칭이 없으면 대상 제목', () => {
    expect(toPlainText('[[제목]]', 'lf')).toBe('제목\n')
  })
})

describe('toPlainText — 목록 (A5)', () => {
  it('글머리 목록 표시 유지', () => {
    expect(toPlainText('- 하나\n- 둘\n', 'lf')).toBe('- 하나\n- 둘\n')
  })
  it('번호 목록은 원문 번호를 그대로 쓴다', () => {
    expect(toPlainText('1. 하나\n2. 둘\n', 'lf')).toBe('1. 하나\n2. 둘\n')
  })
  it('2단 중첩은 깊이 1당 공백 2칸', () => {
    expect(toPlainText('- 하나\n  - 안\n- 둘\n', 'lf')).toBe('- 하나\n  - 안\n- 둘\n')
  })
  it('체크박스는 - [ ] / - [x]', () => {
    expect(toPlainText('- [ ] 할일\n- [x] 완료\n', 'lf')).toBe('- [ ] 할일\n- [x] 완료\n')
  })
})

describe('toPlainText — 인용·콜아웃 (A6)', () => {
  it('인용은 > 로 시작', () => {
    expect(toPlainText('> 인용', 'lf')).toBe('> 인용\n')
  })
  it('중첩 인용은 > > ', () => {
    expect(toPlainText('> > 중첩', 'lf')).toBe('> > 중첩\n')
  })
  it('콜아웃은 [!type] 없이 제목이 첫 줄, 아이콘 글자 없음', () => {
    const out = toPlainText('> [!warning] 주의\n> 본문', 'lf')
    expect(out).toBe('> 주의\n>\n> 본문\n')
    expect(out).not.toContain('[!warning]')
    expect(out).not.toContain('svg')
  })
})

describe('toPlainText — 표 (A7)', () => {
  it('칸은 탭으로 잇고 구분 줄이 없다', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n'
    const out = toPlainText(md, 'lf')
    expect(out).toBe('a\tb\n1\t2\n3\t4\n')
    expect(out).not.toContain('---')
    expect(out).not.toContain('|')
  })
})

describe('toPlainText — 코드블록 (A8)', () => {
  it('펜스·언어 없이 내용이 정규식이 아닌 토큰으로 그대로 남는다', () => {
    const md = '```js\n**a** %%b%% [[c]]\n```\n'
    expect(toPlainText(md, 'lf')).toBe('**a** %%b%% [[c]]\n')
  })
})

describe('toPlainText — 이미지 (A9)', () => {
  it('이미지 블록 — alt 있음', () => {
    const block = buildImageBlock({ id: '0f3a9c2e7b1d4a58', ext: 'png', alt: 'alt', width: 10 })
    expect(toPlainText(block, 'lf')).toBe('[이미지: alt]\n')
  })
  it('이미지 블록 — alt 없음', () => {
    const block = buildImageBlock({ id: '0f3a9c2e7b1d4a58', ext: 'png', alt: '', width: 10 })
    expect(toPlainText(block, 'lf')).toBe('[이미지]\n')
  })
  it('인라인 이미지 — alt 있음', () => {
    expect(toPlainText('![그림](u)', 'lf')).toBe('[이미지: 그림]\n')
  })
  it('인라인 이미지 — alt 없음', () => {
    expect(toPlainText('![](u)', 'lf')).toBe('[이미지]\n')
  })
})

describe('toPlainText — Mermaid (A10)', () => {
  it('[다이어그램] 으로 바뀌고 원본 코드가 남지 않는다', () => {
    const out = toPlainText('```mermaid\ngraph TD\n```\n', 'lf')
    expect(out).toBe('[다이어그램]\n')
    expect(out).not.toContain('graph TD')
  })
})

describe('toPlainText — 프론트매터 (A11)', () => {
  it('프론트매터가 사라지고 본문만 남는다', () => {
    expect(toPlainText('---\ntitle: 회의\n---\n\n본문', 'lf')).toBe('본문\n')
  })
})

describe('toPlainText — 주석 (A12)', () => {
  it('%%…%% 와 <!-- --> 는 사라진다', () => {
    const out1 = toPlainText('본문 %%비밀%% 끝', 'lf')
    expect(out1).not.toContain('비밀')
    expect(out1).not.toContain('%%')
    const out2 = toPlainText('앞 <!-- 숨김 --> 뒤', 'lf')
    expect(out2).not.toContain('숨김')
    expect(out2).not.toContain('<!--')
  })
  it('코드블록 안 %%코드%% 는 남는다', () => {
    const out = toPlainText('```\n%%코드%%\n```\n', 'lf')
    expect(out).toBe('%%코드%%\n')
  })
})

describe('toPlainText — 줄바꿈·BOM·끝 줄 (A13)', () => {
  const md = '첫\n\n둘'
  it('crlf 는 모든 줄바꿈이 \\r\\n', () => {
    const out = toPlainText(md, 'crlf')
    expect(out).toBe('첫\r\n\r\n둘\r\n')
  })
  it('lf 는 \\n, 맨 앞 BOM 없음, 끝 줄바꿈 정확히 1개', () => {
    const out = toPlainText(md, 'lf')
    expect(out).toBe('첫\n\n둘\n')
    expect(out.charCodeAt(0)).not.toBe(0xfeff)
    expect(out.endsWith('\n\n')).toBe(false)
  })
})

// specs/features/F-283.md 6.2, 9장 A16 — F-278 A2 의 == 떼기 정규식을 지운 뒤에도 같은 결과인지
describe('toPlainText — 하이라이트 평문 회귀 (F-283 A16)', () => {
  it('F-278 A2 입력이 mark_open/mark_close 로 바뀐 뒤에도 같은 평문을 낸다', () => {
    expect(toPlainText('**굵게** *기울임* ~~취소~~ ==강조== `코드`', 'lf')).toBe('굵게 기울임 취소 강조 코드\n')
  })
})

describe('toPlainText — 가로줄·빈 문서 (A14)', () => {
  it('가로줄 단독은 --- 한 줄', () => {
    expect(toPlainText('---', 'lf')).toBe('---\n')
  })
  it('빈 문서는 줄바꿈 1개만', () => {
    expect(toPlainText('', 'lf')).toBe('\n')
  })
})
