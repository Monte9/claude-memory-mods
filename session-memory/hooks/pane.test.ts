import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = '/home/me'
const PROJECTS = `${HOME}/.claude/projects`
const APP = `${PROJECTS}/-work-demo/memory`
const BOT = `${PROJECTS}/-home-me--bot-ws/memory`
const EMPTY = `${PROJECTS}/-tmp-empty/memory`

const memory = (type: string, description: string, body: string) =>
  `---\nname: x\ndescription: "${description}"\nmetadata:\n  type: ${type}\n  modified: 2026-10-07T12:00:00Z\n---\n\n${body}`

const FILES: Record<string, string> = {
  [`${APP}/user_role.md`]: memory('user', 'Who the person is', 'Engineer.'),
  [`${APP}/feedback_style.md`]: memory('feedback', 'How to write prose', 'Short sentences.'),
  [`${APP}/feedback_tone.md`]: memory('feedback', 'Tone', 'Plain words.'),
  [`${APP}/project_launch.md`]: memory('project', 'The launch', 'Ship check due 2020-01-15.'),
  [`${APP}/MEMORY.md`]:
    '- [Role](user_role.md)\n- [Writing style](feedback_style.md)\n- [Tone](feedback_tone.md)\n- [Launch](project_launch.md)',
  [`${BOT}/MEMORY.md`]: '- [Writing style](feedback_style.md)',
  [`${HOME}/.claude/CLAUDE.md`]: 'Global rules.',
}
const LINKS: Record<string, string> = { [`${BOT}/feedback_style.md`]: `${APP}/feedback_style.md` }
const DIRS: Record<string, string[]> = {
  '/': ['home', 'work', 'tmp'],
  '/home': ['me'],
  '/home/me': ['.bot', '.claude'],
  '/home/me/.bot': ['ws'],
  '/work': ['demo'],
  [PROJECTS]: ['-work-demo', '-home-me--bot-ws', '-tmp-empty'],
}

const entry = (name: string, kind: 'file' | 'dir', isLink = false) => ({ name, kind, size: 1, mtimeMs: 0, isLink })

/** Answers the plugin's calls with a home folder holding a project, a mirror of it missing one file, and an empty folder. */
const fakeHome = (on: On) => {
  on('env.get', async (_$, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('session.cwd', async () => ({ value: '/work/demo' }))
  on('process.run', async () => ({ deny: 'not a git repository' }))
  on('fs.exists', async (_$, e) => ({
    value: e.path in FILES || [PROJECTS, APP, BOT, EMPTY].includes(e.path),
  }))
  on('fs.list', async (_$, e) => {
    const dirs = DIRS[e.path]
    if (dirs) return { value: dirs.map(name => entry(name, 'dir')) }
    const inFolder = (folder: string) =>
      [...Object.keys(FILES), ...Object.keys(LINKS)]
        .filter(path => path.startsWith(`${folder}/`))
        .map(path => entry(path.slice(folder.length + 1), 'file', path in LINKS))
    return { value: [APP, BOT, EMPTY].includes(e.path) ? inFolder(e.path) : [] }
  })
  on('fs.stat', async (_$, e) => ({
    value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: e.path in LINKS, realPath: LINKS[e.path] ?? e.path, resolve: true },
  }))
  on('fs.read', async (_$, e) => ({ value: FILES[LINKS[e.path] ?? e.path] ?? '' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
}

const PANE_PROPS = {
  title: 'Memory',
  isFocused: false,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: overdue and folders up top, a folder's health, then a type, a memory and Close`, async ($, on) => {
    fakeHome(on)
    const reply = await $.command.run({
      command: 'session-memory',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
    expect(reply.text).toContain('1 overdue')
    const ui = await $.ui.mount({ plugin: 'session-memory', surface, component: 'Pane', props: PANE_PROPS, requestId: 'session-memory' })

    expect(await ui.find({ key: 'search' })).toBeDefined()
    expect((await ui.find({ key: 'due-0' }))?.text).toContain('Launch')
    expect((await ui.find({ key: 'folder--work-demo' }))?.text).toContain('/work/demo')
    expect((await ui.find({ key: 'folder--home-me--bot-ws' }))?.text).toContain('~/.bot/ws')
    expect(await ui.find({ text: /1 empty memory folder hidden/ })).toBeDefined()
    expect(await ui.find({ text: /Loaded into every session here/ })).toBeDefined()

    expect((await ui.find({ key: 'load-0' }))?.text).toContain('~/.claude/CLAUDE.md')
    await ui.press({ key: 'load-0' })
    expect(await ui.find({ text: /Global rules/ })).toBeDefined()
    await ui.press({ key: 'close' })
    expect(await ui.find({ key: 'load-0' })).toBeDefined()

    await ui.press({ key: 'folder--home-me--bot-ws' })
    expect(await ui.find({ text: /feedback_tone\.md isn't symlinked here/ })).toBeDefined()
    await ui.press({ key: 'back-top' })

    await ui.press({ key: 'folder--work-demo' })
    await ui.press({ key: 'type-feedback' })
    await ui.press({ key: 'mem-feedback_style' })
    expect(await ui.find({ key: 'close' })).toBeDefined()
    expect(await ui.find({ text: 'Writing style' })).toBeDefined()
    await ui.press({ key: 'close' })
    expect(await ui.find({ key: 'mem-feedback_style' })).toBeDefined()
  })

  test(`${surface}: search opens a match, and Close comes back to the results`, async ($, on) => {
    fakeHome(on)
    await $.command.run({ command: 'session-memory', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
    const ui = await $.ui.mount({ plugin: 'session-memory', surface, component: 'Pane', props: PANE_PROPS, requestId: 'session-memory' })

    await ui.input({ key: 'search', text: 'sentences' })
    expect(await ui.find({ key: 'hit--work-demo-feedback_style' })).toBeDefined()
    expect(await ui.find({ key: 'due-0' })).toBeUndefined()
    await ui.press({ key: 'hit--work-demo-feedback_style' })
    await ui.press({ key: 'close' })
    expect(await ui.find({ key: 'hit--work-demo-feedback_style' })).toBeDefined()
    await ui.press({ key: 'clear-search' })
    expect(await ui.find({ key: 'due-0' })).toBeDefined()
  })
}

test('mobile draws the browser without the search field it has no element for', async ($, on) => {
  fakeHome(on)
  await $.command.run({ command: 'session-memory', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const ui = await $.ui.mount({ plugin: 'session-memory', surface: 'mobile', component: 'Pane', props: PANE_PROPS, requestId: 'session-memory' })
  expect(await ui.find({ key: 'search' })).toBeUndefined()
  expect(await ui.find({ key: 'folder--work-demo' })).toBeDefined()
})
