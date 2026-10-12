#!/usr/bin/env node
/**
 * Summarize Claude Code token usage from this machine's session transcripts,
 * as JSON for the session-usage pane.
 *
 * Every assistant message in ~/.claude/projects/<project>/<session>.jsonl
 * carries its own usage block, so the full retained history is derivable.
 * Days are local dates. Only lines that can matter are parsed, so a few
 * gigabytes of transcripts read in seconds.
 *
 *   node usage.mjs [--session <id>] [--top <n>]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const currentId = option('--session')
const top = Number(option('--top') ?? 8)

const root = path.join(os.homedir(), '.claude', 'projects')

const transcripts = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'subagents' ? [] : transcripts(full)
    return entry.name.endsWith('.jsonl') ? [full] : []
  })

const localDay = (iso) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-CA')
}

/** The Monday that starts an ISO week, as a local YYYY-MM-DD. */
const weekOf = (day) => {
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return date.toLocaleDateString('en-CA')
}

const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, replies: 0 }
const byDay = new Map()
const sessions = new Map()

const bump = (into, usage) => {
  into.output += usage.output_tokens ?? 0
  into.cacheRead += usage.cache_read_input_tokens ?? 0
}

for (const file of fs.existsSync(root) ? transcripts(root) : []) {
  const id = path.basename(file, '.jsonl')
  const session = {
    id,
    title: '',
    aiTitle: '',
    firstPrompt: '',
    cwd: '',
    branch: '',
    first: '',
    last: '',
    output: 0,
    cacheRead: 0,
    replies: 0,
    lastContext: 0,
  }
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const line of text.split('\n')) {
    const isUsage = line.includes('"usage"')
    const isTitle = line.includes('"custom-title"') || line.includes('"ai-title"')
    const isPrompt = !session.firstPrompt && line.includes('"queue-operation"')
    if (!isUsage && !isTitle && !isPrompt) continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record.type === 'custom-title' && record.customTitle) session.title = record.customTitle
    if (record.type === 'ai-title' && record.aiTitle) session.aiTitle = record.aiTitle
    if (record.type === 'queue-operation' && typeof record.content === 'string' && !session.firstPrompt) {
      session.firstPrompt = record.content
    }
    const usage = record.message?.usage
    if (!usage || record.type !== 'assistant' || record.isSidechain) continue
    const day = localDay(record.timestamp ?? '')
    if (!day) continue
    if (!session.first) session.first = day
    session.last = day
    session.cwd ||= record.cwd ?? ''
    session.branch = record.gitBranch ?? session.branch
    session.replies += 1
    bump(session, usage)
    session.lastContext =
      (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    totals.input += usage.input_tokens ?? 0
    totals.cacheWrite += usage.cache_creation_input_tokens ?? 0
    totals.replies += 1
    bump(totals, usage)
    if (!byDay.has(day)) byDay.set(day, { day, output: 0, cacheRead: 0 })
    bump(byDay.get(day), usage)
  }
  if (session.replies) sessions.set(id, session)
}

const days = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1))
const weeks = new Map()
for (const day of days) {
  const week = weekOf(day.day)
  if (!weeks.has(week)) weeks.set(week, { week, output: 0, cacheRead: 0 })
  const into = weeks.get(week)
  into.output += day.output
  into.cacheRead += day.cacheRead
}

const named = (session) => ({
  id: session.id,
  title: session.title || session.aiTitle || session.firstPrompt.slice(0, 80) || session.id.slice(0, 8),
  project: session.cwd ? path.basename(session.cwd) : '',
  branch: session.branch,
  first: session.first,
  last: session.last,
  output: session.output,
  cacheRead: session.cacheRead,
  replies: session.replies,
  lastContext: session.lastContext,
})

const ranked = [...sessions.values()].sort((a, b) => b.cacheRead - a.cacheRead)

process.stdout.write(
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    range: { from: days[0]?.day ?? null, to: days.at(-1)?.day ?? null },
    totals: { ...totals, sessions: sessions.size },
    days: days.slice(-14),
    weeks: [...weeks.values()].slice(-6),
    heaviest: ranked.slice(0, top).map(named),
    current: currentId && sessions.has(currentId) ? named(sessions.get(currentId)) : null,
  }) + '\n',
)
