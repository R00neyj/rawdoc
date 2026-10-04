// 관리 스크립트 공용 도우미 — 인자 해석·이메일 검사·SQL 만들기·wrangler JSON 해석·흐름 (specs/features/F-2029.md 3장)
export const COMMANDS = ['usage', 'block', 'unblock', 'warn', 'recount', 'github']
export const DB_NAME = 'md-editor-db'

export class AdminError extends Error {
  constructor(kind, message) {
    super(message ?? kind)
    this.kind = kind
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function hasControlChar(text) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

export function normalizeEmail(raw) {
  if (typeof raw !== 'string') throw new AdminError('usage', `이메일 형식이 아닙니다: ${raw}`)
  const trimmed = raw.trim().toLowerCase()
  const ok = trimmed.length >= 3 && trimmed.length <= 254 && !hasControlChar(trimmed) && EMAIL_RE.test(trimmed)
  if (!ok) throw new AdminError('usage', `이메일 형식이 아닙니다: ${raw}`)
  return trimmed
}

export function sqlText(value) {
  const hex = Buffer.from(value, 'utf-8').toString('hex')
  return `CAST(X'${hex}' AS TEXT)`
}

export function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10)
}

export function utcDayStartMs(now) {
  return Date.parse(`${utcDay(now)}T00:00:00.000Z`)
}

function intLiteral(n) {
  if (!Number.isSafeInteger(n)) throw new Error(`정수가 아닙니다: ${n}`)
  return String(n)
}

export function utcMonth(now) {
  return new Date(now).toISOString().slice(0, 7)
}

function monthLiteral(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`달 형식이 아닙니다: ${month}`)
  return `'${month}'`
}

function dayLiteral(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`날짜 형식이 아닙니다: ${day}`)
  return `'${day}'`
}

// 댓글 복사본 바이트는 문서 소유자 몫이다 (F-502 9.3)
const COMMENT_BYTES_S =
  '(SELECT COALESCE(SUM(doc_comments.bytes), 0) FROM doc_comments JOIN docs AS cd ON cd.id = doc_comments.doc_id WHERE cd.owner_id = users.id)'
const RECOUNT_S = `SELECT COALESCE(SUM(length(CAST(docs.content AS BLOB))), 0) + ${COMMENT_BYTES_S}, COUNT(*) FROM docs WHERE docs.owner_id = users.id`

export const SQL = {
  findUser(email) {
    return `SELECT id, email, created_at, write_day, write_count, content_bytes, doc_count, blocked_at, warned_at FROM users WHERE email = ${sqlText(email)}`
  },
  block(email, now) {
    return `UPDATE users SET blocked_at = ${intLiteral(now)} WHERE email = ${sqlText(email)} AND blocked_at IS NULL RETURNING id, email, blocked_at`
  },
  unblock(email) {
    return `UPDATE users SET blocked_at = NULL WHERE email = ${sqlText(email)} AND blocked_at IS NOT NULL RETURNING id, email`
  },
  warn(email, now) {
    return `UPDATE users SET warned_at = ${intLiteral(now)} WHERE email = ${sqlText(email)} AND warned_at IS NULL RETURNING id, email, warned_at`
  },
  clearWarn(email) {
    return `UPDATE users SET warned_at = NULL WHERE email = ${sqlText(email)} AND warned_at IS NOT NULL RETURNING id, email`
  },
  usageTop(now, top) {
    return `SELECT email, created_at, CASE WHEN write_day = ${dayLiteral(utcDay(now))} THEN write_count ELSE 0 END AS today, content_bytes, doc_count, blocked_at, warned_at FROM users ORDER BY today DESC, content_bytes DESC, email LIMIT ${intLiteral(top)}`
  },
  usageSummary(now) {
    const day = dayLiteral(utcDay(now))
    const day0 = intLiteral(utcDayStartMs(now))
    return `SELECT (SELECT CASE WHEN day = ${day} THEN count ELSE 0 END FROM signup_gate WHERE id = 1) AS gate_today, (SELECT COUNT(*) FROM users WHERE created_at >= ${day0}) AS created_today, (SELECT COUNT(*) FROM users) AS users, (SELECT COALESCE(SUM(content_bytes), 0) FROM users) AS bytes, (SELECT COALESCE(SUM(doc_count), 0) FROM users) AS docs, (SELECT COUNT(*) FROM users WHERE blocked_at IS NOT NULL) AS blocked, (SELECT COUNT(*) FROM users WHERE warned_at IS NOT NULL) AS warned`
  },
  githubSummary(now) {
    const m = monthLiteral(utcMonth(now))
    return `SELECT enabled, monthly_limit, updated_at, (SELECT COUNT(*) FROM github_accounts) AS accounts, (SELECT COUNT(*) FROM github_links) AS links, (SELECT COALESCE(SUM(count), 0) FROM github_usage WHERE month = ${m}) AS month_total, (SELECT COUNT(*) FROM github_usage WHERE month = ${m}) AS month_users FROM github_settings WHERE id = 1`
  },
  githubTop(now, top) {
    return `SELECT users.email, github_usage.count, github_accounts.login FROM github_usage JOIN users ON users.id = github_usage.user_id LEFT JOIN github_accounts ON github_accounts.user_id = github_usage.user_id WHERE github_usage.month = ${monthLiteral(utcMonth(now))} ORDER BY github_usage.count DESC, users.email LIMIT ${intLiteral(top)}`
  },
  githubSet(change, now) {
    const sets = []
    const conds = []
    if (change.enabled !== undefined) {
      sets.push(`enabled = ${intLiteral(change.enabled)}`)
      conds.push(`enabled IS NOT ${intLiteral(change.enabled)}`)
    }
    if (change.limit !== undefined) {
      const v = change.limit === null ? 'NULL' : intLiteral(change.limit)
      sets.push(`monthly_limit = ${v}`)
      conds.push(`monthly_limit IS NOT ${v}`)
    }
    return `UPDATE github_settings SET ${sets.join(', ')}, updated_at = ${intLiteral(now)} WHERE id = 1 AND (${conds.join(' OR ')}) RETURNING enabled, monthly_limit, updated_at`
  },
  recountPreview(target) {
    const base = `SELECT id, email, content_bytes, doc_count, (SELECT COALESCE(SUM(length(CAST(docs.content AS BLOB))), 0) FROM docs WHERE docs.owner_id = users.id) + ${COMMENT_BYTES_S} AS real_bytes, (SELECT COUNT(*) FROM docs WHERE docs.owner_id = users.id) AS real_docs FROM users`
    return target.all ? base : `${base} WHERE users.email = ${sqlText(target.email)}`
  },
  recount(target) {
    let sql = `UPDATE users SET (content_bytes, doc_count) = (${RECOUNT_S}) WHERE (content_bytes, doc_count) IS NOT (${RECOUNT_S})`
    if (!target.all) sql += ` AND users.email = ${sqlText(target.email)}`
    return `${sql} RETURNING id, email, content_bytes, doc_count`
  },
}

export function parseWranglerJson(stdout) {
  const text = (stdout ?? '').trim()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AdminError('db', text.slice(-2000))
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.error && typeof parsed.error.text === 'string') {
    throw new AdminError('db', parsed.error.text)
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed[0]?.success !== true) {
    throw new AdminError('db', text.slice(-2000))
  }
  return parsed[0].results
}

const TOP_MIN = 1
const TOP_MAX = 1000
const TOP_DEFAULT = 20
const LIMIT_MAX = 1_000_000

export function parseAdminArgs(command, argv) {
  const opts = { local: false, persistTo: null, yes: false, email: null, all: false, top: TOP_DEFAULT, clear: false, help: false, on: false, off: false, limit: undefined, unlimited: false }
  let topGiven = false
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') opts.help = true
    else if (a === '--local') opts.local = true
    else if (a === '--persist-to') opts.persistTo = argv[++i] ?? null
    else if (a === '--yes') opts.yes = true
    else if (a === '--all') opts.all = true
    else if (a === '--clear') opts.clear = true
    else if (a === '--top') {
      const raw = argv[++i]
      const n = Number(raw)
      if (!Number.isInteger(n) || n < TOP_MIN || n > TOP_MAX) throw new AdminError('usage', `--top 값이 이상합니다: ${raw}`)
      opts.top = n
      topGiven = true
    } else if (command === 'github' && (a === '--on' || a === '--off' || a === '--unlimited')) {
      opts[a.slice(2)] = true
    } else if (command === 'github' && a === '--limit') {
      const raw = argv[++i]
      const n = Number(raw)
      if (raw === undefined || raw.trim() === '' || !Number.isInteger(n) || n < 1 || n > LIMIT_MAX) {
        throw new AdminError('usage', `--limit 값이 이상합니다: ${raw}`)
      }
      opts.limit = n
    } else if (a.startsWith('-')) {
      throw new AdminError('usage', `알 수 없는 인자: ${a}`)
    } else {
      positional.push(a)
    }
  }

  if (opts.help) return opts
  if (opts.persistTo !== null && !opts.local) throw new AdminError('usage', '--persist-to 는 --local 과 함께만 씁니다')

  if (command === 'github') {
    if (opts.on && opts.off) throw new AdminError('usage', '--on 과 --off 를 함께 쓸 수 없습니다')
    if (opts.limit !== undefined && opts.unlimited) throw new AdminError('usage', '--limit 과 --unlimited 를 함께 쓸 수 없습니다')
    const changing = opts.on || opts.off || opts.limit !== undefined || opts.unlimited
    if (changing && topGiven) throw new AdminError('usage', '--top 은 보기에서만 씁니다')
    if (!changing && opts.yes) throw new AdminError('usage', 'github 보기는 --yes 를 받지 않습니다')
    if (positional.length) throw new AdminError('usage', `알 수 없는 인자: ${positional[0]}`)
    return opts
  }

  if (command === 'usage') {
    if (opts.yes) throw new AdminError('usage', 'usage 는 --yes 를 받지 않습니다')
    if (positional.length) throw new AdminError('usage', `알 수 없는 인자: ${positional[0]}`)
    return opts
  }

  if (command === 'recount') {
    if (opts.all && positional.length) throw new AdminError('usage', '이메일과 --all 을 함께 쓸 수 없습니다')
    if (!opts.all && positional.length === 0) throw new AdminError('usage', '이메일 또는 --all 이 필요합니다')
    if (positional.length > 1) throw new AdminError('usage', `알 수 없는 인자: ${positional[1]}`)
    if (!opts.all) opts.email = normalizeEmail(positional[0])
    return opts
  }

  if (command !== 'warn' && opts.clear) throw new AdminError('usage', `${command} 는 --clear 를 받지 않습니다`)
  if (positional.length === 0) throw new AdminError('usage', '이메일이 필요합니다')
  if (positional.length > 1) throw new AdminError('usage', `알 수 없는 인자: ${positional[1]}`)
  opts.email = normalizeEmail(positional[0])
  return opts
}

const USAGE_ARGS = {
  usage: '[--top N] [--local [--persist-to 경로]]',
  block: '<email> [--yes] [--local [--persist-to 경로]]',
  unblock: '<email> [--yes] [--local [--persist-to 경로]]',
  warn: '<email> [--clear] [--yes] [--local [--persist-to 경로]]',
  github: '[--on|--off] [--limit N|--unlimited] [--top N] [--yes] [--local [--persist-to 경로]]',
  recount: '(<email> | --all) [--yes] [--local [--persist-to 경로]]',
}

function usageText(command) {
  return `사용: node scripts/admin-${command}.mjs ${USAGE_ARGS[command]}`
}

function formatMB(bytes) {
  return `${(bytes / 1_048_576).toFixed(1)}MB`
}

function isoMinute(ms) {
  return `${new Date(ms).toISOString().slice(0, 16)}Z`
}

function targetLine(opts) {
  if (!opts.local) return `대상: 원격 D1 ${DB_NAME}`
  return `대상: 로컬 D1 ${DB_NAME}${opts.persistTo ? ` (${opts.persistTo})` : ''}`
}

const YES_MSG = '실행하지 않았습니다. 위 SQL 을 실행하려면 --yes 를 붙이세요.'
const CHANGED_MSG = '그 사이 상태가 바뀌었습니다. 다시 실행해 지금 상태를 보세요.'
const NOTICE_MSG = '앱 화면에는 그 사람이 다음에 /api/me 를 읽을 때 뜹니다(열린 탭은 최대 10분, F-2030 5.1).'

const NO_SETTINGS_MSG = '설정 행이 없습니다. migrations/0023_github.sql 이 적용됐는지 확인하세요.'
const GITHUB_SECRETS_MSG = 'GITHUB_APP_CLIENT_ID·GITHUB_APP_SLUG·GITHUB_APP_CLIENT_SECRET·GITHUB_TOKEN_KEY 가 없으면 켜도 앱에는 꺼진 것으로 보입니다 (F-3014 3장).'

const onOff = (enabled) => (enabled ? '켜짐' : '꺼짐')
const limitText = (limit) => (limit === null ? '무제한' : `월 ${limit}회`)
const limitPlain = (limit) => (limit === null ? '무제한' : `${limit}회`)

async function runGithub(run, now, opts, print) {
  const t = now()
  const summary = (await run(SQL.githubSummary(t)))[0]
  if (!summary) {
    print(NO_SETTINGS_MSG)
    return 1
  }
  const changed = summary.updated_at ? isoMinute(summary.updated_at) : '-'
  print(`GitHub 기능: ${onOff(summary.enabled)} · 월 한도: ${limitPlain(summary.monthly_limit)} · 마지막 변경: ${changed}`)
  const change = {}
  if (opts.on) change.enabled = 1
  if (opts.off) change.enabled = 0
  if (opts.limit !== undefined) change.limit = opts.limit
  if (opts.unlimited) change.limit = null
  if (Object.keys(change).length === 0) {
    print(`이번 달(UTC ${utcMonth(t)}): ${summary.month_total}회 · ${summary.month_users}명 · 연결 계정 ${summary.accounts} · 연결 문서 ${summary.links}`)
    const top = await run(SQL.githubTop(t, opts.top))
    print(`이번 달 많이 쓴 순 ${opts.top}명`)
    print(['이메일', '이번 달', 'GitHub'].join('  '))
    if (top.length === 0) print('이번 달 사용 기록이 없습니다.')
    for (const row of top) print([row.email, row.count, row.login ?? '-'].join('  '))
    return 0
  }
  const parts = []
  if (change.enabled !== undefined && change.enabled !== summary.enabled) {
    parts.push(`${onOff(summary.enabled)} → ${onOff(change.enabled)}`)
  }
  if (change.limit !== undefined && change.limit !== summary.monthly_limit) {
    parts.push(`${limitText(summary.monthly_limit)} → ${limitText(change.limit)}`)
  }
  if (parts.length === 0) {
    print('이미 그 설정입니다.')
    return 0
  }
  const sql = SQL.githubSet(change, t)
  if (!opts.yes) {
    print(`바꿀 것: ${parts.join(' · ')}`)
    print(`SQL: ${sql}`)
    print(YES_MSG)
    return 0
  }
  const result = await run(sql)
  if (result.length === 0) {
    print(CHANGED_MSG)
    return 1
  }
  const r = result[0]
  print(`바꿨습니다: GitHub 기능 ${onOff(r.enabled)} · 월 한도 ${limitPlain(r.monthly_limit)} (${isoMinute(r.updated_at)})`)
  print('Worker 는 다음 요청부터 이 값을 씁니다. 앱 화면은 GitHub 상태를 다시 읽을 때 바뀝니다.')
  if (r.enabled) print(GITHUB_SECRETS_MSG)
  return 0
}

async function githubUsageLine(run, now) {
  try {
    const row = (await run(SQL.githubSummary(now)))[0]
    if (!row) return 'GitHub: 읽지 못했습니다 (설정 행 없음)'
    return `GitHub: ${onOff(row.enabled)} · 월 한도 ${limitPlain(row.monthly_limit)} · 이번 달 ${row.month_total}회 · ${row.month_users}명`
  } catch (err) {
    if (!(err instanceof AdminError && err.kind === 'db')) throw err
    return `GitHub: 읽지 못했습니다 (${err.message})`
  }
}

async function runUsage(run, now, opts, print) {
  const t = now()
  const summary = (await run(SQL.usageSummary(t)))[0]
  print(`오늘(UTC ${utcDay(t)}) 가입: 관문 ${summary.gate_today} · 실제 ${summary.created_today}`)
  print(
    `사용자 ${summary.users}명 · 문서 ${summary.docs}개 · 본문 합계 ${formatMB(summary.bytes)} · 막힘 ${summary.blocked} · 주의 ${summary.warned}`,
  )
  print(await githubUsageLine(run, t))
  const top = await run(SQL.usageTop(t, opts.top))
  print(`오늘 쓰기 많은 순 ${opts.top}명`)
  print(['이메일', '오늘 쓰기', '본문', '문서', '가입일', '막힘', '주의'].join('  '))
  for (const row of top) {
    print(
      [
        row.email,
        row.today,
        formatMB(row.content_bytes),
        row.doc_count,
        utcDay(row.created_at),
        row.blocked_at ? isoMinute(row.blocked_at) : '-',
        row.warned_at ? isoMinute(row.warned_at) : '-',
      ].join('  '),
    )
  }
  return 0
}

async function runBlock(run, now, opts, print) {
  const rows = await run(SQL.findUser(opts.email))
  if (rows.length === 0) {
    print(`계정이 없습니다: ${opts.email}`)
    return 3
  }
  const user = rows[0]
  if (user.blocked_at !== null) {
    print(`이미 막혀 있습니다 (${isoMinute(user.blocked_at)}).`)
    return 0
  }
  const sql = SQL.block(opts.email, now())
  if (!opts.yes) {
    print(`SQL: ${sql}`)
    print(YES_MSG)
    return 0
  }
  const result = await run(sql)
  if (result.length === 0) {
    print(CHANGED_MSG)
    return 1
  }
  print(`막았습니다: ${opts.email} (${isoMinute(result[0].blocked_at)})`)
  print(NOTICE_MSG)
  return 0
}

async function runUnblock(run, now, opts, print) {
  const rows = await run(SQL.findUser(opts.email))
  if (rows.length === 0) {
    print(`계정이 없습니다: ${opts.email}`)
    return 3
  }
  const user = rows[0]
  if (user.blocked_at === null) {
    print('막혀 있지 않습니다.')
    return 0
  }
  const sql = SQL.unblock(opts.email)
  if (!opts.yes) {
    print(`SQL: ${sql}`)
    print(YES_MSG)
    return 0
  }
  const result = await run(sql)
  if (result.length === 0) {
    print(CHANGED_MSG)
    return 1
  }
  print(`풀었습니다: ${opts.email}`)
  return 0
}

async function runWarn(run, now, opts, print) {
  const rows = await run(SQL.findUser(opts.email))
  if (rows.length === 0) {
    print(`계정이 없습니다: ${opts.email}`)
    return 3
  }
  const user = rows[0]
  if (!opts.clear) {
    if (user.warned_at !== null) {
      print(`이미 주의를 받은 계정입니다 (${isoMinute(user.warned_at)}).`)
      return 0
    }
    const sql = SQL.warn(opts.email, now())
    if (!opts.yes) {
      print(`SQL: ${sql}`)
      print(YES_MSG)
      return 0
    }
    const result = await run(sql)
    if (result.length === 0) {
      print(CHANGED_MSG)
      return 1
    }
    print(`주의를 기록했습니다: ${opts.email} (${isoMinute(result[0].warned_at)})`)
    print(NOTICE_MSG)
    return 0
  }
  if (user.warned_at === null) {
    print('주의 기록이 없습니다.')
    return 0
  }
  const sql = SQL.clearWarn(opts.email)
  if (!opts.yes) {
    print(`SQL: ${sql}`)
    print(YES_MSG)
    return 0
  }
  const result = await run(sql)
  if (result.length === 0) {
    print(CHANGED_MSG)
    return 1
  }
  print(`주의를 지웠습니다: ${opts.email}`)
  return 0
}

async function runRecount(run, now, opts, print) {
  const target = opts.all ? { all: true } : { email: opts.email }
  print('미리보기는 문서를 한 번 훑습니다(문서 수만큼 읽기).')
  const preview = await run(SQL.recountPreview(target))
  if (!opts.all && preview.length === 0) {
    print(`계정이 없습니다: ${opts.email}`)
    return 3
  }
  const mismatched = preview.filter((r) => r.content_bytes !== r.real_bytes || r.doc_count !== r.real_docs)
  for (const r of mismatched) {
    print(`${r.email}  저장 ${formatMB(r.content_bytes)}/${r.doc_count}개 → 실제 ${formatMB(r.real_bytes)}/${r.real_docs}개`)
  }
  if (mismatched.length === 0) {
    print('다시 셀 것이 없습니다.')
    return 0
  }
  const sql = SQL.recount(target)
  if (!opts.yes) {
    print(`SQL: ${sql}`)
    print(YES_MSG)
    return 0
  }
  const result = await run(sql)
  print(`다시 셌습니다: ${result.length}명`)
  for (const r of result) print(`${r.email}  ${formatMB(r.content_bytes)}  ${r.doc_count}개`)
  return 0
}

export async function runAdmin(command, argv, { exec, now, print }) {
  let opts
  try {
    opts = parseAdminArgs(command, argv)
  } catch (err) {
    if (!(err instanceof AdminError)) throw err
    print(usageText(command))
    print(err.message)
    return 2
  }

  if (opts.help) {
    print(usageText(command))
    return 0
  }

  print(targetLine(opts))
  const run = exec(opts)

  try {
    if (command === 'usage') return await runUsage(run, now, opts, print)
    if (command === 'block') return await runBlock(run, now, opts, print)
    if (command === 'unblock') return await runUnblock(run, now, opts, print)
    if (command === 'warn') return await runWarn(run, now, opts, print)
    if (command === 'github') return await runGithub(run, now, opts, print)
    return await runRecount(run, now, opts, print)
  } catch (err) {
    if (err instanceof AdminError && err.kind === 'db') {
      print(`D1 실행 실패: ${err.message}`)
      return 1
    }
    throw err
  }
}
