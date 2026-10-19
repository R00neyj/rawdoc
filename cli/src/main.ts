// 진입점. 인자 → 명령 → 출력·종료 코드. 표준 출력에 쓰는 유일한 곳 (specs/features/F-2021.md 4.7)
import { realpathSync } from 'node:fs'
import { mkdir as mkdirReal, readFile as readFileReal, writeFile as writeFileReal } from 'node:fs/promises'
import { dirname as dirnameReal, join as joinReal } from 'node:path'
import { hostname as hostnameReal, homedir as homedirReal } from 'node:os'
import brand from '../../brand.config'
import { SITE_URL } from '../../src/lib/siteMeta'
import { decodeMarkdown, type DecodedMarkdown } from '../../src/lib/decodeMarkdown'
import { buildCliLoginUrl, sanitizeCliHost } from '../../src/lib/cliLoginUrl'
import { generateSealKeyPairV2 } from '../../src/lib/cliSeal'
import { fromEditorText } from '../../src/lib/lineEnding'
import type { V1Doc, V1Me } from '../../worker/v1Contract'
import { parseArgs, type RunCommand } from './args'
import {
  credentialsPath,
  getServerToken,
  readCredentials,
  withoutServerToken,
  withServerToken,
  writeCredentials,
  type CredentialsRead,
  type StoredCredentials,
} from './credentials'
import { apiMe, type ClientConfig } from './client'
import * as commands from './commands'
import { commandHelpText, helpText } from './help'
import { checkAlreadyLoggedIn, startCallbackServer } from './login'
import { unifiedDiff } from './lineDiff'
import { missingWikiTargets, wikiTargetsOf } from './linkCheck'
import { hasConflictMarkers, merge3, MINE_LABEL, THEIRS_LABEL_PREFIX } from './merge3'
import { buildPutPreview, fileLineEndingOf, lineEndingNotice, wouldConflict } from './putPreview'
import { openBrowser } from './openBrowser'
import { parseSidecar, serializeSidecar, sidecarPathOf, type Sidecar } from './sidecar'
import { renderSyntaxMarkdown, syntaxJson } from './syntax'
import {
  CliError,
  docAppUrl,
  errorMessage,
  errorToJson,
  exitCodeFor,
  humanAccountLine,
  humanDocInfo,
  humanDocList,
  humanFolderList,
  humanIdLine,
  humanIdVersionLine,
  humanPutPreview,
  humanRemoveDocLine,
  humanRemoveFolderNotice,
  humanReplaceList,
  humanReplaceSummary,
  humanReplaceWait,
  humanSearchList,
  humanSearchSummary,
  humanSharedList,
  humanUploadLine,
  humanUrlLine,
  replaceExitCode,
  replaceJson,
  stripControlChars,
} from './output'

const ENV_PREFIX = brand.cliName.toUpperCase()

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
  // 바이너리 쓰기 — 위 폴더가 없으면 만든다 (images)
  writeBytes: (path: string, content: Uint8Array) => Promise<void>
  readStdin: () => Promise<Uint8Array>
  stdinIsTTY: boolean
  openBrowserFn: (url: string) => void
  now: () => number
  // signal 이 abort 되면 타이머를 풀어야 한다 — 남은 타이머가 프로세스 종료를 막는다 (리뷰 C2)
  wait: (ms: number, signal?: AbortSignal) => Promise<void>
  // 브라우저 로그인을 기다리는 동안에만 SIGINT 를 가로챈다. 그 밖에는 Node 기본 동작(즉시 종료)을 둔다 (리뷰 C3)
  watchSigint?: () => { interrupted: Promise<void>; stop: () => void }
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

function scopeOf(root: boolean, folderId: string | null): commands.DocScope {
  if (root) return { kind: 'root' }
  return folderId !== null ? { kind: 'folder', id: folderId } : { kind: 'all' }
}

async function folderIdOf(cfg: ClientConfig, value: string | null): Promise<string | null> {
  return value === null ? null : (await commands.resolveFolder(cfg, value)).id
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
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err && typeof err.code === 'string' ? err.code : undefined
    throw new CliError('file_read', { path: source, reason: code })
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

async function writeTextFile(deps: MainDeps, path: string, content: string): Promise<void> {
  try {
    await deps.writeFile(path, content)
  } catch {
    throw new CliError('file_write', { path })
  }
}

type ImageRow = { name: string; file: string | null; skipped: commands.DocImage['skipped'] }

// 받지 못한 이미지는 표준 오류에 알리고 행에는 file: null 로 남긴다
async function saveImages(deps: MainDeps, cfg: ClientConfig, doc: { id: string; content: string }, dir: string): Promise<ImageRow[]> {
  const rows: ImageRow[] = []
  for (const image of await commands.images(cfg, doc)) {
    if (image.bytes === null) {
      rows.push({ name: image.name, file: null, skipped: image.skipped })
      deps.out.stderr(`attachments/${image.name}: ${image.skipped === 'encrypted' ? '금고 이미지라 받지 않았습니다' : '서버에 없습니다'}\n`)
      continue
    }
    const file = joinReal(dir, image.name)
    try {
      await deps.writeBytes(file, image.bytes)
    } catch {
      throw new CliError('file_write', { path: file })
    }
    rows.push({ name: image.name, file, skipped: null })
  }
  if (rows.length === 0) deps.out.stderr('이 문서에는 올린 이미지가 없습니다.\n')
  return rows
}

function printImageRows(deps: MainDeps, rows: ImageRow[]): void {
  for (const row of rows) if (row.file !== null) deps.out.stdout(`attachments/${row.name}\t${row.file}\n`)
}

// 없거나 모양이 어긋난 기록은 null
async function readSidecar(deps: MainDeps, file: string): Promise<Sidecar | null> {
  try {
    return parseSidecar(new TextDecoder().decode(await deps.readFile(sidecarPathOf(file))))
  } catch {
    return null
  }
}

async function requireSidecar(deps: MainDeps, file: string, id: string): Promise<Sidecar> {
  const sidecar = await readSidecar(deps, file)
  const path = sidecarPathOf(file)
  if (sidecar === null) {
    const usageMessage = `판 번호 기록이 없거나 읽을 수 없습니다: ${path}. ${brand.cliName} get ${id} -o ${file} 로 받은 파일에만 쓸 수 있습니다.`
    throw new CliError('usage', { usageMessage })
  }
  if (sidecar.id !== id) {
    throw new CliError('usage', { usageMessage: `${path} 는 다른 문서(${sidecar.id})의 기록입니다. 문서 id 를 확인하세요.` })
  }
  return sidecar
}

// 목록을 못 받으면 조용히 넘어간다 — 경고일 뿐 put 을 막지 않는다
async function warnBrokenLinks(deps: MainDeps, cfg: ClientConfig, id: string, content: string, newTitle: string | null): Promise<void> {
  const targets = wikiTargetsOf(content)
  if (targets.length === 0) return
  let index: commands.WikiIndex
  try {
    index = await commands.wikiIndex(cfg, targets.some((t) => t.includes('/')))
  } catch {
    return
  }
  const docs = index.docs.map((d) => ({ id: d.id, title: d.id === id && newTitle !== null ? newTitle : d.title, folderId: d.folderId }))
  const sourceFolderId = index.docs.find((d) => d.id === id)?.folderId ?? null
  for (const target of missingWikiTargets(targets, docs, index.folders, sourceFolderId)) {
    deps.out.stderr(`경고: 없는 문서를 가리키는 위키링크: [[${stripControlChars(target)}]]\n`)
  }
}

async function runPut(command: Extract<RunCommand, { name: 'put' }>, deps: MainDeps, cfg: ClientConfig): Promise<number> {
  let decoded: DecodedMarkdown | null = null
  if (command.source !== null) {
    decoded = decodeSource(await readSourceBytes(deps, command.source), command.source)
    emitDecodeNotices(deps, decoded, command.source)
  }
  const title = command.title ?? undefined
  const label = labelOf(command.source ?? '')
  const file = decoded ? { text: decoded.text, lineEnding: decoded.lineEnding } : null
  if (file !== null && hasConflictMarkers(file.text)) {
    throw new CliError('usage', { usageMessage: '충돌 표시(<<<<<<< ~ >>>>>>>)가 남아 있습니다. 정리한 뒤 다시 올리세요.' })
  }
  const filePath = command.source !== null && command.source !== '-' ? command.source : null
  let sidecar: Sidecar | null = null
  if (filePath !== null) {
    sidecar = command.baseVersion === 'auto' ? await requireSidecar(deps, filePath, command.id) : await readSidecar(deps, filePath)
  }
  const baseVersion = command.baseVersion === 'auto' ? (sidecar as Sidecar).version : command.baseVersion
  if (file !== null) await warnBrokenLinks(deps, cfg, command.id, file.text, command.title)
  try {
    if (command.dryRun) {
      const server = await commands.get(cfg, command.id)
      const preview = buildPutPreview({ server, file, title })
      if (wouldConflict(baseVersion, preview)) {
        throw new CliError('conflict', { status: 409, currentVersion: server.version })
      }
      const notice = lineEndingNotice(label, preview.fileLineEnding, preview.lineEnding, true)
      if (notice) deps.out.stderr(notice)
      if (!preview.titleChanged && !preview.contentChanged) deps.out.stderr('바뀌는 내용이 없습니다.\n')
      const labels = { old: `${server.id} (서버 판 ${server.version})`, new: label }
      const diff = command.diff && file !== null ? unifiedDiff(server.content, file.text, labels).text : null
      emitResult(deps, command.global.json, diff === null ? preview : { ...preview, diff }, () => humanPutPreview(preview) + (diff ?? ''))
      return 0
    }
    const doc = await commands.putDoc(cfg, { id: command.id, content: file?.text, title, baseVersion, force: command.force })
    const notice = lineEndingNotice(label, fileLineEndingOf(file), doc.lineEnding, false)
    if (notice) deps.out.stderr(notice)
    if (filePath !== null && file !== null && sidecar?.id === command.id) {
      await writeTextFile(deps, sidecarPathOf(filePath), serializeSidecar({ id: doc.id, version: doc.version, base: doc.content }))
    }
    const url = docAppUrl(cfg.origin, doc.id)
    emitResult(deps, command.global.json, { ...doc, url }, () => humanIdVersionLine(doc.id, doc.version) + humanUrlLine(url))
    return 0
  } catch (err) {
    if (err instanceof CliError && err.code === 'conflict' && filePath !== null) {
      throw new CliError('conflict', { ...err.details, id: command.id, path: filePath })
    }
    throw err
  }
}

// 충돌 표시가 남으면 종료 5 — put 의 충돌과 같은 뜻으로 "아직 올릴 수 없음"
async function runMerge(command: Extract<RunCommand, { name: 'merge' }>, deps: MainDeps, cfg: ClientConfig): Promise<number> {
  const sidecar = await requireSidecar(deps, command.file, command.id)
  const decoded = decodeSource(await readSourceBytes(deps, command.file), command.file)
  emitDecodeNotices(deps, decoded, command.file)
  const server = await commands.get(cfg, command.id)
  const merged = merge3(sidecar.base, decoded.text, server.content, { mine: MINE_LABEL, theirs: `${THEIRS_LABEL_PREFIX}${server.version}` })
  await writeTextFile(deps, command.file, fromEditorText(merged.text, decoded.lineEnding))
  await writeTextFile(deps, sidecarPathOf(command.file), serializeSidecar({ id: server.id, version: server.version, base: server.content }))
  const putLine = `${brand.cliName} put ${command.id} ${command.file} --base-version auto`
  deps.out.stderr(
    merged.conflicts === 0
      ? `서버 판 ${server.version} 과 충돌 없이 합쳤습니다. 확인한 뒤 ${putLine} 로 올리세요.\n`
      : `충돌 ${merged.conflicts}곳이 남았습니다. 파일에서 <<<<<<< ~ >>>>>>> 표시를 정리한 뒤 ${putLine} 로 올리세요.\n`,
  )
  const result = { id: server.id, version: server.version, file: command.file, conflicts: merged.conflicts }
  emitResult(deps, command.global.json, result, () => `${result.id}\tversion ${result.version}\tconflicts ${result.conflicts}\n`)
  return merged.conflicts === 0 ? 0 : exitCodeFor('conflict')
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
  const waitAbort = new AbortController()
  const sigint = deps.watchSigint?.()
  let outcome: { kind: 'result'; r: Awaited<typeof handle.result> } | { kind: 'timeout' } | { kind: 'sigint' }
  try {
    outcome = await Promise.race<typeof outcome>([
      handle.result.then((r) => ({ kind: 'result', r })),
      deps.wait(TIMEOUT_MS, waitAbort.signal).then(() => ({ kind: 'timeout' })),
      (sigint?.interrupted ?? new Promise<void>(() => {})).then(() => ({ kind: 'sigint' })),
    ])
  } finally {
    waitAbort.abort()
    sigint?.stop()
    handle.close()
  }

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
  if (command.name === 'syntax') {
    const json = `${JSON.stringify(syntaxJson(deps.packageVersion, command.short))}\n`
    deps.out.stdout(command.global.json ? json : renderSyntaxMarkdown(deps.packageVersion, command.short))
    return 0
  }
  const serverResult = resolveServerOrigin({ flag: command.global.server, env: deps.env })
  if ('usageError' in serverResult) {
    deps.out.stderr(`${serverResult.usageError}\n`)
    return 2
  }
  const origin = serverResult.origin

  const credPath = credentialsPath({ platform: deps.platform, env: deps.env, homedir: deps.homedir })
  let creds: CredentialsRead
  try {
    creds = await readCredentials(credPath)
  } catch (err) {
    if (err instanceof CliError) return emitError(deps, command.global.json, err)
    throw err
  }
  const { store, corrupt } = creds
  if (corrupt && (command.name === 'login' || command.name === 'logout')) {
    if (command.global.json) return emitError(deps, true, new CliError('file_read', { path: credPath, reason: 'corrupt' }))
    deps.out.stderr(`저장 파일을 읽지 못해 덮어쓰지 않습니다: ${credPath} — 고치거나 지운 뒤 다시 실행하세요.\n`)
    return exitCodeFor('file_read')
  }
  if (corrupt) deps.out.stderr(`저장 파일을 읽지 못해 무시합니다: ${credPath}\n`)

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
        if (command.shared) {
          const shared = await commands.lsShared(cfg)
          if (command.global.json) deps.out.stdout(`${JSON.stringify(shared)}\n`)
          else {
            deps.out.stdout(humanSharedList(shared))
            if (shared.length === 0) deps.out.stderr('공유받은 문서가 없습니다.\n')
          }
          return 0
        }
        const ref = command.folder !== null ? await commands.resolveFolder(cfg, command.folder) : null
        const docs = await commands.ls(cfg, scopeOf(command.root, ref?.id ?? null), command.path, ref?.folders ?? undefined)
        if (command.global.json) deps.out.stdout(`${JSON.stringify(docs)}\n`)
        else {
          deps.out.stdout(humanDocList(docs, { path: command.path }))
          if (docs.length === 0) deps.out.stderr('문서가 없습니다.\n')
        }
        return 0
      }
      case 'find': {
        const ref = command.folder !== null ? await commands.resolveFolder(cfg, command.folder) : null
        const scope = scopeOf(command.root, ref?.id ?? null)
        const docs = await commands.find(cfg, command.query, scope, command.path, ref?.folders ?? undefined)
        if (command.global.json) deps.out.stdout(`${JSON.stringify(docs)}\n`)
        else {
          deps.out.stdout(humanDocList(docs, { path: command.path }))
          if (docs.length === 0) deps.out.stderr(`제목으로 찾은 문서가 없습니다: ${stripControlChars(command.query)}\n`)
        }
        return 0
      }
      case 'search': {
        const ref = command.folder !== null ? await commands.resolveFolder(cfg, command.folder) : null
        const folder = ref !== null && command.folder !== null ? { id: ref.id, value: command.folder } : null
        const result = await commands.search(cfg, command.query, folder, ref?.folders ?? undefined)
        if (command.global.json) deps.out.stdout(`${JSON.stringify(result)}\n`)
        else {
          deps.out.stdout(humanSearchList(result.docs))
          deps.out.stderr(humanSearchSummary(result, command.query))
        }
        return 0
      }
      case 'replace': {
        const hooks = { sleep: (ms: number) => deps.wait(ms), onWait: (seconds: number) => deps.out.stderr(humanReplaceWait(seconds)) }
        let result: commands.ReplaceOutput
        if (command.id !== null) {
          const input = { id: command.id, find: command.find, replacement: command.replacement, apply: command.yes, baseVersion: command.baseVersion }
          result = await commands.replaceInDoc(cfg, input)
        } else {
          const ref = command.folder !== null ? await commands.resolveFolder(cfg, command.folder) : null
          const folder = ref !== null && command.folder !== null ? { id: ref.id, value: command.folder } : null
          const input = { find: command.find, replacement: command.replacement, folder, apply: command.yes }
          result = await commands.replace(cfg, input, hooks, ref?.folders ?? undefined)
        }
        if (command.global.json) deps.out.stdout(`${JSON.stringify(replaceJson(result))}\n`)
        else deps.out.stdout(humanReplaceList(result.docs, brand.cliName, ENV_PREFIX))
        if (result.stopped) emitError(deps, command.global.json, result.stopped)
        if (!command.global.json) deps.out.stderr(humanReplaceSummary(result, command.find))
        return result.stopped ? exitCodeFor(result.stopped.code) : replaceExitCode(result.docs)
      }
      case 'info': {
        const info = await commands.info(cfg, command.id)
        const doc = { ...info, url: docAppUrl(cfg.origin, info.id) }
        emitResult(deps, command.global.json, doc, () => humanDocInfo(doc))
        return 0
      }
      case 'get': {
        const doc = await commands.get(cfg, command.id)
        if (command.output) {
          await writeTextFile(deps, command.output, doc.content)
          await writeTextFile(deps, sidecarPathOf(command.output), serializeSidecar({ id: doc.id, version: doc.version, base: doc.content }))
        }
        // 원문의 상대 경로 attachments/… 와 맞도록 받은 파일 옆 attachments/ 에 둔다
        const saved = command.output && command.images ? await saveImages(deps, cfg, doc, joinReal(dirnameReal(command.output), 'attachments')) : null
        if (command.global.json) {
          const body: Partial<V1Doc> & { images?: ImageRow[] } = { ...doc }
          if (command.output) delete body.content
          if (saved) body.images = saved
          deps.out.stdout(`${JSON.stringify(body)}\n`)
        } else if (command.output) {
          deps.out.stdout(humanIdVersionLine(doc.id, doc.version))
          if (saved) printImageRows(deps, saved)
        } else {
          deps.out.stdout(doc.content)
        }
        return 0
      }
      case 'images': {
        const doc = await commands.get(cfg, command.id)
        const rows = await saveImages(deps, cfg, doc, command.dir)
        if (command.global.json) deps.out.stdout(`${JSON.stringify({ id: doc.id, images: rows })}\n`)
        else printImageRows(deps, rows)
        return 0
      }
      case 'diff': {
        const decoded = decodeSource(await readSourceBytes(deps, command.source), command.source)
        emitDecodeNotices(deps, decoded, command.source)
        const server = await commands.get(cfg, command.id)
        const labels = { old: `${server.id} (서버 판 ${server.version})`, new: labelOf(command.source) }
        const diff = unifiedDiff(server.content, decoded.text, labels)
        if (diff.text === '') deps.out.stderr('바뀌는 내용이 없습니다.\n')
        const result = { id: server.id, version: server.version, changed: diff.text !== '', linesAdded: diff.added, linesRemoved: diff.removed, diff: diff.text }
        emitResult(deps, command.global.json, result, () => diff.text)
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
        const folderId = await folderIdOf(cfg, command.folder)
        const doc = await commands.createDoc(cfg, { title, content, lineEnding, folderId })
        const url = command.url ? docAppUrl(cfg.origin, doc.id) : null
        emitResult(deps, command.global.json, url ? { ...doc, url } : doc, () => humanIdLine(doc.id) + (url ? `${url}\n` : ''))
        return 0
      }
      case 'put':
        return await runPut(command, deps, cfg)
      case 'merge':
        return await runMerge(command, deps, cfg)
      case 'mv': {
        const folderId = await folderIdOf(cfg, command.folderId)
        const doc = await commands.moveDoc(cfg, { id: command.id, folderId })
        emitResult(deps, command.global.json, doc, () => humanIdLine(doc.id))
        return 0
      }
      case 'rm': {
        const result = await commands.removeDoc(cfg, command.id)
        emitResult(deps, command.global.json, result, () => humanIdLine(result.id))
        deps.out.stderr(humanRemoveDocLine(result.title))
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
        const parentId = await folderIdOf(cfg, command.parent)
        const folder = await commands.mkdir(cfg, command.folderName, parentId)
        emitResult(deps, command.global.json, folder, () => humanIdLine(folder.id))
        return 0
      }
      case 'rmdir': {
        const result = await commands.removeFolder(cfg, { id: command.id, all: command.all })
        emitResult(deps, command.global.json, result, () => humanIdLine(result.id))
        deps.out.stderr(humanRemoveFolderNotice(result))
        return 0
      }
      case 'upload': {
        const bytes = await readSourceBytes(deps, command.file)
        const attachment = await commands.upload(cfg, bytes, command.doc)
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
    writeBytes: async (path, content) => {
      await mkdirReal(dirnameReal(path), { recursive: true })
      await writeFileReal(path, content)
    },
    readStdin: readStdinReal,
    stdinIsTTY: process.stdin.isTTY === true,
    openBrowserFn: (url) => openBrowser(process.platform, url),
    now: () => Date.now(),
    wait: (ms, signal) =>
      new Promise((resolve) => {
        const timer = setTimeout(resolve, ms)
        signal?.addEventListener('abort', () => clearTimeout(timer), { once: true })
      }),
    watchSigint: () => {
      let onSigint = () => {}
      const interrupted = new Promise<void>((resolve) => {
        onSigint = () => resolve()
      })
      process.on('SIGINT', onSigint)
      return { interrupted, stop: () => process.off('SIGINT', onSigint) }
    },
    packageVersion: pkg.version,
    nodeVersion: process.version,
  })
  process.exitCode = exitCode
}

// argv1 이 이 모듈 파일인지. npm/npx 는 POSIX 에서 node_modules/.bin 의 심볼릭 링크로 실행해 argv[1] 이 링크 경로이므로
// 실제 경로끼리 비교한다 (리뷰 C1)
export function isEntryScript(argv1: string | undefined, selfPath: string, realpath: (path: string) => string): boolean {
  if (!argv1) return false
  if (argv1 === selfPath) return true
  try {
    return realpath(argv1) === realpath(selfPath)
  } catch {
    return false
  }
}

// 이 파일이 실제 실행 스크립트일 때만 돈다 — 테스트가 main() 을 직접 부를 때는 여기가 실행되지 않는다
if (isEntryScript(process.argv[1], import.meta.filename, realpathSync)) {
  // CliError 로 바꾸지 못한 오류(자격 증명 파일 쓰기 실패 등)도 스택 대신 한 줄로 알린다 (리뷰 C4)
  run().catch((err: unknown) => {
    process.stderr.write(`오류: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  })
}
