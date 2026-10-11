// put 위키링크 경고의 대상 뽑기·해석 (small 2026-10-11 CLI 끊긴 링크 경고)
import { describe, expect, it } from 'vitest'
import { missingWikiTargets, wikiTargetsOf } from '../../../cli/src/linkCheck'

describe('wikiTargetsOf', () => {
  it('별칭·제목줄을 떼고, 코드·이미지 삽입·제목줄만 링크·중복은 뺀다', () => {
    const content = [
      '[[가]] `[[인라인코드]]` ![[그림.png]] [[나|별칭]] [[다#제목줄]] [[#제목만]]',
      '```',
      '[[펜스]]',
      '```',
      '[[가]] [[ 라 ]]',
    ].join('\n')
    expect(wikiTargetsOf(content)).toEqual(['가', '나', '다', '라'])
  })
})

describe('missingWikiTargets', () => {
  const docs = [
    { id: '1', title: 'Hello', folderId: null },
    { id: '2', title: '일지', folderId: 'f2' },
  ]
  const folders = [
    { id: 'f1', name: '수업', parentId: null },
    { id: 'f2', name: '1주차', parentId: 'f1' },
  ]

  it('앱 해석기처럼 영문 대소문자 무시·.md 꼬리·폴더 경로 끝 맞춤으로 찾는다', () => {
    const targets = ['hello', 'Hello.md', '일지', '수업/1주차/일지', '1주차/일지', '없음', '다른/일지']
    expect(missingWikiTargets(targets, docs, folders, null)).toEqual(['없음', '다른/일지'])
  })
})
