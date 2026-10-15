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
  isAtLeast,
  librarySummary,
  libraryText,
  mirrorStatus,
  plural,
  rereadNudge,
  SCALED_SINCE,
  search,
  tildePath,
  typeScale,
} from './library'
import { buildReport, formatDay, sectionsOf } from './summary'
import type { MemoryFile } from './summary'

const PANE = 'view-memory'
const TOP: View = { folder: null, section: null, memory: null, file: null, query: '', fromTop: false }
const library = atom({ plugin: 'view-memory', key: 'library' } as const, null)
const view = atom({ plugin: 'view-memory', key: 'view' } as const, TOP)
const measured = atom({ plugin: 'view-memory', key: 'measured' } as const, null)
const opened = atom({ plugin: 'view-memory', key: 'opened' } as const, null)
const reread = atom({ plugin: 'view-memory', key: 'reread' } as const, null)
const isNudged = atom({ plugin: 'view-memory', key: 'isNudged' } as const, false)

/** `text` cut to `max` characters, never under 12 so a narrow pane still names things; `keep: 'end'` keeps a path's file name. */
const clip = (text: string, max: number, keep: 'start' | 'end' = 'start'): string => {
  const room = Math.max(12, max)
  if (text.length <= room) return text
  return keep === 'start' ? `${text.slice(0, room - 1).trimEnd()}…` : `…${text.slice(text.length - room + 1)}`
}

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

/** Reads how many tokens each reply re-reads now; free, no request sent. */
async function measureReread($: Engine): Promise<number> {
  const tokens = (await $.session.usage()).context.tokens ?? 0
  await update($, reread, () => tokens)
  return tokens
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'view-memory',
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

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    try {
      const nudge = rereadNudge(await measureReread($))
      if (nudge && !(await read($, isNudged))) {
        await update($, isNudged, () => true)
        await $.ui.toast(nudge)
      }
    } catch (reason) {
      $.ui.log(`view-memory: ${String(reason)}`)
    }
    return result
  })

  on('command.run', { command: 'view-memory' }, async $ => {
    await measureReread($).catch(() => undefined)
    const current = await refresh($)
    if (!current) return { text: 'No auto-memory folders yet.' }
    await update($, view, () => TOP)
    const today = new Date().toISOString().slice(0, 10)
    const shown = await $.ui.open({ id: PANE, title: 'Memory', focus: true })
    if (!shown.isPlaced) return { text: libraryText(current, today) }
    return { text: `${librarySummary(current, today)} Details in the Memory pane.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    const lib = await read($, library)
    if (lib === null) return <Text dimColor>Run /view-memory to load your memory.</Text>

    const at = await read($, view)
    const go = async (next: View, focusKey: string) => {
      await update($, view, () => next)
      // The pressed Button leaves the drawing, so without this the pane loses the keyboard and the next click only takes it back.
      await $.ui.focus({ requestId: PANE, key: focusKey }).catch(() => undefined)
    }
    const today = new Date().toISOString().slice(0, 10)
    const nameOf = (id: string | undefined) => lib.folders.find(folder => folder.id === id)?.project ?? id ?? ''
    const load = (await read($, measured)) ?? lib.estimatedLoad
    const scale = await $.session
      .version()
      .then(({ base, version }) => typeScale(isAtLeast(base ?? version, SCALED_SINCE)))
      .catch(() => typeScale(false))
    // A Button whose label is wider than its room is not drawn at all, so labels are cut to the pane's width.
    const room = e.props.bodyColumns

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
            <Button key="close" label="Close" role="dismiss" onPress={back} />
          </Box>
          <Box flexDirection="column" rowGap={1} borderStyle="round" borderColor="claude" paddingX={2} paddingY={1}>
            <Box flexDirection="column">
              <Text {...scale.title} {...scale.path}>
                {tildePath(at.file, lib.home)}
              </Text>
              <Text dimColor {...scale.meta}>
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
                {clip(folder.project, room - 44, 'end')}
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
            <Box columnGap={1}>
              <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
              <Button key="close" label="Close" role="dismiss" onPress={close} />
            </Box>
          </Box>
          <Box flexDirection="column" rowGap={1} borderStyle="round" borderColor="claude" paddingX={2} paddingY={1}>
            <Box flexDirection="column">
              <Text {...scale.title}>{memory.title}</Text>
              <Text dimColor {...scale.meta}>
                {section.label} · updated {formatDay(memory.modified, today)} · <Text {...scale.path}>{memory.name}.md</Text>
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
              {`‹ ${clip(folder.project, room - 16, 'end')}`}
            </Button>
            <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
          </Box>
          <Box flexDirection="column">
            <Text {...scale.title}>
              {section.label} <Text dimColor>· {plural(section.memories.length, 'memory', 'memories')}</Text>
            </Text>
            <Text dimColor {...scale.meta}>
              {section.blurb}
            </Text>
          </Box>
          {section.memories.length === 0 && <Text dimColor>Nothing saved here yet.</Text>}
          {section.memories.map(m => (
            <Box key={`row-${m.name}`} {...card}>
              <Box justifyContent="space-between" columnGap={2}>
                <Button
                  key={`mem-${m.name}`}
                  {...link}
                  label={`${clip(m.title, room - 22)} ›`}
                  onPress={() => go({ ...TOP, folder: folder.id, section: section.type, memory: m.name, query: at.query }, 'close')}
                />
                <Text dimColor {...scale.meta}>
                  {formatDay(m.modified, today)}
                  {m.linkTo ? ' · symlink' : ''}
                </Text>
              </Box>
              {m.description !== '' && (
                <Text dimColor {...scale.meta} wrap="truncate-end">
                  {m.description}
                </Text>
              )}
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
            <Text {...scale.title}>{folder.project}</Text>
            <Text dimColor {...scale.meta}>
              {plural(folder.memories.length, 'memory', 'memories')}
              {folder.isCurrent ? ' · this project' : ''} · index {formatChars(folder.indexChars)} ·{' '}
              {issues.length === 0 ? (
                <Text color="success">healthy</Text>
              ) : (
                <Text color="warning">{plural(issues.length, 'problem')}</Text>
              )}
            </Text>
            {folder.mirrorOf && (
              <Text dimColor {...scale.meta}>
                Mostly symlinks into {nameOf(folder.mirrorOf)}
              </Text>
            )}
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
                <Text dimColor {...scale.count}>
                  {plural(s.memories.length, 'memory', 'memories')}
                </Text>
              </Box>
              <Text dimColor {...scale.meta}>
                {s.blurb}
              </Text>
              {s.latest && (
                <Text dimColor {...scale.meta} wrap="truncate-end">
                  Latest: {s.latest.title}, {formatDay(s.latest.modified, today)}
                </Text>
              )}
            </Box>
          ))}
          <Text dimColor {...scale.meta} {...scale.path} wrap="truncate-start">
            {folder.folder}
          </Text>
        </Box>
      )
    }

    const nudge = rereadNudge((await read($, reread)) ?? 0)
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
            <Text {...scale.title}>Memory</Text>
            <Text dimColor {...scale.meta}>
              {plural(total, 'memory', 'memories')} in {plural(lib.folders.length, 'folder')}
            </Text>
          </Box>
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
        </Box>
        {nudge && (
          <Box borderStyle="round" borderColor="warning" paddingX={1}>
            <Text color="warning">{nudge}</Text>
          </Box>
        )}
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
              <Text {...scale.heading}>
                {plural(hits.length, 'match', 'matches')} for “{clip(at.query, 40)}”
              </Text>
              <Button key="clear-search" plain dimColor label="Clear" onPress={() => go(TOP, 'search')} />
            </Box>
            {hits.length === 0 && <Text dimColor>Nothing matches. Try a shorter word.</Text>}
            {hits.map(hit => (
              <Box key={`hitrow-${hit.folder}-${hit.name}`} {...card}>
                <Box justifyContent="space-between" columnGap={2}>
                  <Button
                    key={`hit-${hit.folder}-${hit.name}`}
                    {...link}
                    label={`${clip(hit.title, room - 42)} ›`}
                    onPress={() => openFromTop(hit.folder, hit.name)}
                  />
                  <Text dimColor {...scale.meta}>
                    {clip(nameOf(hit.folder), 32, 'end')}
                  </Text>
                </Box>
                {hit.snippet !== '' && (
                  <Text dimColor {...scale.meta}>
                    {hit.snippet}
                  </Text>
                )}
              </Box>
            ))}
          </Box>
        )}

        {at.query === '' && overdue.length > 0 && (
          <Box flexDirection="column" rowGap={1}>
            <Text {...scale.heading} color="warning">
              Overdue · {overdue.length}
            </Text>
            {overdue.map((item, index) => (
              <Box key={`duerow-${index}`} {...card} borderColor="warning">
                <Box justifyContent="space-between" columnGap={2}>
                  <Button
                    key={`due-${index}`}
                    {...link}
                    label={`${clip(item.title, room - 34)} ›`}
                    onPress={() => openFromTop(item.folder, item.name)}
                  />
                  <Text color="warning" {...scale.count}>
                    {describeDue(item, today)}
                  </Text>
                </Box>
                <Text dimColor {...scale.meta}>
                  {item.line}
                </Text>
                {lib.folders.length > 1 && (
                  <Text dimColor {...scale.meta}>
                    {nameOf(item.folder)}
                  </Text>
                )}
              </Box>
            ))}
          </Box>
        )}

        {at.query === '' && (
          <Box flexDirection="column" rowGap={1}>
            <Text {...scale.heading}>Folders</Text>
            {lib.folders.map(f => {
              const problems = f.unindexed.length + f.missing.length + f.mirrorGaps.length
              const latest = [...f.memories].sort((a, b) => b.modified.localeCompare(a.modified))[0]
              return (
                <Box key={`folderrow-${f.id}`} {...card}>
                  <Box justifyContent="space-between" columnGap={2}>
                    <Button
                      key={`folder-${f.id}`}
                      {...link}
                      label={`${clip(f.project, room - 22, 'end')} ›`}
                      onPress={() => go({ ...TOP, folder: f.id, query: at.query }, `type-${sectionsOf(f)[0]?.type ?? 'user'}`)}
                    />
                    <Text dimColor {...scale.count}>
                      {plural(f.memories.length, 'memory', 'memories')}
                    </Text>
                  </Box>
                  <Text dimColor {...scale.meta}>
                    {f.isCurrent ? 'This project · ' : ''}
                    {f.mirrorOf ? `symlinks into ${nameOf(f.mirrorOf)} · ` : `index ${formatChars(f.indexChars)} · `}
                    {problems === 0 ? <Text color="success">healthy</Text> : <Text color="warning">{plural(problems, 'problem')}</Text>}
                  </Text>
                  {latest && (
                    <Text dimColor {...scale.meta} wrap="truncate-end">
                      Latest: {latest.title}, {formatDay(latest.modified, today)}
                    </Text>
                  )}
                </Box>
              )
            })}
            {lib.emptyFolders > 0 && (
              <Text dimColor {...scale.meta}>
                {plural(lib.emptyFolders, 'empty memory folder')} hidden
              </Text>
            )}
          </Box>
        )}

        {at.query === '' && load.length > 0 && (
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
            <Box justifyContent="space-between" columnGap={2}>
              <Text {...scale.heading}>Loaded into every session here</Text>
              <Text dimColor {...scale.count}>
                {formatChars(loadChars)} · {formatTokens(loadChars)}
              </Text>
            </Box>
            {load.map((file, index) => (
              <Box key={`loadrow-${index}`} justifyContent="space-between" columnGap={2}>
                <Button
                  key={`load-${index}`}
                  {...link}
                  label={`${clip(tildePath(file.path, lib.home), room - 26, 'end')} ›`}
                  onPress={() => openFile(file)}
                />
                <Text dimColor {...scale.count}>
                  {file.kind} · {formatChars(file.chars)}
                </Text>
              </Box>
            ))}
            <Text dimColor {...scale.meta}>
              {isMeasured ? 'As this session loaded them.' : 'Estimated from the files on disk; exact once a new session starts with this mod on.'}
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}
