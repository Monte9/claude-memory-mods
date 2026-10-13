import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Report, View } from '../types'
import { buildReport, formatDay, sectionsOf, summaryLine } from './summary'
import type { MemoryFile } from './summary'

const PANE = 'session-memory'
const OVERVIEW: View = { section: null, memory: null }
const report = atom({ plugin: 'session-memory', key: 'report' } as const, null)
const view = atom({ plugin: 'session-memory', key: 'view' } as const, OVERVIEW)

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`

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
    await update($, view, () => OVERVIEW)
    await $.ui.open({ id: PANE, title: 'Memory' })
    return { text: summaryLine(current) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const current = await read($, report)
    if (current === null) return <Text dimColor>Run /session-memory to load this project's memory.</Text>

    const at = await read($, view)
    const go = (next: View) => update($, view, () => next)
    const today = new Date().toISOString().slice(0, 10)
    const sections = sectionsOf(current)
    const memory = current.memories.find(m => m.name === at.memory)
    const section = sections.find(s => (memory ? s.memories.includes(memory) : s.type === at.section))
    const issues = [
      ...current.unindexed.map(name => `${name} isn't linked from MEMORY.md`),
      ...current.missing.map(name => `MEMORY.md links ${name}, which doesn't exist`),
    ]

    if (memory && section) {
      const toList = () => go({ section: section.type, memory: null })
      return (
        <Box flexDirection="column" rowGap={1}>
          <Box justifyContent="space-between" alignItems="center">
            <Box columnGap={1}>
              <Button key="crumb-overview" plain dimColor onPress={() => go(OVERVIEW)}>
                Memory
              </Button>
              <Text dimColor>›</Text>
              <Button key="crumb-section" plain dimColor onPress={toList}>
                {section.label}
              </Button>
            </Box>
            <Button key="close" label="Close" onPress={toList} />
          </Box>
          <Box flexDirection="column" rowGap={1} borderStyle="round" borderColor="claude" paddingX={2} paddingY={1}>
            <Box flexDirection="column">
              <Text bold>{memory.title}</Text>
              <Text dimColor>
                {section.label} · updated {formatDay(memory.modified, today)} · {memory.name}.md
              </Text>
            </Box>
            {memory.description !== '' && (
              <Text italic dimColor>
                {memory.description}
              </Text>
            )}
            <Markdown text={memory.body} />
          </Box>
        </Box>
      )
    }

    if (section) {
      return (
        <Box flexDirection="column" rowGap={1}>
          <Box justifyContent="space-between" alignItems="center">
            <Button key="back-overview" plain dimColor onPress={() => go(OVERVIEW)}>
              ‹ All memory
            </Button>
            <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
          </Box>
          <Box flexDirection="column">
            <Text bold>
              {section.label} <Text dimColor>· {plural(section.memories.length, 'memory', 'memories')}</Text>
            </Text>
            <Text dimColor>{section.blurb}</Text>
          </Box>
          {section.memories.length === 0 && <Text dimColor>Nothing saved here yet.</Text>}
          {section.memories.map(m => (
            <Box
              key={`row-${m.name}`}
              flexDirection="column"
              borderStyle="round"
              borderColor="subtle"
              hover={{ borderColor: 'claude' }}
              paddingX={1}
            >
              <Box justifyContent="space-between" columnGap={2}>
                <Button
                  key={`open-${m.name}`}
                  plain
                  label={`${m.title} ›`}
                  hover={{ color: 'claude', bold: true }}
                  onPress={() => go({ section: section.type, memory: m.name })}
                />
                <Text dimColor>{formatDay(m.modified, today)}</Text>
              </Box>
              {m.description !== '' && <Text dimColor>{clip(m.description, 160)}</Text>}
            </Box>
          ))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box justifyContent="space-between" alignItems="center">
          <Box flexDirection="column">
            <Text bold>{current.project}</Text>
            <Text dimColor>
              {plural(current.memories.length, 'memory', 'memories')} ·{' '}
              {issues.length === 0 ? (
                <Text color="success">index clean</Text>
              ) : (
                <Text color="warning">{plural(issues.length, 'index problem')}</Text>
              )}
            </Text>
          </Box>
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
        </Box>
        {issues.length > 0 && (
          <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
            {issues.map(issue => (
              <Text color="warning">{issue}</Text>
            ))}
          </Box>
        )}
        {sections.map(s => (
          <Box
            key={`card-${s.type}`}
            flexDirection="column"
            borderStyle="round"
            borderColor="subtle"
            hover={{ borderColor: 'claude' }}
            paddingX={1}
          >
            <Box justifyContent="space-between" columnGap={2}>
              <Button
                key={`open-${s.type}`}
                plain
                label={`${s.label} ›`}
                hover={{ color: 'claude', bold: true }}
                onPress={() => go({ section: s.type, memory: null })}
              />
              <Text dimColor>{plural(s.memories.length, 'memory', 'memories')}</Text>
            </Box>
            <Text dimColor>{s.blurb}</Text>
            {s.latest && (
              <Text dimColor>
                Latest: {s.latest.title}, {formatDay(s.latest.modified, today)}
              </Text>
            )}
          </Box>
        ))}
        <Text dimColor>{current.folder}</Text>
      </Box>
    )
  })
}
