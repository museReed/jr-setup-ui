export function buildTerminalLaunch(commandLine, platform) {
  if (platform === "win32") {
    return {
      cmd: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        "start",
        "",
        "cmd.exe",
        "/k",
        commandLine,
      ],
    };
  }

  if (platform === "darwin") {
    return {
      cmd: "osascript",
      args: [
        "-e",
        `tell application "Terminal" to do script "${commandLine}"`,
      ],
    };
  }

  return null;
}
