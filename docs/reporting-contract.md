# 回報契約 v1

嚮導（學生的電腦）與回報服務之間的介面。三邊——遮罩函式、嚮導的回報模組、後端的
Edge Function——照這份各自開工，不用等對方。

服務端還沒建；這份文件先定契約，之後後端 repo 直接引用這一份，不要各留一份。

## 為什麼是「嚮導只打端點」而不是直連資料庫

嚮導是公開下載的，塞在裡面的任何金鑰等於公開。所以它不能拿到能直接寫資料庫的
東西——真正有權限的鑰匙只待在服務端，嚮導只送「動作」。

這跟嚮導自己的設計是同一條規則的反向：網頁端只能傳代號、可執行的白名單寫死在本機
（見 README）。這裡是服務端不信任嚮導，所以權限判斷寫死在服務端。

## 共用約定

所有端點都是 `POST` + `Content-Type: application/json`，帶
`Authorization: Bearer <device_token>`（`/bind` 除外，它就是來換 token 的）。

每個請求的 body 頂層都有這三個欄位：

```json
{
  "event_id": "uuid-v4",
  "at": "2026-08-04T09:12:33Z",
  "wizard_version": "v2026-08-04"
}
```

`event_id` 是必要的：離線補送會重送同一筆，服務端靠它去重。

`at` 是學生機器的時鐘，可能不準；服務端另外記 `received_at`。兩個都留，排錯時才
看得出時差。

---

## 1. `POST /bind`

一台機器只做一次：用報到頁給的 6 碼換長期 token。

```json
// 請求（不帶 Authorization）
{
  "join_code": "K7M2Q9",
  "install_id": "uuid-v4",
  "os": { "platform": "win32", "arch": "x64" },
  "wizard_version": "v2026-08-04"
}

// 200
{
  "device_token": "…",
  "class_code": "KCL-0804",
  "student": { "name": "王小明", "avatar_url": "https://…" }
}
```

`install_id` 由嚮導產生後存進 `state.json`。重灌或重跑 `bind` 時帶同一個 id，
服務端就知道這是換發 token 而不是多一個學生。

回傳 `student` 是為了讓嚮導能顯示「你已綁定為 王小明」——學生要看得到自己綁對人。

失敗：`404` 代碼不存在、`410` 代碼過期。

---

## 2. `POST /report`

進度，自動送。學生可以關掉。

```json
{
  "event_id": "…", "at": "…", "wizard_version": "…",
  "kind": "card",
  "section": "env",
  "card_id": "claude",
  "card_status": "done",
  "checks": [
    { "id": "claude", "status": "ok" },
    { "id": "claude-auth", "status": "warn" }
  ],
  "run": {
    "action": "login-claude",
    "exit_code": 1,
    "signal": null,
    "ms": 42310
  }
}
```

回應 `204`，不回內容。

| 欄位 | 值 |
|---|---|
| `kind` | `heartbeat` / `card` / `action` / `section` |
| `section` | `env` / `rules` / `skills` / `demo` |
| `card_id` | 卡片的 checkId，例如 `env-config`、`claude`、`tab-sync` |
| `card_status` | `pending` / `done` / `failed` |
| `checks[].status` | `ok` / `warn` / `missing`（跟 `/env` 回的同一組值） |
| `run` | 只有 `kind: "action"` 才有 |
| `checks` | 可省略。心跳不用送，狀態變動時送一次全量 |

心跳每 30 秒一次（`kind: "heartbeat"`，只帶 `section` 與 `card_id`）。儀表板的
「多久沒動」就是拿最後一筆的 `received_at` 算出來的——那一欄比進度條有用，它才是
「該過去看看」的訊號。

---

## 3. `POST /submit-log`

錯誤包，學生按按鈕才送。按下去就是明確同意。

```json
{
  "event_id": "…", "at": "…", "wizard_version": "…",
  "card_id": "claude",
  "action": "login-claude",
  "exit_code": 1,
  "signal": null,
  "fingerprint": "3f2a91c0d5e7b418",
  "error_head": "running scripts is disabled on this system",
  "log": "…（已遮罩，≤32KB）…",
  "truncated": false,
  "redact_v": 1,
  "env": {
    "platform": "win32",
    "os_version": "10.0.22631",
    "node": "v24.18.0",
    "powershell": "5.1.22621.4391",
    "execution_policy": "Restricted",
    "checks": [{ "id": "claude", "status": "ok" }]
  }
}

// 200
{
  "ticket_id": "…",
  "fix": {
    "title": "PowerShell 擋掉了腳本",
    "body": "先做「讓電腦願意跑課堂指令」那張卡…",
    "source": "fingerprint"
  }
}
```

`fix` 沒有已知解法時是 `null`。回應直接帶 `fix` 等於 submit 與 lookup 合一，
少一個往返。

### `fingerprint` 的定義（不能改，改了整個指紋庫失效）

1. 取 stderr 最後 20 行
2. 移除：路徑、數字、hex 串、時間戳、引號裡的內容
3. 取前 500 字
4. `sha256`，取前 16 個 hex

### `error_head`

正規化後的前 200 字。**拿去做 embedding 的是這一段，不是整份 log**——整份丟進去，
相似度會被路徑與時間戳主導，語意搜尋就失去意義。

### `redact_v`

遮罩規則的版本。之後改規則時，分得出哪些舊資料是用舊規則遮的。

---

## 4. `POST /lookup`

還沒送 log、只想先查有沒有人踩過。出錯當下嚮導自動打一次。

```json
{
  "fingerprint": "3f2a91c0d5e7b418",
  "error_head": "running scripts is disabled on this system",
  "card_id": "claude",
  "os": "win32"
}

// 200
{
  "fix": { "title": "…", "body": "…", "source": "fingerprint" },
  "similar": [
    { "title": "…", "score": 0.83, "ticket_id": "…" }
  ]
}
```

查詢順序寫死在服務端：**指紋精確命中 → 沒有就向量近似 → 都沒有回 `null`**。

`similar` 只有在指紋沒命中時才有內容。嚮導不需要知道走了哪一條，看 `source` 就好。

---

## 遮罩清單 v1（`redact_v: 1`）

送出前在嚮導做一次（學生看得到自己送什麼），服務端收到後再做一次（不能信任學生
機器上的程式碼）。

| # | 型態 | 從哪來 | 規則 |
|---|---|---|---|
| 1 | 嚮導網址的 token | `bin/jr-setup-ui.js` 印出的 `?t=<48 hex>` | `([?&]t=)[0-9a-f]{16,}` → `$1<redacted>` |
| 2 | OAuth 授權網址 | 登入指令的輸出，含 `code=` / `state=` | 只留 host，query 整段換掉 |
| 3 | 裝置授權碼 | `src/login-hints.js` 抓的 `\b[A-Z0-9]{3,6}-[A-Z0-9]{3,6}\b` | 同一條 regex → `<code>` |
| 4 | 學生貼回終端的授權碼 | `/input` 收到的內容 | **根本不要寫進 log** |
| 5 | 家目錄路徑 | `homedir()`，幾乎每一行路徑都有 | `C:\Users\X`、`/Users/X`、`/home/X` → `<home>` |
| 6 | 機器名 | PowerShell prompt、部分錯誤訊息 | 用實際 hostname 做字面替換 |
| 7 | email | `gh auth` / `git config` 的輸出 | `[\w.+-]+@[\w-]+\.[\w.]+` → `<email>` |
| 8 | API key 字面 | 環境變數出現在輸出時 | `(sk-ant-\|sk-\|ghp_\|gho_\|github_pat_)[A-Za-z0-9_\-]{16,}` → `<key>` |

第 1 條不是隱私問題是安全問題：那個 token 就是那台嚮導的控制權。

**不要遮的**：版本號、exit code、錯誤代碼、去掉家目錄後的檔名、指令名稱。遮過頭
會讓 log 變成一堆 `<redacted>`，那就白收了。

**怎麼驗**：拿真實 log 當 fixture，寫否定斷言——遮完之後在結果裡 grep 那幾個
pattern 必須零命中。

⚠️ 這份清單今天就適用，不是只為了回報系統：`scripts/explain-output.mjs` 會把原始
輸出丟給 `claude` 產生白話版，那條路已經讓輸出離開學生的電腦了。

---

## 學生端的失敗行為（也是契約的一部分）

| 情況 | 行為 |
|---|---|
| 網路不通 / 5xx | 安靜放棄，寫進本機佇列（最多 20 筆），下次啟動補送 |
| `401` token 失效 | 提示「請重新貼一次報到代碼」，不要一直重試 |
| 任何錯誤 | **絕對不能影響安裝流程**——回報壞掉不該讓學生裝不了東西 |

## 還沒定（不擋開工）

- `fix.body` 用 Markdown 還是純文字（影響嚮導怎麼顯示）
- 心跳 30 秒是不是太密（30 人每分鐘 60 筆，先這樣）
- `env.checks` 要不要每次全量送（現在允許省略，先全送最簡單）
- 原始 log 的保留期
