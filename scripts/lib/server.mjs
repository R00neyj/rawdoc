// 빌드·preview 서버 기동·대기·종료 공용 (specs/features/F-160.md 2.5)
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

async function isResponding(port) {
  try {
    const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1000) })
    return res.ok || res.status < 500
  } catch {
    return false
  }
}

function killTree(child) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'])
  } else {
    child.kill('SIGTERM')
  }
}

// 필요하면 빌드하고 preview 를 자식 프로세스로 띄워 { url, stop } 을 돌려줌
export async function ensureServer({ port, dist, build }) {
  if (port === 5173) {
    throw new Error('포트 5173 은 사용자 dev 서버 전용이라 쓸 수 없습니다')
  }

  if (await isResponding(port)) {
    throw new Error(`포트 ${port} 는 이미 응답 중입니다 (다른 프로세스가 쓰는 중일 수 있어 재사용하지 않습니다)`)
  }

  // stdout 은 measure.mjs 의 JSON 출력 전용이라 자식 프로세스 로그는 섞지 않는다
  if (build || !existsSync(dist)) {
    const result = spawnSync('npx', ['vite', 'build', '--outDir', dist], {
      shell: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf-8',
    })
    if (result.status !== 0) {
      throw new Error(`빌드 실패 (exit ${result.status})\n${result.stderr}`)
    }
  }

  const child = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--outDir', dist], {
    shell: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderrTail = ''
  child.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk.toString()).slice(-2000) })

  const deadline = Date.now() + 30_000
  let up = false
  while (Date.now() < deadline) {
    if (await isResponding(port)) {
      up = true
      break
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  if (!up) {
    killTree(child)
    throw new Error(`preview 서버가 ${port} 에서 30초 안에 응답하지 않았습니다\n${stderrTail}`)
  }

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    killTree(child)
  }
  process.on('exit', stop)
  process.on('SIGINT', () => {
    stop()
    process.exit(1)
  })

  return { url: `http://localhost:${port}`, stop }
}
