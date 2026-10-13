import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = '/home/me'
const DIR = `${HOME}/.claude/projects/-work-demo/memory`

const memory = (type: string, description: string, body: string) =>
  `---\nname: x\ndescription: "${description}"\nmetadata:\n  type: ${type}\n  modified: 2026-10-07T12:00:00Z\n---\n\n${body}`

const FILES: Record<string, string> = {
  'user_role.md': memory('user', 'Who the person is', 'Engineer.'),
  'feedback_style.md': memory('feedback', 'How to write prose', 'Short sentences.'),
  'MEMORY.md': '- [Role](user_role.md) — x\n- [Writing style](feedback_style.md) — y',
}

/** Answers the plugin's session, process and file calls with one project's memory folder. */
const fakeProject = (on: On) => {
  on('env.get', async (_$, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('session.cwd', async () => ({ value: '/work/demo' }))
  on('process.run', async () => ({ deny: 'not a git repository' }))
  on('fs.exists', async (_$, e) => ({ value: e.path === DIR || e.path.startsWith(`${DIR}/`) }))
  on('fs.list', async () => ({
    value: Object.keys(FILES).map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', async (_$, e) => ({ value: FILES[e.path.slice(DIR.length + 1)] ?? '' }))
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
  test(`${surface}: overview, then a type, then a memory, then Close`, async ($, on) => {
    fakeProject(on)
    await $.command.run({
      command: 'session-memory',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
    const ui = await $.ui.mount({
      plugin: 'session-memory',
      surface,
      component: 'Pane',
      props: PANE_PROPS,
      requestId: 'session-memory',
    })

    expect(await ui.find({ key: 'open-user' })).toBeDefined()
    expect(await ui.find({ key: 'open-user_role' })).toBeUndefined()

    await ui.press({ key: 'open-feedback' })
    expect(await ui.find({ key: 'open-feedback_style' })).toBeDefined()
    expect(await ui.find({ key: 'open-user' })).toBeUndefined()

    await ui.press({ key: 'open-feedback_style' })
    expect(await ui.find({ key: 'close' })).toBeDefined()
    expect(await ui.find({ key: 'open-feedback_style' })).toBeUndefined()
    expect(await ui.find({ text: 'Writing style' })).toBeDefined()

    await ui.press({ key: 'close' })
    expect(await ui.find({ key: 'open-feedback_style' })).toBeDefined()
    expect(await ui.find({ key: 'close' })).toBeUndefined()

    await ui.press({ key: 'back-overview' })
    expect(await ui.find({ key: 'open-user' })).toBeDefined()
  })
}
