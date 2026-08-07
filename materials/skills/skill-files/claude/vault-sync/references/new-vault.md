# 幫一個新的筆記庫接上 GitHub

課堂那本在安裝時就接好了。這一份是**之後**使用者自己新開一本筆記庫、想要一樣
自動同步時照著做的步驟。

使用者說「這本也幫我接到 GitHub」的時候照這個順序做。每一步都先確認再動手，
已經有的就跳過。

**0. 確認它真的是筆記庫**：那個資料夾底下要有 `.obsidian`。沒有的話先問清楚。

**1. 起版控**

```bash
git -C <vault> init -b main
```

**2. 不要進版控的東西**

寫一份 `<vault>/.gitignore`：

```
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.obsidian/cache
.trash/
.DS_Store
.obsidian/plugins/obsidian-git/.git_credentials_input
```

`workspace.json` 記的是「現在開了哪幾個分頁」，每切一次就變一次——不擋掉的話它是
衝突的最大來源。

**3. 建 GitHub 上那一份**（私人的）

```bash
gh repo create <名字> --private
```

回「Name already exists」代表他之前建過。這時候不要重建，改成接上去：

```bash
git -C <vault> remote add origin $(gh repo view <名字> --json url --jq .url)
```

```bash
git -C <vault> fetch origin
```

遠端已經有東西的話，先把它當基礎再疊上去——不然兩段歷史沒有關係，push 會被擋：

```bash
git -C <vault> reset --mixed origin/main
```

**4. 裝同步外掛**

三個檔放進 `<vault>/.obsidian/plugins/obsidian-git/` 就等於裝好了：

```bash
curl -fL --silent -o <vault>/.obsidian/plugins/obsidian-git/main.js https://github.com/Vinzent03/obsidian-git/releases/latest/download/main.js
```

（`manifest.json` 與 `styles.css` 同一個網址換檔名，各抓一次。）

再寫 `<vault>/.obsidian/community-plugins.json`，內容是 `["obsidian-git"]`——
沒有這一份的話檔案在、外掛卻是關的。

**5. 設定成跟課堂那本一樣**

寫 `<vault>/.obsidian/plugins/obsidian-git/data.json`：

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

意思是：打開就先抓最新的、每 10 分鐘自己存一次、推之前先拉。

⚠️ **這幾個 key 的名字不能改**。寫錯的 key 會被安靜忽略——設定看起來寫進去了，
行為卻是預設值，而畫面上沒有任何錯誤。

**6. 存起來、推上去**（走「推上去」那一節）

**7. 最後告訴他**：Obsidian 要**完全關掉再打開**那本筆記庫，外掛才會載入；
第一次打開會問「要不要信任這個資料夾的外掛」，要選信任。
