// parseArgs 로 명령·옵션 해석, 사용법 오류 (specs/features/F-2021.md 4.2)
import { parseArgs as nodeParseArgs } from 'node:util'
import brand from '../../brand.config'
import { SEARCH_MAX_QUERY_CHARS } from '../../worker/searchLines'

export type GlobalOptions = { server: string | null; json: boolean }

export type RunCommand =
  | { name: 'login'; global: GlobalOptions; force: boolean; withToken: boolean; noBrowser: boolean }
  | { name: 'logout'; global: GlobalOptions }
  | { name: 'whoami'; global: GlobalOptions }
  | { name: 'ls'; global: GlobalOptions; folder: string | null; shared: boolean; root: boolean; path: boolean }
  | { name: 'find'; global: GlobalOptions; query: string; folder: string | null; root: boolean; path: boolean }
  | { name: 'search'; global: GlobalOptions; query: string; folder: string | null }
  | {
      name: 'replace'
      global: GlobalOptions
      find: string
      replacement: string
      folder: string | null
      yes: boolean
      id: string | null
      baseVersion: number | null
    }
  | { name: 'info'; global: GlobalOptions; id: string }
  | { name: 'get'; global: GlobalOptions; id: string; output: string | null; images: boolean }
  | { name: 'images'; global: GlobalOptions; id: string; dir: string }
  | { name: 'diff'; global: GlobalOptions; id: string; source: string }
  | { name: 'new'; global: GlobalOptions; source: string | null; title: string | null; folder: string | null; url: boolean }
  | {
      name: 'put'
      global: GlobalOptions
      id: string
      source: string | null
      title: string | null
      baseVersion: number | 'auto' | null
      force: boolean
      dryRun: boolean
      diff: boolean
    }
  | { name: 'merge'; global: GlobalOptions; id: string; file: string }
  | { name: 'mv'; global: GlobalOptions; id: string; folderId: string | null }
  | { name: 'rm'; global: GlobalOptions; id: string }
  | { name: 'folders'; global: GlobalOptions }
  | { name: 'mkdir'; global: GlobalOptions; folderName: string; parent: string | null }
  | { name: 'rmdir'; global: GlobalOptions; id: string; all: boolean }
  | { name: 'upload'; global: GlobalOptions; file: string; doc?: string }
  | { name: 'link'; global: GlobalOptions; id: string }
  | { name: 'syntax'; global: GlobalOptions; short: boolean }

export type CommandName = RunCommand['name']

export type ParsedInvocation =
  | { kind: 'help'; command: CommandName | null }
  | { kind: 'no-command' }
  | { kind: 'version' }
  | { kind: 'usage'; message: string; command: CommandName | null }
  | { kind: 'run'; command: RunCommand }

export const COMMAND_NAMES: CommandName[] = [
  'login',
  'logout',
  'whoami',
  'ls',
  'find',
  'search',
  'replace',
  'info',
  'get',
  'images',
  'diff',
  'new',
  'put',
  'merge',
  'mv',
  'rm',
  'folders',
  'mkdir',
  'rmdir',
  'upload',
  'link',
  'syntax',
]

function isCommandName(value: string): value is CommandName {
  return (COMMAND_NAMES as string[]).includes(value)
}

function usage(message: string, command: CommandName | null = null): ParsedInvocation {
  return { kind: 'usage', message, command }
}

type OptionSchema = Record<string, { type: 'string' | 'boolean'; short?: string }>

const GLOBAL_OPTIONS: OptionSchema = {
  server: { type: 'string' },
  json: { type: 'boolean' },
}

function globalsOf(values: Record<string, string | boolean | undefined>): GlobalOptions {
  return { server: typeof values.server === 'string' ? values.server : null, json: values.json === true }
}

// node:util parseArgs 는 strict:true 에서 모르는 옵션에 ERR_PARSE_ARGS_UNKNOWN_OPTION 을 던진다 (측정 (g))
function runParseArgs(
  args: string[],
  options: OptionSchema,
  allowPositionals: boolean,
): { values: Record<string, string | boolean | undefined>; positionals: string[] } | null {
  try {
    return nodeParseArgs({ args, options, strict: true, allowPositionals })
  } catch {
    return null
  }
}

function parseNonNegativeInt(value: string): number | null {
  if (!/^[0-9]+$/.test(value)) return null
  const n = Number(value)
  return Number.isSafeInteger(n) ? n : null
}

function parseCommandArgs(command: CommandName, rest: string[]): ParsedInvocation {
  switch (command) {
    case 'login': {
      const options: OptionSchema = { ...GLOBAL_OPTIONS, force: { type: 'boolean' }, 'with-token': { type: 'boolean' }, 'no-browser': { type: 'boolean' } }
      const parsed = runParseArgs(rest, options, false)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      return {
        kind: 'run',
        command: {
          name: 'login',
          global: globalsOf(parsed.values),
          force: parsed.values.force === true,
          withToken: parsed.values['with-token'] === true,
          noBrowser: parsed.values['no-browser'] === true,
        },
      }
    }
    case 'logout':
    case 'whoami':
    case 'folders': {
      const parsed = runParseArgs(rest, GLOBAL_OPTIONS, false)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      return { kind: 'run', command: { name: command, global: globalsOf(parsed.values) } }
    }
    case 'syntax': {
      const parsed = runParseArgs(rest, { ...GLOBAL_OPTIONS, short: { type: 'boolean' } }, false)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      return { kind: 'run', command: { name: 'syntax', global: globalsOf(parsed.values), short: parsed.values.short === true } }
    }
    case 'ls': {
      const options: OptionSchema = {
        ...GLOBAL_OPTIONS,
        folder: { type: 'string' },
        shared: { type: 'boolean' },
        root: { type: 'boolean' },
        path: { type: 'boolean' },
      }
      const parsed = runParseArgs(rest, options, false)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      const folder = typeof parsed.values.folder === 'string' ? parsed.values.folder : null
      const shared = parsed.values.shared === true
      const root = parsed.values.root === true
      const path = parsed.values.path === true
      if (folder !== null && shared) return usage('--shared 와 --folder 는 함께 쓸 수 없습니다.', command)
      if (root && shared) return usage('--shared 와 --root 는 함께 쓸 수 없습니다.', command)
      if (path && shared) return usage('--shared 와 --path 는 함께 쓸 수 없습니다.', command)
      if (root && folder !== null) return usage('--root 와 --folder 는 함께 쓸 수 없습니다.', command)
      return {
        kind: 'run',
        command: { name: 'ls', global: globalsOf(parsed.values), folder, shared, root, path },
      }
    }
    case 'find': {
      const options: OptionSchema = { ...GLOBAL_OPTIONS, folder: { type: 'string' }, root: { type: 'boolean' }, path: { type: 'boolean' } }
      const parsed = runParseArgs(rest, options, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      const folder = typeof parsed.values.folder === 'string' ? parsed.values.folder : null
      const root = parsed.values.root === true
      if (root && folder !== null) return usage('--root 와 --folder 는 함께 쓸 수 없습니다.', command)
      const query = (parsed.positionals[0] ?? '').trim()
      if (query === '') return usage('찾을 제목이 필요합니다.', command)
      if (parsed.positionals.length > 1) {
        return usage('제목은 하나만 줄 수 있습니다. 띄어쓰기가 든 제목은 따옴표로 감싸세요.', command)
      }
      return {
        kind: 'run',
        command: { name: 'find', global: globalsOf(parsed.values), query, folder, root, path: parsed.values.path === true },
      }
    }
    case 'search': {
      const parsed = runParseArgs(rest, { ...GLOBAL_OPTIONS, folder: { type: 'string' } }, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      const query = (parsed.positionals[0] ?? '').trim()
      if (query === '') return usage('찾을 글자가 필요합니다.', command)
      if (parsed.positionals.length > 1) {
        return usage('검색어는 하나만 줄 수 있습니다. 띄어쓰기가 든 검색어는 따옴표로 감싸세요.', command)
      }
      if (query.length > SEARCH_MAX_QUERY_CHARS) return usage(`검색어는 ${SEARCH_MAX_QUERY_CHARS}자까지입니다.`, command)
      const folder = typeof parsed.values.folder === 'string' ? parsed.values.folder : null
      return { kind: 'run', command: { name: 'search', global: globalsOf(parsed.values), query, folder } }
    }
    case 'replace': {
      const options: OptionSchema = { ...GLOBAL_OPTIONS, folder: { type: 'string' }, yes: { type: 'boolean' }, id: { type: 'string' }, 'base-version': { type: 'string' } }
      const parsed = runParseArgs(rest, options, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      if (parsed.positionals.length < 2) return usage('찾을 말과 바꿀 말이 필요합니다. 지우려면 바꿀 말에 "" 를 주세요.', command)
      if (parsed.positionals.length > 2) {
        return usage('찾을 말과 바꿀 말은 하나씩만 줄 수 있습니다. 띄어쓰기가 든 말은 따옴표로 감싸세요.', command)
      }
      const [find, replacement] = parsed.positionals
      if (find === '') return usage('찾을 말이 비어 있습니다.', command)
      if (/[\r\n]/.test(find)) return usage('찾을 말에는 줄바꿈을 넣을 수 없습니다.', command)
      if (find.length > SEARCH_MAX_QUERY_CHARS) return usage(`찾을 말은 ${SEARCH_MAX_QUERY_CHARS}자까지입니다.`, command)
      const folder = typeof parsed.values.folder === 'string' ? parsed.values.folder : null
      const id = typeof parsed.values.id === 'string' ? parsed.values.id : null
      if (id !== null && folder !== null) return usage('--id 와 --folder 는 함께 쓸 수 없습니다.', command)
      let baseVersion: number | null = null
      if (typeof parsed.values['base-version'] === 'string') {
        if (id === null) return usage('--base-version 은 --id 와 함께 씁니다.', command)
        baseVersion = parseNonNegativeInt(parsed.values['base-version'])
        if (baseVersion === null) return usage('--base-version 은 0 이상의 정수여야 합니다.', command)
      }
      return {
        kind: 'run',
        command: { name: 'replace', global: globalsOf(parsed.values), find, replacement, folder, yes: parsed.values.yes === true, id, baseVersion },
      }
    }
    case 'info': {
      const parsed = runParseArgs(rest, GLOBAL_OPTIONS, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      if (parsed.positionals.length !== 1) return usage('문서 id 가 필요합니다.', command)
      return { kind: 'run', command: { name: 'info', global: globalsOf(parsed.values), id: parsed.positionals[0] } }
    }
    case 'get': {
      const options: OptionSchema = { ...GLOBAL_OPTIONS, output: { type: 'string', short: 'o' }, images: { type: 'boolean' } }
      const parsed = runParseArgs(rest, options, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      if (parsed.positionals.length !== 1) return usage('문서 id 가 필요합니다.', command)
      const output = typeof parsed.values.output === 'string' ? parsed.values.output : null
      if (parsed.values.images === true && output === null) return usage('--images 는 -o <파일> 과 함께 씁니다.', command)
      return {
        kind: 'run',
        command: { name: 'get', global: globalsOf(parsed.values), id: parsed.positionals[0], output, images: parsed.values.images === true },
      }
    }
    case 'images': {
      const options: OptionSchema = { ...GLOBAL_OPTIONS, output: { type: 'string', short: 'o' } }
      const parsed = runParseArgs(rest, options, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      if (parsed.positionals.length !== 1) return usage('문서 id 가 필요합니다.', command)
      const dir = typeof parsed.values.output === 'string' ? parsed.values.output : 'attachments'
      return { kind: 'run', command: { name: 'images', global: globalsOf(parsed.values), id: parsed.positionals[0], dir } }
    }
    case 'diff': {
      const parsed = runParseArgs(rest, GLOBAL_OPTIONS, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      if (parsed.positionals.length !== 2) return usage('문서 id 와 비교할 파일(표준 입력은 -)이 필요합니다.', command)
      const [id, source] = parsed.positionals
      return { kind: 'run', command: { name: 'diff', global: globalsOf(parsed.values), id, source } }
    }
    case 'merge': {
      const parsed = runParseArgs(rest, GLOBAL_OPTIONS, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      if (parsed.positionals.length !== 2) return usage('문서 id 와 get -o 로 받은 파일이 필요합니다.', command)
      const [id, file] = parsed.positionals
      if (file === '-') return usage('merge 는 표준 입력을 받지 않습니다. get -o 로 받은 파일을 주세요.', command)
      return { kind: 'run', command: { name: 'merge', global: globalsOf(parsed.values), id, file } }
    }
    case 'new': {
      const options: OptionSchema = { ...GLOBAL_OPTIONS, title: { type: 'string' }, folder: { type: 'string' }, url: { type: 'boolean' } }
      const parsed = runParseArgs(rest, options, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      if (parsed.positionals.length > 1) return usage('원문 인자는 하나만 줄 수 있습니다.', command)
      const source = parsed.positionals[0] ?? null
      const title = typeof parsed.values.title === 'string' ? parsed.values.title : null
      if (source === null && title === null) return usage('원문 파일이나 --title 이 필요합니다.', command)
      return {
        kind: 'run',
        command: {
          name: 'new',
          global: globalsOf(parsed.values),
          source,
          title,
          folder: typeof parsed.values.folder === 'string' ? parsed.values.folder : null,
          url: parsed.values.url === true,
        },
      }
    }
    case 'put': {
      const options: OptionSchema = {
        ...GLOBAL_OPTIONS,
        title: { type: 'string' },
        'base-version': { type: 'string' },
        force: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        diff: { type: 'boolean' },
      }
      const parsed = runParseArgs(rest, options, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      if (parsed.positionals.length < 1 || parsed.positionals.length > 2) {
        return usage('문서 id 가 필요합니다.', command)
      }
      const [id, source = null] = parsed.positionals
      const title = typeof parsed.values.title === 'string' ? parsed.values.title : null
      if (source === null && title === null) return usage('올릴 원문 파일이나 --title 이 필요합니다.', command)

      const hasBaseVersion = typeof parsed.values['base-version'] === 'string'
      const force = parsed.values.force === true
      const dryRun = parsed.values['dry-run'] === true
      const diff = parsed.values.diff === true
      if (diff && !dryRun) return usage('--diff 는 --dry-run 과 함께 씁니다. 쓰지 않고 비교만 하려면 diff 명령을 쓰세요.', command)
      if (dryRun ? hasBaseVersion && force : hasBaseVersion === force) {
        return usage(
          `--base-version 또는 --force 가 필요합니다. ${brand.cliName} get ${id} -o 파일.md 로 받아 고친 뒤 ${brand.cliName} put ${id} 파일.md --base-version auto 로 올리세요. --force 는 그 사이 바뀐 내용을 덮어씁니다.`,
          command,
        )
      }
      let baseVersion: number | 'auto' | null = null
      if (hasBaseVersion) {
        const raw = parsed.values['base-version'] as string
        baseVersion = raw === 'auto' ? 'auto' : parseNonNegativeInt(raw)
        if (baseVersion === null) return usage('--base-version 은 0 이상의 정수나 auto 여야 합니다.', command)
        if (baseVersion === 'auto' && (source === null || source === '-')) {
          return usage('--base-version auto 는 get -o 로 받은 파일을 올릴 때만 씁니다. 표준 입력이면 판 번호를 직접 주세요.', command)
        }
      }
      return {
        kind: 'run',
        command: { name: 'put', global: globalsOf(parsed.values), id, source, title, baseVersion, force, dryRun, diff },
      }
    }
    case 'mv': {
      const options: OptionSchema = { ...GLOBAL_OPTIONS, folder: { type: 'string' }, root: { type: 'boolean' } }
      const parsed = runParseArgs(rest, options, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      if (parsed.positionals.length !== 1) return usage('문서 id 가 필요합니다.', command)
      const hasFolder = typeof parsed.values.folder === 'string'
      const hasRoot = parsed.values.root === true
      if (hasFolder === hasRoot) return usage('--folder <폴더id> 또는 --root 중 하나가 필요합니다.', command)
      return {
        kind: 'run',
        command: {
          name: 'mv',
          global: globalsOf(parsed.values),
          id: parsed.positionals[0],
          folderId: hasRoot ? null : (parsed.values.folder as string),
        },
      }
    }
    case 'rm': {
      const options: OptionSchema = { ...GLOBAL_OPTIONS, yes: { type: 'boolean' } }
      const parsed = runParseArgs(rest, options, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      if (parsed.positionals.length !== 1) return usage('문서 id 가 필요합니다.', command)
      if (parsed.values.yes !== true) {
        return usage('문서를 휴지통으로 옮기려면 --yes 를 붙이세요.', command)
      }
      return { kind: 'run', command: { name: 'rm', global: globalsOf(parsed.values), id: parsed.positionals[0] } }
    }
    case 'rmdir': {
      const options: OptionSchema = { ...GLOBAL_OPTIONS, yes: { type: 'boolean' }, all: { type: 'boolean' } }
      const parsed = runParseArgs(rest, options, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      if (parsed.positionals.length !== 1) return usage('폴더 id 가 필요합니다.', command)
      const all = parsed.values.all === true
      if (parsed.values.yes !== true) {
        return usage(
          all
            ? '폴더와 하위 폴더를 지우고 안의 문서를 휴지통으로 옮기려면 --yes 를 붙이세요.'
            : '폴더를 지우려면 --yes 를 붙이세요. 안의 문서와 폴더는 위 폴더로 옮겨집니다.',
          command,
        )
      }
      return { kind: 'run', command: { name: 'rmdir', global: globalsOf(parsed.values), id: parsed.positionals[0], all } }
    }
    case 'mkdir': {
      const options: OptionSchema = { ...GLOBAL_OPTIONS, parent: { type: 'string' } }
      const parsed = runParseArgs(rest, options, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      if (parsed.positionals.length !== 1) return usage('폴더 이름이 필요합니다.', command)
      return {
        kind: 'run',
        command: {
          name: 'mkdir',
          global: globalsOf(parsed.values),
          folderName: parsed.positionals[0],
          parent: typeof parsed.values.parent === 'string' ? parsed.values.parent : null,
        },
      }
    }
    case 'upload': {
      const parsed = runParseArgs(rest, { ...GLOBAL_OPTIONS, doc: { type: 'string' } }, true)
      if (!parsed) return usage('알 수 없는 옵션이거나 --doc 값이 없습니다.', command)
      if (parsed.positionals.length !== 1) return usage('이미지 파일이 필요합니다.', command)
      const doc = typeof parsed.values.doc === 'string' ? { doc: parsed.values.doc } : {}
      return { kind: 'run', command: { name: 'upload', global: globalsOf(parsed.values), file: parsed.positionals[0], ...doc } }
    }
    case 'link': {
      const parsed = runParseArgs(rest, GLOBAL_OPTIONS, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      if (parsed.positionals.length !== 1) return usage('문서 id 가 필요합니다.', command)
      return { kind: 'run', command: { name: 'link', global: globalsOf(parsed.values), id: parsed.positionals[0] } }
    }
  }
}

function parseHelpAlias(rest: string[]): ParsedInvocation {
  if (rest.length === 0) return { kind: 'help', command: null }
  if (rest.length > 1) return usage('help 뒤에는 명령 이름 하나만 줍니다.')
  return isCommandName(rest[0]) ? { kind: 'help', command: rest[0] } : usage(`알 수 없는 명령입니다: ${rest[0]}`)
}

export function parseArgs(argv: string[]): ParsedInvocation {
  if (argv.length === 0) return { kind: 'no-command' }
  const [first, ...rest] = argv
  if (first === '--help' || first === '-h') return { kind: 'help', command: null }
  if (first === '--version' || first === '-v') return { kind: 'version' }
  if (first === 'help') return parseHelpAlias(rest)
  if (!isCommandName(first)) return usage(`알 수 없는 명령입니다: ${first}`)

  if (rest.includes('--help') || rest.includes('-h')) return { kind: 'help', command: first }
  if (rest.includes('--version') || rest.includes('-v')) return { kind: 'version' }
  return parseCommandArgs(first, rest)
}
