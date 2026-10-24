// Notion 내보내기 zip → 볼트 가져오기가 읽는 모양으로 — 이름의 32자리 id 떼기, 본문 링크 고쳐 쓰기 (small 2026-10-16)
import type { VaultEntry } from './importVault'

const ID_SEG_RE = /^(?:(.*) )?[0-9a-f]{32}(\.[A-Za-z0-9]+)?$/
const LINK_RE = /(!?)\[([^\]\n]*)\]\(([^)\s]+)\)/g
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i

export function isNotionExport(names: readonly string[]): boolean {
  return names.some((n) => n.split('/').some((seg) => ID_SEG_RE.test(seg)))
}

function stripIdSegment(seg: string): string {
  const m = ID_SEG_RE.exec(seg)
  return m ? `${m[1] || 'Untitled'}${m[2] ?? ''}` : seg
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// '/' 조각, './' '../' 를 dir 기준으로 푼다. 루트를 벗어나면 null
function resolvePath(dir: string, rel: string): string | null {
  const stack = dir === '' ? [] : dir.split('/')
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (stack.length === 0) return null
      stack.pop()
    } else stack.push(seg)
  }
  return stack.join('/')
}

function relativePath(fromDir: string, to: string): string {
  const from = fromDir === '' ? [] : fromDir.split('/')
  const parts = to.split('/')
  let i = 0
  while (i < from.length && i < parts.length - 1 && from[i] === parts[i]) i++
  return [...from.slice(i).map(() => '..'), ...parts.slice(i)].join('/')
}

// mapPath: 원래 전체 경로(파일·디렉터리) → 정리된 전체 경로. 모르는 경로는 조각마다 id 만 뗀다
export function rewriteNotionMarkdown(text: string, docDir: string, mapPath: (path: string) => string): string {
  const finalDir = docDir === '' ? '' : mapPath(docDir)
  const lines = text.replace(/^# [^\n]*\n(\n)?/, '').split('\n')
  let fence: string | null = null
  return lines
    .map((line) => {
      const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
      if (f) {
        if (fence === null) fence = f[1][0]
        else if (f[1][0] === fence) fence = null
        return line
      }
      if (fence !== null) return line
      const inTable = line.trimStart().startsWith('|')
      return line.replace(LINK_RE, (whole, bang: string, label: string, rawTarget: string) => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(rawTarget) || rawTarget.startsWith('#') || rawTarget.startsWith('//')) return whole
        const full = resolvePath(docDir, safeDecode(rawTarget))
        if (full === null) return whole
        const target = mapPath(full)
        if (!bang && /\.md$/i.test(target) && !IMAGE_RE.test(target)) {
          const title = (target.split('/').pop() ?? target).replace(/\.md$/i, '')
          return label === title || label === '' ? `[[${title}]]` : `[[${title}${inTable ? '\\|' : '|'}${label}]]`
        }
        return `${bang}[${label}](${relativePath(finalDir, target).split('/').map((s) => (s === '..' ? s : encodeURIComponent(s))).join('/')})`
      })
    })
    .join('\n')
}

// 경로마다 id 를 떼고 같은 디렉터리에서 겹치면 ' 2'·' 3' 을 붙인다. md 본문은 고쳐 쓴다
export function normalizeNotionEntries(entries: readonly VaultEntry[]): VaultEntry[] {
  const finalOf = new Map<string, string>()
  const taken = new Set<string>()

  function mapPath(path: string): string {
    const hit = finalOf.get(path)
    if (hit !== undefined) return hit
    const cut = path.lastIndexOf('/')
    const parent = cut < 0 ? '' : mapPath(path.slice(0, cut))
    const seg = stripIdSegment(path.slice(cut + 1))
    const dot = seg.lastIndexOf('.')
    const [stem, ext] = dot > 0 ? [seg.slice(0, dot), seg.slice(dot)] : [seg, '']
    let name = seg
    for (let n = 2; taken.has(`${parent}/${name}`.toLowerCase()); n++) name = `${stem} ${n}${ext}`
    taken.add(`${parent}/${name}`.toLowerCase())
    const final = parent === '' ? name : `${parent}/${name}`
    finalOf.set(path, final)
    return final
  }

  for (const e of entries) mapPath(e.name)
  // 본문이 가리키는 경로는 이미 다 정해졌다 — 없는 경로는 새로 자리를 잡지 않고 조각마다 id 만 뗀다
  const lookup = (path: string) => finalOf.get(path) ?? path.split('/').map(stripIdSegment).join('/')
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  return entries.map((e) => {
    const name = finalOf.get(e.name) ?? e.name
    if (e.bytes === null || !/\.(md|markdown)$/i.test(e.name)) return { name, bytes: e.bytes }
    const dir = e.name.includes('/') ? e.name.slice(0, e.name.lastIndexOf('/')) : ''
    return { name, bytes: encoder.encode(rewriteNotionMarkdown(decoder.decode(e.bytes), dir, lookup)) }
  })
}
