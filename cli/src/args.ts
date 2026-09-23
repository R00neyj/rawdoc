// parseArgs 로 명령·옵션 해석, 사용법 오류 (specs/features/F-2021.md 4.2)
import { parseArgs as nodeParseArgs } from 'node:util'
import brand from '../../brand.config'

export type GlobalOptions = { server: string | null; json: boolean }

export type RunCommand =
  | { name: 'login'; global: GlobalOptions; force: boolean; withToken: boolean; noBrowser: boolean }
  | { name: 'logout'; global: GlobalOptions }
  | { name: 'whoami'; global: GlobalOptions }
  | { name: 'ls'; global: GlobalOptions; folder: string | null }
  | { name: 'get'; global: GlobalOptions; id: string; output: string | null }
  | { name: 'new'; global: GlobalOptions; source: string | null; title: string | null; folder: string | null }
  | {
      name: 'put'
      global: GlobalOptions
      id: string
      source: string | null
      title: string | null
      baseVersion: number | null
      force: boolean
    }
  | { name: 'folders'; global: GlobalOptions }
  | { name: 'mkdir'; global: GlobalOptions; folderName: string; parent: string | null }
  | { name: 'upload'; global: GlobalOptions; file: string }
  | { name: 'link'; global: GlobalOptions; id: string }

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
  'get',
  'new',
  'put',
  'folders',
  'mkdir',
  'upload',
  'link',
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
  return Number(value)
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
    case 'ls': {
      const options: OptionSchema = { ...GLOBAL_OPTIONS, folder: { type: 'string' } }
      const parsed = runParseArgs(rest, options, false)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      return {
        kind: 'run',
        command: {
          name: 'ls',
          global: globalsOf(parsed.values),
          folder: typeof parsed.values.folder === 'string' ? parsed.values.folder : null,
        },
      }
    }
    case 'get': {
      const options: OptionSchema = { ...GLOBAL_OPTIONS, output: { type: 'string', short: 'o' } }
      const parsed = runParseArgs(rest, options, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      if (parsed.positionals.length !== 1) return usage('문서 id 가 필요합니다.', command)
      return {
        kind: 'run',
        command: {
          name: 'get',
          global: globalsOf(parsed.values),
          id: parsed.positionals[0],
          output: typeof parsed.values.output === 'string' ? parsed.values.output : null,
        },
      }
    }
    case 'new': {
      const options: OptionSchema = { ...GLOBAL_OPTIONS, title: { type: 'string' }, folder: { type: 'string' } }
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
        },
      }
    }
    case 'put': {
      const options: OptionSchema = {
        ...GLOBAL_OPTIONS,
        title: { type: 'string' },
        'base-version': { type: 'string' },
        force: { type: 'boolean' },
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
      if (hasBaseVersion === force) {
        return usage(
          `--base-version 또는 --force 가 필요합니다. ${brand.cliName} get ${id} --json 으로 지금 version 을 확인하세요.`,
          command,
        )
      }
      let baseVersion: number | null = null
      if (hasBaseVersion) {
        baseVersion = parseNonNegativeInt(parsed.values['base-version'] as string)
        if (baseVersion === null) return usage('--base-version 은 0 이상의 정수여야 합니다.', command)
      }
      return {
        kind: 'run',
        command: { name: 'put', global: globalsOf(parsed.values), id, source, title, baseVersion, force },
      }
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
      const parsed = runParseArgs(rest, GLOBAL_OPTIONS, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      if (parsed.positionals.length !== 1) return usage('이미지 파일이 필요합니다.', command)
      return { kind: 'run', command: { name: 'upload', global: globalsOf(parsed.values), file: parsed.positionals[0] } }
    }
    case 'link': {
      const parsed = runParseArgs(rest, GLOBAL_OPTIONS, true)
      if (!parsed) return usage('알 수 없는 옵션입니다.', command)
      if (parsed.positionals.length !== 1) return usage('문서 id 가 필요합니다.', command)
      return { kind: 'run', command: { name: 'link', global: globalsOf(parsed.values), id: parsed.positionals[0] } }
    }
  }
}

export function parseArgs(argv: string[]): ParsedInvocation {
  if (argv.length === 0) return { kind: 'no-command' }
  const [first, ...rest] = argv
  if (first === '--help' || first === '-h') return { kind: 'help', command: null }
  if (first === '--version' || first === '-v') return { kind: 'version' }
  if (!isCommandName(first)) return usage(`알 수 없는 명령입니다: ${first}`)

  if (rest.includes('--help') || rest.includes('-h')) return { kind: 'help', command: first }
  if (rest.includes('--version') || rest.includes('-v')) return { kind: 'version' }
  return parseCommandArgs(first, rest)
}
