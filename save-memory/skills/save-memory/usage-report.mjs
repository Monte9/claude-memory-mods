#!/usr/bin/env node
/**
 * Aggregate Claude Code token usage from local session transcripts.
 *
 * Claude Code has no export command; `/usage` is interactive and shows only the
 * last 24h or 7d. But every assistant message in ~/.claude/projects/<slug>/*.jsonl
 * carries its own usage block, so the full history is derivable.
 *
 * Writes ~/.claude/stats.json on every run and prints a summary.
 *
 * Usage:
 *   node ~/.claude/scripts/usage-report.mjs                 # summary + stats.json
 *   node ~/.claude/scripts/usage-report.mjs --csv > out.csv # per-day CSV instead
 *   node ~/.claude/scripts/usage-report.mjs --since 2026-08-01
 *
 * Caveat: this machine only. Usage from other devices or claude.ai is not here.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const kRoot = path.join(os.homedir(), '.claude', 'projects')

const args = process.argv.slice(2)
const asCsv = args.includes('--csv')
const since = args[args.indexOf('--since') + 1]
const sinceDate = args.includes('--since') ? since : null

/** Every .jsonl under every project directory. */
const findTranscripts = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return findTranscripts(full)
    return entry.name.endsWith('.jsonl') ? [full] : []
  })

const blank = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  messages: 0,
})

const add = (into, usage) => {
  into.input += usage.input_tokens ?? 0
  into.output += usage.output_tokens ?? 0
  into.cacheRead += usage.cache_read_input_tokens ?? 0
  into.cacheWrite += usage.cache_creation_input_tokens ?? 0
  into.messages += 1
}

const byDay = new Map()
const byModel = new Map()
const byProject = new Map()
const total = blank()
const sessions = new Set()

for (const file of findTranscripts(kRoot)) {
  // The project directory name is the slugified working directory.
  const project = path.basename(path.dirname(file))
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    const usage = record.message?.usage
    if (!usage) continue

    const day = (record.timestamp ?? '').slice(0, 10)
    if (sinceDate && day < sinceDate) continue

    const model = record.message?.model ?? 'unknown'
    for (const [map, key] of [
      [byDay, day],
      [byModel, model],
      [byProject, project],
    ]) {
      if (!map.has(key)) map.set(key, blank())
      add(map.get(key), usage)
    }
    add(total, usage)
    if (record.sessionId) sessions.add(record.sessionId)
  }
}

const fmt = (n) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(2)}B`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(1)}M`
      : n >= 1e3
        ? `${(n / 1e3).toFixed(1)}k`
        : String(n)

if (asCsv) {
  console.log('date,messages,input,output,cache_read,cache_write')
  for (const [day, t] of [...byDay].sort()) {
    console.log(
      [day, t.messages, t.input, t.output, t.cacheRead, t.cacheWrite].join(','),
    )
  }
  process.exit(0)
}

const table = (title, map, limit = 0) => {
  console.log(`\n${title}`)
  const rows = [...map].sort((a, b) => b[1].output - a[1].output)
  for (const [key, t] of limit ? rows.slice(0, limit) : rows) {
    console.log(
      `  ${key.padEnd(46)} ${fmt(t.input).padStart(8)} in  ${fmt(t.output).padStart(8)} out  ${fmt(t.cacheRead).padStart(8)} cache-read`,
    )
  }
}

const days = [...byDay.keys()].sort()

// Sorted objects rather than Maps, so the file diffs cleanly between runs.
const asObject = (map, sortByOutput = false) =>
  Object.fromEntries(
    [...map]
      .sort((a, b) => (sortByOutput ? b[1].output - a[1].output : a[0] < b[0] ? -1 : 1))
      .map(([key, t]) => [key, t]),
  )

const statsPath = path.join(os.homedir(), '.claude', 'stats.json')
fs.writeFileSync(
  statsPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      generatedBy: 'usage-report.mjs',
      machine: os.hostname(),
      scope: 'Local session transcripts on this machine only. Excludes claude.ai and other devices.',
      source: path.join(os.homedir(), '.claude', 'projects'),
      filter: sinceDate ? { since: sinceDate } : null,
      range: { from: days[0] ?? null, to: days[days.length - 1] ?? null, days: days.length },
      totals: { sessions: sessions.size, ...total },
      byModel: asObject(byModel, true),
      byProject: asObject(byProject, true),
      byDay: asObject(byDay),
    },
    null,
    2,
  ) + '\n',
)

console.log('Claude Code usage from local transcripts (this machine only)')
console.log(`  range      ${days[0] ?? 'n/a'} to ${days[days.length - 1] ?? 'n/a'}`)
console.log(`  sessions   ${sessions.size}`)
console.log(`  messages   ${total.messages}`)
console.log(
  `  tokens     ${fmt(total.input)} in, ${fmt(total.output)} out, ${fmt(total.cacheRead)} cache-read, ${fmt(total.cacheWrite)} cache-write`,
)

table('By model', byModel)
table('By project (top 10)', byProject, 10)
table('Busiest days (top 10)', byDay, 10)

console.log(`\nFull breakdown written to ${statsPath}`)
