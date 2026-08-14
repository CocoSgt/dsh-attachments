# dsh-file-upload

DeepSeek Harness（dsh）的文件上传插件：在输入框工具栏左端加一个回形针附件按钮，
点开系统的多选文件选择器，按文件类型分流落位。

## 功能

- **附件按钮**：注册进 `conversation.input.left` 槽（输入框工具栏左端、`[+]` 命令按钮
  之后的列表位），28×28 幽灵图标按钮，中英文按浏览器语言自动切换提示文案。
- **图片**（png / jpeg / webp / gif）：走 dsh **原生附件管线**
  （`ConversationController.createDraftImages` + 输入机 `addImages`），与内置的
  粘贴图片完全同一条路径 —— 输入框上方出现内置 AttachmentRail 缩略图栏
  （64px 缩略图、可横滚、可逐张移除、可点开大图），随消息以 base64 image 块发出。
- **文本类文件**（代码 / 配置 / Markdown / 日志等，按 MIME 与扩展名识别）：
  读出内容，以带文件名、大小、行数标注的围栏代码块**追加进输入框草稿**，
  发送时就是普通文本。单个文件超过 256 KB 截断并标注；单批最多内联 8 个文本文件。
- **其余二进制文件**：明确拒绝，通过输入框上方的错误横幅提示
  「已忽略 N 个文件（仅支持图片与文本类文件）：…」。

## 为什么文本文件是「内联进草稿」而不是附件卡片

dsh 的发送管线（内容块类型、宿主附件存储、消息序列化）目前**只接受图片附件**：
`ContentBlock` 只有 text / image 等类型，没有文件块；插件也没有提交钩子可以在
发送时改写消息。因此在现有插件接口下，文本类文件唯一能真正到达模型的路径就是
作为文本进入草稿。本插件选择把这个路径做到最好（标注清晰、带语言高亮围栏、
自动截断保护），而不是做一个发不出去的假附件卡片。

## 安装

要求：dsh（DeepSeek Harness 官方版，含 `dsh plugin` 命令）。

```bash
# 从 GitHub 安装到 web profile
dsh plugin --profile web add CocoSgt/dsh-file-upload

# 本地开发（link 方式）
dsh plugin --profile web add /path/to/dsh-file-upload
```

安装后（重新）启动 `dsh --profile web` 即生效；侧边栏无需其它配置。

卸载：

```bash
dsh plugin --profile web remove dsh-file-upload
```

## 使用

1. 打开一个工作区会话（无会话的首页不显示输入工具栏，按钮自然也不在）。
2. 点输入框左下角工具栏上的回形针按钮 → 系统文件选择器（可多选）。
3. 按上文「功能」一节分流：图片进缩略图栏，文本进草稿，二进制报错。

## 构建

```bash
pnpm install
pnpm check   # tsc 类型检查
pnpm build   # 产出 lib/index.js（node 半体）与 lib/client.js（浏览器半体）
```

产物契约与官方 `packages/client/tsdown.client.ts` 一致：浏览器半体是
`window.__ModuleLoader__.load({ id, factory })` 形式的 CJS 闭包，运行时
`require` 只命中 shell 的平台种子模块表（react、`@deepseek-ai/cordis`、
ui-slots、ui-primitives 等），其余代码全部内联。

## 架构

```
cordis.patch.yml     bundle patch：向配置树插入本插件一行
                    （host 半体加载锚点 + client-modules 扫描锚点）
src/index.ts        node 半体：空 apply（本插件无 host 侧逻辑）
src/client/index.ts 浏览器半体：ctx.slots.inject('conversation.input.left', …)
src/client/AttachButton.tsx  回形针按钮 + 隐藏 file input
src/client/intake.ts        文件分诊（图片/文本/拒绝）与落位逻辑
```

- cordis 层 `inject: ['slots', 'sessions', 'conversation']` —— conversation
  服务（ui-conversation 插件）未就绪时本插件停驻等待，先加载也不会崩。
- 与宿主的协作全部走 cordis 服务与槽位系统，不跨包值引用，可与其他插件
  独立或合并加载（槽位 id、包名、bundle id 均为 `dsh-file-upload` / `file-upload`，
  无命名冲突面）。

## 已知限制

- **图片走具体控制器方法**：dsh 对外冻结的服务接口 `IConversation` 不含
  `createDraftImages`，本插件与官方 ui-conversation 内部接线一样，通过
  `ctx.get('conversation')` 拿到具体对象后调用。上游若重构该方法名，图片
  路径会失效（会以输入框错误横幅报告，不影响文本路径）。
- 文本文件超出 256 KB 截断；一批超过 8 个文本文件时多出的按拒绝处理。
- 拖拽整个页面的文件仍走 dsh 内置行为（仅图片）；本插件不接管全局拖放。
- 无会话的首页（选择工作区的 hero 态）不渲染输入工具栏，按钮只在有会话后出现。
