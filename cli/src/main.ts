// 진입점. 인자 → 명령 → 출력·종료 코드. 표준 출력에 쓰는 유일한 곳 (specs/features/F-2021.md 4.7)
import { readFile as readFileReal, writeFile as writeFileReal } from 'node:fs/promises'
import { hostname as hostnameReal, homedir as homedirReal } from 'node:os'
import brand from '../../brand.config'
import { SITE_URL } from '../../src/lib/siteMeta'
import { decodeMarkdown, type DecodedMarkdown } from '../../src/lib/decodeMarkdown'
import { buildCliLoginUrl, sanitizeCliHost } from '../../src/lib/cliLoginUrl'
import { generateSealKeyPairV2 } from '../../src/lib/cliSeal'
import type { V1Doc, V1Me } from '../../worker/v1Contract'
import {
  COMMAND_NAMES,
  parseArgs,
  type CommandName,
  type RunCommand,
} from './args'
import {
  credentialsPath,
  getServerToken,
  readCredentials,
  withoutServerToken,
  withServerToken,
  writeCredentials,
  type StoredCredentials,
} from './credentials'
import { apiMe, type ClientConfig } from './client'
import * as commands from './commands'
import { checkAlreadyLoggedIn, startCallbackServer } from './login'
import { openBrowser } from './openBrowser'
import {
  CliError,
  errorMessage,
  errorToJson,
  exitCodeFor,
  humanAccountLine,
  humanDocList,
  humanFolderList,
  humanIdLine,
  humanIdVersionLine,
  humanUploadLine,
  humanUrlLine,
} from './output'

const ENV_PREFIX = brand.cliName.toUpperCase()

const COMMAND_DESCRIPTIONS: Record<CommandName, string> = {
  login: '브라우저로 로그인해 토큰을 저장합니다',
  logout: '이 컴퓨터에 저장한 토큰을 지웁니다',
  whoami: '로그인한 계정을 보여 줍니다',
  ls: '내 문서 목록',
  get: '문서 원문을 출력합니다',
  new: '새 문서를 만듭니다',
  put: '문서를 고칩니다',
  folders: '폴더 목록',
  mkdir: '폴더를 만듭니다',
  upload: '이미지를 올리고 붙일 마크다운을 출력합니다',
  link: '읽기 전용 링크를 만듭니다',
}

function helpText(version: string): string {
  const lines = [`${brand.name} 명령줄 도구 ${version}`, '']
  for (const name of COMMAND_NAMES) lines.push(`  ${name}\t${COMMAND_DESCRIPTIONS[name]}`)
  lines.push('')
  lines.push('Windows PowerShell 5.1 에서는 > 대신 -o 로 저장하세요. > 는 파일을 UTF-16 으로 바꿉니다.')
  lines.push(`AI 도구에서 쓸 때는 npx -y ${brand.cliName} … 또는 ${ENV_PREFIX}_TOKEN 환경 변수를 쓰세요.`)
  return lines.join('\n') + '\n'
}

function commandHelpText(command: CommandName): string {
  return `${brand.cliName} ${command} — ${COMMAND_DESCRIPTIONS[command]}\n`
}

export type MainDeps = {
  argv: string[]
  env: Record<string, string | undefined>
  fetchImpl: typeof fetch
  out: { stdout: (chunk: string) => void; stderr: (chunk: string) => void }
  platform: string
  hostname: string
  homedir: string
  readFile: (path: string) => Promise<Uint8Array>
  writeFile: (path: string, content: string) => Promise<void>
  readStdin: () => Promise<Uint8Array>
  stdinIsTTY: boolean
  openBrowserFn: (url: string) => void
  now: () => number
  wait: (ms: number) => Promise<void>
  sigint?: Promise<void>
  packageVersion: string
  nodeVersion: string
}

function resolveServerOrigin(opts: {
  flag: string | null
  env: Record<string, string | undefined>
}): { origin: string } | { usageError: string } {
  const raw = opts.flag ?? opts.env[`${ENV_PREFIX}_SERVER`] ?? SITE_URL
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { usageError: `서버 주소가 올바르지 않습니다: ${raw}` }
  }
  if (url.protocol === 'https:') return { origin: url.origin }
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    return { origin: url.origin }
  }
  return { usageError: `http 주소는 localhost 에서만 쓸 수 있습니다: ${raw}` }
}

function resolveToken(env: Record<string, string | undefined>, store: StoredCredentials, origin: string): string | null {
  const envToken = env[`${ENV_PREFIX}_TOKEN`]
  if (envToken) return envToken
  return getServerToken(store, origin)
}

function labelOf(source: string): string {
  return source === '-' ? '표준 입력' : source
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function titleFromFileName(name: string): string {
  const stripped = name.replace(/\.md$/i, '')
  return stripped === '' ? '제목 없는 문서' : stripped
}

function titleFromSource(source: string | null): string {
  if (source === null || source === '-') return '제목 없는 문서'
  return titleFromFileName(basename(source))
}

async function readSourceBytes(deps: MainDeps, source: string): Promise<Uint8Array> {
  if (source === '-') {
    try {
      return await deps.readStdin()
    } catch {
      throw new CliError('file_read', { path: '표준 입력' })
    }
  }
  try {
    return await deps.readFile(source)
  } catch {
    throw new CliError('file_read', { path: source })
  }
}

function decodeSource(bytes: Uint8Array, source: string): DecodedMarkdown {
  try {
    return decodeMarkdown(bytes)
  } catch (err) {
    if (err instanceof Error && err.message === 'not-utf8') {
      throw new CliError('not_utf8', { path: labelOf(source) })
    }
    throw err
  }
}

function emitDecodeNotices(deps: MainDeps, decoded: DecodedMarkdown, source: string): void {
  const label = labelOf(source)
  if (decoded.mixed) deps.out.stderr(`"${label}" 줄바꿈 형식이 섞여 있어 CRLF 로 통일했습니다.\n`)
  if (decoded.hadBom) deps.out.stderr(`"${label}" 파일 맨 앞의 BOM 을 제거했습니다.\n`)
}

function emitResult(deps: MainDeps, json: boolean, data: unknown, human: () => string): void {
  if (json) deps.out.stdout(`${JSON.stringify(data)}\n`)
  else deps.out.stdout(human())
}

function emitError(deps: MainDeps, json: boolean, err: CliError): number {
  if (json) deps.out.stderr(`${JSON.stringify(errorToJson(err, brand.cliName, ENV_PREFIX))}\n`)
  else deps.out.stderr(`${errorMessage(err, brand.cliName, ENV_PREFIX)}\n`)
  return exitCodeFor(err.code)
}

function userAgentOf(deps: MainDeps): string {
  return `${brand.cliName}/${deps.packageVersion} node/${deps.nodeVersion}`
}

function baseCfg(origin: string, token: string, deps: MainDeps): ClientConfig {
  return { origin, token, fetchImpl: deps.fetchImpl, userAgent: userAgentOf(deps) }
}

async function saveLogin(
  deps: MainDeps,
  credPath: string,
  store: StoredCredentials,
  origin: string,
  token: string,
  me: V1Me,
): Promise<void> {
  const nextStore = withServerToken(store, origin, { token, email: me.email, savedAt: new Date(deps.now()).toISOString() })
  await writeCredentials(credPath, nextStore)
}

async function runLoginCommand(
  command: Extract<RunCommand, { name: 'login' }>,
  deps: MainDeps,
  origin: string,
  credPath: string,
  store: StoredCredentials,
): Promise<number> {
  const existingToken = deps.env[`${ENV_PREFIX}_TOKEN`] || getServerToken(store, origin)
  if (!command.force && existingToken) {
    let me: V1Me | null
    try {
      me = await checkAlreadyLoggedIn(baseCfg(origin, existingToken, deps))
    } catch (err) {
      if (err instanceof CliError) return emitError(deps, false, err)
      throw err
    }
    if (me) {
      deps.out.stderr(`이미 ${me.email} 계정으로 로그인돼 있습니다 (${origin}). 다시 로그인하려면 --force 를 붙이세요.\n`)
      return 0
    }
  }

  if (command.withToken) {
    if (deps.stdinIsTTY) {
      deps.out.stderr(`토큰을 파이프로 넘기세요: ${brand.cliName} login --with-token < token.txt\n`)
      return 2
    }
    const bytes = await deps.readStdin()
    const token = new TextDecoder().decode(bytes).trim()
    if (!/^rd_[A-Za-z0-9_-]{43}$/.test(token)) {
      deps.out.stderr('API 토큰 형식이 아닙니다 (rd_ 로 시작하는 46자).\n')
      return 2
    }
    let me: V1Me
    try {
      me = await apiMe(baseCfg(origin, token, deps))
    } catch (err) {
      if (err instanceof CliError) return emitError(deps, false, err)
      throw err
    }
    await saveLogin(deps, credPath, store, origin, token, me)
    deps.out.stderr(`${me.email} 계정으로 로그인했습니다 (${origin}).\n`)
    return 0
  }

  const { publicKey, privateKey } = await generateSealKeyPairV2()
  let handle
  try {
    handle = await startCallbackServer({ publicKey, privateKey })
  } catch (err) {
    if (err instanceof CliError) return emitError(deps, false, err)
    throw err
  }

  const host = sanitizeCliHost(deps.hostname)
  const url = buildCliLoginUrl(origin, { port: handle.port, host, publicKey })
  deps.out.stderr(`브라우저에서 로그인을 승인하세요. 브라우저가 열리지 않으면 이 주소를 여세요:\n${url}\n`)
  if (!command.noBrowser) deps.openBrowserFn(url)

  const TIMEOUT_MS = 5 * 60 * 1000
  const outcome = await Promise.race<{ kind: 'result'; r: Awaited<typeof handle.result> } | { kind: 'timeout' } | { kind: 'sigint' }>([
    handle.result.then((r) => ({ kind: 'result', r })),
    deps.wait(TIMEOUT_MS).then(() => ({ kind: 'timeout' })),
    (deps.sigint ?? new Promise<void>(() => {})).then(() => ({ kind: 'sigint' })),
  ])
  handle.close()

  if (outcome.kind === 'sigint') return 130
  if (outcome.kind === 'timeout') return emitError(deps, false, new CliError('login_timeout'))
  if (outcome.r.kind === 'denied') return emitError(deps, false, new CliError('login_denied'))

  const token = outcome.r.token
  let me: V1Me
  try {
    me = await apiMe(baseCfg(origin, token, deps))
  } catch (err) {
    if (err instanceof CliError) return emitError(deps, false, err)
    throw err
  }
  await saveLogin(deps, credPath, store, origin, token, me)
  deps.out.stderr(`${me.email} 계정으로 로그인했습니다 (${origin}).\n`)
  if (deps.env[`${ENV_PREFIX}_TOKEN`]) {
    deps.out.stderr(`${ENV_PREFIX}_TOKEN 환경 변수가 설정돼 있어 저장한 토큰 대신 그 값을 씁니다.\n`)
  }
  return 0
}

export async function main(deps: MainDeps): Promise<number> {
  const invocation = parseArgs(deps.argv)

  if (invocation.kind === 'no-command') {
    deps.out.stderr(helpText(deps.packageVersion))
    return 2
  }
  if (invocation.kind === 'help') {
    deps.out.stdout(invocation.command ? commandHelpText(invocation.command) : helpText(deps.packageVersion))
    return 0
  }
  if (invocation.kind === 'version') {
    deps.out.stdout(`${deps.packageVersion}\n`)
    return 0
  }
  if (invocation.kind === 'usage') {
    const hint = invocation.command ? `${brand.cliName} ${invocation.command} --help 를 보세요.\n` : ''
    deps.out.stderr(`${invocation.message}\n${hint}`)
    return 2
  }

  const command = invocation.command
  const serverResult = resolveServerOrigin({ flag: command.global.server, env: deps.env })
  if ('usageError' in serverResult) {
    deps.out.stderr(`${serverResult.usageError}\n`)
    return 2
  }
  const origin = serverResult.origin

  const credPath = credentialsPath({ platform: deps.platform, env: deps.env, homedir: deps.homedir })
  const { store } = await readCredentials(credPath)

  if (command.name === 'login') {
    return runLoginCommand(command, deps, origin, credPath, store)
  }
  if (command.name === 'logout') {
    const { store: nextStore, removed } = withoutServerToken(store, origin)
    await writeCredentials(credPath, nextStore)
    deps.out.stderr(
      removed
        ? `로그아웃했습니다 (${origin}). 토큰은 서버에 남아 있습니다 — 웹의 계정 메뉴 → API 토큰에서 폐기할 수 있습니다.\n`
        : `저장된 토큰이 없습니다 (${origin}).\n`,
    )
    if (command.global.json) deps.out.stdout(`${JSON.stringify({ server: origin, removed })}\n`)
    return 0
  }

  const token = resolveToken(deps.env, store, origin)
  if (!token) return emitError(deps, command.global.json, new CliError('not_logged_in'))
  const cfg = baseCfg(origin, token, deps)

  try {
    switch (command.name) {
      case 'whoami': {
        const me = await commands.whoami(cfg)
        if (command.global.json) deps.out.stdout(`${JSON.stringify({ ...me, server: origin })}\n`)
        else deps.out.stdout(humanAccountLine(me.email, origin))
        return 0
      }
      case 'ls': {
        const docs = await commands.ls(cfg, command.folder)
        if (command.global.json) deps.out.stdout(`${JSON.stringify(docs)}\n`)
        else {
          deps.out.stdout(humanDocList(docs))
          if (docs.length === 0) deps.out.stderr('문서가 없습니다.\n')
        }
        return 0
      }
      case 'get': {
        const doc = await commands.get(cfg, command.id)
        if (command.output) {
          try {
            await deps.writeFile(command.output, doc.content)
          } catch {
            throw new CliError('file_write', { path: command.output })
          }
        }
        if (command.global.json) {
          const body: Partial<V1Doc> = { ...doc }
          if (command.output) delete body.content
          deps.out.stdout(`${JSON.stringify(body)}\n`)
        } else if (command.output) {
          deps.out.stdout(humanIdVersionLine(doc.id, doc.version))
        } else {
          deps.out.stdout(doc.content)
        }
        return 0
      }
      case 'new': {
        let content = ''
        let lineEnding: 'crlf' | 'lf' = 'lf'
        if (command.source !== null) {
          const bytes = await readSourceBytes(deps, command.source)
          const decoded = decodeSource(bytes, command.source)
          content = decoded.text
          lineEnding = decoded.lineEnding
          emitDecodeNotices(deps, decoded, command.source)
        }
        const title = command.title ?? titleFromSource(command.source)
        const doc = await commands.createDoc(cfg, { title, content, lineEnding, folderId: command.folder })
        emitResult(deps, command.global.json, doc, () => humanIdLine(doc.id))
        return 0
      }
      case 'put': {
        let content: string | undefined
        if (command.source !== null) {
          const bytes = await readSourceBytes(deps, command.source)
          const decoded = decodeSource(bytes, command.source)
          content = decoded.text
          emitDecodeNotices(deps, decoded, command.source)
        }
        const doc = await commands.putDoc(cfg, {
          id: command.id,
          content,
          title: command.title ?? undefined,
          baseVersion: command.baseVersion,
          force: command.force,
        })
        emitResult(deps, command.global.json, doc, () => humanIdVersionLine(doc.id, doc.version))
        return 0
      }
      case 'folders': {
        const list = await commands.folders(cfg)
        if (command.global.json) deps.out.stdout(`${JSON.stringify(list)}\n`)
        else {
          deps.out.stdout(humanFolderList(list))
          if (list.length === 0) deps.out.stderr('폴더가 없습니다.\n')
        }
        return 0
      }
      case 'mkdir': {
        const folder = await commands.mkdir(cfg, command.folderName, command.parent)
        emitResult(deps, command.global.json, folder, () => humanIdLine(folder.id))
        return 0
      }
      case 'upload': {
        const bytes = await readSourceBytes(deps, command.file)
        const attachment = await commands.upload(cfg, bytes)
        emitResult(deps, command.global.json, attachment, () => humanUploadLine(attachment.markdown))
        return 0
      }
      case 'link': {
        const result = await commands.link(cfg, command.id)
        emitResult(deps, command.global.json, result, () => humanUrlLine(result.url))
        return 0
      }
      default:
        return 2
    }
  } catch (err) {
    if (err instanceof CliError) return emitError(deps, command.global.json, err)
    throw err
  }
}

function readStdinReal(): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = []
    process.stdin.on('data', (chunk) => chunks.push(chunk))
    process.stdin.on('end', () => {
      const total = chunks.reduce((n, c) => n + c.length, 0)
      const out = new Uint8Array(total)
      let offset = 0
      for (const c of chunks) {
        out.set(c, offset)
        offset += c.length
      }
      resolve(out)
    })
    process.stdin.resume()
  })
}

async function run(): Promise<void> {
  const major = Number(process.version.replace(/^v/, '').split('.')[0])
  if (!Number.isFinite(major) || major < 22) {
    process.stderr.write(`Node.js 22 이상이 필요합니다 (지금 ${process.version}).\n`)
    process.exitCode = 1
    return
  }

  const pkgText = await readFileReal(new URL('../package.json', import.meta.url), 'utf-8')
  const pkg = JSON.parse(pkgText) as { version: string }

  let sigintResolve: (() => void) | undefined
  const sigint = new Promise<void>((resolve) => {
    sigintResolve = resolve
  })
  process.on('SIGINT', () => sigintResolve?.())

  const exitCode = await main({
    argv: process.argv.slice(2),
    env: process.env,
    fetchImpl: fetch,
    out: {
      stdout: (chunk) => process.stdout.write(chunk),
      stderr: (chunk) => process.stderr.write(chunk),
    },
    platform: process.platform,
    hostname: hostnameReal(),
    homedir: homedirReal(),
    readFile: (path) => readFileReal(path),
    writeFile: (path, content) => writeFileReal(path, content, { encoding: 'utf-8' }),
    readStdin: readStdinReal,
    stdinIsTTY: process.stdin.isTTY === true,
    openBrowserFn: (url) => openBrowser(process.platform, url),
    now: () => Date.now(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    sigint,
    packageVersion: pkg.version,
    nodeVersion: process.version,
  })
  process.exitCode = exitCode
}

// 이 파일이 실제 실행 스크립트일 때만 돈다 — 테스트가 main() 을 직접 부를 때는 여기가 실행되지 않는다
if (import.meta.filename === process.argv[1]) {
  void run()
}
