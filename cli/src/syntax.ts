// syntax 명령 출력 — 앱 도움말과 같은 문법 데이터를 터미널용으로 그린다 (specs/features/F-2118.md 3장)
import brand from '../../brand.config'
import { SITE_URL } from '../../src/lib/siteMeta'
import { fenceSource, SYNTAX_GROUPS, type SyntaxGroup } from '../../src/lib/markdownSyntax'

// 이 앱에만 있는 문법을 먼저 둔다 — 앞부분만 읽는 도구도 콜아웃·위키링크는 보게
export const APP_SYNTAX_GROUPS = ['콜아웃', '위키링크', '수식', '다이어그램', '이미지', '프론트매터']

export function syntaxHelpUrl(): string {
  return new URL('help', SITE_URL).href
}

// markdownSyntax.cliNote 는 src/ 소유라 cli/ 에서 덧붙인다 (F-2132 6장)
export const WIKILINK_BREAK_NOTE = '제목을 바꾸면 옛 제목으로 건 위키링크는 자동으로 고쳐지지 않아 끊깁니다. 폴더를 붙인 링크는 문서를 다른 폴더로 옮겨도 끊길 수 있습니다.'

function cliNoteOf(group: SyntaxGroup): string | undefined {
  if (group.group !== '위키링크') return group.cliNote
  return group.cliNote ? `${group.cliNote} ${WIKILINK_BREAK_NOTE}` : WIKILINK_BREAK_NOTE
}

function orderedGroups(): { app: SyntaxGroup[]; general: SyntaxGroup[] } {
  const app = APP_SYNTAX_GROUPS.map((name) => SYNTAX_GROUPS.find((g) => g.group === name)!)
  return { app, general: SYNTAX_GROUPS.filter((g) => !APP_SYNTAX_GROUPS.includes(g.group)) }
}

function renderGroup(group: SyntaxGroup): string {
  const parts = [`### ${group.group}`]
  for (const item of group.items) {
    if (group.items.length > 1) parts.push(item.name)
    parts.push(fenceSource(item.source))
    if (item.caption) parts.push(item.caption)
  }
  if (group.cliNote) parts.push(group.cliNote)
  if (group.group === '위키링크') parts.push(WIKILINK_BREAK_NOTE)
  return parts.join('\n\n')
}

export function renderSyntaxMarkdown(version: string): string {
  const { app, general } = orderedGroups()
  const blocks = [
    `# ${brand.name} 마크다운 문법`,
    '문서에 쓰는 마크다운입니다. 일반 마크다운에 없는 문법을 먼저 둡니다.',
    '## 이 앱의 문법',
    ...app.map(renderGroup),
    '## 일반 마크다운',
    ...general.map(renderGroup),
    `${brand.cliName} ${version} 기준입니다. 최신 문법은 ${syntaxHelpUrl()} 에서 봅니다.`,
  ]
  return `${blocks.join('\n\n')}\n`
}

export type SyntaxJson = {
  version: string
  helpUrl: string
  groups: Array<{
    group: string
    appOnly: boolean
    items: Array<{ name: string; source: string; caption?: string }>
    note?: string
  }>
}

export function syntaxJson(version: string): SyntaxJson {
  const { app, general } = orderedGroups()
  return {
    version,
    helpUrl: syntaxHelpUrl(),
    groups: [...app, ...general].map((g) => ({
      group: g.group,
      appOnly: APP_SYNTAX_GROUPS.includes(g.group),
      items: g.items.map(({ name, source, caption }) => ({ name, source, caption })),
      note: cliNoteOf(g),
    })),
  }
}
