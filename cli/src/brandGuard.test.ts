// 제품명 불변조건이 cli/ 에도 적용된다는 것을 코드로 확인한다 (specs/features/F-2021.md 8장, U13)
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import brand from '../../brand.config'

const SOURCE_FILES = [
  'args.ts',
  'client.ts',
  'commands.ts',
  'credentials.ts',
  'login.ts',
  'main.ts',
  'openBrowser.ts',
  'output.ts',
]

describe('F-2021 8장 제품명 불변조건 — cli/', () => {
  it('테스트가 아닌 cli/src/*.ts 에 브랜드 값 문자열이 없다', async () => {
    for (const name of SOURCE_FILES) {
      const text = await readFile(new URL(`./${name}`, import.meta.url), 'utf-8')
      expect(text.includes(brand.name), `${name} 에 brand.name 값("${brand.name}")이 있음`).toBe(false)
      expect(text.includes(brand.cliName), `${name} 에 brand.cliName 값("${brand.cliName}")이 있음`).toBe(false)
    }
  })

  it('cli/package.json 의 name·bin 의 유일한 키가 brand.cliName 이다', async () => {
    const text = await readFile(new URL('../package.json', import.meta.url), 'utf-8')
    const pkg = JSON.parse(text) as { name: string; bin: Record<string, string> }
    expect(pkg.name).toBe(brand.cliName)
    expect(Object.keys(pkg.bin)).toEqual([brand.cliName])
  })
})
