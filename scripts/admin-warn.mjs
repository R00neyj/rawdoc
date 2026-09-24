#!/usr/bin/env node
// 계정 주의 기록·지우기 — 진입점 (specs/features/F-2029.md 6.2)
import { runAdmin } from './lib/admin.mjs'
import { makeD1Exec } from './lib/d1.mjs'

process.exitCode = await runAdmin('warn', process.argv.slice(2), { exec: makeD1Exec, now: Date.now, print: console.log })
