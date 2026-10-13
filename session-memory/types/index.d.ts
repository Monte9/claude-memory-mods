/** One auto-memory file, read from its frontmatter and body. */
export type Memory = {
  name: string
  /** The link text MEMORY.md gives the file, else a title made from its name. */
  title: string
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

/** Where the pane is: the overview (no section), one type's list, or one memory open. */
export type View = { section: string | null; memory: string | null }

declare module 'claude-code' {
  interface PluginState {
    'session-memory': { report: Report | null; view: View }
  }
}
