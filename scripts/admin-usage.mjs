#!/usr/bin/env node
// 원격 D1 사용량 보기 — 진입점 (specs/features/F-2029.md 6.2)
import { runAdmin } from './lib/admin.mjs'
import { makeD1Exec } from './lib/d1.mjs'

process.exitCode = await runAdmin('usage', process.argv.slice(2), { exec: makeD1Exec, now: Date.now, print: console.log })
