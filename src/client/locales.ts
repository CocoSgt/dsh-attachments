/**
 * zh/en 双语词典(命名空间 'dsh-attachments')。
 *
 * 复刻官方模式(ui-settings-general/src/client/locales.ts):zh 是键集
 * 真相源,en 按同一键集校验完整。键覆盖两类文案:
 * 1. 浏览器半体的全部用户可见字符串(按钮、卡片、遮罩、预览、toast);
 * 2. 宿主半体 RPC 失败的稳定 dot-code(src/index.ts 的 failure() 载荷)——
 *    客户端用 t(code, params) 命中词典即本地化渲染,未命中回退宿主
 *    message 兜底文案(rpcText)。
 *
 * 槽组件通过注册项 `locale: NS` 拿到框架合成的 t 席位(随语言切换重渲染);
 * 无席位可拿的窗口级模块(dropzone/preview/history-cards/intake)经
 * setBoundT(locale.bind(NS)) 获得模块级 tr(),调用时读当前语言。
 */

import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

/** 本插件拥有的词典命名空间。 */
export const NS = 'dsh-attachments'

/** 简体中文词典(键集真相源)。 */
export const zh = {
  // 输入工具栏附件按钮
  'attach.title': '添加附件:任何文件都可以,统一落进工作区交给模型',
  'attach.aria': '添加附件',
  // composer 附件卡片
  'dock.card.title': '{path} · 点击预览',
  'dock.remove.aria': '移除附件 {name}',
  // 全窗拖拽遮罩
  'drop.title': '拖放文件加入对话',
  'drop.sub': '任何类型都可以,统一落进工作区交给模型(看图用 read_image)',
  // 分诊(intake)错误 toast
  'intake.err.batchLimit': '一次最多带入 {max} 个文件,已跳过 {count} 个',
  'intake.err.noApi': '附件服务未就绪,请稍后重试',
  'intake.err.noCwd': '当前会话没有工作区目录,附件无处安放;请在项目目录中打开会话',
  'intake.err.failed': '「{name}」带入失败:{message}',
  'intake.err.restage': '附件引用无效({path}):{message}',
  // 历史消息附件卡
  'card.preview': '点击预览',
  // 预览弹层
  'preview.copy': '复制引用',
  'preview.copied': '已复制 ✓',
  'preview.close.aria': '关闭',
  'preview.loading': '加载中…',
  'preview.truncated': '…(预览截断)',
  'preview.unsupported': '暂不支持在页面内预览 .{ext} 文件。',
  'preview.openSystem': '用系统应用打开',
  'preview.loadFailed': '读取失败:{message}',
  'preview.err.notReady': '会话或服务未就绪',
  // 宿主 RPC 失败 dot-code(客户端本地化渲染)
  'cwd.err.invalid': 'cwd 必须是非空字符串',
  'cwd.err.notAbsolute': 'cwd 必须是绝对路径,收到 {value}',
  'cwd.err.unreachable': '工作区目录不可访问:{cwd}',
  'cwd.err.notDir': 'cwd 不是目录:{cwd}',
  'session.err.invalid': 'sessionId 必须是非空字符串',
  'stash.err.data': 'dataBase64 必须是字符串',
  'stash.err.tooMany': '一条消息最多暂存 {max} 个附件',
  'stash.err.tooLarge': '文件超过 {max}MB 传输上限;更大的文件请直接放进项目目录后在消息里写路径',
  'stash.err.escape': '解析后的路径越出了 uploads 目录',
  'remove.err.badPath': '不支持的撤回路径:{path}',
  'restage.err.badPath': '不支持的引用路径:{path}',
  'restage.err.missing': '引用的文件不存在(本地与全局索引均未命中):{path}',
  'restage.err.migrate': '迁移后无法读取文件:{path}',
  'read.err.badPath': '不支持的预览路径:{path}',
  'read.err.missing': '文件不存在:{path}',
  'read.err.tooLarge': '文件超过 {max}MB 预览上限,请用系统应用打开',
} satisfies Record<string, string>

/** 词典键联合。 */
export type Key = keyof typeof zh

/** 英文词典(按 zh 键集校验完整)。 */
export const en = {
  'attach.title': 'Attach files — any type; everything lands in the workspace for the agent',
  'attach.aria': 'Attach files',
  'dock.card.title': '{path} · Click to preview',
  'dock.remove.aria': 'Remove attachment {name}',
  'drop.title': 'Drop files to add to chat',
  'drop.sub': 'Any type — everything lands in the workspace for the agent (images via read_image)',
  'intake.err.batchLimit': 'At most {max} files per batch; skipped {count}',
  'intake.err.noApi': 'Attachment service not ready; try again shortly',
  'intake.err.noCwd': 'This session has no workspace directory to receive files; open a session in a project directory',
  'intake.err.failed': 'Failed to attach "{name}": {message}',
  'intake.err.restage': 'Invalid attachment reference ({path}): {message}',
  'card.preview': 'Click to preview',
  'preview.copy': 'Copy reference',
  'preview.copied': 'Copied ✓',
  'preview.close.aria': 'Close',
  'preview.loading': 'Loading…',
  'preview.truncated': '…(preview truncated)',
  'preview.unsupported': 'In-page preview is not supported for .{ext} files.',
  'preview.openSystem': 'Open with system app',
  'preview.loadFailed': 'Failed to load: {message}',
  'preview.err.notReady': 'Session or service not ready',
  'cwd.err.invalid': 'cwd must be a non-empty string',
  'cwd.err.notAbsolute': 'cwd must be an absolute path; got {value}',
  'cwd.err.unreachable': 'Workspace directory is not accessible: {cwd}',
  'cwd.err.notDir': 'cwd is not a directory: {cwd}',
  'session.err.invalid': 'sessionId must be a non-empty string',
  'stash.err.data': 'dataBase64 must be a string',
  'stash.err.tooMany': 'At most {max} attachments can be staged per message',
  'stash.err.tooLarge': 'File exceeds the {max}MB transfer limit; put larger files directly into the project directory and reference the path in your message',
  'stash.err.escape': 'Resolved path escapes the uploads directory',
  'remove.err.badPath': 'Unsupported removal path: {path}',
  'restage.err.badPath': 'Unsupported reference path: {path}',
  'restage.err.missing': 'Referenced file does not exist (not found locally or in the global index): {path}',
  'restage.err.migrate': 'File unreadable after migration: {path}',
  'read.err.badPath': 'Unsupported preview path: {path}',
  'read.err.missing': 'File does not exist: {path}',
  'read.err.tooLarge': 'File exceeds the {max}MB preview limit; open it with a system app',
} satisfies Record<Key, string>

// 把命名空间并入官方 LocaleNamespaceMap:注册项的 locale: NS 与组件
// props 的 t 席位由此获得类型(与官方插件同一 declare-merge 模式)。
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-attachments': Key
  }
}

/** 槽组件的 locale 席位(props 上框架合成的 t;按可缺失防御)。 */
export type LocaleProps = { t?: Translate<Key> }

/** 模块级绑定的 translate(apply 期 setBoundT 注入)。 */
let bound: Translate | undefined

/**
 * 注入 locale 服务 bind 出的 t(调用时读当前语言)。
 * @param t - 命名空间绑定的 translate 函数。
 */
export function setBoundT(t: Translate): void {
  bound = t
}

/**
 * 模块级取词:绑定未就绪时原样返回 key(调用点早于 locale 服务时防御)。
 * @param key - 词典键。
 * @param params - `{name}` 模板参数。
 * @returns 当前语言的文案;未绑定为 key 本身。
 */
export function tr(key: string, params?: Record<string, unknown>): string {
  return bound === undefined ? key : bound(key, params)
}

/** RPC 错误分支的最小防御面。 */
export interface RpcErrorLike {
  readonly code?: unknown
  readonly message?: unknown
  readonly params?: unknown
  readonly level?: unknown
}

/**
 * RPC 错误 → 展示文案:词典命中 code 即本地化渲染(带 params),未命中
 * 回退宿主 message 兜底文案(bind 的 t 对缺失键原样返回 key,以此判定)。
 * @param error - RPC 错误分支(code/message/params 可缺失防御)。
 * @returns 用户可见文案。
 */
export function rpcText(error: RpcErrorLike): string {
  const fallback = typeof error.message === 'string' && error.message !== ''
    ? error.message
    : String(error)
  if (typeof error.code !== 'string') return fallback
  const params = typeof error.params === 'object' && error.params !== null
    ? error.params as Record<string, unknown>
    : undefined
  const translated = tr(error.code, params)
  return translated === error.code ? fallback : translated
}

/**
 * RPC 错误的提示级别(宿主失败载荷可携带 level;缺省按 error)。
 * @param error - RPC 错误分支。
 * @returns 会话输入面板 notify 级别。
 */
export function rpcLevel(error: RpcErrorLike): 'error' | 'idle' {
  return error.level === 'idle' ? 'idle' : 'error'
}
