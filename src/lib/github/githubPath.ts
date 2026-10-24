// GitHub 저장소 경로 규칙 — 서버·앱 공용 순수 함수 (specs/features/F-3015.md 2장)
export const REPO_PATH_MAX = 1024

const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/
const hasControl = (text: string) => [...text].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)
const ATTACHMENT_RE = /^attachments\/[0-9a-f]{16}\.(png|jpg|gif|webp)$/
const MD_IMAGE_RE = /!\[[^[\]\n]*\]\((<[^<>\n]+>|[^\s()<][^\s()]*)(?:\s+"[^"\n]*")?\)/g
const IMG_START_RE = /<img\b/gi
const SRC_NAME_RE = /\bsrc\s*=\s*/gi
const UNQUOTED_RE = /[^\s"'>]+/y
const FULL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/
const BRANCH_BAD_RE = /[\s~^:?*[\\]/

function isRepoShape(path: string): boolean {
  if (path.length === 0 || path.length > REPO_PATH_MAX) return false
  if (path.includes('\\') || hasControl(path)) return false
  return path.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')
}

export function resolveRepoPath(mdPath: string, url: string): string | null {
  let text = url
  const cut = text.search(/[?#]/)
  if (cut >= 0) text = text.slice(0, cut)
  try {
    text = decodeURIComponent(text)
  } catch {
    return null
  }
  if (text === '' || SCHEME_RE.test(text) || text.startsWith('//')) return null
  if (text.includes('\\') || hasControl(text)) return null
  const base = text.startsWith('/') ? [] : mdPath.split('/').slice(0, -1)
  const rest = text.startsWith('/') ? text.slice(1) : text
  const out = [...base]
  for (const seg of rest.split('/')) {
    if (seg === '') return null
    if (seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(seg)
  }
  const joined = out.join('/')
  return isRepoShape(joined) ? joined : null
}

// 태그마다 첫 > 까지만 src 를 찾는다 — 정규식 하나로 훑으면 > 없는 <img 가 많을 때 이차 시간 (F-3017 r1)
function imgTagSources(content: string, urls: string[]): void {
  const exhausted = { '"': false, "'": false }
  IMG_START_RE.lastIndex = 0
  for (let start = IMG_START_RE.exec(content); start; start = IMG_START_RE.exec(content)) {
    const gt = content.indexOf('>', start.index)
    if (gt < 0) return
    const tag = content.slice(start.index, gt)
    let next = gt + 1
    SRC_NAME_RE.lastIndex = 0
    for (let name = SRC_NAME_RE.exec(tag); name; name = SRC_NAME_RE.exec(tag)) {
      const at = start.index + name.index + name[0].length
      const quote = content[at]
      if (quote === '"' || quote === "'") {
        const end = exhausted[quote] ? -1 : content.indexOf(quote, at + 1)
        if (end < 0) {
          exhausted[quote] = true
          continue
        }
        urls.push(content.slice(at + 1, end))
        next = Math.max(next, end + 1)
        break
      }
      UNQUOTED_RE.lastIndex = at
      const bare = UNQUOTED_RE.exec(content)
      if (bare) {
        urls.push(bare[0])
        break
      }
    }
    IMG_START_RE.lastIndex = next
  }
}

export function repoImagePaths(content: string, mdPath: string): Set<string> {
  const urls: string[] = []
  for (const m of content.matchAll(MD_IMAGE_RE)) {
    const raw = m[1]
    urls.push(raw.startsWith('<') ? raw.slice(1, -1) : raw)
  }
  imgTagSources(content, urls)
  const out = new Set<string>()
  const seen = new Set<string>()
  for (const url of urls) {
    if (seen.has(url)) continue
    seen.add(url)
    if (ATTACHMENT_RE.test(url)) continue
    const path = resolveRepoPath(mdPath, url)
    if (path !== null) out.add(path)
  }
  return out
}

export function isRepoMdPath(path: unknown): path is string {
  return typeof path === 'string' && isRepoShape(path) && /\.(md|markdown)$/i.test(path)
}

export function isRepoDir(dir: unknown): dir is string {
  return typeof dir === 'string' && (dir === '' || isRepoShape(dir))
}

export function isRepoFullName(repo: unknown): repo is string {
  if (typeof repo !== 'string' || !FULL_NAME_RE.test(repo)) return false
  const name = repo.split('/')[1]
  return name !== '.' && name !== '..'
}

export function isBranchName(branch: unknown): branch is string {
  if (typeof branch !== 'string' || branch.length < 1 || branch.length > 255) return false
  if (BRANCH_BAD_RE.test(branch) || hasControl(branch)) return false
  if (branch.includes('..') || branch.includes('@{') || branch.includes('//')) return false
  if (/^[/.]|[/.]$/.test(branch) || branch.endsWith('.lock')) return false
  return true
}

export function encodePathSegments(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export function githubBlobUrl(repo: string, branch: string, path: string): string {
  return `https://github.com/${repo}/blob/${encodePathSegments(branch)}/${encodePathSegments(path)}`
}
