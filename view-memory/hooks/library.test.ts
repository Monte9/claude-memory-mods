import { expect, test } from 'claude-code/testing'

import type { Folder, Memory } from '../types'
import {
  consumeSegment,
  findOverdue,
  formatChars,
  formatCount,
  formatTokens,
  isAtLeast,
  librarySummary,
  libraryText,
  mirrorStatus,
  overdueIn,
  rereadNudge,
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
  updatedMs: 0,
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
  expect(consumeSegment('-Users-me-Projects-acme-web', 'Users')).toBe('-me-Projects-acme-web')
  expect(consumeSegment('-acme-web', 'acme')).toBe('-web')
  expect(consumeSegment('-acme-web', 'acme-web')).toBe('')
  expect(consumeSegment('--bot-workspace', '.bot')).toBe('-workspace')
  expect(consumeSegment('-acmex', 'acme')).toBeUndefined()
})

test('finds due dates that have passed, and only those', () => {
  const at = (body: string, modified = '2026-10-09') => overdueIn(memory('m', { body, modified }), '2026-10-13')
  expect(at('- Check due 10-10 (Sam asked).')).toEqual([{ date: '2026-10-10', line: 'Check due 10-10 (Sam asked).' }])
  expect(at('signup rate by cohort due on the 10-10 UTC day').map(item => item.date)).toEqual(['2026-10-10'])
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
  expect(formatCount(940)).toBe('940')
  expect(formatCount(12_340)).toBe('12.3k')
  expect(formatCount(182_400)).toBe('182k')
  expect(formatCount(1_240_000)).toBe('1.2M')
  expect(tildePath('/Users/me/Projects/app', '/Users/me')).toBe('~/Projects/app')
  expect(tildePath('/opt/app', '/Users/me')).toBe('/opt/app')
})

test('nudges to save and clear only once each reply re-reads 150k tokens', () => {
  expect(rereadNudge(149_999)).toBeUndefined()
  expect(rereadNudge(182_400)).toBe('Each reply now re-reads 182k tokens. When this topic is done: /save-memory, then /clear.')
})

test('summarizes the whole library in one line', () => {
  const current = folder('-app', [memory('a', { body: 'due 2026-10-01' }), memory('b')], { isCurrent: true, project: '~/app' })
  const other = folder('-x', [memory('c')], { unindexed: ['c.md'] })
  const lib = { home: '/h', folders: [current, other], emptyFolders: 0, estimatedLoad: [] }
  expect(librarySummary(lib, '2026-10-13')).toBe('Memory: 3 memories in 2 folders, ~/app has 2, 1 overdue, 1 index problem.')
  expect(libraryText(lib, '2026-10-13').split('\n')).toEqual([
    'Memory: 3 memories in 2 folders, ~/app has 2, 1 overdue, 1 index problem.',
    '- a (~/app), due Oct 1, 12 days ago: due 2026-10-01',
  ])
})

test('compares engine versions by their first three numbers', () => {
  expect(isAtLeast('2.1.299', '2.1.299')).toBe(true)
  expect(isAtLeast('2.1.301-dev', '2.1.299')).toBe(true)
  expect(isAtLeast('2.1.295', '2.1.299')).toBe(false)
  expect(isAtLeast('2.2.0', '2.1.299')).toBe(true)
  expect(isAtLeast('10.0.0', '9.9.9')).toBe(true)
})
