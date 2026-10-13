# claude-memory-mods

Claude Code already keeps memory for you: a `MEMORY.md` index and one file per fact, in a folder per project. These two plugins help you curate it. They read and write those same files, so there's no new database, service or format.

<!-- Screenshot: the Memory pane's top view (search, Overdue, folder cards). Save as docs/view-memory.png and link it here. -->

| Command | What it does |
|---|---|
| `/view-memory` | Opens a pane over every project's memory: search, overdue items, and each folder's health |
| `/save-memory` | Saves what this session learned, under a strict bar, so `/clear` is safe |

Both work in the terminal and in the Code tab of the Claude desktop app.

## view-memory

`/view-memory` opens a **Memory** pane over every project's [auto memory](https://code.claude.com/docs/en/memory#auto-memory), not only the one you're in.

- **Search** every memory file at once.
- **Overdue** lists every line that says `due YYYY-MM-DD` with a date that has passed.
- **Folder health** shows files `MEMORY.md` doesn't link, links that point nowhere, and, for a folder of symlinks into another, the files it's missing.
- **What loads** lists the `CLAUDE.md` files and `MEMORY.md` every session here starts with, and their size in tokens.
- **A nudge** appears once each reply re-reads more than 150k tokens: a toast and a line in the pane suggest `/save-memory`, then `/clear`. Long sessions are where the bill goes.

<!-- Screenshot: a search with results, or a memory open. Save as docs/view-memory-search.png and link it here. -->

## save-memory

`/save-memory` closes a session so `/clear` is safe.

- It saves only what clears one bar: would a future session make a *worse decision* without this? Most sessions save nothing.
- It folds new facts into existing memories rather than adding neighbours, and checks `MEMORY.md` against the files.
- It reports what the session cost: its cache-read to output ratio against your average, from a bundled script that reads your local transcripts.
- It hands back `/rename` and `/clear` to paste.

Put your own rules (team docs, a ship log, who else reads your memory) in `~/.claude/save-memory.md`. It reads them first.

## Install

This repo is a plugin marketplace named `monte9`. Each folder is one plugin you can install on its own.

```bash
claude plugin marketplace add Monte9/claude-memory-mods
claude plugin install view-memory@monte9 --scope user
claude plugin install save-memory@monte9 --scope user
```

In a session that's already open, run `/reload-plugins`.

A mod runs with your permissions, like any plugin. Read its code first, or list what it hooks and calls with `claude plugin validate <mod folder>`.

## Alongside Claude Code's own commands

- `/memory` (built in) opens one memory file to edit.
- `/view-memory` browses all of them, across projects.
- `/save-memory` adds what one session learned.
- Anthropic's `consolidate-memory` skill, where you have it, tidies a whole folder.

## Develop

Clone the repo and add your checkout as the marketplace instead. Claude Code then reads each mod from the folder, so an edit plus `/reload-plugins` is the whole loop:

```bash
claude plugin marketplace add ~/Projects/claude-memory-mods
```

Before committing a change: `claude plugin validate <mod>` and `claude plugin test <mod>`.

The tests check a mod's logic, not how the desktop app paints it, so click through a pane there by hand. On the desktop app a pane `Button` needs two clicks unless it already holds the focus ([anthropics/claude-code#99395](https://github.com/anthropics/claude-code/issues/99395)): open panes with `focus: true`, and after a press that swaps the view, move the focus with `$.ui.focus` onto the next likely `Button`, as `view-memory` does.

## License

MIT
