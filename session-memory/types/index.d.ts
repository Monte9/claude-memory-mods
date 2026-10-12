/** One auto-memory file, read from its frontmatter and body. */
export type Memory = {
  name: string
  type: string
  description: string
  body: string
  modified: string
}

/** The project's memory folder at the last refresh. */
export type Report = {
  project: string
  folder: string
  memories: Memory[]
  indexed: number
  unindexed: string[]
  missing: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'session-memory': { report: Report | null; selected: string | null }
  }
}
