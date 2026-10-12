import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type { Live, Report } from '../types'
import { HEAVY_TOKENS, bar, fmt, limitName, ratio, shortDate, span, summaryLine, weekCompare } from './format'

const PANE = 'session-usage'
const report = atom({ plugin: 'session-usage', key: 'report' } as const, null)
const live = atom({ plugin: 'session-usage', key: 'live' } as const, null)
const status = atom({ plugin: 'session-usage', key: 'status' } as const, 'idle')
const error = atom({ plugin: 'session-usage', key: 'error' } as const, null)
const isNudged = atom({ plugin: 'session-usage', key: 'isNudged' } as const, false)

/** Reads the live context, cost and rate limits; free to call, no request sent. */
async function refreshLive($: Engine): Promise<Live> {
  const usage = await $.session.usage()
  const next: Live = {
    tokens: usage.context.tokens ?? 0,
    window: usage.context.window,
    percent: usage.context.percent ?? null,
    costUsd: usage.cost?.usd ?? null,
    limits: usage.rateLimits.map(limit => ({ kind: limit.kind, percentUsed: limit.percentUsed, resetsAt: limit.resetsAt })),
  }
  await update($, live, () => next)
  return next
}

/** Runs the bundled script over every local transcript; a few seconds at most. */
async function refreshHistory($: Engine): Promise<Report | null> {
  await update($, status, () => 'loading')
  const sessionId = await $.session.id()
  const run = await $.process
    .run(['node', `${$.plugin.root}/scripts/usage.mjs`, '--session', sessionId], { timeoutMs: 120_000 })
    .catch((reason: unknown) => ({ exitCode: -1, stdout: '', stderr: String(reason) }))
  if (run.exitCode !== 0) {
    const reason = run.stderr.includes('ENOENT') || run.stderr.includes('not found') ? 'node is not on PATH' : run.stderr.trim()
    await update($, error, () => `Couldn't read transcripts: ${reason || `exit ${run.exitCode}`}`)
    await update($, status, () => 'error')
    return null
  }
  const next = JSON.parse(run.stdout) as Report
  await update($, report, () => next)
  await update($, error, () => null)
  await update($, status, () => 'idle')
  return next
}

/** Once per session, when every reply starts re-reading a heavy history. */
async function nudgeIfHeavy($: Engine, current: Live): Promise<void> {
  if (current.tokens < HEAVY_TOKENS || (await read($, isNudged))) return
  await update($, isNudged, () => true)
  $.ui.toast(
    `Each reply now re-reads ${fmt(current.tokens)} tokens. When this topic is done: /session-wrap, then /clear.`,
  )
}

const clock = (iso?: string): string => {
  if (!iso) return ''
  const date = new Date(iso)
  const isToday = date.toDateString() === new Date().toDateString()
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return isToday ? time : `${shortDate(date.toLocaleDateString('en-CA'))}, ${time}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-usage',
      description: 'Open the Usage pane: what each reply costs now, your limits, and which sessions carry the bill',
    })
    return next(e)
  })

  on('command.run', { command: 'session-usage' }, async $ => {
    const current = await refreshLive($)
    await $.ui.open({ id: PANE, title: 'Usage' })
    const history = await refreshHistory($)
    return { text: summaryLine(current, history) }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    void refreshLive($)
      .then(current => nudgeIfHeavy($, current))
      .catch(reason => $.ui.log(`session-usage: ${String(reason)}`))
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await read($, live)
    const history = await read($, report)
    const state = await read($, status)
    const problem = await read($, error)
    const week = history ? weekCompare(history) : null
    const maxDay = Math.max(0, ...(history?.days ?? []).map(day => day.cacheRead))
    const total = history?.totals.cacheRead ?? 0
    const isHeavy = (now?.tokens ?? 0) >= HEAVY_TOKENS

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box justifyContent="space-between">
          <Text bold>Usage{state === 'loading' ? ' · reading transcripts…' : ''}</Text>
          <Button
            key="refresh"
            label="Refresh"
            onPress={() => Promise.all([refreshLive($), refreshHistory($)])}
          />
        </Box>

        <Box flexDirection="column">
          <Text bold color="claude">
            This session{history?.current ? ` · ${history.current.title}` : ''}
          </Text>
          {now && now.tokens > 0 ? (
            <Text>
              Each reply re-reads <Text bold>{fmt(now.tokens)}</Text> tokens
              {now.percent === null ? '' : ` (${Math.round(now.percent)}% of the ${fmt(now.window)} window)`}
            </Text>
          ) : (
            <Text dimColor>No reply yet in this session.</Text>
          )}
          {isHeavy && (
            <Text color="warning">
              Heavy: every reply pays for the whole history again. Wrap and clear when this topic is done: /session-wrap
            </Text>
          )}
          {now?.costUsd !== null && now?.costUsd !== undefined && (
            <Text dimColor>Cost since it started: ${now.costUsd.toFixed(2)}</Text>
          )}
          {history?.current && (
            <Text dimColor>
              So far: {history.current.replies} replies, {fmt(history.current.cacheRead)} cache-read,{' '}
              {ratio(history.current.cacheRead, history.current.output)}
              {total > 0 ? `, ${Math.round((history.current.cacheRead / total) * 100)}% of everything on this machine` : ''}
            </Text>
          )}
          {(now?.limits ?? []).map(limit => (
            <Text color={limit.percentUsed >= 80 ? 'warning' : undefined}>
              {limitName(limit.kind)} limit: {Math.round(limit.percentUsed)}% used
              {limit.resetsAt ? ` · resets ${clock(limit.resetsAt)}` : ''}
            </Text>
          ))}
        </Box>

        {problem && <Text color="error">{problem}</Text>}

        {week && (
          <Box flexDirection="column">
            <Text bold color="claude">This week</Text>
            <Text>
              {week.now}
              {week.before ? <Text dimColor> · last week {week.before} ({week.change})</Text> : ''}
            </Text>
          </Box>
        )}

        {history && history.days.length > 0 && (
          <Box flexDirection="column">
            <Text bold color="claude">Last 14 days · cache-read</Text>
            {history.days.map(day => (
              <Box key={`day-${day.day}`} columnGap={1}>
                <Box width={7}>
                  <Text dimColor>{shortDate(day.day)}</Text>
                </Box>
                <Text color="claude">{bar(day.cacheRead, maxDay)}</Text>
                <Text dimColor>{fmt(day.cacheRead)}</Text>
              </Box>
            ))}
          </Box>
        )}

        {history && history.heaviest.length > 0 && (
          <Box flexDirection="column">
            <Text bold color="claude">Heaviest sessions</Text>
            {history.heaviest.map(session => (
              <Text key={`session-${session.id}`}>
                <Text bold>{fmt(session.cacheRead)}</Text>
                <Text dimColor> {total > 0 ? `${Math.round((session.cacheRead / total) * 100)}%` : ''} · </Text>
                {session.title}
                <Text dimColor>
                  {' '}
                  · {session.project} · {span(session.first, session.last)}
                  {session.id === history.current?.id ? ' · this one' : ''}
                </Text>
              </Text>
            ))}
          </Box>
        )}

        {history && (
          <Text dimColor>
            {history.totals.sessions} sessions on this machine since {shortDate(history.range.from ?? '')}:{' '}
            {fmt(history.totals.cacheRead)} cache-read, {ratio(history.totals.cacheRead, history.totals.output)}. Cache-read
            is what a long session costs: every reply re-reads the whole conversation.
          </Text>
        )}
      </Box>
    )
  })
}
