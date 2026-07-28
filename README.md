# jr-setup-ui

Workshop 安裝嚮導：同學在自己電腦上跑一行指令，開一個本機網頁 UI，
按按鈕就完成環境設定與 skill 安裝。

## 同學怎麼用

不需要先裝任何東西，貼一行指令就好。

**macOS**（終端機）

```bash
curl -fsSL https://musereed.github.io/jr-setup-ui/setup.sh | bash
```

**Windows**（PowerShell）

```powershell
irm https://raw.githubusercontent.com/museReed/jr-setup-ui/main/docs/setup.ps1 | iex
```

腳本會裝好 Node（macOS 另外裝 Homebrew）、抓下嚮導、啟動網頁。
給同學的說明頁：<https://musereed.github.io/jr-setup-ui/>

## 設計要點

- 網頁跑在**同學自己的電腦**（`127.0.0.1`），不是遠端 server。
- 官網（Cloudflare Pages）只負責顯示安裝指令與接收回報，**不能指揮任何電腦**。
- 可執行的指令是一張寫死在本機的白名單，網路端只能傳「代號」。

架構圖與完整規劃見 `docs/`。

## 現況

Spike 階段：驗證「網頁按鈕 → 執行 CLI → 輸出即時串流回頁面」這條路。
