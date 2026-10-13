import { expect, test } from 'claude-code/testing'

import type { Folder, Memory } from '../types'
import {
  consumeSegment,
  findOverdue,
  formatChars,
  formatTokens,
  librarySummary,
  mirrorStatus,
  overdueIn,
  search,
  tildePath,
} from './library'

const memory = (name: string, extra: Partial<Memory> = {}): Memory => ({
  name,
  title: name,
  type: 'feedback',
  description: '',
  body: '',
  modified: '2026-10-01',
  ...extra,
})

const folder = (id: string, memories: Memory[], extra: Partial<Folder> = {}): Folder => ({
  project: `~/${id}`,
  folder: `/m/${id}`,
  memories,
  indexed: memories.length,
  unindexed: [],
  missing: [],
  id,
  isCurrent: false,
  indexChars: 100,
  mirrorGaps: [],
  ...extra,
})

test('takes one directory name off the front of an encoded project folder', () => {
  expect(consumeSegment('-Users-me-Projects-rosebud-react', 'Users')).toBe('-me-Projects-rosebud-react')
  expect(consumeSegment('-rosebud-react', 'rosebud')).toBe('-react')
  expect(consumeSegment('-rosebud-react', 'rosebud-react')).toBe('')
  expect(consumeSegment('--slack-agent-workspace', '.slack-agent')).toBe('-workspace')
  expect(consumeSegment('-rosebudx', 'rosebud')).toBeUndefined()
})

test('finds due dates that have passed, and only those', () => {
  const at = (body: string, modified = '2026-10-09') => overdueIn(memory('m', { body, modified }), '2026-10-13')
  expect(at('- Check due 10-10 (Monte asked).')).toEqual([{ date: '2026-10-10', line: 'Check due 10-10 (Monte asked).' }])
  expect(at('tap rate by writer due on the 10-10 UTC day').map(item => item.date)).toEqual(['2026-10-10'])
  expect(at('A ticket due 2026-09-30 for the move.').map(item => item.date)).toEqual(['2026-09-30'])
  expect(at('Ship it, due 2999-01-01.')).toEqual([])
  expect(at('The report was due; unconfirmed as of 10-10.')).toEqual([])
  expect(at('Released 10-10 with no due date.')).toEqual([])
  const long = at(`${'Background that runs on and on. '.repeat(30)}Check due 10-10 (asked).`)
  expect(long[0]?.line).toContain('Check due 10-10')
  expect(long[0]?.line.startsWith('…')).toBe(true)
})

test('gives a yearless due date the next year when it falls months before the memory', () => {
  const late = overdueIn(memory('m', { body: 'Renew, due 01-05.', modified: '2026-12-20' }), '2027-01-10')
  expect(late.map(item => item.date)).toEqual(['2027-01-05'])
})

test('lists overdue items most recently missed first, and skips symlinked copies', () => {
  const source = folder('-a', [
    memory('old', { body: 'due 2026-09-01' }),
    memory('new', { body: 'due 2026-10-10' }),
  ])
  const mirror = folder('-b', [memory('new', { linkTo: '-a' })])
  const overdue = findOverdue([source, mirror], '2026-10-13')
  expect(overdue.map(item => [item.name, item.daysLate])).toEqual([
    ['new', 3],
    ['old', 42],
  ])
})

test('searches titles before descriptions before bodies, case-insensitively', () => {
  const folders = [
    folder('-a', [
      memory('in_body', { title: 'Zeta', body: 'Before anything, the Release checklist lives here.' }),
      memory('in_title', { title: 'Release notes' }),
      memory('in_description', { title: 'Alpha', description: 'How a release goes out' }),
      memory('linked', { title: 'Release copy', linkTo: '-b' }),
    ]),
  ]
  const hits = search(folders, 'RELEASE')
  expect(hits.map(hit => [hit.name, hit.where])).toEqual([
    ['in_title', 'title'],
    ['in_description', 'description'],
    ['in_body', 'body'],
  ])
  expect(hits[2]?.snippet).toContain('Release checklist')
  expect(search(folders, 'r')).toEqual([])
})

test('flags a mirror missing files of a type it already links, not types it skips', () => {
  const source = folder('-src', [
    memory('feedback_a', { type: 'feedback' }),
    memory('feedback_b', { type: 'feedback' }),
    memory('user_c', { type: 'user' }),
  ])
  const mirror = folder('-bot', [memory('feedback_a', { type: 'feedback', linkTo: '-src' })])
  expect(mirrorStatus(mirror, [source, mirror])).toEqual({ mirrorOf: '-src', mirrorGaps: ['feedback_b.md'] })
  expect(mirrorStatus(source, [source, mirror])).toEqual({ mirrorGaps: [] })
})

test('writes sizes and paths the way a reader says them', () => {
  expect(formatChars(940)).toBe('940 B')
  expect(formatChars(8681)).toBe('8.7 KB')
  expect(formatChars(341_000)).toBe('341 KB')
  expect(formatTokens(8681)).toBe('~2.2k tokens')
  expect(tildePath('/Users/me/Projects/app', '/Users/me')).toBe('~/Projects/app')
  expect(tildePath('/opt/app', '/Users/me')).toBe('/opt/app')
})

test('summarizes the whole library in one line', () => {
  const current = folder('-app', [memory('a', { body: 'due 2026-10-01' }), memory('b')], { isCurrent: true, project: '~/app' })
  const other = folder('-x', [memory('c')], { unindexed: ['c.md'] })
  expect(librarySummary({ home: '/h', folders: [current, other], emptyFolders: 0, estimatedLoad: [] }, '2026-10-13')).toBe(
    'Memory: 3 memories in 2 folders, ~/app has 2, 1 overdue, 1 index problem. Details in the Memory pane.',
  )
})
