# dsh-attachments

DeepSeek Harness(dsh)的第三方附件插件:**把任何文件带进会话,零类型拒绝**。

- **图片**(png/jpeg/webp/gif)→ 原生附件管线,缩略图进内置附件栏;
- **其余一切文件**(文本、PDF、压缩包、数据库……)→ 落盘到会话工作区
  `<cwd>/.dsh/uploads/` 并按会话暂存,composer 上方出现平台级卡片
  (图标块 + 文件名 + 大小 + ✕)。**草稿完全干净,不写任何引用文本**:
  发送时宿主在 `agent/pre-step` 波形里把附件清单作为一条 `plugin` 来源
  的消息折进模型请求(紧跟你的消息之后),与官方 agent-instructions 的
  注入模式同构——模型可见即落日志,回放安全。注入后卡片自动消失
  (卡片以宿主暂存为真相源,会话出现新消息节点时重新拉取)。

认不认、怎么处理,是模型和它的工具/技能的事——模型拿到路径后自己会 read、
跑脚本、调 pdf/xlsx 技能。插件不做类型预判,也就没有「不支持的格式」这种
拒绝;唯一的硬限制是单文件 32MB 的 RPC 传输上限(更大的文件直接放进项目
目录再在消息里写路径)。

## 入口

1. **回形针按钮**(输入框工具栏左端):文件选择器,多选,无 accept 过滤;
2. **全窗拖拽**:拖文件进窗口出现遮罩提示,松手即带入;
3. **粘贴**:非图片文件粘贴直达(图片粘贴由宿主原生管线处理,不重复落位)。

## 附件卡片

落盘的附件在 composer 上方(`conversation.input.dock`)逐个成卡:扩展名
图标块 + 文件名 + 大小 + ✕。✕ 同时移出暂存并删除落盘文件。图片的缩略图
与移除由宿主原生附件栏负责,卡片栏只管落盘文件。全窗拖拽遮罩为居中
卡片样式(「拖放文件加入对话」)。

## 架构

- **宿主端**(`lib/index.js`):`AttachmentsGateway` 继承 `TypertRemoteService`,
  暴露 `attachments/stashFile|removeStash` 两个 RPC。路径安全:只写
  `<cwd>/.dsh/uploads/`,文件名白名单化 + 时间戳前缀,撤回路径 resolve 后
  前缀校验。第三方双副本场景下 SRC 发现失明,同时注册弱(src-json)清单进
  宿主 typert registry。
- **浏览器端**(`lib/client.js`):$mount 手写 strict zod 描述符 →
  `ctx.remote.attachments`;按钮注册 `conversation.input.left`,chip 栏注册
  `conversation.input.dock`(session 槽标准 props 自带 inputActions);全窗
  拖拽/粘贴经 store 捕捉的「当前 composer」上下文路由到目标会话。

## 安装

```sh
dsh plugin --profile web add /path/to/dsh-attachments
```

安装后重启 `dsh web`。卸载:`dsh plugin --profile web remove dsh-attachments`。

## 已知限制

- 非图片附件需要会话有工作区目录(cwd);无工作区的会话只支持图片。
- 单文件 32MB 传输上限(JSON wire 的现实约束),超限明确报错不静默。
- 附件暂存是宿主内存态:dsh 重启后未发送的卡片消失(文件仍在 uploads
  目录,可重新拖入);同一会话多端打开时卡片以宿主状态为准。
- `.dsh/uploads/` 不自动清理;chip ✕ 会删除对应文件,已发送消息引用过的
  文件建议保留(会话历史里的路径还指着它)。

## 开发

```sh
pnpm install
pnpm run check   # tsc --noEmit
pnpm run build   # tsdown(宿主 + 浏览器 bundle)
```

注意:宿主方法参数名就是 RPC wire 字段名(Gateway SRC 模式),构建不得
压缩改写参数名。

## 许可

MIT
