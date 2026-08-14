/**
 * dsh-attachments 宿主端:fileStash 落盘网关 + 发送时注入。
 *
 * 附件哲学:零类型拒绝。图片走浏览器端原生附件管线(不经过本网关);
 * 其余一切文件由本网关落盘到会话工作区 `<cwd>/.dsh/uploads/`。
 *
 * 关键设计:**草稿不写引用文本**。落盘文件按会话暂存(pending),浏览器端
 * 只显示卡片;用户下一条消息进入模型请求时,本插件在 `agent/pre-step`
 * 波形里把附件清单作为一条 `plugin` 来源的用户消息折进批次(紧跟用户
 * 消息之后)——与官方 dsh-agent-instructions 的注入模式同构,模型可见即
 * 落日志,回放安全。浏览器端的卡片以宿主 pending 为真相源(listStash),
 * 注入(消费)后卡片自动消失。
 *
 * 路径安全:stash 只往 `<cwd>/.dsh/uploads/` 下写,文件名做白名单化清洗
 * (时间戳前缀防撞名);removeStash 只接受该目录下的相对路径,resolve 后
 * 再做前缀校验。
 *
 * 第三方双副本场景下 SRC 发现失明,因此把弱(src-json)清单注册进宿主
 * typert registry。Gateway 按参数名生成 wire 字段,公开方法保持简单
 * 标识符参数;不使用 @Remote 装饰器(双副本下无效,且 tsdown 产物保留
 * 装饰器语法会让 Node 导入报错)。
 */

import { copyFileSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { TypertLookupFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

/** 单个文件经 RPC 落盘的解码后字节上限(JSON wire 传输的现实约束)。 */
export const MAX_STASH_BYTES = 32 * 1024 * 1024

/** 工作区内的落盘目录(相对 cwd)。 */
export const UPLOADS_DIR = '.dsh/uploads'

/** 每会话最多暂存的附件数(误操作保险)。 */
const MAX_PENDING_PER_SESSION = 30

/** 全局附件索引:时间戳文件名 → 落盘绝对路径(跨项目引用迁移用)。 */
function indexPath(): string {
  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== '' ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh')
  return join(home, 'attachments-index.json')
}

function loadIndex(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(indexPath(), 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, string> : {}
  } catch {
    return {}
  }
}

function recordIndex(fileName: string, absolute: string): void {
  const index = loadIndex()
  index[fileName] = absolute
  // 索引只增不删;文件被删时查找侧自然失败。上限防膨胀:超 2000 条丢最旧。
  const keys = Object.keys(index)
  const trimmed = keys.length > 2000
    ? Object.fromEntries(keys.slice(keys.length - 2000).map(key => [key, index[key]!]))
    : index
  try {
    writeFileSync(indexPath(), `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8')
  } catch { /* 索引写失败不阻塞落盘:跨项目迁移退化为不可用。 */ }
}

/** 一个已落盘、待随下一条消息注入的附件。 */
export interface StashedFile {
  /** 相对 cwd 的落盘路径。 */
  readonly relPath: string
  /** 清洗后的文件名(展示用)。 */
  readonly name: string
  /** 字节数。 */
  readonly size: number
}

/** stashFile 的返回。 */
export interface StashResult {
  readonly relPath: string
  readonly size: number
}

/** removeStash 的返回。 */
export interface RemoveStashResult {
  readonly removed: boolean
}

/** readStash 的返回。 */
export interface ReadStashResult {
  /** 文件字节的 base64。 */
  readonly dataBase64: string
  readonly size: number
}

/** listStash 的返回。 */
export interface ListStashResult {
  /** 该会话当前暂存(尚未注入)的附件。 */
  readonly files: readonly StashedFile[]
}

/**
 * RPC 失败载荷:稳定 dot-code + 模板参数 + 兜底中文文案。客户端词典命中
 * code 即本地化渲染(t(code, params)),未命中回退 message——wire 上
 * 三者皆为 src-json 安全值(可选字段条件展开,无 undefined)。
 */
export interface StashFailurePayload {
  /** 稳定 dot-code(客户端词典键,如 'stash.err.tooLarge')。 */
  readonly code: string
  /** 兜底文案(中文,保持既有字节,兼容旧 wire 消费方)。 */
  readonly message: string
  /** `{name}` 模板参数(可选,条件展开)。 */
  readonly params?: Readonly<Record<string, string | number>>
  /** 提示级别(客户端据此选 notice 通道,不再正则匹配中文)。 */
  readonly level?: 'error' | 'idle'
}

/**
 * 构造一个携带结构化载荷的 RPC 失败。经网关 rpcFailure 对
 * TypertLookupFailure 的原样透传,failure 对象即客户端的 result.error。
 * @param code - 稳定 dot-code。
 * @param message - 兜底中文文案。
 * @param params - 可选 `{name}` 模板参数。
 * @returns 待抛出的失败。
 */
function failure(
  code: string,
  message: string,
  params?: Record<string, string | number>,
): TypertLookupFailure<StashFailurePayload> {
  return new TypertLookupFailure<StashFailurePayload>({
    code,
    ...(params === undefined ? {} : { params }),
    level: 'error',
    message,
  })
}

/** 校验并解析工作区目录:必须是存在的绝对路径目录。 */
function checkCwd(cwd: string): string {
  if (typeof cwd !== 'string' || cwd.length === 0 || cwd.includes('\0')) {
    throw failure('cwd.err.invalid', 'attachments: cwd 必须是非空字符串')
  }
  if (!isAbsolute(cwd)) {
    throw failure('cwd.err.notAbsolute', `attachments: cwd 必须是绝对路径,收到 ${JSON.stringify(cwd)}`, {
      value: JSON.stringify(cwd),
    })
  }
  let stats
  try {
    stats = statSync(cwd)
  } catch {
    throw failure('cwd.err.unreachable', `attachments: 工作区目录不可访问: ${cwd}`, { cwd })
  }
  if (!stats.isDirectory()) throw failure('cwd.err.notDir', `attachments: cwd 不是目录: ${cwd}`, { cwd })
  return resolve(cwd)
}

function checkSessionId(sessionId: string): string {
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 200) {
    throw failure('session.err.invalid', 'attachments: sessionId 必须是非空字符串')
  }
  return sessionId
}

/**
 * 把用户文件名清洗为安全的落盘名:仅保留字母数字、点、连字符、下划线与
 * 常见 Unicode 文字,其余替换为 `_`;去掉路径分隔与前导点。
 */
function sanitizeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = base.replace(/[^\p{L}\p{N}._-]/gu, '_').replace(/^\.+/, '')
  return cleaned.length === 0 ? 'file' : cleaned.slice(0, 120)
}

/** 时间戳前缀(yyMMdd-HHmmss)。 */
function stampPrefix(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/** 人类可读的大小。 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 生成注入消息的正文:附件清单 + 一句话使用说明。
 * @param files - 本轮随消息带入的附件。
 * @returns 注入的纯文本。
 */
export function buildAttachmentNote(files: readonly StashedFile[]): string {
  const lines = files.map(file => `📎 ${file.name}(${formatSize(file.size)}) → ${file.relPath}`)
  return `${lines.join('\n')}\n(附件已存入工作区,用文件工具按相对路径直接读取)`
}

/** agent/pre-step 载荷与决策的最小结构面(第三方插件不依赖 dsh-agent 类型)。 */
interface PreStepPayloadLike {
  agent?: { session?: { id?: unknown } }
  messages?: readonly unknown[]
}
interface PreStepDecisionLike {
  kind?: string
  messages?: unknown[]
}

/**
 * 把某会话的暂存附件折进一次 pre-step 决策(纯函数,便于测试)。
 * 只在「本步有已认领的用户消息进入」时注入;注入位置紧跟最后一条已认领
 * 消息(直发提示在前,运行时上下文在后——与 agent-instructions 同位)。
 * @param decision - 下游波形已产出的决策。
 * @param payload - pre-step 载荷(认领批次 + agent)。
 * @param files - 该会话暂存的附件。
 * @returns 注入后的决策与是否消费了附件。
 */
export function foldPendingAttachments(
  decision: PreStepDecisionLike,
  payload: PreStepPayloadLike,
  files: readonly StashedFile[],
): { decision: PreStepDecisionLike; consumed: boolean } {
  if (decision.kind !== 'enter' || !Array.isArray(decision.messages)) return { decision, consumed: false }
  const claimed = payload.messages
  if (!Array.isArray(claimed) || claimed.length === 0) return { decision, consumed: false }
  if (files.length === 0) return { decision, consumed: false }
  // 来源用 'user':附件是用户动作,历史里渲染成用户气泡(📎 文件清单),
  // 紧跟用户消息之后——与各平台「附件挂在消息上」的语义一致,且完全走
  // 原生渲染,无需自定义节点(自定义节点会与内置 context 行双显)。
  const note = createUserMessage({
    content: [{ type: 'text', text: buildAttachmentNote(files) }],
    source: { kind: 'user' },
  })
  // 插在首条已认领消息之前:历史里附件卡显示在用户文本上方(DeepSeek 同款
  // 顺序),模型侧则先见附件说明后见问题,语序也更自然。
  const firstClaimed = decision.messages.findIndex(message => claimed.includes(message))
  const messages = decision.messages.toSpliced(Math.max(firstClaimed, 0), 0, note)
  return { decision: { ...decision, kind: 'enter', messages }, consumed: true }
}

/** 弱(src-json)调用描述符。 */
interface WeakInvocation {
  readonly id: string
  readonly service: 'fileStash'
  readonly namespace: 'fileStash'
  readonly method: string
  readonly invocation: { readonly kind: 'direct' }
  readonly parameters: ReadonlyArray<{
    readonly name: string
    readonly wire: string
    readonly source: 'json'
    readonly codec: { readonly mode: 'src-json' }
  }>
  readonly result: { readonly mode: 'src-json' }
}

/** ctx.typert 注册面(宿主 dsh-typert-registry 提供;本包不依赖其类型)。 */
interface TypertRegistryLike {
  register(contribution: unknown): unknown
}

function jsonParameter(name: string): WeakInvocation['parameters'][number] {
  return { name, wire: name, source: 'json', codec: { mode: 'src-json' } }
}

function invocation(method: string, parameters: readonly string[]): WeakInvocation {
  return {
    id: `dsh-attachments#fileStash/${method}`,
    service: 'fileStash',
    namespace: 'fileStash',
    method,
    invocation: { kind: 'direct' },
    parameters: parameters.map(jsonParameter),
    result: { mode: 'src-json' },
  }
}

const TYPERT_MANIFEST = {
  package: 'dsh-attachments',
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: [
    invocation('stashFile', ['cwd', 'sessionId', 'name', 'dataBase64']),
    invocation('removeStash', ['cwd', 'sessionId', 'relPath']),
    invocation('restageFile', ['cwd', 'sessionId', 'relPath']),
    invocation('clearStash', ['cwd', 'sessionId']),
    invocation('readStash', ['cwd', 'relPath']),
    invocation('listStash', ['sessionId']),
  ] satisfies WeakInvocation[],
} as const

/**
 * fileStash 网关服务:非图片附件的工作区落盘、按会话暂存与发送时注入。
 * @param ctx - 宿主 Cordis 上下文。
 */
export class AttachmentsGateway extends TypertRemoteService {
  /** 每会话暂存的附件(内存态;进程重启后卡片消失,文件仍在磁盘)。 */
  private readonly pending = new Map<string, StashedFile[]>()

  /** 注册 'fileStash' 服务键(官方已占用 'attachments');typert registry 就绪后补登记弱清单;挂 pre-step 注入。 */
  constructor(ctx: Context) {
    super(ctx, 'fileStash')
    ctx.inject(['typert'], (typertCtx: Context) =>
      (typertCtx as unknown as { typert: TypertRegistryLike }).typert.register(TYPERT_MANIFEST))
    // 发送时注入:波形监听必须调用 next() 委托下游,再在其决策上折入附件清单。
    ;(ctx as unknown as {
      on(event: string, listener: (payload: PreStepPayloadLike, next: () => Promise<PreStepDecisionLike>) => Promise<PreStepDecisionLike>): void
    }).on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      const sessionId = payload.agent?.session?.id
      if (typeof sessionId !== 'string') return decision
      const files = this.pending.get(sessionId)
      if (files === undefined || files.length === 0) return decision
      const { decision: folded, consumed } = foldPendingAttachments(decision, payload, files)
      if (consumed) this.pending.delete(sessionId)
      return folded
    })
  }

  /** 把一个文件落盘到 `<cwd>/.dsh/uploads/` 并加入会话暂存。 */
  stashFile(cwd: string, sessionId: string, name: string, dataBase64: string): StashResult {
    const resolvedCwd = checkCwd(cwd)
    const session = checkSessionId(sessionId)
    if (typeof dataBase64 !== 'string') throw failure('stash.err.data', 'attachments: dataBase64 必须是字符串')
    const staged = this.pending.get(session) ?? []
    if (staged.length >= MAX_PENDING_PER_SESSION) {
      throw failure('stash.err.tooMany', `attachments: 一条消息最多暂存 ${MAX_PENDING_PER_SESSION} 个附件`, {
        max: MAX_PENDING_PER_SESSION,
      })
    }
    const bytes = Buffer.from(dataBase64, 'base64')
    if (bytes.length > MAX_STASH_BYTES) {
      throw failure('stash.err.tooLarge', `attachments: 文件超过 ${MAX_STASH_BYTES / 1024 / 1024}MB 传输上限;更大的文件请直接放进项目目录后在消息里写路径`, {
        max: MAX_STASH_BYTES / 1024 / 1024,
      })
    }
    const dir = join(resolvedCwd, UPLOADS_DIR)
    mkdirSync(dir, { recursive: true })
    const safe = sanitizeName(typeof name === 'string' ? name : 'file')
    let fileName = `${stampPrefix()}-${safe}`
    let target = join(dir, fileName)
    if (statOf(target) !== undefined) {
      fileName = `${stampPrefix()}-${String(Date.now() % 1000)}-${safe}`
      target = join(dir, fileName)
    }
    writeFileSync(target, bytes)
    recordIndex(fileName, target)
    const file: StashedFile = { relPath: `${UPLOADS_DIR}/${fileName}`, name: safe, size: bytes.length }
    this.pending.set(session, [...staged, file])
    return { relPath: file.relPath, size: file.size }
  }

  /** 撤回一个暂存附件(卡片 ✕):移出暂存并删除落盘文件。 */
  removeStash(cwd: string, sessionId: string, relPath: string): RemoveStashResult {
    const resolvedCwd = checkCwd(cwd)
    const session = checkSessionId(sessionId)
    if (typeof relPath !== 'string' || !relPath.startsWith(`${UPLOADS_DIR}/`) || relPath.includes('..') || relPath.includes('\0')) {
      throw failure('remove.err.badPath', `attachments: 不支持的撤回路径: ${JSON.stringify(relPath)}`, { path: relPath })
    }
    const staged = this.pending.get(session)
    if (staged !== undefined) {
      const next = staged.filter(file => file.relPath !== relPath)
      if (next.length === 0) this.pending.delete(session)
      else this.pending.set(session, next)
    }
    const target = resolve(resolvedCwd, relPath)
    const uploadsRoot = join(resolvedCwd, UPLOADS_DIR)
    if (!target.startsWith(uploadsRoot + sep)) {
      throw failure('stash.err.escape', 'attachments: 解析后的路径越出了 uploads 目录')
    }
    if (statOf(target) === undefined) return { removed: false }
    unlinkSync(target)
    return { removed: true }
  }

  /** 把一个已落盘的 uploads 文件重新加入会话暂存(粘贴引用行再物化)。 */
  restageFile(cwd: string, sessionId: string, relPath: string): StashResult {
    const resolvedCwd = checkCwd(cwd)
    const session = checkSessionId(sessionId)
    if (typeof relPath !== 'string' || !relPath.startsWith(`${UPLOADS_DIR}/`) || relPath.includes('..') || relPath.includes('\0')) {
      throw failure('restage.err.badPath', `attachments: 不支持的引用路径: ${JSON.stringify(relPath)}`, { path: relPath })
    }
    const target = resolve(resolvedCwd, relPath)
    if (!target.startsWith(join(resolvedCwd, UPLOADS_DIR) + sep)) {
      throw failure('stash.err.escape', 'attachments: 解析后的路径越出了 uploads 目录')
    }
    let stats = statOf(target)
    if (stats === undefined) {
      // 本地没有:查全局索引,从来源项目把文件迁移进当前工作区(跨项目引用)。
      const fileName = relPath.slice(UPLOADS_DIR.length + 1)
      const source = loadIndex()[fileName]
      const sourceStats = source === undefined ? undefined : statOf(source)
      if (source === undefined || sourceStats === undefined) {
        throw failure('restage.err.missing', `attachments: 引用的文件不存在(本地与全局索引均未命中): ${relPath}`, { path: relPath })
      }
      mkdirSync(join(resolvedCwd, UPLOADS_DIR), { recursive: true })
      copyFileSync(source, target)
      recordIndex(fileName, target)
      stats = statOf(target)
      if (stats === undefined) throw failure('restage.err.migrate', `attachments: 迁移后无法读取文件: ${relPath}`, { path: relPath })
    }
    const staged = this.pending.get(session) ?? []
    if (staged.some(file => file.relPath === relPath)) return { relPath, size: stats.size }
    if (staged.length >= MAX_PENDING_PER_SESSION) {
      throw failure('stash.err.tooMany', `attachments: 一条消息最多暂存 ${MAX_PENDING_PER_SESSION} 个附件`, {
        max: MAX_PENDING_PER_SESSION,
      })
    }
    const base = relPath.slice(UPLOADS_DIR.length + 1)
    const name = base.replace(/^\d{6}-\d{6}(?:-\d+)?-/u, '')
    this.pending.set(session, [...staged, { relPath, name, size: stats.size }])
    return { relPath, size: stats.size }
  }

  /** 清空某会话的暂存并删除未发送的落盘文件(页面刷新时调用:与原生
   * 图片草稿同寿命——刷新即弃,保持两类附件行为一致)。 */
  clearStash(cwd: string, sessionId: string): RemoveStashResult {
    const resolvedCwd = checkCwd(cwd)
    const session = checkSessionId(sessionId)
    const staged = this.pending.get(session) ?? []
    let removed = false
    for (const file of staged) {
      const target = resolve(resolvedCwd, file.relPath)
      if (!target.startsWith(join(resolvedCwd, UPLOADS_DIR) + sep)) continue
      if (statOf(target) !== undefined) {
        try {
          unlinkSync(target)
          removed = true
        } catch { /* 删除失败不阻塞清空:文件残留无害。 */ }
      }
    }
    this.pending.delete(session)
    return { removed }
  }

  /** 读回一个 uploads 文件的字节(预览用;超 20MB 拒绝,防大文件拖爆页面)。 */
  readStash(cwd: string, relPath: string): ReadStashResult {
    const resolvedCwd = checkCwd(cwd)
    if (typeof relPath !== 'string' || !relPath.startsWith(`${UPLOADS_DIR}/`) || relPath.includes('..') || relPath.includes('\0')) {
      throw failure('read.err.badPath', `attachments: 不支持的预览路径: ${JSON.stringify(relPath)}`, { path: relPath })
    }
    const target = resolve(resolvedCwd, relPath)
    if (!target.startsWith(join(resolvedCwd, UPLOADS_DIR) + sep)) {
      throw failure('stash.err.escape', 'attachments: 解析后的路径越出了 uploads 目录')
    }
    const stats = statOf(target)
    if (stats === undefined) throw failure('read.err.missing', `attachments: 文件不存在: ${relPath}`, { path: relPath })
    if (stats.size > 20 * 1024 * 1024) throw failure('read.err.tooLarge', 'attachments: 文件超过 20MB 预览上限,请用系统应用打开', { max: 20 })
    return { dataBase64: readFileSync(target).toString('base64'), size: stats.size }
  }

  /** 某会话当前暂存(尚未注入)的附件清单——浏览器卡片的真相源。 */
  listStash(sessionId: string): ListStashResult {
    const session = checkSessionId(sessionId)
    return { files: this.pending.get(session) ?? [] }
  }
}

function statOf(target: string): { size: number } | undefined {
  try {
    const stats = statSync(target)
    return stats.isFile() ? { size: stats.size } : undefined
  } catch {
    return undefined
  }
}

export default AttachmentsGateway
