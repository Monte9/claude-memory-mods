---
name: save-memory
description: Save what this session learned to auto memory, then hand back the commands to rename and clear. Captures durable facts, folds them into existing memories rather than adding neighbours, and verifies the index. Use when finishing a topic, before switching to unrelated work, or when a session has run long.
---

# Save memory

Close out this session so `/clear` is safe. The conversation is disposable; anything worth keeping must be in memory before it goes.

**You cannot run `/rename` or `/clear`.** They are harness commands. Do the capture, then hand the user the exact two lines to paste.

## Why this exists

Usage tracks session length, not how much was asked for. Every turn re-reads the whole conversation from cache, so a long session pays for its history again on each reply. Measured on one heavy user's machine over two months: cache reads ran about 400:1 against output tokens, and the two longest sessions were most of all usage. Clearing between unrelated topics is the biggest lever, and the only reason not to clear is fear of losing context. This skill removes that reason.

## Workflow

### 0. Read the user's own rules

If `~/.claude/save-memory.md` exists, read it first. It holds this user's additions: where their external docs live, extra memory fields, a ship log, who else reads their memory. Where it and this file disagree, it wins.

### 1. Find what is durable

**The default is to write nothing.** Most sessions produce zero memories. A typical good session produces one. If you are about to write three, you are recording that work happened, which is what the transcript is for.

**The bar, and it is the only test:** would a future session, with no knowledge of this conversation, make a *worse decision* without this? Not "be less informed." Worse decision.

Apply these disqualifiers before anything else. Each one is a reason people write bloat:

- **"We discussed it."** Not a reason. Discussion is not durability.
- **"It was hard to work out."** Not a reason. Effort spent is not the same as effort saved. If a search finds it again in two minutes, do not write it.
- **"It's interesting."** Not a reason.
- **"It might be useful."** Not a reason. If you cannot name the future decision it changes, there isn't one.
- **The repo or a team doc already says it.** Then it is documentation, not memory. Propose the edit there and say so.
- **It is only true until this work ships.** That is state, not knowledge. Leave it on the PR or the ticket.

What actually clears the bar, roughly in order of how often it does:

- **A correction the user gave that generalizes.** They will not repeat it, and repeating the mistake costs trust. These are the highest-value memories in the store.
- **A fact invisible from the code that cost real time to establish.** A dashboard-held config value, a platform behaving differently from its docs, a build step that fails as a warning. The test is whether reading the code would reveal it. If it would, skip.
- **A decision and why the alternative was rejected**, where someone will otherwise re-open it in a month.
- **Who someone is** and how to read their review, when it is not written down anywhere.

If nothing clears the bar, say so plainly and move to the handoff. That is the common case and it is a success, not a gap.

### 2. Consolidate rather than accumulate

Read the project's `MEMORY.md` and `~/.claude/CLAUDE.md`, then open any memory file whose index line looks close. Prefer updating an existing memory to adding a neighbour. Two files on one topic is how the store rots, and so is a memory that restates a CLAUDE.md rule.

### 3. Write it

**Pick the layer first.** A correction that holds in every repo becomes one line in `~/.claude/CLAUDE.md` and nowhere else: that file reaches every session and subagent, which memory does not. Keep it short (about 30 lines), and name any change to it in the step 6 report. Project-specific facts, incident detail and the why stay in memory.

Follow Claude Code's memory format: one fact per file, named `<type>_<topic>.md` with `name` matching the filename, `type` (`user`, `feedback`, `project`, `reference`) in the frontmatter. Feedback and project memories carry `**Why:**` and `**How to apply:**` lines.

Add a one-line index entry to `MEMORY.md`. Write the line to say **when to reach for the file**, not what it contains: the index is the only text guaranteed in context, so it is the routing layer.

**A project memory is a milestone list, not a diary.** It holds four things, as bullets: where the work lives (links to the ticket, PR, docs), dated milestones one line each, decisions still open, and what the next session needs that nothing else says. Never a paragraph per session. Once a milestone's detail lands on a ticket, PR or doc, its paragraph becomes a one-line bullet with the link. The check on the way in: if the file has a heading per month, or has passed 25 lines, it is being written as a log of what happened. Rewrite it to the four lists before adding to it.

**A project memory lives while its work is new or in progress.** Once the work ships, fold what still needs watching (checks, due dates, open follow-ups, traps) into the shipped-work file the user's rules name, then delete the project memory and repoint links to it; with no such file, keep only what a future decision needs.

**Due dates live only in project memories,** each on the line that says what is due, written `due YYYY-MM-DD` so a search or the `view-memory` pane's Overdue list finds every one. A feedback, reference or user memory holds no deadline: move the date into the project it belongs to and leave the method behind. When a due item is done, record the result and delete the due line, or it stays overdue forever.

### 4. Ship log (optional)

Skip this step unless the user's rules (step 0) name a ship log. It is the one deliberate exception to "never record that work happened": a file that lets the user look back in six months and see the big rocks.

**The bar is a rock, not a good day's work.** A rock changed what the team can do, what users get, what the company spends, or what we know, and would still matter in six months. Most merged PRs are pebbles and stay in git. Outcome first ("cut CI time 95%", not "added an `if:` to four jobs"), then the evidence, then a learning only if it changed how the user works.

### 5. Verify the index

Find this project's memory folder. Claude Code keys it by the git repository, so a worktree uses the main checkout's folder:

```bash
root=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null | sed 's#/\.git/*$##'); root=${root:-$PWD}
cd ~/.claude/projects/$(printf %s "$root" | sed 's#[^a-zA-Z0-9]#-#g')/memory
echo "files: $(ls *.md | grep -vc '^MEMORY.md$')   index: $(grep -c '^- ' MEMORY.md)"
grep -oE '\]\([A-Za-z0-9_-]+\.md\)' MEMORY.md | tr -d ']()' | while read f; do [ -f "$f" ] || echo "BROKEN: $f"; done
for f in *.md; do [ "$f" = "MEMORY.md" ] && continue; grep -q "($f)" MEMORY.md || echo "ORPHAN: $f"; done
grep -ohE '\[\[[A-Za-z0-9_-]+\]\]' *.md | tr -d '[]' | sort -u | while read n; do [ -f "$n.md" ] || echo "DANGLING: [[$n]]"; done
grep -rnE '\bdue\b[^.;]{0,40}\b([0-9]{4}-)?[0-9]{2}-[0-9]{2}\b' . --include='feedback_*.md' --include='reference_*.md' --include='user_*.md' | sed 's/^/MISPLACED DUE: /'
```

Counts must match and nothing may print. (The `view-memory` mod shows the same check in a pane, plus every passed due date.)

### 6. Report and hand off

The user is about to erase this conversation on the strength of this report. They should be able to read it and know nothing important is being thrown away. Give them four things, in this order:

**What memory now holds from this session.** Not filenames: the actual claims, in a sentence each, so they can judge whether they are right. Say whether each was a new file or a change to an existing one.

> Added `reference_billing_webhooks`: retries come from the provider's dashboard setting, not our code, so a fix in the handler alone doesn't stop duplicates.
> Updated `user_team`: Sam and sam-k on GitHub are one person.

**What was deliberately not saved, and why.** This is the part that builds trust in the bar. Name the two or three things a reader would expect to see and say which disqualifier they hit.

> Not saved: the review thread on the PR, because the findings are on the PR. Not saved: the flaky test run, because it was state, not knowledge.

**What is still open and lives only here.** Anything unfinished that is not on a PR, in a ticket, or in memory. This is the real risk of clearing, so be specific and offer to capture it before they do: a follow-up with a date becomes a `due YYYY-MM-DD` line in its project memory (step 3).

**Then the two commands**, with a rename that will be findable in a `/resume` list months from now:

```
/rename <topic>-<what-happened>
/clear
```

If nothing was written, say so in one line and still give the commands. Do not pad the report to look busy.

## Rules

- **Writing nothing is the expected outcome.** Report it as a result, not a gap.
- Never write a memory to record that work happened. Memory holds what is true, not what you did. The one exception is a ship log the user's rules ask for (step 4).
- When something belongs in the repo or a team doc instead, say so and offer the edit. Do not mirror it into memory.
- Deleting or shrinking a memory counts as a successful run. A session that removes two stale files and writes none has improved the store more than one that adds three.
- Flag anything still open that lives only in this conversation, so the user can decide whether to capture it before clearing.

## The store should not grow

If the file count drifts up run to run, the bar in step 1 is being applied too loosely; the fix is deleting on the way in rather than tightening later.

Two signals that bloat is happening:

- Two files whose index lines you cannot tell apart. Merge them.
- A file you have never opened in a session where its topic came up. Its index line is wrong, or it should not exist.
