简体中文 | [English](README.md)

# dsh-attachment

DeepSeek Harness(dsh)的第三方附件插件:**把任何文件带进会话,零类型拒绝**。

- **所有文件(含图片)统一走暂存管线**:文件落盘到会话工作区
  `<cwd>/.dsh/uploads/` 并按会话暂存,composer 上方出现卡片(图标块 +
  文件名 + 大小 + ✕)。不再使用宿主原生图片草稿管线
  (`createDraftImages`/`addImages` 均未使用);模型需要看图时,用 harness
  原生的 `read_image` 工具按路径读取——非视觉模型也不会被「模型不支持
  图片」堵住发送。
- **草稿完全干净**,输入框里绝不出现引用文本。用户下一条消息进入模型
  请求时,宿主在 `agent/pre-step` 波形里把附件清单折进批次,作为
  `source: { kind: 'user' }` 的消息(插在你的消息之前,与官方
  dsh-agent-instructions 的注入模式同构)——模型可见即落日志,回放安全。
  注入(消费)后卡片自动消失。
- 认不认、怎么处理,是模型和它的工具/技能的事。插件不做类型预判,也就
  没有「不支持的格式」这种拒绝;唯一的硬限制是单文件 32MB 的 RPC 传输
  上限(更大的文件直接放进项目目录再在消息里写路径)。

## 入口

1. **回形针按钮**(输入框工具栏左端):文件选择器,多选,无 accept 过滤;
2. **全窗拖拽**:拖文件进窗口出现遮罩提示,松手即带入;
3. **粘贴**:文件粘贴直达同一分诊;粘贴含附件引用行(`📎 … → .dsh/uploads/…`,
   如从历史消息复制)的文本时自动再物化成卡片。

## 附件卡片

落盘的附件在 composer 上方(`conversation.input.dock`)逐个成卡:扩展名
图标块 + 文件名 + 大小 + ✕。✕ 同时移出暂存并删除落盘文件;图片卡带本地
缩略图。卡片以宿主 pending 为真相源(`listStash`),经 2 秒轮询刷新——
发送消费后卡片自动消失。点卡片打开预览弹层:图片直接渲染,文本/代码按
纯文本渲染,其余类型提供「用系统应用打开」;弹层头部的「复制引用」复制
的是附件的文本协议形态,粘贴回输入框即等同重新携带。

## 架构

- **宿主端**(`lib/index.js`):`AttachmentsGateway` 继承
  `TypertRemoteService`,以 `fileStash` 命名空间提供**六个 RPC**:
  `stashFile`/`removeStash`/`restageFile`/`clearStash`/`readStash`/
  `listStash`。路径安全:只写 `<cwd>/.dsh/uploads/`,文件名白名单化 +
  时间戳前缀,撤回/预览路径 resolve 后做前缀校验。第三方双副本场景下
  SRC 发现失明,同时注册弱(src-json)清单进宿主 typert registry。
- **浏览器端**(`lib/client.js`):$mount 手写 strict zod 描述符,暴露
  `ctx.remote.fileStash`;按钮注册 `conversation.input.left`,卡片栏注册
  `conversation.input.dock`;全窗拖拽/粘贴经 store 捕捉的「当前 composer」
  上下文路由到目标会话。宿主在 `agent/pre-step` 把暂存附件折进决策。
- **国际化**:zh/en 双语词典经宿主 locale 服务注册(命名空间
  `dsh-attachment`)。槽组件拿到标准响应式 `t` 席位;窗口级模块(拖拽
  遮罩、预览、历史卡、分诊 toast)经命名空间绑定的 t 在调用时取词。宿主
  RPC 失败携带稳定 dot-code 与 `{name}` 模板参数(如
  `stash.err.tooLarge` + `{max}`),同时保留中文兜底文案——客户端词典命中
  code 即本地化渲染,未命中回退兜底。注入模型历史的 `📎 … → 路径` 引用行
  是文本协议,绝不本地化。

## 安装

```sh
dsh plugin --profile web add dsh-attachment
```

或从 GitHub 安装:`dsh plugin --profile web add github:CocoSgt/dsh-attachment`。

安装后重启 `dsh web`。卸载:`dsh plugin --profile web remove dsh-attachment`。

## 已知限制

- 落盘需要会话有工作区目录(cwd)。**无工作区的会话,一切文件类型都会
  失败**——附件无处安放。
- 单文件 32MB 传输上限(JSON wire 的现实约束),超限明确报错不静默。
- 附件暂存是宿主内存态:dsh 重启后未发送的卡片消失(文件仍在 uploads
  目录,可重新拖入);同一会话多端打开时卡片如实跟随宿主状态:页面
  打开/刷新绝不清空暂存(加载只读),任一端发送即在所有端消费掉待发
  条目(卡片经轮询消失;落盘文件保留,已发送消息还引用着它),只有
  卡片 ✕ 会删除文件。
- `.dsh/uploads/` 不自动清理;卡片 ✕ 会删除对应文件,已发送消息引用过的
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
