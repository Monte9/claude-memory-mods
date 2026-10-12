import { expect, test } from 'claude-code/testing'

import type { Report } from '../types'
import { bar, fmt, limitName, ratio, shortDate, span, summaryLine, weekCompare } from './format'

const report = (weeks: Report['weeks']): Report => ({
  generatedAt: '',
  range: { from: '2026-07-25', to: '2026-10-11' },
  totals: { input: 0, output: 10, cacheRead: 3930, cacheWrite: 0, replies: 1, sessions: 2 },
  days: [],
  weeks,
  heaviest: [],
  current: null,
})

test('formats token counts and ratios the way Claude Code does', () => {
  expect(fmt(950)).toBe('950')
  expect(fmt(12_340)).toBe('12.3k')
  expect(fmt(826_385)).toBe('826k')
  expect(fmt(36_307_716)).toBe('36.3M')
  expect(fmt(10_959_300_318)).toBe('10.96B')
  expect(ratio(3930, 10)).toBe('393:1')
  expect(ratio(5, 0)).toBe('n/a')
})

test('dates, spans, bars and limit names', () => {
  expect(shortDate('2026-10-07')).toBe('Oct 7')
  expect(span('2026-10-07', '2026-10-08')).toBe('Oct 7–8')
  expect(span('2026-09-28', '2026-10-02')).toBe('Sep 28–Oct 2')
  expect(span('2026-10-07', '2026-10-07')).toBe('Oct 7')
  expect(bar(50, 100, 10)).toBe('█████')
  expect(bar(1, 1000, 10)).toBe('█')
  expect(bar(0, 100)).toBe('')
  expect(limitName('five_hour')).toBe('5-hour')
  expect(limitName('spend_limit')).toBe('spend limit')
})

test('compares this week with last', () => {
  const compared = weekCompare(
    report([
      { week: '2026-09-28', output: 10, cacheRead: 2000 },
      { week: '2026-10-05', output: 10, cacheRead: 3000 },
    ]),
  )
  expect(compared).toEqual({ now: '3.0k cache-read, 300:1', before: '2.0k cache-read, 200:1', change: '+50%' })
  expect(weekCompare(report([]))).toBe(null)
})

test('summarizes in one line', () => {
  const line = summaryLine(
    { tokens: 826_385, window: 1_000_000, percent: 82.6, costUsd: 14.1, limits: [] },
    report([]),
  )
  expect(line).toBe(
    'This session re-reads 826k tokens per reply (83% of the window). All 2 sessions: 3.9k cache-read, 393:1. Details in the Usage pane.',
  )
})
