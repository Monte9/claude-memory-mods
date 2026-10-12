import { expect, test } from 'claude-code/testing'

import { buildReport, parseMemory, summaryLine, typeOf } from './summary'

const memory = (type: string, extra = '') =>
  `---\nname: x\ndescription: "A short line"\nmetadata:\n  type: ${type}\n${extra}---\n\nThe body.`

test('reads the type from frontmatter, then from the filename prefix', () => {
  expect(typeOf({ name: 'whatever.md', text: memory('project') })).toBe('project')
  expect(typeOf({ name: 'reference_ci.md', text: 'no frontmatter' })).toBe('reference')
  expect(typeOf({ name: 'notes.md', text: 'no frontmatter' })).toBe('other')
})

test('parses description, body and the modified date', () => {
  const parsed = parseMemory({ name: 'user_a.md', text: memory('user', '  modified: 2026-10-07T14:13:24Z\n') })
  expect(parsed.name).toBe('user_a')
  expect(parsed.description).toBe('A short line')
  expect(parsed.body).toBe('The body.')
  expect(parsed.modified).toBe('2026-10-07')
})

test('flags files out of step with the index, and summarizes in one line', () => {
  const files = [
    { name: 'user_a.md', text: memory('user') },
    { name: 'feedback_b.md', text: memory('feedback') },
    { name: 'project_c.md', text: memory('project') },
  ]
  const index = '- [A](user_a.md) — x\n- [B](feedback_b.md) — y\n- [Gone](project_gone.md) — z'
  const report = buildReport(files, index, 'demo', '/m')
  expect(report.unindexed).toEqual(['project_c.md'])
  expect(report.missing).toEqual(['project_gone.md'])
  expect(summaryLine(report)).toBe(
    'demo: 3 memories (1 user · 1 feedback · 1 project · 0 reference), 2 index problems. Details in the Memory pane.',
  )
})
