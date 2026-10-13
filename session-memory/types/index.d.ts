/** One auto-memory file, read from its frontmatter and body. */
export type Memory = {
  name: string
  /** The link text MEMORY.md gives the file, else a title made from its name. */
  title: string
  type: string
  description: string
  /** Empty for a symlink into another scanned folder: read it from `linkTo`. */
  body: string
  modified: string
  /** The id of the scanned folder this file is a symlink into, if any. */
  linkTo?: string
}

/** One memory folder at the last refresh. */
export type Report = {
  project: string
  folder: string
  memories: Memory[]
  indexed: number
  unindexed: string[]
  missing: string[]
}

/** A memory folder as the browser lists it: its report plus where it lives and its health. */
export type Folder = Report & {
  /** Claude Code's encoded folder name under ~/.claude/projects. */
  id: string
  isCurrent: boolean
  indexChars: number
  /** The folder most of this one's files are symlinks into. */
  mirrorOf?: string
  /** Files of a type this mirror already links that it doesn't link. */
  mirrorGaps: string[]
}

/** One file loaded into every session's context, by path and size. */
export type LoadedFile = { path: string; kind: string; chars: number }

/** Every memory folder, and what a session in the current project loads. */
export type Library = {
  home: string
  folders: Folder[]
  emptyFolders: number
  /** Estimated from the files on disk; `measured` replaces it once a session reports its own. */
  estimatedLoad: LoadedFile[]
}

/** Where the pane is. `fromTop` sends Close back to search or Overdue rather than a type's list. */
export type View = {
  folder: string | null
  section: string | null
  memory: string | null
  query: string
  fromTop: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'session-memory': { library: Library | null; view: View; measured: LoadedFile[] | null }
  }
}
