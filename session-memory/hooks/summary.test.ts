import { expect, test } from 'claude-code/testing'

import { buildReport, formatDay, parseMemory, sectionsOf, summaryLine, typeOf } from './summary'

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

test('titles a memory by its MEMORY.md link, else by its file name', () => {
  const files = [
    { name: 'feedback_pr_style.md', text: memory('feedback') },
    { name: 'reference_ci_checks.md', text: memory('reference') },
  ]
  const report = buildReport(files, '- [PR style](feedback_pr_style.md) — x', 'demo', '/m')
  expect(report.memories.map(m => m.title)).toEqual(['PR style', 'Ci checks'])
})

test('groups by type in order, sorts by title, and adds Other only when a file needs it', () => {
  const files = [
    { name: 'user_b.md', text: memory('user', '  modified: 2026-10-09T00:00:00Z\n') },
    { name: 'user_a.md', text: memory('user', '  modified: 2026-10-01T00:00:00Z\n') },
  ]
  const sections = sectionsOf(buildReport(files, '', 'demo', '/m'))
  expect(sections.map(s => s.type)).toEqual(['user', 'feedback', 'project', 'reference'])
  expect(sections[0]?.memories.map(m => m.name)).toEqual(['user_a', 'user_b'])
  expect(sections[0]?.latest?.name).toBe('user_b')
  expect(sections[1]?.latest).toBeUndefined()
  const withOther = sectionsOf(buildReport([{ name: 'notes.md', text: 'plain' }], '', 'demo', '/m'))
  expect(withOther.map(s => s.type)).toEqual(['user', 'feedback', 'project', 'reference', 'other'])
})

test('says a date the way people do', () => {
  expect(formatDay('2026-10-12', '2026-10-12')).toBe('today')
  expect(formatDay('2026-10-11', '2026-10-12')).toBe('yesterday')
  expect(formatDay('2025-12-31', '2026-01-01')).toBe('yesterday')
  expect(formatDay('2026-10-07', '2026-10-12')).toBe('Oct 7')
  expect(formatDay('2025-10-07', '2026-10-12')).toBe('Oct 7, 2025')
  expect(formatDay('', '2026-10-12')).toBe('date unknown')
})
