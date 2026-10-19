// npx 는 윈도에서 .cmd 라 셸 없이 못 띄운다 — 셸 인용 문제를 피하려 패키지 JS 진입점을 node 로 직접 부른다
import { fileURLToPath } from 'node:url'

const bin = (rel) => fileURLToPath(new URL(`../../node_modules/${rel}`, import.meta.url))

export const BIN = {
  eslint: bin('eslint/bin/eslint.js'),
  vitest: bin('vitest/vitest.mjs'),
  vite: bin('vite/bin/vite.js'),
  playwright: bin('@playwright/test/cli.js'),
}
