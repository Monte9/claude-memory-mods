import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Folder, Library, LoadedFile, View } from '../types'
import {
  consumeSegment,
  describeDue,
  encodePath,
  findOverdue,
  formatChars,
  formatTokens,
  librarySummary,
  mirrorStatus,
  plural,
  search,
  tildePath,
} from './library'
import { buildReport, formatDay, sectionsOf } from './summary'
import type { MemoryFile } from './summary'

const PANE = 'session-memory'
const TOP: View = { folder: null, section: null, memory: null, file: null, query: '', fromTop: false }
const library = atom({ plugin: 'session-memory', key: 'library' } as const, null)
const view = atom({ plugin: 'session-memory', key: 'view' } as const, TOP)
const measured = atom({ plugin: 'session-memory', key: 'measured' } as const, null)
const opened = atom({ plugin: 'session-memory', key: 'opened' } as const, null)

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text

/**
 * The paths a session here keys its memory by, most specific first: the git
 * repository's main checkout (worktrees share it), then the session's folder
 * and each parent.
 */
async function projectRoots($: Engine): Promise<string[]> {
  const cwd = await $.session.cwd()
  const roots: string[] = []
  const git = await $.process
    .run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd })
    .catch(() => undefined)
  if (git && git.exitCode === 0) roots.push(git.stdout.trim().replace(/\/\.git\/?$/, ''))
  for (let dir = cwd; dir.length > 1; dir = dir.slice(0, dir.lastIndexOf('/')) || '/') roots.push(dir)
  return roots
}

/** The real path behind an encoded project folder name, found by matching it against the file system. */
async function decodeProject($: Engine, encoded: string): Promise<string | undefined> {
  const walk = async (dir: string, rest: string, depth: number): Promise<string | undefined> => {
    if (rest === '') return dir
    if (depth > 16) return undefined
    const entries = await $.fs.list(dir).catch(() => [])
    const options = entries
      .filter(entry => entry.kind === 'dir' || entry.isLink)
      .flatMap(entry => {
        const after = consumeSegment(rest, entry.name)
        return after === undefined ? [] : [{ name: entry.name, after }]
      })
      .sort((a, b) => a.after.length - b.after.length)
    for (const option of options) {
      const found = await walk(dir === '/' ? `/${option.name}` : `${dir}/${option.name}`, option.after, depth + 1)
      if (found) return found
    }
    return undefined
  }
  return walk('/', encoded, 0)
}

/** Reads every memory folder under ~/.claude/projects; a symlink into another of them is not read twice. */
async function scan($: Engine): Promise<Library | undefined> {
  const home = await $.env.get('HOME')
  if (!home) return undefined
  const projects = `${home}/.claude/projects`
  if (!(await $.fs.exists(projects))) return undefined
  const roots = await projectRoots($)

  type Raw = { id: string; dir: string; real: string; files: MemoryFile[]; index: string; links: { name: string; real: string }[] }
  const raws: Raw[] = []
  for (const entry of await $.fs.list(projects)) {
    if (entry.kind !== 'dir') continue
    const dir = `${projects}/${entry.name}/memory`
    if (!(await $.fs.exists(dir))) continue
    const real = (await $.fs.stat(dir, { resolve: true }).catch(() => undefined))?.realPath ?? dir
    const raw: Raw = { id: entry.name, dir, real, files: [], index: '', links: [] }
    for (const file of await $.fs.list(dir)) {
      if (!file.name.endsWith('.md')) continue
      const path = `${dir}/${file.name}`
      if (file.name === 'MEMORY.md') raw.index = await $.fs.read(path)
      else if (file.isLink) {
        const target = (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath
        if (target) raw.links.push({ name: file.name, real: target })
      } else if (file.kind === 'file') raw.files.push({ name: file.name, text: await $.fs.read(path), mtimeMs: file.mtimeMs })
    }
    raws.push(raw)
  }
  for (const raw of raws) {
    for (const link of raw.links) {
      const cut = link.real.lastIndexOf('/')
      const source = raws.find(other => other !== raw && other.real === link.real.slice(0, cut))
      const file = source?.files.find(candidate => candidate.name === link.real.slice(cut + 1))
      if (source && file) raw.files.push({ ...file, name: link.name, linkTo: source.id })
      else raw.files.push({ name: link.name, text: await $.fs.read(`${raw.dir}/${link.name}`).catch(() => '') })
    }
  }

  const currentId = roots.map(encodePath).find(id => raws.some(raw => raw.id === id && raw.files.length > 0))
  const folders: Folder[] = []
  for (const raw of raws) {
    if (raw.files.length === 0) continue
    const path = await decodeProject($, raw.id)
    const report = buildReport(raw.files, raw.index, path ? tildePath(path, home) : raw.id, raw.dir)
    folders.push({ ...report, id: raw.id, isCurrent: raw.id === currentId, indexChars: raw.index.length, mirrorGaps: [] })
  }
  for (const folder of folders) Object.assign(folder, mirrorStatus(folder, folders))
  folders.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.memories.length - a.memories.length)

  const root = roots.find(candidate => encodePath(candidate) === currentId) ?? roots[0]
  const current = raws.find(raw => raw.id === currentId)
  const candidates: [string, string][] = [
    [`${home}/.claude/CLAUDE.md`, 'user'],
    ...(root ? ([[`${root}/CLAUDE.md`, 'project'], [`${root}/.claude/CLAUDE.md`, 'project'], [`${root}/CLAUDE.local.md`, 'local']] as [string, string][]) : []),
    ...(current ? ([[`${current.dir}/MEMORY.md`, 'memory']] as [string, string][]) : []),
  ]
  const estimatedLoad: LoadedFile[] = []
  for (const [path, kind] of candidates) {
    if (await $.fs.exists(path)) estimatedLoad.push({ path, kind, chars: (await $.fs.read(path)).length })
  }
  return { home, folders, emptyFolders: raws.length - folders.length, estimatedLoad }
}

async function refresh($: Engine): Promise<Library | undefined> {
  const next = await scan($)
  if (next) await update($, library, () => next)
  return next
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-memory',
      description: 'Open the Memory pane: every auto-memory folder, with search, overdue items and health checks',
    })
    return next(e)
  })

  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    const files = result.instructionFiles ?? e.instructionFiles
    if (files) {
      await update($, measured, () => files.map(file => ({ path: file.path, kind: file.kind, chars: file.content.length }))).catch(
        () => undefined,
      )
    }
    return result
  })

  on('command.run', { command: 'session-memory' }, async $ => {
    const current = await refresh($)
    if (!current) return { text: 'No auto-memory folders yet.' }
    await update($, view, () => TOP)
    await $.ui.open({ id: PANE, title: 'Memory', focus: true })
    return { text: librarySummary(current, new Date().toISOString().slice(0, 10)) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    const lib = await read($, library)
    if (lib === null) return <Text dimColor>Run /session-memory to load your memory.</Text>

    const at = await read($, view)
    const go = async (next: View, focusKey: string) => {
      await update($, view, () => next)
      // The pressed Button leaves the drawing, so without this the pane loses the keyboard and the next click only takes it back.
      await $.ui.focus({ requestId: PANE, key: focusKey }).catch(() => undefined)
    }
    const today = new Date().toISOString().slice(0, 10)
    const nameOf = (id: string | undefined) => lib.folders.find(folder => folder.id === id)?.project ?? id ?? ''
    const load = (await read($, measured)) ?? lib.estimatedLoad

    if (at.file !== null) {
      const doc = await read($, opened)
      const text = doc?.path === at.file ? doc.text : ''
      const back = () => go({ ...TOP, query: at.query }, `load-${load.findIndex(file => file.path === at.file)}`)
      return (
        <Box flexDirection="column" rowGap={1}>
          <Box justifyContent="space-between" alignItems="center">
            <Box columnGap={1}>
              <Button key="crumb-top" plain dimColor onPress={back}>
                Memory
              </Button>
              <Text dimColor>› Loaded into every session</Text>
            </Box>
            <Button key="close" label="Close" onPress={back} />
          </Box>
          <Box flexDirection="column" rowGap={1} borderStyle="round" borderColor="claude" paddingX={2} paddingY={1}>
            <Box flexDirection="column">
              <Text bold>{tildePath(at.file, lib.home)}</Text>
              <Text dimColor>
                {doc?.kind ?? 'file'} · {formatChars(text.length)} · {formatTokens(text.length)}
              </Text>
            </Box>
            <Markdown text={text === '' ? '_Empty, or it could not be read._' : text} />
          </Box>
        </Box>
      )
    }

    const overdue = findOverdue(lib.folders, today)
    const hits = search(lib.folders, at.query)
    const folder = lib.folders.find(candidate => candidate.id === at.folder)
    const sections = folder ? sectionsOf(folder) : []
    const memory = folder?.memories.find(candidate => candidate.name === at.memory)
    const section = sections.find(candidate => (memory ? candidate.memories.includes(memory) : candidate.type === at.section))
    const card = { flexDirection: 'column', borderStyle: 'round', borderColor: 'subtle', hover: { borderColor: 'claude' }, paddingX: 1 } as const
    const link = { plain: true, hover: { color: 'claude', bold: true } } as const

    if (folder && memory && section) {
      const body = memory.linkTo
        ? (lib.folders.find(other => other.id === memory.linkTo)?.memories.find(other => other.name === memory.name)?.body ?? '')
        : memory.body
      const backTop = at.query ? `hit-${folder.id}-${memory.name}` : `due-${overdue.findIndex(item => item.folder === folder.id && item.name === memory.name)}`
      const close = () =>
        at.fromTop
          ? go({ ...TOP, query: at.query }, backTop)
          : go({ ...TOP, folder: folder.id, section: section.type, query: at.query }, `mem-${memory.name}`)
      return (
        <Box flexDirection="column" rowGap={1}>
          <Box justifyContent="space-between" alignItems="center">
            <Box columnGap={1}>
              <Button key="crumb-top" plain dimColor onPress={() => go({ ...TOP, query: at.query }, 'search')}>
                Memory
              </Button>
              <Text dimColor>›</Text>
              <Button key="crumb-folder" plain dimColor onPress={() => go({ ...TOP, folder: folder.id }, `type-${section.type}`)}>
                {clip(folder.project, 40)}
              </Button>
              <Text dimColor>›</Text>
              <Button
                key="crumb-section"
                plain
                dimColor
                onPress={() => go({ ...TOP, folder: folder.id, section: section.type }, `mem-${memory.name}`)}
              >
                {section.label}
              </Button>
            </Box>
            <Button key="close" label="Close" onPress={close} />
          </Box>
          <Box flexDirection="column" rowGap={1} borderStyle="round" borderColor="claude" paddingX={2} paddingY={1}>
            <Box flexDirection="column">
              <Text bold>{memory.title}</Text>
              <Text dimColor>
                {section.label} · updated {formatDay(memory.modified, today)} · {memory.name}.md
                {memory.linkTo ? ` · symlink into ${nameOf(memory.linkTo)}` : ''}
              </Text>
            </Box>
            {memory.description !== '' && (
              <Text italic dimColor>
                {memory.description}
              </Text>
            )}
            <Markdown text={body} />
          </Box>
        </Box>
      )
    }

    if (folder && section) {
      return (
        <Box flexDirection="column" rowGap={1}>
          <Box justifyContent="space-between" alignItems="center">
            <Button key="back-folder" plain dimColor onPress={() => go({ ...TOP, folder: folder.id }, `type-${section.type}`)}>
              {`‹ ${clip(folder.project, 50)}`}
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
            <Box key={`row-${m.name}`} {...card}>
              <Box justifyContent="space-between" columnGap={2}>
                <Button
                  key={`mem-${m.name}`}
                  {...link}
                  label={`${m.title} ›`}
                  onPress={() => go({ ...TOP, folder: folder.id, section: section.type, memory: m.name, query: at.query }, 'close')}
                />
                <Text dimColor>
                  {formatDay(m.modified, today)}
                  {m.linkTo ? ' · symlink' : ''}
                </Text>
              </Box>
              {m.description !== '' && <Text dimColor>{clip(m.description, 160)}</Text>}
            </Box>
          ))}
        </Box>
      )
    }

    if (folder) {
      const issues = [
        ...folder.unindexed.map(name => `${name} isn't linked from MEMORY.md`),
        ...folder.missing.map(name => `MEMORY.md links ${name}, which doesn't exist`),
        ...folder.mirrorGaps.map(name => `${name} isn't symlinked here, though other files of its type are`),
      ]
      return (
        <Box flexDirection="column" rowGap={1}>
          <Box justifyContent="space-between" alignItems="center">
            <Button key="back-top" plain dimColor onPress={() => go({ ...TOP, query: at.query }, `folder-${folder.id}`)}>
              ‹ All memory
            </Button>
            <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
          </Box>
          <Box flexDirection="column">
            <Text bold>{folder.project}</Text>
            <Text dimColor>
              {plural(folder.memories.length, 'memory', 'memories')}
              {folder.isCurrent ? ' · this project' : ''} · index {formatChars(folder.indexChars)} ·{' '}
              {issues.length === 0 ? (
                <Text color="success">healthy</Text>
              ) : (
                <Text color="warning">{plural(issues.length, 'problem')}</Text>
              )}
            </Text>
            {folder.mirrorOf && <Text dimColor>Mostly symlinks into {nameOf(folder.mirrorOf)}</Text>}
          </Box>
          {issues.length > 0 && (
            <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
              {issues.map(issue => (
                <Text color="warning">{issue}</Text>
              ))}
            </Box>
          )}
          {sections.map(s => (
            <Box key={`card-${s.type}`} {...card}>
              <Box justifyContent="space-between" columnGap={2}>
                <Button
                  key={`type-${s.type}`}
                  {...link}
                  label={`${s.label} ›`}
                  onPress={() =>
                    go(
                      { ...TOP, folder: folder.id, section: s.type, query: at.query },
                      s.memories[0] ? `mem-${s.memories[0].name}` : 'back-folder',
                    )
                  }
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
          <Text dimColor>{folder.folder}</Text>
        </Box>
      )
    }

    const total = lib.folders.reduce((sum, each) => sum + each.memories.filter(m => !m.linkTo).length, 0)
    const isMeasured = load !== lib.estimatedLoad
    const loadChars = load.reduce((sum, file) => sum + file.chars, 0)
    const openFromTop = (folderId: string, name: string, focusKey = 'close') =>
      go({ ...TOP, folder: folderId, memory: name, query: at.query, fromTop: true }, focusKey)
    const openFile = async (file: LoadedFile) => {
      const text = await $.fs.read(file.path).catch(() => '')
      await update($, opened, () => ({ path: file.path, kind: file.kind, text }))
      await go({ ...TOP, file: file.path, query: at.query }, 'close')
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box justifyContent="space-between" alignItems="center">
          <Box flexDirection="column">
            <Text bold>Memory</Text>
            <Text dimColor>
              {plural(total, 'memory', 'memories')} in {plural(lib.folders.length, 'folder')}
            </Text>
          </Box>
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
        </Box>
        {Input && (
          <Box width="100%">
            <Input
              key="search"
              placeholder="Search all memory"
              value={at.query}
              submitLabel="search"
              onSubmit={value => go({ ...TOP, query: value.trim() }, 'search')}
            />
          </Box>
        )}

        {at.query !== '' && (
          <Box flexDirection="column" rowGap={1}>
            <Box justifyContent="space-between" alignItems="center">
              <Text bold>
                {plural(hits.length, 'match', 'matches')} for “{clip(at.query, 40)}”
              </Text>
              <Button key="clear-search" plain dimColor label="Clear" onPress={() => go(TOP, 'search')} />
            </Box>
            {hits.length === 0 && <Text dimColor>Nothing matches. Try a shorter word.</Text>}
            {hits.map(hit => (
              <Box key={`hitrow-${hit.folder}-${hit.name}`} {...card}>
                <Box justifyContent="space-between" columnGap={2}>
                  <Button key={`hit-${hit.folder}-${hit.name}`} {...link} label={`${hit.title} ›`} onPress={() => openFromTop(hit.folder, hit.name)} />
                  <Text dimColor>{clip(nameOf(hit.folder), 32)}</Text>
                </Box>
                {hit.snippet !== '' && <Text dimColor>{hit.snippet}</Text>}
              </Box>
            ))}
          </Box>
        )}

        {at.query === '' && overdue.length > 0 && (
          <Box flexDirection="column" rowGap={1}>
            <Text bold color="warning">
              Overdue · {overdue.length}
            </Text>
            {overdue.map((item, index) => (
              <Box key={`duerow-${index}`} {...card} borderColor="warning">
                <Box justifyContent="space-between" columnGap={2}>
                  <Button key={`due-${index}`} {...link} label={`${item.title} ›`} onPress={() => openFromTop(item.folder, item.name)} />
                  <Text color="warning">{describeDue(item, today)}</Text>
                </Box>
                <Text dimColor>{item.line}</Text>
                {lib.folders.length > 1 && <Text dimColor>{nameOf(item.folder)}</Text>}
              </Box>
            ))}
          </Box>
        )}

        {at.query === '' && (
          <Box flexDirection="column" rowGap={1}>
            <Text bold>Folders</Text>
            {lib.folders.map(f => {
              const problems = f.unindexed.length + f.missing.length + f.mirrorGaps.length
              const latest = [...f.memories].sort((a, b) => b.modified.localeCompare(a.modified))[0]
              return (
                <Box key={`folderrow-${f.id}`} {...card}>
                  <Box justifyContent="space-between" columnGap={2}>
                    <Button
                      key={`folder-${f.id}`}
                      {...link}
                      label={`${clip(f.project, 50)} ›`}
                      onPress={() => go({ ...TOP, folder: f.id, query: at.query }, `type-${sectionsOf(f)[0]?.type ?? 'user'}`)}
                    />
                    <Text dimColor>{plural(f.memories.length, 'memory', 'memories')}</Text>
                  </Box>
                  <Text dimColor>
                    {f.isCurrent ? 'This project · ' : ''}
                    {f.mirrorOf ? `symlinks into ${nameOf(f.mirrorOf)} · ` : `index ${formatChars(f.indexChars)} · `}
                    {problems === 0 ? <Text color="success">healthy</Text> : <Text color="warning">{plural(problems, 'problem')}</Text>}
                  </Text>
                  {latest && (
                    <Text dimColor>
                      Latest: {latest.title}, {formatDay(latest.modified, today)}
                    </Text>
                  )}
                </Box>
              )
            })}
            {lib.emptyFolders > 0 && <Text dimColor>{plural(lib.emptyFolders, 'empty memory folder')} hidden</Text>}
          </Box>
        )}

        {at.query === '' && load.length > 0 && (
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
            <Box justifyContent="space-between" columnGap={2}>
              <Text bold>Loaded into every session here</Text>
              <Text dimColor>
                {formatChars(loadChars)} · {formatTokens(loadChars)}
              </Text>
            </Box>
            {load.map((file, index) => (
              <Box key={`loadrow-${index}`} justifyContent="space-between" columnGap={2}>
                <Button key={`load-${index}`} {...link} label={`${clip(tildePath(file.path, lib.home), 80)} ›`} onPress={() => openFile(file)} />
                <Text dimColor>
                  {file.kind} · {formatChars(file.chars)}
                </Text>
              </Box>
            ))}
            <Text dimColor>
              {isMeasured ? 'As this session loaded them.' : 'Estimated from the files on disk; exact once a new session starts with this mod on.'}
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}
