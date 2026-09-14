// 측정·검증용 테스트 문서 생성기 (specs/features/F-160.md 2.4). 순수 함수, 문자열만 돌려준다

/** `줄 {i}` 문단을 lines 개 만든다 */
export function longDoc(lines) {
  const paras = []
  for (let i = 1; i <= lines; i++) paras.push(`줄 ${i}`)
  return paras.join('\n\n') + '\n'
}

/** `#`~`###` 제목과 문단이 번갈아 n 개 */
export function headingsDoc(n) {
  const levels = ['#', '##', '###']
  const parts = []
  for (let i = 1; i <= n; i++) {
    const hashes = levels[(i - 1) % levels.length]
    parts.push(`${hashes} 제목 ${i}`)
    parts.push(`문단 ${i}`)
  }
  return parts.join('\n\n') + '\n'
}

/** 긴 목록 항목(접히는 줄), 순서 목록, 체크박스, 중첩 1단 */
export function listDoc() {
  const longItem = '항목 텍스트를 아주 길게 만들어 편집기 안에서 줄바꿈이 일어나 여러 줄로 접히는지 확인하는 목적의 목록 항목입니다. '.repeat(3)
  return [
    `- ${longItem}`,
    '- 일반 항목',
    '  - 중첩 항목 1',
    '  - 중첩 항목 2',
    '',
    '1. 순서 항목 1',
    '2. 순서 항목 2',
    '3. 순서 항목 3',
    '',
    '- [ ] 미완료 체크박스',
    '- [x] 완료 체크박스',
    '',
  ].join('\n')
}

/** 프론트매터, 제목, 인라인 서식, 인용, 콜아웃, 목록, 체크박스, 코드블록, 표, 구분선을 모두 담은 문서 */
export function mixedDoc() {
  return [
    '---',
    'title: 문서',
    '---',
    '',
    '# 제목1',
    '## 제목2',
    '### 제목3',
    '#### 제목4',
    '##### 제목5',
    '###### 제목6',
    '',
    '문단 안에 **굵게**, *기울임*, `인라인코드`, [링크](https://example.com), [[위키링크]] 를 담는다',
    '',
    '> 인용문 한 줄',
    '',
    '> [!note] 콜아웃',
    '> 콜아웃 본문',
    '',
    '- 목록 항목 1',
    '- 목록 항목 2',
    '  - 중첩 항목',
    '',
    '- [ ] 체크박스',
    '',
    '```js',
    'const x = 1',
    '```',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '---',
    '',
  ].join('\n')
}
