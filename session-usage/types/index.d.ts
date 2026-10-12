/** One session as the usage script names it. */
export type SessionRow = {
  id: string
  title: string
  project: string
  branch: string
  first: string
  last: string
  output: number
  cacheRead: number
  replies: number
  lastContext: number
}

/** What scripts/usage.mjs prints. */
export type Report = {
  generatedAt: string
  range: { from: string | null; to: string | null }
  totals: { input: number; output: number; cacheRead: number; cacheWrite: number; replies: number; sessions: number }
  days: { day: string; output: number; cacheRead: number }[]
  weeks: { week: string; output: number; cacheRead: number }[]
  heaviest: SessionRow[]
  current: SessionRow | null
}

/** The live figures from $.session.usage(). */
export type Live = {
  tokens: number
  window: number
  percent: number | null
  costUsd: number | null
  limits: { kind: string; percentUsed: number; resetsAt?: string }[]
}

declare module 'claude-code' {
  interface PluginState {
    'session-usage': {
      report: Report | null
      live: Live | null
      status: 'idle' | 'loading' | 'error'
      error: string | null
      isNudged: boolean
    }
  }
}
