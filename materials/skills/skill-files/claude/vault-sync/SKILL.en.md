---
name: vault-sync
description: Manage the sync between the user's Obsidian vault and GitHub, running every git command on their behalf. Use for "save my notes", "back this up", "push my notes", "pull the latest", "my notes have a conflict", "what's the state of my vault", connecting a newly created vault to GitHub, and any request to write, rewrite, move, rename, or link note files. Users rarely say "Obsidian" or "git" — they say "save my notes", "I switched computers", "my notes look weird". If they're talking about their notes, vault, notebook, or knowledge base, this is the skill. Not this skill: git operations on code projects, Obsidian's UI or preferences, comparing sync tools, converting markdown to other formats.
---

# Obsidian vault sync

The user's vault lives at `VAULT_PATH`. It is also a git repo whose remote is their own private GitHub repo.

**Your role**: the user does not need to know git. They say "save my notes", not "commit then push". You run every git command, and you report at the level where they can actually make a decision.

## Before you touch anything

Look at the current state — don't go from memory:

```bash
git -C VAULT_PATH status --short --branch
```

The `##` line's `[ahead N]` / `[behind N]` decides what happens next:

| State | What to do |
|---|---|
| Clean, no ahead/behind | Nothing to do — tell them they're up to date |
| Changes, not behind | Save it (see "Saving") |
| Behind | **Pull first, then push** (see "Getting the latest") |
| Files starting with `UU` | Conflict — go to "Resolving conflicts" |

## Saving (user says "save my notes / back this up / push it")

```bash
git -C VAULT_PATH add -A
```

Where the commit message comes from is in "Commit messages" below — that's the part
of this skill most likely to decay into boilerplate, so don't skip it.

```bash
git -C VAULT_PATH commit -m "<message>"
```

```bash
git -C VAULT_PATH push
```

After pushing, report **how many files changed and what the message said**. Don't paste raw git output.

### Push rejected (`rejected` / `non-fast-forward`)

Another computer pushed first. **Never use `--force`** — it deletes what the other machine wrote. Go to the next section instead.

## Getting the latest (user says "pull / sync / I switched computers")

```bash
git -C VAULT_PATH pull --rebase=false
```

No conflict means you're done — report how many files came down. If there is a conflict, keep reading.

## Resolving conflicts

**Back up first, before touching any file**:

```bash
cp -R VAULT_PATH VAULT_PATH-backup-$(date +%Y%m%d-%H%M%S)
```

List the files that actually conflict:

```bash
git -C VAULT_PATH diff --name-only --diff-filter=U
```

Work through them one at a time. Three rules:

1. **Keep both sides.** These are notes, not code — duplication is safer than deletion.
2. Merge duplicated paragraphs into one; keep anything that exists on only one side verbatim.
3. Remove every `<<<<<<<`, `=======`, and `>>>>>>>` marker.

Then save it via "Saving", with the message `🗂️ Merge notes from both computers`.

**Always report**: which files you merged, what you kept in each, and where the backup is. The user needs to be able to go look.

### Attachment conflicts (images, PDFs, audio)

Binary files can't be merged — it's one or the other. **Stop and ask the user** which side to keep, and give them both file sizes and modification times. Don't decide for them.

## Commit messages

One line: an emoji, then a sentence. **Don't** use `update`, `wip`, or `fix` — that line
is their only clue when they go looking later, and what they're looking for is "what did
I write that day", not "which files changed".

Format: `<emoji> <one sentence>`

| emoji | When |
|---|---|
| ✨ | Added a new note |
| 📝 | Rewrote the content of an existing note |
| 🗂️ | Moved, renamed, or restructured |
| 🔗 | Added links or references |
| 🧹 | Small fixes: typos, formatting |
| 🗑️ | Deleted something |

When a change fits several, pick **the biggest one** — one emoji per commit.

Write what **happened**, not how many files:

> ❌ `📝 Updated 2 files`
> ✅ `✨ Wrote down the three hook patterns from today's class`

(This set is gitmoji's spirit, narrowed: gitmoji is built for code — 🐛 fix, ♻️ refactor
mean nothing for notes — so these are the six things that actually happen in a vault.)

### Let them pick the line

Ask which sentence they want before you save — they know better than you what this
session meant to them. **You're asking which line, not whether to save**: saving is part
of what they already asked for, so don't make them confirm it twice.

1. Read what actually changed: `git -C VAULT_PATH diff --cached` (not just `--stat`)
2. Draft **3 candidates** from different angles: one about the topic, one about what it's
   for, one about where it came from
3. Ask with the **structured-questions** skill — the three candidates plus
   "**let me write my own**". If they pick that, wait for their line and use it verbatim
4. Commit with whichever line they picked

⚠️ **Don't ask when nobody's watching** (`-p`, `exec`, batch runs): the question will
just hang there. In that case write the line yourself using the format above.

## When they ask you to change note content

You can freely add, edit, and move `.md` files under `VAULT_PATH`, but:

- **Save it right after** (see "Saving"). Leaving uncommitted changes around is where the next conflict comes from.
- Obsidian's links look like `[[filename]]`. When you move or rename a note, update every note pointing at it or the links break.
- Leave `.obsidian/` alone — that's Obsidian's own configuration.

## A different vault

The path above is the workshop's vault. When the user means **a different one** ("I made
a new vault", "the one under Documents"), ask where it is, and once you have the absolute
path, replace `VAULT_PATH` in every command above with that folder. Everything else is the same.

If that vault isn't connected to GitHub yet ("connect this one too"), **read
`references/new-vault.md` first**, then follow it. It has the full seven steps, including
the name collision, the case where the remote already has content, and the setting keys
that fail silently when misspelled.

## Never

- **Never `git push --force`** — it deletes what the other computer wrote.
- **Never `git reset --hard`** unless the user explicitly says "throw away my changes here", and you've already backed up.
- **Never decide for them which version of a note to keep.** If it can't be merged, ask.
