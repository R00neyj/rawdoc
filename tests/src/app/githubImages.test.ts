// F-2131 A1 저장소 그림 리졸버·받아 넣기 (specs/features/F-2131.md 2장·5장)
import { describe, expect, it, vi } from 'vitest'
import {
  GITHUB_IMAGE_IMPORT_MAX,
  githubAttachmentOf,
  githubImageResolver,
  githubProxySrc,
  parseGithubImageMap,
  planGithubImageImport,
  runGithubImageImport,
  type GithubImageImportDeps,
} from '../../../src/app/githubImages'
import { AttachmentApiError } from '../../../src/storage/attachmentsApi'
import type { GithubImageSource } from '../../../src/lib/githubContract'

const SHA = 'a'.repeat(40)
const ID = '0123456789abcdef'

describe('githubProxySrc', () => {
  it('네 꼴, path·토큰·id 를 encodeURIComponent', () => {
    expect(githubProxySrc({ kind: 'doc', docId: 'd 1' }, 'a b/c.png')).toBe('/api/docs/d%201/github/img?path=a%20b%2Fc.png')
    expect(githubProxySrc({ kind: 'pub', token: 't/k' }, 'a b/c.png')).toBe('/pub/docs/t%2Fk/gh?path=a%20b%2Fc.png')
    expect(githubProxySrc({ kind: 'pubSet', token: 'tk', docId: 'd1' }, 'a b/c.png')).toBe('/pub/docs/tk/docs/d1/gh?path=a%20b%2Fc.png')
    expect(githubProxySrc({ kind: 'pubFolder', token: 'tk', docId: 'd1' }, 'a b/c.png')).toBe('/pub/folders/tk/docs/d1/gh?path=a%20b%2Fc.png')
  })
})

describe('parseGithubImageMap', () => {
  it('틀린 path·배열·images 아님 → null', () => {
    for (const raw of [null, [], 'x', { path: '../a.md', images: {} }, { path: 'a.txt', images: {} }, { path: 'a.md', images: [] }, { path: 'a.md' }]) {
      expect(parseGithubImageMap(raw)).toBeNull()
    }
  })
  it('틀린 값 항목만 빠진다', () => {
    const raw = { path: 'docs/README.md', images: { 'docs/a.png': `${ID}.png`, 'docs/b.png': `${ID}.svg`, 'docs/c.png': 'ABCDEF0123456789.png', 'docs/d.png': 3, 'docs/e.jpg': `${ID}.jpg` } }
    expect(parseGithubImageMap(raw)).toEqual({ path: 'docs/README.md', images: { 'docs/a.png': `${ID}.png`, 'docs/e.jpg': `${ID}.jpg` } })
  })
})

describe('githubImageResolver', () => {
  const map = { path: 'docs/README.md', images: { 'docs/img/a.png': `${ID}.png` } }
  const resolve = githubImageResolver(map, { kind: 'doc', docId: 'd1' })
  it('대응 → { id, ext }, 없음 → { repoPath, src }, 저장소 밖 → null', () => {
    expect(resolve('./img/a.png')).toEqual({ id: ID, ext: 'png' })
    expect(resolve('img/b.svg')).toEqual({ repoPath: 'docs/img/b.svg', src: '/api/docs/d1/github/img?path=docs%2Fimg%2Fb.svg' })
    expect(resolve('../../x.png')).toBeNull()
  })
  it('같은 url 두 번 → 같은 객체', () => {
    expect(resolve('img/b.svg')).toBe(resolve('img/b.svg'))
  })
})

describe('githubAttachmentOf', () => {
  it('값이 그 id 인 대응의 확장자, 없으면 null', () => {
    const map = { path: 'a.md', images: { 'x.png': 'ffffffffffffffff.png', 'y.jpg': `${ID}.webp` } }
    expect(githubAttachmentOf(map, ID)).toEqual({ ext: 'webp' })
    expect(githubAttachmentOf(map, '1111111111111111')).toBeNull()
  })
})

const src = (path: string, over: Partial<GithubImageSource> = {}): GithubImageSource => ({ path, sha: SHA, size: 10, mapped: false, ...over })

describe('planGithubImageImport', () => {
  it('mapped·.SVG·5,242,881 B 는 빠지고 순서 그대로', () => {
    const plan = planGithubImageImport([src('a.png'), src('b.png', { mapped: true }), src('c.SVG'), src('d.png', { size: 5_242_881 }), src('e.png', { size: 5_242_880 })])
    expect(plan.map((s) => s.path)).toEqual(['a.png', 'e.png'])
  })
  it('60개 → 앞 50', () => {
    const plan = planGithubImageImport(Array.from({ length: 60 }, (_, i) => src(`${i}.png`)))
    expect(plan).toHaveLength(GITHUB_IMAGE_IMPORT_MAX)
    expect(plan[49].path).toBe('49.png')
  })
})

function pngBytes(): Uint8Array {
  const b = new Uint8Array(24)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 2])
  return b
}
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 2, 0])
const MD = 'docs/README.md'
const tick = () => new Promise((r) => setTimeout(r, 0))

type Fake = {
  deps: GithubImageImportDeps
  raw: string[]
  uploads: string[]
  puts: unknown[]
  mapped: [string, string][]
  maxActive: () => number
}

function fake(o: { sources?: GithubImageSource[]; bytes?: (path: string) => Uint8Array; toWebp?: (b: Blob) => Blob; upload?: (n: number) => Error | null; put?: (n: number) => { status: number; error: string | null } | null; sourcesFail?: boolean } = {}): Fake {
  const raw: string[] = []
  const uploads: string[] = []
  const puts: unknown[] = []
  const mapped: [string, string][] = []
  let active = 0
  let maxActive = 0
  let ids = 0
  const deps: GithubImageImportDeps = {
    imageSources: vi.fn(async (paths: string[]) =>
      o.sourcesFail ? { ok: false as const, status: 503, error: 'github_rate_limited', body: null } : { ok: true as const, value: { sources: o.sources ?? paths.map((p) => src(p)), truncated: false } },
    ),
    raw: async (path) => {
      raw.push(path)
      active++
      maxActive = Math.max(maxActive, active)
      await tick()
      active--
      return { ok: true, value: (o.bytes ?? (() => pngBytes()))(path) }
    },
    putImage: async (body) => {
      puts.push(body)
      const fail = o.put?.(puts.length)
      return fail ? { ok: false, status: fail.status, error: fail.error, body: null } : { ok: true, value: true }
    },
    toWebp: vi.fn(async (b: Blob) => (o.toWebp ? o.toWebp(b) : b)),
    upload: async (id, ext) => {
      uploads.push(`${id}.${ext}`)
      const err = o.upload?.(uploads.length)
      if (err) throw err
    },
    newId: () => String(++ids).padStart(16, '0'),
    onMapped: (path, attachment) => mapped.push([path, attachment]),
  }
  return { deps, raw, uploads, puts, mapped, maxActive: () => maxActive }
}

describe('runGithubImageImport', () => {
  const body = (n: number) => Array.from({ length: n }, (_, i) => `![${i}](img/${i}.png)`).join('\n\n')

  it('경로 없는 본문 → 요청 0', async () => {
    const f = fake()
    expect(await runGithubImageImport({ content: '# 글\n![x](https://e.com/a.png)\n', mdPath: MD }, f.deps)).toEqual({ mapped: 0, skipped: 0, stopped: null })
    expect(f.deps.imageSources).not.toHaveBeenCalled()
  })

  it('동시 최대 2, 성공마다 onMapped(path, {id}.{ext}), putImage 몸통', async () => {
    const f = fake()
    const r = await runGithubImageImport({ content: body(5), mdPath: MD }, f.deps)
    expect(r).toEqual({ mapped: 5, skipped: 0, stopped: null })
    expect(f.deps.imageSources).toHaveBeenCalledWith(['docs/img/0.png', 'docs/img/1.png', 'docs/img/2.png', 'docs/img/3.png', 'docs/img/4.png'])
    expect(f.maxActive()).toBe(2)
    expect(f.mapped.map(([, a]) => a).sort()).toEqual([...f.uploads].sort())
    expect(f.mapped.map(([p]) => p).sort()).toEqual(['docs/img/0.png', 'docs/img/1.png', 'docs/img/2.png', 'docs/img/3.png', 'docs/img/4.png'])
    const put = f.puts[0] as { path: string; blobSha: string; attachment: string }
    expect(put.blobSha).toBe(SHA)
    expect(f.mapped).toContainEqual([put.path, put.attachment])
  })

  it('gif 는 toWebp 를 부르지 않고 gif, png 는 결과가 다르면 webp 같으면 png', async () => {
    const gif = fake({ bytes: () => GIF })
    await runGithubImageImport({ content: body(1), mdPath: MD }, gif.deps)
    expect(gif.deps.toWebp).not.toHaveBeenCalled()
    expect(gif.uploads[0]).toMatch(/\.gif$/)

    const same = fake()
    await runGithubImageImport({ content: body(1), mdPath: MD }, same.deps)
    expect(same.uploads[0]).toMatch(/^[0-9a-f]{16}\.png$/)

    const conv = fake({ toWebp: () => new Blob([new Uint8Array([1])], { type: 'image/webp' }) })
    await runGithubImageImport({ content: body(1), mdPath: MD }, conv.deps)
    expect(conv.uploads[0]).toMatch(/\.webp$/)
  })

  it('시그니처 실패 → 올리기 0, 건너뜀', async () => {
    const f = fake({ bytes: () => new TextEncoder().encode('<svg></svg>') })
    expect(await runGithubImageImport({ content: body(2), mdPath: MD }, f.deps)).toEqual({ mapped: 0, skipped: 2, stopped: null })
    expect(f.uploads).toHaveLength(0)
  })

  it('too_large 는 그 장만 건너뛴다', async () => {
    const f = fake({ upload: (n) => (n === 1 ? new AttachmentApiError('too_large') : null) })
    expect(await runGithubImageImport({ content: body(3), mdPath: MD }, f.deps)).toEqual({ mapped: 2, skipped: 1, stopped: null })
    expect(f.raw).toHaveLength(3)
  })

  it('quota_exceeded·too_many → 남은 raw 0 (진행 중인 것만 끝낸다)', async () => {
    const q = fake({ upload: (n) => (n === 1 ? new AttachmentApiError('quota_exceeded') : null) })
    expect((await runGithubImageImport({ content: body(5), mdPath: MD }, q.deps)).stopped).toBe('quota')
    expect(q.raw).toHaveLength(2)

    const t = fake({ put: (n) => (n === 1 ? { status: 409, error: 'too_many' } : null) })
    expect((await runGithubImageImport({ content: body(5), mdPath: MD }, t.deps)).stopped).toBe('too_many')
    expect(t.raw).toHaveLength(2)
  })

  it('abort → raw 0', async () => {
    const f = fake()
    const ctl = new AbortController()
    ctl.abort()
    expect((await runGithubImageImport({ content: body(3), mdPath: MD }, { ...f.deps, signal: ctl.signal })).stopped).toBe('aborted')
    expect(f.raw).toHaveLength(0)
  })

  it('sources 실패 → raw 0', async () => {
    const f = fake({ sourcesFail: true })
    expect((await runGithubImageImport({ content: body(2), mdPath: MD }, f.deps)).stopped).toBe('sources')
    expect(f.raw).toHaveLength(0)
  })
})
