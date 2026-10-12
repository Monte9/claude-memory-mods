import type { Memory, Report } from '../types'

export const TYPES = ['user', 'feedback', 'project', 'reference'] as const

export type MemoryFile = { name: string; text: string; mtimeMs?: number }

const field = (frontmatter: string, name: string): string => {
  const match = frontmatter.match(new RegExp(`^\\s*${name}:\\s*(.*)$`, 'm'))
  return match ? match[1].trim().replace(/^"(.*)"$/, '$1') : ''
}

/** The memory's type: `type:` in its frontmatter, else its `<type>_` filename prefix. */
export function typeOf(file: MemoryFile): string {
  const frontmatter = file.text.startsWith('---') ? (file.text.split('---')[1] ?? '') : ''
  const declared = field(frontmatter, 'type')
  if (/^[a-z]+$/.test(declared)) return declared
  const prefix = file.name.match(/^(user|feedback|project|reference)[_-]/)
  return prefix ? prefix[1] : 'other'
}

/** Name, type, description, body and last-modified date of one memory file. */
export function parseMemory(file: MemoryFile): Memory {
  const hasFrontmatter = file.text.startsWith('---')
  const parts = file.text.split('---')
  const frontmatter = hasFrontmatter ? (parts[1] ?? '') : ''
  const body = hasFrontmatter ? parts.slice(2).join('---').trim() : file.text.trim()
  const modified =
    field(frontmatter, 'modified').slice(0, 10) ||
    (file.mtimeMs ? new Date(file.mtimeMs).toISOString().slice(0, 10) : '')
  return {
    name: file.name.replace(/\.md$/, ''),
    type: typeOf(file),
    description: field(frontmatter, 'description'),
    body,
    modified,
  }
}

/** Every memory in the folder, and how they line up with the links in MEMORY.md. */
export function buildReport(files: MemoryFile[], index: string, project: string, folder: string): Report {
  const linked = new Set([...index.matchAll(/\]\(([^)\s]+\.md)\)/g)].map(match => match[1]))
  const names = new Set(files.map(file => file.name))
  return {
    project,
    folder,
    memories: files.map(parseMemory).sort((a, b) => a.name.localeCompare(b.name)),
    indexed: linked.size,
    unindexed: files.map(file => file.name).filter(name => !linked.has(name)),
    missing: [...linked].filter(name => !names.has(name)),
  }
}

/** One line for the command's reply: counts by type and whether the index is clean. */
export function summaryLine(report: Report): string {
  const counts = TYPES.map(type => `${report.memories.filter(m => m.type === type).length} ${type}`)
  const other = report.memories.filter(m => !(TYPES as readonly string[]).includes(m.type)).length
  if (other) counts.push(`${other} other`)
  const issues = report.unindexed.length + report.missing.length
  const index = issues ? `${issues} index ${issues === 1 ? 'problem' : 'problems'}` : 'index clean'
  return `${report.project}: ${report.memories.length} memories (${counts.join(' · ')}), ${index}. Details in the Memory pane.`
}
