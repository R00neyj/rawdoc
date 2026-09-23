// @types/node 를 들이지 않고 CLI 가 쓰는 node:* 만 손으로 선언한다. fetch·Response·URL·TextEncoder·CryptoKey·crypto.subtle 는 cli/tsconfig.json 의 lib DOM 에서 온다 (specs/features/F-2021.md 3.4, 15장 Q6)
declare module 'node:http' {
  export interface IncomingMessage {
    method?: string
    url?: string
    headers: Record<string, string | string[] | undefined>
  }
  export interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string, string>): void
    end(chunk?: string): void
  }
  export interface Server {
    listen(port: number, host: string, callback?: () => void): Server
    close(callback?: (err?: Error) => void): void
    address(): { port: number } | string | null
    on(event: 'error', listener: (err: Error) => void): Server
  }
  export function createServer(requestListener: (req: IncomingMessage, res: ServerResponse) => void): Server
}

// vite.config.ts(빌드 설정)에서만 쓰는 API
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
}

declare module 'node:fs/promises' {
  export function readFile(path: string | URL): Promise<Uint8Array>
  export function readFile(path: string | URL, encoding: 'utf-8'): Promise<string>
  export function writeFile(
    path: string,
    data: string | Uint8Array,
    options?: 'utf-8' | { encoding?: 'utf-8'; mode?: number },
  ): Promise<void>
  export function mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<string | undefined>
  export function rename(oldPath: string, newPath: string): Promise<void>
  export function chmod(path: string, mode: number): Promise<void>
  // 테스트 전용 — 스크래치 디렉터리 만들기·정리·모드 확인
  export function mkdtemp(prefix: string): Promise<string>
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  export function stat(path: string): Promise<{ mode: number }>
}

declare module 'node:os' {
  export function homedir(): string
  export function hostname(): string
  export function tmpdir(): string
}

declare module 'node:path' {
  export function join(...segments: string[]): string
  export function dirname(path: string): string
}

declare module 'node:child_process' {
  export interface ChildProcess {
    on(event: 'error', listener: (err: Error) => void): ChildProcess
    unref(): ChildProcess
  }
  export function spawn(
    command: string,
    args: string[],
    options?: { detached?: boolean; stdio?: 'ignore' | string[]; windowsHide?: boolean },
  ): ChildProcess
}

declare module 'node:util' {
  export interface ParseArgsOptionConfig {
    type: 'string' | 'boolean'
    short?: string
    default?: string | boolean
  }
  export interface ParseArgsConfig {
    args?: string[]
    options?: Record<string, ParseArgsOptionConfig>
    strict?: boolean
    allowPositionals?: boolean
  }
  export function parseArgs(config: ParseArgsConfig): {
    values: Record<string, string | boolean | undefined>
    positionals: string[]
  }
}

// Node 22 의 import.meta.filename — 이 모듈이 실제 실행 스크립트인지 판정한다(main.ts 맨 아래)
interface ImportMeta {
  filename: string
}

declare const process: {
  argv: string[]
  env: Record<string, string | undefined>
  version: string
  platform: string
  exitCode?: number
  cwd(): string
  exit(code?: number): never
  stdout: { write(chunk: string | Uint8Array): boolean }
  stderr: { write(chunk: string): boolean }
  stdin: {
    isTTY?: boolean
    on(event: 'data', listener: (chunk: Uint8Array) => void): void
    on(event: 'end', listener: () => void): void
    resume(): void
  }
  on(event: 'SIGINT', listener: () => void): void
}
