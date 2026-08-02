# 卡片生命週期判斷邏輯盤點

## 一、判斷函式一覽

| 函式名 | 檔案:行號 | 它回答什麼問題 | 被誰呼叫 |
|---|---|---|---|
| `runEnvCheck` | `src/env-check.js:610-665` | 執行各平台的環境與登入檢查，並把每筆結果交給環境版 `withActions` 補動作欄位。 | `/env` API 的後端處理流程；前端 `checkEnvironment` 取得其結果。`public/app.js:658-677` |
| 環境版 `withActions` | `src/env-check.js:253-284` | 依 `status`、`installable`、installer 是否存在，產生 `hasInstaller`、`installAction`、`fixAction`。 | `runEnvCheck` 對每筆環境檢查結果呼叫。`src/env-check.js:653-654` |
| `runConfigCheck` | `src/config-check.js:710-740` | 依 step 的 `kind` 分派規則檔、skill、第三方 skill、demo 的檢查函式，再以 config 版 `withActions` 補動作欄位。 | `/configs` API 的後端處理流程；前端 `checkConfigs` 取得其結果。`public/app.js:705-727` |
| config 版 `withActions` | `src/config-check.js:744-762` | 依 `status`、`noInstall`、`needsMerge`、`VERIFICATION` 產生 `installAction`、`mergeAction`、`verifyAction`、`verifyKind`、`verifyOptions`、`eyeCheck`。 | `runConfigCheck` 對每筆 config 檢查結果呼叫。`src/config-check.js:739-740` |
| `groupChecks` | `public/model.js:344-375` | 依 id 把 config checks 分到 `rules`、`skills`、`demo` 與 Claude／Codex／共用群組。 | `allCardSections` 在每次組卡時呼叫。`public/app.js:187-198` |
| `flattenCheckCards` | `public/model.js:485-550` | 建立 setup 卡、合併 CLI 與 auth 的 env 卡，並把每一筆 config check 攤成一張 `kind: "config"` 卡。 | `allCardSections`。`public/app.js:187-198` |
| `currentCardIndex` | `public/viewmodel.js:504-517` | 找第一張 `cardIsComplete === false` 的卡；若全完成則回最後一張。 | `renderWizard` 計算 `derivedIndex`。`public/app.js:224-230` |
| `renderWizard` | `public/app.js:214-484` | 選定目前卡片，組出清單、按鈕、下一張、徽章、里程碑與段落狀態的 ViewModel。 | 初始檢查回來、重檢、段落切換、人工勾選、下一張與 milestone 點擊等入口。`public/app.js:421-480` |
| `envRowModel` | `public/viewmodel.js:167-207` | 把單一環境 check 轉成顯示狀態、安裝／修正／登入按鈕規格。 | `envCardRowModel`。`public/viewmodel.js:227-270` |
| `envCardRowModel` | `public/viewmodel.js:227-270` | 合併一張 env 卡內 primary check 與 auth check 的按鈕，並處理卡片級安裝佔位。 | `renderWizard` 在 `kind === "env"` 時呼叫。`public/app.js:338-351` |
| `configRowModel` | `public/viewmodel.js:306-425` | 由 `status`、`verified`、`installed`、`noInstall` 與各 action 欄位決定 config 列狀態及按鈕。 | `renderWizard`、`cardIsComplete`、`systemRowChecked`、config 摘要。`public/app.js:338-350` `public/viewmodel.js:477-502` |
| `nextCardUnlocked` | `public/viewmodel.js:702-713` | 判定非 setup、非 env 卡是否已安裝、已嘗試必要驗證、人工項目全勾。 | `renderWizard` 的 config 分支。`public/app.js:304-321` |
| `cardIsComplete` | `public/viewmodel.js:477-502` | 依 `kind` 判定 setup、env、config 卡的實際完成狀態。 | `currentCardIndex`、徽章、env 下一張、milestone 候選、段落完成與 tab blocker。`public/app.js:310-327` `public/app.js:504-530` |
| `systemRowChecked` | `public/viewmodel.js:590-593` | 判定 config 清單的系統列是否勾選：最終列狀態為 `ok`，或行為驗證已過且結構仍為 `ok`。 | `renderWizard` 建立 `verifiedCheckIds`。`public/app.js:264-274` |
| `checklistGroups` | `public/viewmodel.js:595-646` | 建立系統與人工 checklist items，從 `verifiedCheckIds`、`checkedManualIds` 決定各項 `checked`。 | `renderWizard`。`public/app.js:276-284` |
| `cardStatusModel` | `public/viewmodel.js:62-79` | 以 `running > completed > failed > installed` 的優先序決定右上徽章。 | `renderWizard`。`public/app.js:365-377` |
| `cardsDone` | `public/viewmodel.js:519-529` | 一張里程碑是否完成：id 在 `completedCardIds`，且卡片 index 不大於目前 index。 | `milestoneModels`、`sectionStatus`。`public/viewmodel.js:531-562` |
| `milestoneModels` | `public/viewmodel.js:531-554` | 產生每站的 `completed`、`unlocked`、`reached`、`current`。 | `renderWizard`。`public/app.js:322-337` |
| `sectionStatus` | `public/viewmodel.js:556-562` | 用 `cardsDone` 的剩餘數量顯示「這一段已完成」或「還有 N 張」。 | `renderWizard`。`public/app.js:468-475` |
| `incompleteCards` | `public/app.js:504-513` | 列出段落內未完成卡；setup 直接看 `completed`，其他卡呼叫 `cardIsComplete`。 | `sectionCompletion` 與 `renderNavigation`。`public/app.js:518-558` |
| `sectionCompletion` | `public/app.js:518-533` | 判定各 section 是否沒有 incomplete card。 | `renderNavigation`。`public/app.js:535-558` |
| `sectionGateState` | `public/model.js:203-259` | 以「前一段是否完成」及 `SECTION_GATES` 是否勾完決定 tab lock。 | `renderNavigation`。`public/app.js:546-558` |
| `actionButton` | `public/view.js:210-229` | 把按鈕規格畫成 DOM；`secondary` 決定 ghost／primary，`disabled`、`done` 決定停用與完成樣式。 | `renderCard` 對 `row.buttons` 的每一筆呼叫。`public/view.js:433-435` |
| `checklistElement` | `public/view.js:277-332` | 計算 checklist 的 `checked / items.length`，並在全勾時加上 `is-complete`。 | `renderCard`。`public/view.js:413-415` |
| `renderMilestones` | `public/view.js:153-208` | 以 `reached`、`unlocked` 畫亮／鎖住 milestone，點擊時也再檢查 `unlocked`。 | View 的 `renderWizard`。`public/view.js:495-500` |
| `renderSectionLocks` | `public/view.js:517-524` | 以各 tab 的 `lockStates[section].locked` 畫鎖定樣式與 `aria-disabled`。 | `renderNavigation`。`public/app.js:546-558` |

## 二、每種卡的行為

### 1. `setup`：選工具＋選語言

1. **進卡。** `flattenCheckCards` 固定把 `env-config` 放成 env 段第一張 `kind: "setup"`；`allCardSections` 再把 `state.setupCompleted` 填入它的 `completed`。`public/model.js:514-530` `public/app.js:187-198`
   `renderWizard` 先用 `currentCardIndex` 找第一張未完成卡；第一次進該段時使用 `derivedIndex` 並寫入 `state.viewingCardIndex`，之後 render 保持該 index，只有下一張或 milestone 點擊會改 index。`public/app.js:224-243` `public/app.js:462-480` `public/viewmodel.js:504-517`
   自動檢查由整個 app 的 `initialize` 同時啟動 `checkEnvironment()`、`checkConfigs()`，不是由 setup 卡進入條件觸發；切 tab 只設定 `activeSectionId` 後呼叫 `renderWizard()`。`public/app.js:1276-1287` `public/app.js:1309-1318`
   在 setup 卡改工具會清空所有 `viewingCardIndex` 並重跑 config check；改語言只重跑 config check。`public/app.js:1261-1275`

2. **安裝按鈕。** `renderWizard` 對 setup 不建立 env/config row，`renderCard` 的 setup 分支只放選擇面板，因此沒有任何由 `actionButton` 產生的安裝按鈕。`public/app.js:338-351` `public/view.js:387-435`

3. **其他動作按鈕。** setup 的 `row` 為 `null`，`showRetest` 也不是 env 且沒有 `row.showRetest`；View 又不進非 setup 的 actions 分支，所以「再 check 一次」「開終端跑」「用 AI 合併」都不出現。`public/app.js:338-351` `public/app.js:413-430` `public/view.js:400-451`

4. **下一張。** `nextUnlocked` 對 setup 固定為 `true`；`showNext` 還要求目前不是本段最後一張。View 只在 `showNext` 時建立按鈕；點擊後先把 `state.setupCompleted = true`，再把目前 index 加一。`public/app.js:310-321` `public/app.js:413-415` `public/app.js:462-465` `public/view.js:474-486`

5. **完成。** `cardIsComplete` 對 setup 只看 `card.completed === true`，其來源是 `state.setupCompleted`；徽章收到這個結果，tab blocker 對 setup 也直接檢查同一個 `completed`。`public/viewmodel.js:477-484` `public/app.js:187-198` `public/app.js:365-377` `public/app.js:504-510`
   setup 不顯示 checklist，因此沒有 N/M；milestone 的 setup 候選看 `candidate.completed === true`，之後仍要通過 `cardsDone` 的 `index <= currentIndex`。`public/app.js:322-337` `public/viewmodel.js:519-554` `public/app.js:385-392`

### 2. `env`：環境、CLI 與登入卡

1. **進卡。** `runEnvCheck` 平行執行 CLI、登入及平台特定檢查；`flattenCheckCards` 依 `ENV_CARD_META` 合併 CLI 與 `-auth` check，並把 `CARD_GATES[check.id]` 放入 `manualIds`。`src/env-check.js:610-665` `public/model.js:485-513`
   顯示 index 仍由 `renderWizard → currentCardIndex` 的第一張未完成規則決定，第一次進段後由 `state.viewingCardIndex` 釘住。`public/app.js:224-243` `public/viewmodel.js:504-517`
   `initialize` 會在 app 啟動時自動呼叫 `checkEnvironment`；單純切回 env tab 不重跑，卡內「再 check 一次」或頁面上的重檢按鈕才再次呼叫。`public/app.js:1258-1260` `public/app.js:1276-1287` `public/app.js:1309-1318`

2. **安裝按鈕。** 後端環境版 `withActions` 只有在 `status === "missing"`、`installable !== false` 且 `resolveInstaller` 有結果時給 `installAction`；`hasInstaller` 則表示這個 id 在平台上是否有 installer。`src/env-check.js:253-284`
   `envRowModel` 在 `installAction != null` 時產生可按或已完成的安裝按鈕；若 `installed === true`、`installAction == null` 且 `hasInstaller !== false`，補一顆停用的「✅ 安裝」。`public/viewmodel.js:167-190`
   `envCardRowModel` 以 primary 的 `status === "ok"`，或 `installedSteps` 中已有該 id 且 status 不是 `missing`，算 `installed`；找不到 primary 的 install spec 時，只要 `hasInstaller !== false`，再補一顆停用的「安裝」。`public/viewmodel.js:227-254`
   所有上述 spec 最後都由 `actionButton` 依 `secondary`、`disabled`、`done` 畫樣式；執行中／等待登入時，`envButtonState` 另改停用狀態與文字。`public/view.js:210-229` `public/viewmodel.js:895-918` `public/app.js:575-590`

3. **其他動作按鈕。** env 卡的「再 check 一次」無條件由 `card.kind === "env"` 打開，點擊呼叫 `checkEnvironment()`。`public/app.js:413-430`
   env 的其他 row buttons 只有 `installAction` 與 `fixAction`；`fixAction` 只可能是 execution policy 修正或三種登入，因此不會產生「開終端跑」或「用 AI 合併」。`src/env-check.js:260-283` `public/viewmodel.js:192-204`

4. **下一張。** env 分支要求 `cardIsComplete(card, verified, manualCheckedIds)`，並再次要求 `groups.manual.every(item.checked)`；`showNext` 還要求不是本段最後一張。`public/app.js:310-321` `public/app.js:413-415`
   `cardIsComplete` 的 env 分支要求卡內所有 checks 的 `status === "ok"`，且 `card.manualIds` 全部存在於 `checkedManualIds`；`groups.manual` 由 check 的 `eyeCheck`、`sectionManualItems` 與 `checkedManualIds` 組成。`public/viewmodel.js:488-495` `public/viewmodel.js:595-646`

5. **完成。** 徽章直接吃上述 `cardIsComplete`；清單系統列則逐 check 看 `status === "ok"`，人工列看 `checkedManualIds`，N/M 由全部 items 的 `checked` 數計算。`public/app.js:264-284` `public/app.js:365-377` `public/view.js:277-295`
   milestone 先把 `cardIsComplete` 為真的 env 卡放進 `completedCardIds`，再要求該卡 index 不超過目前 index；tab 解鎖的段落完成則經 `incompleteCards` 再呼叫 `cardIsComplete`，沒有 milestone 的 index 限制。`public/app.js:322-337` `public/viewmodel.js:519-554` `public/app.js:504-558`

### 3. 規則檔 `config`

1. **進卡。** `sectionForCheck` 把非 `skill-`／`ext-`／`demo-` id 歸到 `rules`，`groupChecks` 再依 `CARD_DEFINITIONS.rules` 分 Claude、Codex、共用；`flattenCheckCards` 把每筆 check 建成一張 `kind: "config"` 卡。`public/model.js:261-299` `public/model.js:332-375` `public/model.js:538-548`
   `runConfigCheck` 依 step kind 呼叫 `checkOutputStyle`、`checkHook`、`checkAllowlist`、`checkTabSync`、`checkAgentHooks` 或通用 `checkCopyStep`。`src/config-check.js:710-738`
   顯示 index 由 `renderWizard → currentCardIndex` 決定並釘在 `viewingCardIndex`；config check 由 `initialize`、工具／語言變更或手動重檢啟動，單純進卡或切 rules tab 只 render。`public/app.js:224-243` `public/app.js:1260-1287` `public/app.js:1309-1318`

2. **安裝按鈕。** config 版 `withActions` 在 `noInstall !== true && status !== "ok"` 時給 `installAction: "install-config-step"`，其餘給 `null`。`src/config-check.js:744-754`
   `configRowModel` 先算 `alreadyInstalled = status === "ok"`、`installationDone = installed || verified || alreadyInstalled`，再把「status ok、尚未 verified、且有 verifyAction 或 eyeCheck」定為 `pending`。`public/viewmodel.js:322-334`
   實際按鈕 action 優先用 `check.installAction`；若是 `pending` 且 `noInstall !== true`，即使後端 action 為 null 也補回 `install-config-step`。文字依序是未裝「安裝」、已裝待驗「重裝」且 secondary、完成「✅ 安裝」且 disabled/done。`public/viewmodel.js:339-369`
   若 action 仍為 null 且 `noInstall !== true`，會產生停用佔位，文字由 `installationDone` 決定「安裝」或「✅ 安裝」。`public/viewmodel.js:370-388`

3. **其他動作按鈕。** 「再 check 一次」的來源是 `showRetest = verifyAction != null && noInstall !== true`，`renderWizard` 再把 `row.showRetest` 傳給 View，點擊執行該 check 的 `verifyAction`。`public/viewmodel.js:414-418` `public/app.js:413-430` `public/view.js:436-444`
   規則卡不會顯示「開終端跑」，因該按鈕還要求 `noInstall === true`；即使規則的 `verifyKind === "terminal"`，其 `noInstall` 並非 true。`public/viewmodel.js:390-403`
   `checkCopyStep` 只有在 `protectExisting === true`、內容不同且尚未包含來源內容時回 `needsMerge: true`；`withActions` 才給 `mergeAction: "merge-config-step"`，`configRowModel` 才畫「用 AI 合併」。`src/config-check.js:126-141` `src/config-check.js:750-755` `public/viewmodel.js:405-412`

4. **下一張。** `installed` 要求本卡非 auth check 全部符合 `status === "ok"`，或本 session 已在 `installedSteps` 且 status 不是 `missing`；規則卡沒有 `noInstall` 例外。`public/app.js:285-303`
   `verificationRequired` 來自 `card.check.verifyAction` 或 `eyeCheck`；`verificationAttempted` 在無需驗證、`effectiveVerifiedSteps` 已含 id、或 `state.verificationAttempted` 已含 id 時為真。`public/app.js:304-309` `public/app.js:174-185`
   config 分支把以上三值與 `groups.manual` 傳給 `nextCardUnlocked`；結果要求 installed、必要驗證至少 attempted、所有人工項全勾，且 `showNext` 再要求不是本段末卡。`public/app.js:310-321` `public/viewmodel.js:702-713` `public/app.js:413-415`

5. **完成。** `cardIsComplete` 對 config 要求每個 check 經 `configRowModel(check, verifiedSteps.has(id)).status === "ok"`；有驗證規格而未 verified 的 `status: "ok"` 會先被 row model 改成 `unverified`。`public/viewmodel.js:496-501` `public/viewmodel.js:326-334`
   `effectiveVerifiedSteps` 由持久化的 `state.verifiedSteps` 起算，並把所有已勾的 `eye-*` 去前綴後加入；無 eye 的成功自動驗證會寫 `verifiedSteps`，有 eye 的成功驗證只先寫 `behaviorVerifiedSteps`。`public/app.js:174-185` `public/app.js:926-947`
   徽章使用 `cardIsComplete`；清單系統格用 `systemRowChecked`，人工格用 `checkedManualIds`；milestone 使用 `completedCardIds → cardsDone`；tab 段落完成使用 `incompleteCards → cardIsComplete`。`public/app.js:264-284` `public/app.js:322-377` `public/app.js:504-558` `public/viewmodel.js:590-646`

### 4. 內建 `skill` config

1. **進卡。** `sectionForCheck` 把 `skill-*` 歸到 `skills`，`CARD_DEFINITIONS.skills` 再按 `skill-claude-`／`skill-codex-` 分卡；每筆仍由 `checkCard` 建成 `kind: "config"`。`public/model.js:300-315` `public/model.js:332-342` `public/model.js:453-467`
   `runConfigCheck` 對 `kind === "skill"` 呼叫 `checkSkill`；它要求所有目標檔存在，且內容等於套用 substitutions 後的素材，回傳 `missing`、`warn` 或 `ok`。`src/config-check.js:626-671` `src/config-check.js:725-728`
   目前卡 index 與進卡是否重檢，和規則 config 相同：`currentCardIndex` 加 `viewingCardIndex`；自動 config check 只由 app 初始化等入口觸發，切 skills tab 只 render。`public/app.js:224-243` `public/app.js:1276-1287` `public/app.js:1309-1318`

2. **安裝按鈕。** `checkSkill` 本身只給 `status`；config 版 `withActions` 依 status 補 `installAction`，`configRowModel` 再依 `installed`、`verified`、`pending` 決定「安裝／重裝／✅ 安裝」或停用佔位。`src/config-check.js:626-671` `src/config-check.js:744-762` `public/viewmodel.js:322-388`

3. **其他動作按鈕。** skill id 有出現在 `VERIFICATION` 時，`withActions` 產生 terminal `verifyAction` 與可能的 `eyeCheck`，因此 `noInstall !== true` 時顯示「再 check 一次」；skill 沒有 `noInstall`，所以不顯示「開終端跑」。`src/config-check.js:235-274` `src/config-check.js:756-761` `public/viewmodel.js:390-418`
   `checkSkill` 不產生 `needsMerge`，故 `withActions` 的 `mergeAction` 為 null，不會產生「用 AI 合併」。`src/config-check.js:626-671` `src/config-check.js:750-755` `public/viewmodel.js:405-412`

4. **下一張。** skill 沿用 config 鏈：`status` 或 `installedSteps` 決定 installed，`VERIFICATION` 產生的 `verifyAction`／`eyeCheck` 決定 verificationRequired，執行紀錄或 effective verified 決定 verificationAttempted，人工 eye 全勾後由 `nextCardUnlocked` 放行。`public/app.js:285-321` `public/viewmodel.js:702-713`

5. **完成。** skill 沿用 config 的 `cardIsComplete → configRowModel(...).status === "ok"`；徽章與 tab 的實際完成走這條，清單與 milestone 分別走 `systemRowChecked/checklistGroups` 及 `completedCardIds/cardsDone`。`public/viewmodel.js:496-501` `public/app.js:264-337` `public/app.js:365-377` `public/app.js:504-558`

### 5. 第三方 `skill` config

1. **進卡。** `sectionForCheck` 把 `ext-*` 歸到 `skills`，再由 `CARD_DEFINITIONS.skills` 的 `/^ext-.*-(claude|codex)$/` 分卡。`public/model.js:300-315` `public/model.js:332-342`
   `runConfigCheck` 對 `kind === "external-skill"` 呼叫 `checkExternalSkill`；MCP 類只看 `mcpServers` 註冊，其他類只看 marker 是否存在。`src/config-check.js:674-695` `src/config-check.js:727-730`
   index 與自動檢查入口仍是 config 共用路徑；切到第三方 skill 卡本身不觸發 `checkConfigs`。`public/app.js:224-243` `public/app.js:1276-1287` `public/app.js:1309-1318`

2. **安裝按鈕。** `checkExternalSkill` 回 `ok` 或 `missing` 後，由 config `withActions` 在 missing 時給安裝 action；ok 且無待驗證時，`configRowModel` 產生停用「✅ 安裝」佔位。`src/config-check.js:674-695` `src/config-check.js:744-754` `public/viewmodel.js:322-388`
   Playwright 兩筆在 `VERIFICATION` 有 terminal 驗證；當結構 status 已 ok 但尚未 verified 時會成為 `pending`，row model 補回 install action並顯示 secondary「重裝」。`src/config-check.js:188-199` `public/viewmodel.js:326-369`

3. **其他動作按鈕。** 只有 `verifyAction != null && noInstall !== true` 的第三方 skill 顯示「再 check 一次」；目前 `VERIFICATION` 中的第三方 id 是兩筆 Playwright。`src/config-check.js:188-199` `public/viewmodel.js:414-418`
   第三方 skill 沒有 `noInstall: true` 與 `needsMerge: true`，所以不顯示「開終端跑」或「用 AI 合併」。`src/config-check.js:674-695` `public/viewmodel.js:390-412`

4. **下一張。** 第三方 skill 走 config 的 installed／verificationRequired／verificationAttempted／manualItems 鏈；無 `VERIFICATION` 的第三方項目在 status ok 時不要求驗證，有 `VERIFICATION` 的 Playwright 至少要留下 attempted 紀錄。`public/app.js:285-321` `src/config-check.js:188-199` `public/viewmodel.js:702-713`

5. **完成。** 無驗證規格的第三方項目在 `checkExternalSkill.status === "ok"` 時，`configRowModel` 保持 ok；Playwright 則還要求 `effectiveVerifiedSteps` 含該 id。四個顯示位置仍分別使用 config 共用的徽章、checklist、milestone、tab 鏈。`src/config-check.js:674-695` `public/viewmodel.js:326-334` `public/viewmodel.js:496-501` `public/app.js:264-377` `public/app.js:504-558`

### 6. `demo` config

1. **進卡。** `sectionForCheck` 把 `demo-*` 歸到 `demo`，`CARD_DEFINITIONS.demo` 分 Claude／Codex；`checkDemo` 固定回 `status: "ok"`、`noInstall: true`。`public/model.js:316-342` `src/config-check.js:700-708`
   demo 卡仍是 `kind: "config"`，index 走 `currentCardIndex` 與 `viewingCardIndex`；切 demo tab只 render，不會因進卡重跑 config check。`public/model.js:453-467` `public/app.js:224-243` `public/app.js:1276-1287`

2. **安裝按鈕。** config `withActions` 因 `noInstall === true` 把 `installAction` 設為 null；`configRowModel` 的 pending fallback 與停用佔位都排除 `noInstall === true`，所以 demo 沒有安裝按鈕。`src/config-check.js:744-754` `public/viewmodel.js:339-388`

3. **其他動作按鈕。** demo 在 `VERIFICATION` 有 terminal `verifyAction` 與 `eyeCheck`，又有 `noInstall === true`，因此 `configRowModel` 產生「開終端跑」。`src/config-check.js:255-267` `public/viewmodel.js:390-403`
   「再 check 一次」明確排除 `noInstall === true`；`checkDemo` 沒有 `needsMerge`，所以也沒有「用 AI 合併」。`public/viewmodel.js:405-418` `src/config-check.js:700-708`

4. **下一張。** `installed` 的 config 分支把 `noInstall === true` 視為已安裝；demo 的 `verifyAction/eyeCheck` 令 verificationRequired 為真，驗證執行成功或失敗都會把 id 加進 `verificationAttempted`，人工 eye 還必須全勾。`public/app.js:296-321` `public/app.js:810-823` `public/app.js:891-898`
   `showNext` 另要求不是 demo 段最後一張；因此最後一張即使 `nextUnlocked` 為真，也不畫「下一張」。`public/app.js:413-415` `public/view.js:474-486`

5. **完成。** demo 的 `check.status` 固定 ok，但有驗證規格時 `configRowModel` 在 effective verified 前把它改成 `unverified`；已勾的 `eye-demo-*` 會被 `effectiveVerifiedSteps` 轉成 demo id，令 `cardIsComplete` 成真。`src/config-check.js:700-708` `public/viewmodel.js:326-334` `public/app.js:174-185` `public/viewmodel.js:496-501`
   徽章、清單、milestone、tab 仍分別走 config 共用的四條判斷；其中 checklist 的系統格看 `systemRowChecked`，人工格看 eye checkbox。`public/app.js:264-377` `public/viewmodel.js:590-646` `public/app.js:504-558`

## 三、同一件事有幾種判法

| 顯示位置 | 實際判斷 | 與其他位置是否一致 |
|---|---|---|
| 卡片右上角徽章 | `renderWizard` 把 `cardIsComplete(card, effectiveVerifiedSteps, manualCheckedIds)` 傳入 `cardStatusModel.completed`；但徽章優先序是 running、completed、failed、installed，所以 running 時不顯示「已完成」。`public/app.js:365-377` `public/viewmodel.js:62-79` | setup 看 `completed`；env 看全 checks status ok 加 manualIds；config 看 `configRowModel(...).status === "ok"`。這是 `cardIsComplete` 的直接使用者。`public/viewmodel.js:477-502` |
| 卡內清單 N/M | env 系統格看每個 check 的 `status === "ok"`；config 系統格看 `systemRowChecked`；人工格看 `checkedManualIds`。View 將 system＋manual 中 `checked` 的數量顯示成 N/M。`public/app.js:264-284` `public/viewmodel.js:590-646` `public/view.js:277-295` | 不直接呼叫 `cardIsComplete`，是逐列、逐人工項各判；setup 根本不顯示清單。`public/app.js:385-392` |
| 進度條 milestone | `completedCardIds` 先接受 setup completed、`cardIsComplete`、目前卡的 `nextUnlocked`，以及其他卡的 `verificationAttempted && installedSteps`；`cardsDone` 再加 `index <= currentIndex`。`public/app.js:322-337` `public/viewmodel.js:519-554` | 部分使用 `cardIsComplete`，但另有 `nextUnlocked`、attempted＋installed 與已走到該 index 三條額外條件，因此不是徽章的同一判法。`public/app.js:322-337` |
| tab 解鎖 | `sectionCompletion → incompleteCards`；setup 看 `completed`，其他卡呼叫 `cardIsComplete`。`sectionGateState` 再檢查前一段為 false 與 SECTION_GATES 缺項，`renderSectionLocks` 才畫鎖。`public/app.js:504-558` `public/model.js:203-259` `public/view.js:517-524` | 「上一段是否完成」與徽章共用 `cardIsComplete` 的核心判斷，沒有 milestone 的 index 限制；tab 最後還有 section gate 條件。`public/app.js:518-558` |

`sectionStatus` 是第五個完成相關文字：它與 milestone 共用 `cardsDone`，所以「這一段已完成」也受 `completedCardIds` 與 `index <= currentIndex` 影響。`public/viewmodel.js:519-562` `public/app.js:468-475`

## 四、觀察到的不一致

1. **config 的「下一張」只要求驗證嘗試過，徽章與 tab 要求驗證完成。** 失敗驗證也會加入 `verificationAttempted`；只要 installed 與 manual 條件成立，`nextCardUnlocked` 可為真，但 `cardIsComplete` 仍因沒有 effective verified 而為假。`public/app.js:304-321` `public/app.js:810-823` `public/viewmodel.js:496-501` `public/viewmodel.js:702-713`

2. **目前卡的 milestone 可用 `nextUnlocked` 算完成，右上徽章只用 `cardIsComplete`。** 同一張 config 卡在「驗證失敗但已嘗試、其他條件成立」時，milestone 可 `completed/reached`，徽章仍不是 complete。`public/app.js:322-377` `public/viewmodel.js:531-554`

3. **非目前卡的 milestone 還有 `verificationAttempted && installedSteps` 路徑。** 這條路不檢查驗證是否成功、check 最新 status 或人工項；徽章與 tab 沒有這條完成路徑。`public/app.js:322-331` `public/app.js:365-377` `public/app.js:504-530`

4. **milestone／段落狀態要求卡片已走到，tab 段落完成不要求。** `cardsDone` 會排除 `index > currentIndex` 的卡，即使其 id 已在 `completedCardIds`；`incompleteCards` 只看 `cardIsComplete`，沒有 index 條件。`public/viewmodel.js:519-562` `public/app.js:504-530`

5. **config 後端的 `installAction: null` 不等於畫面沒有安裝動作。** 後端在 status ok 時把 action 設 null；前端遇到 status ok 但待驗證的非 demo 卡，會補回 `install-config-step` 並顯示「重裝」，其他 action-null 非 demo 卡則補停用佔位。`src/config-check.js:744-754` `public/viewmodel.js:326-388`

6. **env 的 install spec 有兩個補按鈕位置。** `envRowModel` 依 `installed && hasInstaller !== false` 補「✅ 安裝」；`envCardRowModel` 若沒取到該 spec但 `hasInstaller !== false`，另補停用「安裝」，兩處使用的條件與文字不同。`public/viewmodel.js:167-190` `public/viewmodel.js:227-254`

7. **徽章在 running 時不顯示完成，其他完成顯示不套這個優先序。** `cardStatusModel` 先判 running 再判 completed；checklist、milestone、tab 不讀 `runInProgress`。`public/viewmodel.js:62-79` `public/app.js:264-337` `public/app.js:365-377` `public/app.js:504-558`
