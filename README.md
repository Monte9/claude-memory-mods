# claude-mods

Plugins for Claude Code: [mods](https://code.claude.com/docs/en/plugins/mods/overview) that draw panes in Claude Code, and skills that change how a session runs. They work in the terminal and in the Code tab of the Claude desktop app.

The first three are about sessions: see what your memory holds, see what a session costs, and close one without losing anything worth keeping.

This repo is a plugin marketplace named `monte9`. Each folder is one plugin you can install on its own.

## Install

Add the marketplace once:

```bash
claude plugin marketplace add Monte9/claude-mods
```

Then install the mods you want, for example:

```bash
claude plugin install <mod>@monte9 --scope user
```

In a session that's already open, run `/reload-plugins`.

A mod runs with your permissions, like any plugin. Read its code first, or list what it hooks and calls with `claude plugin validate <mod folder>`.

## Mods

| Mod | What it does | Commands |
|---|---|---|
| [`session-memory`](session-memory) | Opens a **Memory** pane over every project's [auto memory](https://code.claude.com/docs/en/memory#auto-memory). Up top: search across all of it, and **Overdue**, any line saying "due <date>" whose date has passed. Then one card per memory folder, this project first, with its health: files `MEMORY.md` doesn't link, links that point nowhere, and for a folder of symlinks into another, the files of a type it shares that it's missing. A folder opens on its types, a type on its memories, and a memory reads on its own with **Close** to go back. The last card is what every session here loads (`CLAUDE.md` files and `MEMORY.md`), with its size in tokens; click one to read it | `/session-memory`, then **Refresh** in the pane |
| [`session-wrap`](session-wrap) | A skill that closes a session so `/clear` is safe. It saves only what clears one bar (would a future session make a *worse decision* without this?), folds new facts into existing memories instead of adding neighbours, verifies `MEMORY.md`, and reports what the session cost: its cache-read to output ratio against your average, from a bundled script that reads your local transcripts. Then it hands back `/rename` and `/clear`. Put your own additions (team docs, a ship log, who else reads your memory) in `~/.claude/session-wrap.md` and it reads them first | `/session-wrap` |
| [`session-usage`](session-usage) | Opens a **Usage** pane. **Live:** how many tokens each reply re-reads right now and its share of the context window, the session's cost, and your 5-hour and 7-day limits with reset times. **History** (from your local transcripts, read by a bundled Node script in about a second): this week against last, the last 14 days as bars, and your heaviest sessions by name with their share of the total. A toast suggests `/session-wrap` once a session re-reads more than 150k tokens per reply, because long sessions are where the bill goes | `/session-usage`, then **Refresh** in the pane |

## Develop

Clone the repo and add your checkout as the marketplace instead. Claude Code then reads each mod from the folder, so an edit plus `/reload-plugins` is the whole loop:

```bash
claude plugin marketplace add ~/Projects/claude-mods
```

Before committing a change: `claude plugin validate <mod>` and `claude plugin test <mod>`.

The tests check a mod's logic, not how the desktop app paints it, so click through a pane there by hand. On the desktop app a pane `Button` needs two clicks unless it already holds the focus ([anthropics/claude-code#99395](https://github.com/anthropics/claude-code/issues/99395)): open panes with `focus: true`, and after a press that swaps the view, move the focus with `$.ui.focus` onto the next likely `Button`, as `session-memory` does.

## License

MIT
