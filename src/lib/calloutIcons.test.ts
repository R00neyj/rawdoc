// specs/features/F-148.md 4장 A1
import { describe, expect, it } from 'vitest'
import { calloutIconName, calloutIconSvg } from './calloutIcons.js'

describe('calloutIconName — 2장 표', () => {
  it('종류마다 정해진 아이콘 이름', () => {
    expect(calloutIconName('note')).toBe('edit')
    expect(calloutIconName('abstract')).toBe('summarize')
    expect(calloutIconName('summary')).toBe('summarize')
    expect(calloutIconName('tldr')).toBe('summarize')
    expect(calloutIconName('info')).toBe('info')
    expect(calloutIconName('todo')).toBe('check_circle')
    expect(calloutIconName('tip')).toBe('local_fire_department')
    expect(calloutIconName('hint')).toBe('local_fire_department')
    expect(calloutIconName('important')).toBe('local_fire_department')
    expect(calloutIconName('success')).toBe('check')
    expect(calloutIconName('check')).toBe('check')
    expect(calloutIconName('done')).toBe('check')
    expect(calloutIconName('question')).toBe('help')
    expect(calloutIconName('help')).toBe('help')
    expect(calloutIconName('faq')).toBe('help')
    expect(calloutIconName('warning')).toBe('warning')
    expect(calloutIconName('caution')).toBe('warning')
    expect(calloutIconName('attention')).toBe('warning')
    expect(calloutIconName('failure')).toBe('close')
    expect(calloutIconName('fail')).toBe('close')
    expect(calloutIconName('missing')).toBe('close')
    expect(calloutIconName('danger')).toBe('bolt')
    expect(calloutIconName('error')).toBe('bolt')
    expect(calloutIconName('bug')).toBe('bug_report')
    expect(calloutIconName('example')).toBe('format_list_bulleted')
    expect(calloutIconName('quote')).toBe('format_quote')
    expect(calloutIconName('cite')).toBe('format_quote')
  })

  it('대소문자를 가리지 않는다', () => {
    expect(calloutIconName('DANGER')).toBe('bolt')
    expect(calloutIconName('Tip')).toBe('local_fire_department')
  })

  it('모르는 이름은 note 와 같은 edit', () => {
    expect(calloutIconName('unknown')).toBe('edit')
    expect(calloutIconName('할일')).toBe('edit')
  })
})

describe('calloutIconSvg', () => {
  it('svg 원문 문자열을 돌려준다', () => {
    const svg = calloutIconSvg('warning')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
  })

  it('종류마다 다른 svg', () => {
    expect(calloutIconSvg('note')).not.toBe(calloutIconSvg('tip'))
  })

  it('같은 아이콘으로 묶인 별칭은 같은 svg', () => {
    expect(calloutIconSvg('note')).toBe(calloutIconSvg('unknown'))
    expect(calloutIconSvg('success')).toBe(calloutIconSvg('check'))
  })
})
