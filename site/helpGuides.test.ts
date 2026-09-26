// 도움말 ↔ 사용법 글 분담 규칙 (specs/features/F-2039.md 2장 R3~R7, 8.2 U4~U7)
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { findFrontmatter, parseSimpleProperties } from '../src/lib/frontmatter'
import { HELP_DOC_CONTENT } from '../src/app/helpDoc'
import brand from '../brand.config'
import {
  E2EE_MIN_PASSWORD_CHARS,
  E2EE_PBKDF2_ITERATIONS,
  E2EE_MAX_PLAIN_CONTENT_BYTES,
  E2EE_MAX_ATTACHMENT_REFS,
} from '../src/lib/e2eeLimits'
import { E2EE_LOCK_MINUTES, E2EE_DEFAULT_LOCK_MINUTES } from '../src/e2ee/keyring'
import { E2EE_SERVER_SAVE_INTERVAL_MS } from '../src/storage/serverStore'
import { RECOVERY_CODE_BYTES } from '../src/e2ee/recoveryCode'
import { buildE2eeConvertDialogText } from '../src/e2ee/convert'
import { PEER_AVATARS_MAX, PEER_AVATARS_MAX_NARROW } from '../src/lib/peers'
import { DISCONNECT_NOTICE_MS } from '../src/app/liveDoc'

const GUIDES_DIR = fileURLToPath(new URL('../content/guides', import.meta.url))

function readGuide(slug: string): string {
  return readFileSync(`${GUIDES_DIR}/${slug}.md`, 'utf-8')
}

function guideTitle(raw: string): string {
  const frontmatter = findFrontmatter(raw)
  if (!frontmatter) return ''
  const content = raw.slice(frontmatter.contentFrom, frontmatter.contentTo)
  const props = parseSimpleProperties(content)
  const titleProp = props?.find((p) => p.key === 'title')
  return titleProp && typeof titleProp.value === 'string' ? titleProp.value : ''
}

// 프론트매터를 뗀 본문
function guideBody(raw: string): string {
  const frontmatter = findFrontmatter(raw)
  if (!frontmatter) return raw
  return raw.slice(frontmatter.to).replace(/^\r?\n/, '')
}

// R4 판정 — .·?·! 뒤 공백·줄바꿈으로 문장을 자르고, 목록 기호·표 칸 구분자를 뗀 뒤 20자 이상만 남긴다
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((s) =>
      s
        .trim()
        .replace(/^[-*]\s+/, '')
        .replace(/^\d+\.\s+/, '')
        .replace(/^\|\s*/, '')
        .replace(/\s*\|$/, ''),
    )
    .filter((s) => [...s].length >= 20)
}

const HELP_LINK_RE = /사용법 글: \[([^\]]+)\]\(\/guides\/([a-z0-9]([a-z0-9-]*[a-z0-9])?)\)/g

function helpLinks(): Array<{ slug: string; label: string }> {
  const out: Array<{ slug: string; label: string }> = []
  for (const m of HELP_DOC_CONTENT.matchAll(HELP_LINK_RE)) out.push({ label: m[1], slug: m[2] })
  return out
}

// 링크가 들어 있는 도움말 절 하나의 본문 — 절 제목 줄과 사용법 글 줄 자신은 뺀다
function helpSectionBodyFor(slug: string): string {
  const needle = `/guides/${slug})`
  const sections = HELP_DOC_CONTENT.split(/\n(?=## )/)
  const section = sections.find((s) => s.includes(needle))
  if (!section) return ''
  return section.replace(/^## .+\n\n?/, '').replace(/(?:\n\n)?사용법 글: \[[^\]]+\]\([^)]+\)\s*$/, '')
}

describe('U4 링크 대상 (R3)', () => {
  it('도움말의 사용법 글 링크마다 content/guides/{slug}.md 가 있고, 글자가 그 title 과 같다', () => {
    const links = helpLinks()
    expect(links.length).toBeGreaterThan(0)
    for (const { slug, label } of links) {
      const raw = readGuide(slug)
      expect(guideTitle(raw), slug).toBe(label)
    }
  })
})

describe('U5 서로 옮기지 않는다 (R4)', () => {
  it('링크로 이어진 (절, 글) 쌍마다 20자 이상 문장이 양방향으로 다른 쪽에 그대로 없다', () => {
    for (const { slug } of helpLinks()) {
      const helpBody = helpSectionBodyFor(slug)
      const guideText = guideBody(readGuide(slug))
      for (const sentence of sentencesOf(helpBody)) {
        expect(guideText, `도움말 문장이 ${slug}.md 에 그대로 있다: ${sentence}`).not.toContain(sentence)
      }
      for (const sentence of sentencesOf(guideText)) {
        expect(helpBody, `${slug}.md 문장이 도움말에 그대로 있다: ${sentence}`).not.toContain(sentence)
      }
    }
  })
})

const FORBIDDEN_WORDS = [
  // 쓰지 않는 말 (F-400 5.1)
  '비밀번호',
  '마스터 암호',
  '복구 키',
  '백업 코드',
  '보관함',
  '비밀 폴더',
  '잠금 폴더',
  '가이드',
  '튜토리얼',
  // 내부 용어
  'DEK',
  'KEK',
  'AES-KW',
  'Y.Text',
  'Y.Doc',
  'Durable Object',
  'md-yjs',
  'md-docs',
  'md-remote',
  'e2ee',
  '키 묶음',
  '봉투',
  'outbox',
  'IndexedDB',
  // 과장
  '완벽',
  '100% 안전',
]

describe('U6 글 전체의 말과 분량 (R6·R7)', () => {
  const files = readdirSync(GUIDES_DIR).filter((f) => f.endsWith('.md'))

  it('글 파일이 하나 이상 있다', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`${file} 이 쓰지 않는 말을 담지 않고, 본문 6,000자·## 10개 이하다`, () => {
      const body = guideBody(readGuide(file.replace(/\.md$/, '')))
      for (const word of FORBIDDEN_WORDS) {
        expect(body, `${file} 에 "${word}"`).not.toContain(word)
      }
      expect([...body].length, `${file} 본문 길이`).toBeLessThanOrEqual(6000)
      const headingCount = (body.match(/^## /gm) ?? []).length
      expect(headingCount, `${file} ## 개수`).toBeLessThanOrEqual(10)
    })
  }

  it('encryption.md 에 제품명(brand.name·brand.shortName)이 없다', () => {
    const body = guideBody(readGuide('encryption')).toLowerCase()
    expect(body).not.toContain(brand.name.toLowerCase())
    expect(body).not.toContain(brand.shortName.toLowerCase())
  })
})

function lockLabel(m: number): string {
  return m === 60 ? '1시간' : m === 240 ? '4시간' : `${m}분`
}

describe('U7 금고 글의 수치 (R5)', () => {
  const raw = readGuide('encryption')

  it('금고 암호 최소 길이', () => {
    expect(raw).toContain(`${E2EE_MIN_PASSWORD_CHARS}자 이상`)
  })

  it('PBKDF2 반복 수', () => {
    expect(raw).toContain(`${E2EE_PBKDF2_ITERATIONS.toLocaleString('en-US')}번`)
  })

  it('금고 문서 최대 크기', () => {
    expect(raw).toContain(`약 ${Math.round(E2EE_MAX_PLAIN_CONTENT_BYTES / 1000)}KB`)
  })

  it('금고 문서의 이미지 개수 한도', () => {
    expect(raw).toContain(`${E2EE_MAX_ATTACHMENT_REFS.toLocaleString('en-US')}개까지`)
  })

  it('자동 잠금 선택지와 기본값', () => {
    const labels = E2EE_LOCK_MINUTES.map((m) => `\`${lockLabel(m)}\``).join('·')
    expect(raw).toContain(labels)
    expect(raw).toContain(`처음 값은 ${lockLabel(E2EE_DEFAULT_LOCK_MINUTES)}`)
  })

  it('서버로 보내는 간격', () => {
    expect(raw).toContain(`${Math.round(E2EE_SERVER_SAVE_INTERVAL_MS / 1000)}초에 한 번`)
  })

  it('복구 코드 길이·묶음·비트 수', () => {
    const chars = Math.ceil((RECOVERY_CODE_BYTES * 8) / 5)
    const bits = RECOVERY_CODE_BYTES * 8
    expect(raw).toContain(`${chars}자`)
    expect(raw).toContain(`4자씩 ${chars / 4}묶음`)
    expect(raw).toContain(`${bits}비트`)
  })

  it('옮기기 전 내용의 백업 보관 기간', () => {
    const text = buildE2eeConvertDialogText({
      direction: 'to-e2ee',
      scope: 'account',
      name: 'x',
      targetKind: 'doc',
      docCount: 0,
      folderCount: 0,
      showBackupNotice: true,
      usage: { writesLeft: null, bytesLeft: null },
      cost: { writes: 0, deltaBytes: 0 },
    })
    const days = /최대 (\d+)일/.exec(text.backupNotice ?? '')?.[1]
    expect(days).toBeTruthy()
    expect(raw).toContain(`최대 ${days}일`)
  })

  it('암호화로 커지는 비율', () => {
    const text = buildE2eeConvertDialogText({
      direction: 'to-e2ee',
      scope: 'account',
      name: 'x',
      targetKind: 'doc',
      docCount: 0,
      folderCount: 0,
      showBackupNotice: false,
      usage: { writesLeft: null, bytesLeft: 0 },
      cost: { writes: 0, deltaBytes: 100 },
    })
    const ratio = /약 ([\d.]+)배/.exec(text.notes.join(' '))?.[1]
    expect(ratio).toBeTruthy()
    expect(raw).toContain(`약 ${ratio}배`)
  })
})

// F-2045.md 6.2 U2~U4
describe('F-2045 공유 글', () => {
  it('U2: 공유 글의 수치가 상수에서 만든 문자열과 같다 (R5)', () => {
    const raw = readGuide('sharing')
    expect(raw).toContain(`넓은 창에서는 ${PEER_AVATARS_MAX}명까지`)
    expect(raw).toContain(`좁은 창에서는 ${PEER_AVATARS_MAX_NARROW}명까지`)
    expect(raw).toContain(`${DISCONNECT_NOTICE_MS / 1000}초 넘게`)
  })

  it('U3: 공유 글에 제품명이 없다 (R6)', () => {
    const body = guideBody(readGuide('sharing')).toLowerCase()
    expect(body).not.toContain(brand.name.toLowerCase())
    expect(body).not.toContain(brand.shortName.toLowerCase())
  })
})

describe('U4 글 사이 링크 대상 (R8)', () => {
  it('모든 content/guides/*.md 본문의 (/guides/{slug}) 링크마다 content/guides/{slug}.md 가 있다', () => {
    const files = readdirSync(GUIDES_DIR).filter((f) => f.endsWith('.md'))
    const linkRe = /\]\(\/guides\/([a-z0-9]([a-z0-9-]*[a-z0-9])?)\)/g
    let checked = 0
    for (const file of files) {
      const body = guideBody(readGuide(file.replace(/\.md$/, '')))
      for (const m of body.matchAll(linkRe)) {
        const slug = m[1]
        expect(files, `${file} → ${slug}`).toContain(`${slug}.md`)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})
