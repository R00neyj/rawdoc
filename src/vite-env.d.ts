/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

// @types/node 는 2.1 의존성 목록에 없다 — vite.config.ts·테스트가 쓰는 두 함수만 최소로 선언한다
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf-8'): string
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
}
