#!/usr/bin/env node
// GitHub 기능 켜기·끄기·월 한도 — 진입점 (specs/features/F-3018.md)
import { runAdmin } from './lib/admin.mjs'
import { makeD1Exec } from './lib/d1.mjs'

process.exitCode = await runAdmin('github', process.argv.slice(2), { exec: makeD1Exec, now: Date.now, print: console.log })
