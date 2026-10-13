import type { Memory, Report } from '../types'

export const TYPES = ['user', 'feedback', 'project', 'reference'] as const

/** A memory file as read; `linkTo` names the scanned folder it is a symlink into, `text` being that file's. */
export type MemoryFile = { name: string; text: string; mtimeMs?: number; linkTo?: string }

/** One type's memories, as the overview card and its list show them. */
export type Section = {
  type: string
  label: string
  blurb: string
  memories: Memory[]
  latest: Memory | undefined
}

const SECTION_INFO: Record<string, { label: string; blurb: string }> = {
  user: { label: 'User', blurb: 'Who you are and who you work with' },
  feedback: { label: 'Feedback', blurb: 'How you want work done: corrections and approaches you confirmed' },
  project: { label: 'Project', blurb: "Work in flight: status, decisions and what's due" },
  reference: { label: 'Reference', blurb: 'Where things live and how systems behave' },
  other: { label: 'Other', blurb: 'Files with no recognised type' },
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const field = (frontmatter: string, name: string): string => {
  const value = frontmatter.match(new RegExp(`^\\s*${name}:\\s*(.*)$`, 'm'))?.[1]
  return value ? value.trim().replace(/^"(.*)"$/, '$1') : ''
}

/** A readable title from a file name: `feedback_pr_style` reads "Pr style". */
export function titleFromName(name: string): string {
  const words = name.replace(/^(user|feedback|project|reference)[_-]/, '').replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name
}

/** The memory's type: `type:` in its frontmatter, else its `<type>_` filename prefix. */
export function typeOf(file: MemoryFile): string {
  const frontmatter = file.text.startsWith('---') ? (file.text.split('---')[1] ?? '') : ''
  const declared = field(frontmatter, 'type')
  if (/^[a-z]+$/.test(declared)) return declared
  return file.name.match(/^(user|feedback|project|reference)[_-]/)?.[1] ?? 'other'
}

/** Name, title, type, description, body and last-modified date of one memory file. */
export function parseMemory(file: MemoryFile, title?: string): Memory {
  const hasFrontmatter = file.text.startsWith('---')
  const parts = file.text.split('---')
  const frontmatter = hasFrontmatter ? (parts[1] ?? '') : ''
  const body = hasFrontmatter ? parts.slice(2).join('---').trim() : file.text.trim()
  const name = file.name.replace(/\.md$/, '')
  const modified =
    field(frontmatter, 'modified').slice(0, 10) ||
    (file.mtimeMs ? new Date(file.mtimeMs).toISOString().slice(0, 10) : '')
  return {
    name,
    title: title || titleFromName(name),
    type: typeOf(file),
    description: field(frontmatter, 'description'),
    body: file.linkTo ? '' : body,
    modified,
    ...(file.linkTo ? { linkTo: file.linkTo } : {}),
  }
}

/** Every memory in the folder, titled by its MEMORY.md link, and how the two line up. */
export function buildReport(files: MemoryFile[], index: string, project: string, folder: string): Report {
  const titles = new Map([...index.matchAll(/\[([^\]]+)\]\(([^)\s]+\.md)\)/g)].map(([, title = '', file = '']) => [file, title]))
  const names = new Set(files.map(file => file.name))
  return {
    project,
    folder,
    memories: files.map(file => parseMemory(file, titles.get(file.name))).sort((a, b) => a.name.localeCompare(b.name)),
    indexed: titles.size,
    unindexed: files.map(file => file.name).filter(name => !titles.has(name)),
    missing: [...titles.keys()].filter(name => !names.has(name)),
  }
}

/** The four types in order, each with its memories by title and its newest; `other` only when it has any. */
export function sectionsOf(report: Report): Section[] {
  const known = TYPES as readonly string[]
  const types = [...known, ...(report.memories.some(m => !known.includes(m.type)) ? ['other'] : [])]
  return types.map(type => {
    const memories = report.memories
      .filter(m => (type === 'other' ? !known.includes(m.type) : m.type === type))
      .sort((a, b) => a.title.localeCompare(b.title))
    const latest = [...memories].sort((a, b) => b.modified.localeCompare(a.modified))[0]
    const { label, blurb } = SECTION_INFO[type] ?? { label: type, blurb: '' }
    return { type, label, blurb, memories, latest }
  })
}

/** A `YYYY-MM-DD` day as people say it, relative to `today`: "today", "yesterday", "Oct 7", "Oct 7, 2025". */
export function formatDay(day: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'date unknown'
  if (day === today) return 'today'
  if (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`) === 86_400_000) return 'yesterday'
  const short = `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`
  return day.slice(0, 4) === today.slice(0, 4) ? short : `${short}, ${day.slice(0, 4)}`
}
