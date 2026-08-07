# Connecting a new vault to GitHub

The workshop's vault was wired up during setup. This file is for **later** — when the
user creates their own vault and wants the same automatic sync.

Follow this order when they say "connect this one too". Check before each step and skip
anything that's already done.

**0. Confirm it really is a vault**: the folder must contain `.obsidian`. If it doesn't, ask.

**1. Start version control**

```bash
git -C <vault> init -b main
```

**2. Things that shouldn't be tracked**

Write `<vault>/.gitignore`:

```
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.obsidian/cache
.trash/
.DS_Store
.obsidian/plugins/obsidian-git/.git_credentials_input
```

`workspace.json` records which tabs are open right now — it changes every time they switch
tabs, which makes it the single biggest source of conflicts if you don't exclude it.

**3. Create the GitHub side** (private)

```bash
gh repo create <name> --private
```

"Name already exists" means they created it before. Don't recreate it — connect to it:

```bash
git -C <vault> remote add origin $(gh repo view <name> --json url --jq .url)
```

```bash
git -C <vault> fetch origin
```

If the remote already has content, base this work on it before stacking anything on top —
otherwise the two histories are unrelated and the push gets rejected:

```bash
git -C <vault> reset --mixed origin/main
```

**4. Install the sync plugin**

Dropping three files into `<vault>/.obsidian/plugins/obsidian-git/` is the whole install:

```bash
curl -fL --silent -o <vault>/.obsidian/plugins/obsidian-git/main.js https://github.com/Vinzent03/obsidian-git/releases/latest/download/main.js
```

(`manifest.json` and `styles.css` come from the same URL with the filename swapped — fetch each.)

Then write `<vault>/.obsidian/community-plugins.json` containing `["obsidian-git"]`.
Without it the files are there but the plugin stays off.

**5. Configure it like the workshop's vault**

Write `<vault>/.obsidian/plugins/obsidian-git/data.json`:

```json
{
  "autoPullOnBoot": true,
  "autoSaveInterval": 10,
  "pullBeforePush": true,
  "syncMethod": "merge",
  "showBranchStatusBar": false,
  "showStatusBar": true
}
```

Which means: pull on open, commit and push every 10 minutes, pull before pushing.

⚠️ **These key names cannot be changed.** A misspelled key is silently ignored — the
setting looks written, the behaviour falls back to the default, and nothing on screen
says anything is wrong.

**6. Save and push** (follow the "Saving" section)

**7. Finally, tell them**: Obsidian must be **fully quit and reopened** on that vault
before the plugin loads, and the first time it opens it will ask whether to trust the
plugins in that folder — they need to say yes.
