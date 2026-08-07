# 帮一个新的笔记库接上 GitHub

课堂那本在安装时就接好了。这一份是**之后**用户自己新开一本笔记库、想要一样
自动同步时照着做的步骤。

用户说「这本也帮我接到 GitHub」的时候照这个顺序做。每一步都先确认再动手，
已经有的就跳过。

**0. 确认它真的是笔记库**：那个文件夹底下要有 `.obsidian`。没有的话先问清楚。

**1. 起版本控制**

```bash
git -C <vault> init -b main
```

**2. 不要进版本控制的东西**

写一份 `<vault>/.gitignore`：

```
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.obsidian/cache
.trash/
.DS_Store
.obsidian/plugins/obsidian-git/.git_credentials_input
```

`workspace.json` 记的是「现在开了哪几个标签页」，每切一次就变一次——不挡掉的话它是
冲突的最大来源。

**3. 建 GitHub 上那一份**（私有的）

```bash
gh repo create <名字> --private
```

回「Name already exists」代表他之前建过。这时候不要重建，改成接上去：

```bash
git -C <vault> remote add origin $(gh repo view <名字> --json url --jq .url)
```

```bash
git -C <vault> fetch origin
```

远端已经有东西的话，先把它当基础再叠上去——不然两段历史没有关系，push 会被挡：

```bash
git -C <vault> reset --mixed origin/main
```

**4. 装同步插件**

三个文件放进 `<vault>/.obsidian/plugins/obsidian-git/` 就等于装好了：

```bash
curl -fL --silent -o <vault>/.obsidian/plugins/obsidian-git/main.js https://github.com/Vinzent03/obsidian-git/releases/latest/download/main.js
```

（`manifest.json` 与 `styles.css` 同一个网址换文件名，各抓一次。）

再写 `<vault>/.obsidian/community-plugins.json`，内容是 `["obsidian-git"]`——
没有这一份的话文件在、插件却是关的。

**5. 设置成跟课堂那本一样**

写 `<vault>/.obsidian/plugins/obsidian-git/data.json`：

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

意思是：打开就先拉最新的、每 10 分钟自己存一次、推之前先拉。

⚠️ **这几个 key 的名字不能改**。写错的 key 会被安静忽略——设置看起来写进去了，
行为却是默认值，而画面上没有任何错误。

**6. 存起来、推上去**（走「推上去」那一节）

**7. 最后告诉他**：Obsidian 要**完全关掉再打开**那本笔记库，插件才会加载；
第一次打开会问「要不要信任这个文件夹的插件」，要选信任。
