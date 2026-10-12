import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type { Report } from '../types'
import { TYPES, buildReport, summaryLine } from './summary'
import type { MemoryFile } from './summary'

const PANE = 'session-memory'
const report = atom({ plugin: 'session-memory', key: 'report' } as const, null)
const selected = atom({ plugin: 'session-memory', key: 'selected' } as const, null)

const LABELS: Record<string, string> = {
  user: 'User',
  feedback: 'Feedback',
  project: 'Project',
  reference: 'Reference',
  other: 'Other',
}

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text

/** Claude Code's project folder name: every character that isn't a letter or digit becomes '-'. */
const encode = (path: string): string => path.replace(/[^a-zA-Z0-9]/g, '-')

/**
 * This project's auto-memory folder. Claude Code keys it by the git
 * repository, so worktrees share the main checkout's; failing that, the
 * session's folder or the nearest parent that has one.
 */
async function findMemoryDir($: Engine): Promise<{ dir: string; project: string } | undefined> {
  const home = await $.env.get('HOME')
  if (!home) return undefined
  const cwd = await $.session.cwd()
  const candidates: string[] = []
  const git = await $.process
    .run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd })
    .catch(() => undefined)
  if (git && git.exitCode === 0) candidates.push(git.stdout.trim().replace(/\/\.git\/?$/, ''))
  for (let dir = cwd; dir.length > 1; dir = dir.slice(0, dir.lastIndexOf('/')) || '/') {
    candidates.push(dir)
  }
  for (const candidate of candidates) {
    const dir = `${home}/.claude/projects/${encode(candidate)}/memory`
    if (await $.fs.exists(dir)) return { dir, project: candidate.split('/').pop() ?? candidate }
  }
  return undefined
}

/** Re-reads the memory folder into state; undefined when the project has none. */
async function refresh($: Engine): Promise<Report | undefined> {
  const found = await findMemoryDir($)
  if (!found) return undefined
  const files: MemoryFile[] = []
  for (const entry of await $.fs.list(found.dir)) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.md') || entry.name === 'MEMORY.md') continue
    files.push({ name: entry.name, text: await $.fs.read(`${found.dir}/${entry.name}`), mtimeMs: entry.mtimeMs })
  }
  const index = (await $.fs.exists(`${found.dir}/MEMORY.md`)) ? await $.fs.read(`${found.dir}/MEMORY.md`) : ''
  const next = buildReport(files, index, found.project, found.dir)
  await update($, report, () => next)
  return next
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-memory',
      description: "Open the Memory pane: this project's auto-memory files by type, with the index check",
    })
    return next(e)
  })

  on('command.run', { command: 'session-memory' }, async $ => {
    const current = await refresh($)
    if (!current) return { text: 'No auto-memory folder for this project yet.' }
    await $.ui.open({ id: PANE, title: 'Memory' })
    return { text: summaryLine(current) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const current = await read($, report)
    if (current === null) return <Text dimColor>Run /session-memory to load this project's memory.</Text>
    const selectedName = await read($, selected)
    const chosen = current.memories.find(memory => memory.name === selectedName)
    const issues = [
      ...current.unindexed.map(name => `${name} isn't linked from MEMORY.md`),
      ...current.missing.map(name => `MEMORY.md links ${name}, which doesn't exist`),
    ]
    const types = [...TYPES, ...(current.memories.some(m => !(TYPES as readonly string[]).includes(m.type)) ? ['other'] : [])]

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box justifyContent="space-between">
          <Text bold>
            {current.project} · {current.memories.length} memories
          </Text>
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
        </Box>
        {issues.length === 0 ? (
          <Text color="success">Index clean: every file is linked, and every link resolves.</Text>
        ) : (
          <Box flexDirection="column">
            {issues.map(issue => (
              <Text color="warning">{issue}</Text>
            ))}
          </Box>
        )}
        {types.map(type => {
          const group = current.memories.filter(memory =>
            type === 'other' ? !(TYPES as readonly string[]).includes(memory.type) : memory.type === type,
          )
          return (
            <Box key={`type-${type}`} flexDirection="column">
              <Text bold color="claude">
                {LABELS[type]} · {group.length}
              </Text>
              {group.length === 0 && <Text dimColor>none</Text>}
              {group.map(memory => (
                <Button
                  key={`memory-${memory.name}`}
                  plain
                  onPress={() => update($, selected, now => (now === memory.name ? null : memory.name))}
                >
                  {memory.name === chosen?.name ? '▾ ' : '▸ '}
                  {memory.name} <Text dimColor>{clip(memory.description, 90)}</Text>
                </Button>
              ))}
            </Box>
          )
        })}
        {chosen && (
          <Box flexDirection="column">
            <Text bold>{chosen.name}</Text>
            <Text dimColor>
              {LABELS[chosen.type] ?? chosen.type} · modified {chosen.modified || 'unknown'}
            </Text>
            <Markdown text={chosen.body} />
          </Box>
        )}
        <Text dimColor>{current.folder}</Text>
      </Box>
    )
  })
}
