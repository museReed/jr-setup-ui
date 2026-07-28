// Node 20 起，spawn 在 shell:false 下執行 .cmd / .bat 會直接丟 EINVAL
// （BatBadBut 漏洞的修補，CVE-2024-27980）。Windows 上 npm 裝出來的 CLI
// 都是這種包裝檔，所以必須改成交給 cmd.exe 執行。
//
// ⚠️ 只能用在「指令與參數都寫死在程式裡」的情況。cmd.exe 有自己的一套
// 引號與跳脫規則，把外部輸入（例如使用者打的 prompt）當參數傳過去
// 可能被注入。使用者輸入要走的路見 README / spike-log。
const WRAPPED_EXTENSIONS = [".cmd", ".bat"];

export function needsCmdWrapper(cmd, platform = process.platform) {
  if (platform !== "win32") {
    return false;
  }

  const lower = cmd.toLowerCase();
  return WRAPPED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function resolveSpawn(cmd, args, platform = process.platform) {
  if (!needsCmdWrapper(cmd, platform)) {
    return { cmd, args };
  }

  // /d 不跑 AutoRun、/s 讓引號處理可預測、/c 執行完就結束。
  return { cmd: "cmd.exe", args: ["/d", "/s", "/c", cmd, ...args] };
}
