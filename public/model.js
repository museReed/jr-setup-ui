// Model（domain）：不依賴任何人的那一層。
//
// 這裡放「規則本身」——哪些工具組合、哪些語言是合法的，以及怎麼把它們變成一次
// 查詢。View / ViewModel / API 都往這裡依賴，這裡不往外依賴任何一層。
//
// 為什麼要獨立出來：原本這幾樣住在 viewmodel.js，而 api.js（跟 server 講話的那層）
// 得 import 它才組得出 /configs 的查詢字串——資料層反過來依賴呈現層，箭頭反了。
// 搬到這裡之後兩邊都只往內指。

export const CONFIG_LANGUAGES = ["zh-TW", "zh-CN", "en"];

export const CONFIG_TOOL_CHOICES = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex CLI" },
  { value: "claude,codex", label: "兩個都要" },
];

export function configQuery({ tools, lang }) {
  const toolValues = CONFIG_TOOL_CHOICES.map((choice) => choice.value);

  if (!toolValues.includes(tools) || !CONFIG_LANGUAGES.includes(lang)) {
    throw new Error("規則檔工具或語言不合法");
  }

  return `tools=${tools}&lang=${lang}`;
}
