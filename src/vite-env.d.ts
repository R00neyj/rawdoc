/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

// @types/node 는 2.1 의존성 목록에 없다 — vite.config.ts·테스트가 쓰는 함수만 최소로 선언한다 (F-272.md 3.2 sitePlugin 이 fs·path 를 더 쓰게 되어 늘렸다)
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf-8'): string
  export function writeFileSync(path: string, data: string, encoding: 'utf-8'): void
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
  export function readdirSync(path: string): string[]
  export function statSync(path: string): { isDirectory(): boolean }
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
}
declare module 'node:path' {
  export function resolve(...segments: string[]): string
  export function join(...segments: string[]): string
  export function dirname(path: string): string
  export function relative(from: string, to: string): string
  export const sep: string
}
