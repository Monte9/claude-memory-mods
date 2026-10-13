import type { Folder, Library, Memory } from '../types'
import { formatDay } from './summary'

/** "1 memory", "3 memories". */
export const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`

/** Claude Code's project folder name for a path: every character that isn't a letter or digit becomes '-'. */
export const encodePath = (path: string): string => path.replace(/[^a-zA-Z0-9]/g, '-')

/**
 * What is left of an encoded project name once `entry`, one directory name, is
 * taken off its front as `-<entry>`; undefined when the name doesn't start with it.
 */
export function consumeSegment(rest: string, entry: string): string | undefined {
  const head = `-${encodePath(entry)}`
  if (!rest.startsWith(head)) return undefined
  const after = rest.slice(head.length)
  return after === '' || after.startsWith('-') ? after : undefined
}

/** A path under the home folder written from `~`. */
export const tildePath = (path: string, home: string): string =>
  path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path

/** Characters as a reader sizes a file: "940 B", "8.7 KB". */
export const formatChars = (chars: number): string =>
  chars < 1000 ? `${chars} B` : `${(chars / 1000).toFixed(chars < 10_000 ? 1 : 0)} KB`

/** Roughly how many tokens a model reads for that many characters. */
export const formatTokens = (chars: number): string => {
  const tokens = Math.round(chars / 4)
  return tokens < 1000 ? `~${tokens} tokens` : `~${(tokens / 1000).toFixed(1)}k tokens`
}

/** Above this many tokens re-read per reply, the session is worth saving and clearing. */
export const HEAVY_TOKENS = 150_000

/** 1.2k, 180k, 1.2M: the units Claude Code's own usage views use. */
export const formatCount = (n: number): string => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`
  return String(Math.round(n))
}

/** The nudge once each reply re-reads a heavy history; undefined below the line. */
export const rereadNudge = (tokens: number): string | undefined =>
  tokens < HEAVY_TOKENS
    ? undefined
    : `Each reply now re-reads ${formatCount(tokens)} tokens. When this topic is done: /save-memory, then /clear.`

/** One line of a memory that names a due date which has passed. */
export type Overdue = {
  folder: string
  name: string
  title: string
  date: string
  daysLate: number
  line: string
}

/** About `width` characters of `text` centred on a match at `at`, flattened to one line, with ellipses where cut. */
const snippetAround = (text: string, at: number, length: number, width = 140): string => {
  const flat = text.replace(/\s+/g, ' ')
  const start = Math.max(0, at - Math.floor((width - length) / 2))
  const end = Math.min(flat.length, start + width)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`
}

const DAY_MS = 86_400_000
const DUE = /\bdue\b[^\n.;]{0,40}?\b(?:(\d{4})-)?(\d{2})-(\d{2})\b/gi

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)

/**
 * The due dates a memory's body names ("due 10-10", "due on 2026-10-10") that
 * fall before `today`. A date without a year takes the memory's own year, or
 * the next one when that would put it months before the memory was written.
 */
export function overdueIn(memory: Memory, today: string): { date: string; line: string }[] {
  const found: { date: string; line: string }[] = []
  for (const raw of memory.body.split('\n')) {
    const line = raw.replace(/^[\s>*-]+/, '').replace(/\s+/g, ' ').trim()
    for (const match of line.matchAll(DUE)) {
      const [, year, month, day] = match
      const written = /^\d{4}-\d{2}-\d{2}$/.test(memory.modified) ? memory.modified : today
      let date = `${year ?? written.slice(0, 4)}-${month}-${day}`
      if (!year && daysBetween(date, written) > 60) date = `${Number(written.slice(0, 4)) + 1}-${month}-${day}`
      if (Number.isNaN(Date.parse(date)) || date >= today) continue
      found.push({ date, line: snippetAround(line, match.index ?? 0, match[0].length, 160) })
    }
  }
  return found
}

/** Every passed due date across the folders, the most recently missed first; mirrors are skipped. */
export function findOverdue(folders: Folder[], today: string): Overdue[] {
  return folders
    .flatMap(folder =>
      folder.memories
        .filter(memory => !memory.linkTo)
        .flatMap(memory =>
          overdueIn(memory, today).map(({ date, line }) => ({
            folder: folder.id,
            name: memory.name,
            title: memory.title,
            date,
            daysLate: daysBetween(date, today),
            line,
          })),
        ),
    )
    .sort((a, b) => a.daysLate - b.daysLate)
}

/** A plain-language "due Oct 10, 3 days ago". */
export const describeDue = (item: Overdue, today: string): string =>
  `due ${formatDay(item.date, today)}, ${item.daysLate === 1 ? 'yesterday' : `${item.daysLate} days ago`}`

/** One search result: which memory, where the text matched, and the words around it. */
export type Hit = { folder: string; name: string; title: string; where: 'title' | 'description' | 'body'; snippet: string }

/**
 * Memories whose title, description or body holds `query`, case-insensitive,
 * title matches first. Mirrors are skipped so a shared file shows once.
 */
export function search(folders: Folder[], query: string, limit = 20): Hit[] {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return []
  const rank = { title: 0, description: 1, body: 2 } as const
  const hits: Hit[] = []
  for (const folder of folders) {
    for (const memory of folder.memories) {
      if (memory.linkTo) continue
      const base = { folder: folder.id, name: memory.name, title: memory.title }
      if (memory.title.toLowerCase().includes(needle)) {
        hits.push({ ...base, where: 'title', snippet: memory.description })
        continue
      }
      if (memory.description.toLowerCase().includes(needle)) {
        hits.push({ ...base, where: 'description', snippet: memory.description })
        continue
      }
      const flat = memory.body.replace(/\s+/g, ' ')
      const at = flat.toLowerCase().indexOf(needle)
      if (at >= 0) hits.push({ ...base, where: 'body', snippet: snippetAround(flat, at, needle.length) })
    }
  }
  return hits.sort((a, b) => rank[a.where] - rank[b.where] || a.title.localeCompare(b.title)).slice(0, limit)
}

/** One line for the command's reply: how much memory, this project's share, what is overdue, and index health. */
export function librarySummary(library: Library, today: string): string {
  const own = library.folders.reduce((sum, folder) => sum + folder.memories.filter(memory => !memory.linkTo).length, 0)
  const current = library.folders.find(folder => folder.isCurrent)
  const overdue = findOverdue(library.folders, today).length
  const problems = library.folders.reduce(
    (sum, folder) => sum + folder.unindexed.length + folder.missing.length + folder.mirrorGaps.length,
    0,
  )
  const parts = [`${plural(own, 'memory', 'memories')} in ${plural(library.folders.length, 'folder')}`]
  if (current) parts.push(`${current.project} has ${current.memories.length}`)
  parts.push(overdue ? `${overdue} overdue` : 'nothing overdue')
  parts.push(problems ? plural(problems, 'index problem') : 'every index clean')
  return `Memory: ${parts.join(', ')}. Details in the Memory pane.`
}

/**
 * The folder most of `folder`'s files are symlinks into, and the files of that
 * folder it leaves out among the types it already links: a mirror that shares
 * some feedback memories but not a new one has a gap, while a type it never
 * links is a choice, not a gap.
 */
export function mirrorStatus(folder: Folder, folders: Folder[]): { mirrorOf?: string; mirrorGaps: string[] } {
  const linked = folder.memories.filter(memory => memory.linkTo)
  if (linked.length === 0 || linked.length * 2 < folder.memories.length) return { mirrorGaps: [] }
  const counts = new Map<string, number>()
  for (const memory of linked) counts.set(memory.linkTo ?? '', (counts.get(memory.linkTo ?? '') ?? 0) + 1)
  const [mirrorOf] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  const source = folders.find(other => other.id === mirrorOf)
  if (!mirrorOf || !source) return { mirrorGaps: [] }
  const names = new Set(linked.filter(memory => memory.linkTo === mirrorOf).map(memory => memory.name))
  const types = new Set(linked.filter(memory => memory.linkTo === mirrorOf).map(memory => memory.type))
  const mirrorGaps = source.memories
    .filter(memory => !memory.linkTo && types.has(memory.type) && !names.has(memory.name))
    .map(memory => `${memory.name}.md`)
  return { mirrorOf, mirrorGaps }
}
