import type { Live, Report } from '../types'

/** Above this many tokens re-read per reply, the session is worth wrapping. */
export const HEAVY_TOKENS = 150_000

/** 1.2k, 36.3M, 10.96B: the units Claude Code's own usage views use. */
export function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`
  return String(Math.round(n))
}

/** Cache-read per output token, written 393:1. */
export function ratio(cacheRead: number, output: number): string {
  return output > 0 ? `${Math.round(cacheRead / output)}:1` : 'n/a'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 2026-10-07 → Oct 7. */
export function shortDate(day: string): string {
  const [, month, date] = day.split('-').map(Number)
  return month ? `${MONTHS[month - 1]} ${date}` : day
}

/** Oct 7, or Oct 7–8, or Sep 28–Oct 2. */
export function span(first: string, last: string): string {
  if (!first || first === last) return shortDate(first || last)
  const [a, b] = [shortDate(first), shortDate(last)]
  return a.split(' ')[0] === b.split(' ')[0] ? `${a}–${b.split(' ')[1]}` : `${a}–${b}`
}

/** A bar of `width` cells scaled to `max`; at least one cell for any non-zero value. */
export function bar(value: number, max: number, width = 24): string {
  if (max <= 0 || value <= 0) return ''
  return '█'.repeat(Math.max(1, Math.round((value / max) * width)))
}

/** five_hour → 5-hour, seven_day → 7-day, anything else as it came. */
export function limitName(kind: string): string {
  return ({ five_hour: '5-hour', seven_day: '7-day' } as Record<string, string>)[kind] ?? kind.replace(/_/g, ' ')
}

/** This week against last: cache-read and ratio for each, and the change. */
export function weekCompare(report: Report): { now: string; before: string; change: string } | null {
  const [before, now] = report.weeks.slice(-2)
  if (!now) return null
  const line = (week: { cacheRead: number; output: number }) => `${fmt(week.cacheRead)} cache-read, ${ratio(week.cacheRead, week.output)}`
  if (!before) return { now: line(now), before: '', change: '' }
  const change = before.cacheRead > 0 ? Math.round(((now.cacheRead - before.cacheRead) / before.cacheRead) * 100) : 0
  return { now: line(now), before: line(before), change: `${change >= 0 ? '+' : ''}${change}%` }
}

/** The command's one-line reply. */
export function summaryLine(live: Live | null, report: Report | null): string {
  const parts: string[] = []
  if (live && live.tokens > 0) {
    const share = live.percent === null ? '' : ` (${Math.round(live.percent)}% of the window)`
    parts.push(`This session re-reads ${fmt(live.tokens)} tokens per reply${share}.`)
  }
  if (report) {
    parts.push(
      `All ${report.totals.sessions} sessions: ${fmt(report.totals.cacheRead)} cache-read, ${ratio(report.totals.cacheRead, report.totals.output)}.`,
    )
  }
  parts.push('Details in the Usage pane.')
  return parts.join(' ')
}
