// @types/node 는 의존성에 없다 — worker 테스트가 쓰는 node:sqlite·node:fs·node:url 함수만 최소로 선언한다 (specs/features/F-2033.md 10.1)
declare module 'node:sqlite' {
  type SqlValue = string | number | bigint | null | Uint8Array
  export class StatementSync {
    get(...params: SqlValue[]): unknown
    all(...params: SqlValue[]): unknown[]
    run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  }
  export class DatabaseSync {
    constructor(path: string)
    exec(sql: string): void
    prepare(sql: string): StatementSync
  }
}
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf-8'): string
  export function readdirSync(path: string): string[]
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
}
// 테스트가 migrations/·wrangler.jsonc 를 찾는 기준 — DOM lib 이 없어 여기서 선언한다
interface ImportMeta {
  readonly url: string
}
