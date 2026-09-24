// 테스트 전용 node:sqlite → D1 모양 어댑터 (specs/features/F-2025.md 8.3). 운영 코드는 import 하지 않는다
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url))

// migrations/*.sql 을 번호 순서로. until('0009' 등) 이하만
export function openTestDb(until?: string): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    if (until && file.slice(0, 4) > until) continue
    db.exec(readFileSync(MIGRATIONS + file, 'utf-8'))
  }
  return db
}

type SqlValue = string | number | bigint | null | Uint8Array

function toSqlValue(v: unknown): SqlValue {
  return v === undefined ? null : (v as SqlValue)
}

type TestStatement = {
  bind(...args: unknown[]): TestStatement
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<{ results: T[] }>
  run(): Promise<{ success: true; meta: { changes: number } }>
}

function makeStatement(stmt: StatementSync, boundArgs: unknown[]): TestStatement {
  const args = boundArgs.map(toSqlValue)
  return {
    bind(...next: unknown[]) {
      return makeStatement(stmt, next)
    },
    async first<T>() {
      const row = stmt.get(...args) as T | undefined
      return row === undefined ? null : row
    },
    async all<T>() {
      return { results: stmt.all(...args) as T[] }
    },
    async run() {
      const result = stmt.run(...args)
      return { success: true, meta: { changes: Number(result.changes) } }
    },
  }
}

// prepare → bind → first·all·run, prepare 에서 바로 first·all·run, batch
export function asD1(db: DatabaseSync): D1Database {
  const prepare = (sql: string): TestStatement => makeStatement(db.prepare(sql), [])
  return {
    prepare,
    async batch<T>(statements: TestStatement[]) {
      db.exec('BEGIN')
      try {
        const results: T[] = []
        for (const statement of statements) {
          results.push((await statement.run()) as unknown as T)
        }
        db.exec('COMMIT')
        return results
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    },
  } as unknown as D1Database
}
