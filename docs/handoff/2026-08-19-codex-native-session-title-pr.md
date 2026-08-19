# Codex 原生 Session Title PR — Session Handoff

> 貼這行到新 session 即可：
> **「讀 docs/handoff/2026-08-19-codex-native-session-title-pr.md 繼續工作」**

---

## 工作環境

| 項目 | 值 |
|---|---|
| Type | `continuation` |
| Branch | `fix/55-codex-native-session-title` |
| Worktree | `codex-native-session-title`（external worktree） |
| Issue | `jr-setup-ui#55` |
| 已關閉 PR | `jr-setup-ui#51`（由 #56 取代） |
| 未完成 PR | `jr-setup-ui#56`（ready、非 draft） |
| 上游 Issue | `jr_ai_agent_skills#24` |

## 目標

讓 macOS／Linux 的 Codex 0.146+ 以原生 thread title 同步 session 自動命名，不再被舊 POSIX watcher 改回「等待命名」，同時維持 Windows 與 Claude 既有行為。

## 已完成的工作

| PR / Commit | 內容 |
|---|---|
| `fe960eb` | POSIX 0.146 版本閘門、原生 title config、Claude／Codex wrapper 分流 |
| `e72504b` | app-server `thread/name/set` helper、session-id relay、舊 wrapper 遷移與同步 gate |
| `0e394bc` | 四角色 review hardening：競態、中止復原、TOML scope、Windows 分流、transactional sync |
| PR #56 | 已推送、PR body 含 QA evidence；完整測試 48/48 檔、761 項通過 |
| PR #51 | 已留言連到 #56 並關閉，舊 branch 未刪除 |

## 當前進度

- [x] 建立 `jr-setup-ui#55` 與上游 `jr_ai_agent_skills#24`
- [x] 在隔離 worktree 完成 TDD、四角色 pre-PR review、修正與推送
- [x] 建立 ready-for-review PR #56，狀態 `MERGEABLE / CLEAN`
- [x] 連續監看 PR review、comments、threads 與 checks；目前全部為 0
- [ ] 取得 Reed 明確同意後合併 PR #56 ← **接續點**
- [ ] 決定是否接著實作上游 issue `jr_ai_agent_skills#24`

## 關鍵決策

| 決策 | 結論 | 原因 |
|---|---|---|
| POSIX Codex 0.146+ tab title | 改用 `[tui] terminal_title = ["thread"]` | shared app-server 不再繼承各 terminal 的 `AI_TAB_SYNC_FILE` |
| Session rename 寫入 | 優先呼叫 app-server `thread/name/set` | 只改 SQLite 會出現 sidebar 更新、tab 不更新 |
| Relay key | `session_id`，缺少時才用 PPID | shared app-server 讓不同 session 共用父程序，PPID 不能隔離 |
| Windows | 保留 PowerShell／tab-sync 舊路徑，不安裝 POSIX helper | Issue #55 只更換 POSIX 路徑，Windows 行為不可回歸 |
| Claude | 保留 POSIX watcher，mixed block 遷移成 Claude-only | 移除整段會讓 Codex-only 修復破壞 Claude title |
| Materials sync | 完整 staging／驗證後再交換 | 來源不完整或 copy 中斷時不能留下半套 materials |

## 必讀檔案

1. `materials/skills/hooks/codex-session-namer.sh` *(branch: `fix/55-codex-native-session-title`)* ← session-id relay、lock、claim、中止復原與 fallback 成功條件都在這裡。
2. `materials/skills/hooks/codex-session-name-set.py` *(branch: `fix/55-codex-native-session-title`)* ← Unix socket WebSocket 與 app-server rename protocol 實作。
3. `src/config-install.js`、`src/config-check.js` *(branch: `fix/55-codex-native-session-title`)* ← POSIX／Windows config transform 與 `[tui]` 語意驗證。
4. `src/shell-wrapper.js` *(branch: `fix/55-codex-native-session-title`)* ← 舊 marker／`mycodex` alias 的 fail-safe 遷移邏輯。
5. `scripts/sync-skills-materials.sh` *(branch: `fix/55-codex-native-session-title`)* ← 上游 compatibility gate 與 transactional replacement。

## 注意事項

- PR #56 最後監看 HEAD 為 `0e394bc3f649b1649481e8a1e27750864bc3f3e1`；無 review、留言、unresolved thread 或 CI check。
- GitHub 沒有 required checks／required review，所以空的 `reviewDecision` 不構成 merge blocker。
- 尚未執行 merge；`gh pr merge` 需要 Reed 明確確認。
- Windows `.ps1` 在整個 PR 中維持零 diff；不要為統一程式碼順便修改。
- 主 `jr-setup-ui` worktree 原本有使用者變更；後續繼續使用此隔離 worktree，不要回主 worktree 開發。
- 未採納的非阻擋建議：掃描多個 SQLite DB、counter locking；兩者不屬這次 root cause，避免擴大 diff。

## 下一步（新 session 要做的事）

1. 進入 branch `fix/55-codex-native-session-title`，讀本 handoff，先跑 `git status -s` 與 `gh pr view 56 --repo museReed/jr-setup-ui`。
2. 若 Reed 要合併，先再掃一次 checks、reviews、comments 與 unresolved threads；全部乾淨後才執行合併。
3. 合併後確認 issue #55 自動關閉；不要刪 worktree／branch，除非 Reed 另行確認。
4. 若接續上游工作，從 `jr_ai_agent_skills#24` 開新的隔離 worktree／branch，不直接在本 PR branch 修改上游 repo。

---

*2026-08-19 產出；PR #56 已 ready，等待合併決策。*
