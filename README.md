# claude-mods

[Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview): small plugins that draw panes and bands in Claude Code and react to what it does. They work in the terminal and in the Code tab of the Claude desktop app.

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

## Develop

Clone the repo and add your checkout as the marketplace instead. Claude Code then reads each mod from the folder, so an edit plus `/reload-plugins` is the whole loop:

```bash
claude plugin marketplace add ~/Projects/claude-mods
```

Before committing a change: `claude plugin validate <mod>` and `claude plugin test <mod>`.

## License

MIT
