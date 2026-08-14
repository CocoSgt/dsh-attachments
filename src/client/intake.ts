/**
 * 附件分诊(浏览器半体)——万物皆文件,零类型拒绝,草稿零污染。
 *
 * **所有文件(含图片)统一落盘**进会话工作区并按会话暂存,composer 内
 * 出现可撤回的卡片;发送时宿主把路径清单注入模型请求。图片不再走宿主
 * 原生视觉管线——移动/整理类任务不需要模型看见内容;需要看时,视觉
 * 模型自己调 read_image(harness 原生工具,按路径读图并产出图像块),
 * 非视觉模型也不再被「模型不支持图片」堵住发送。图片卡带本地缩略图预览。
 *
 * 失败(RPC 错误、超传输上限、会话无工作区)通过会话输入面板的 notice
 * 通道逐文件报告,不静默。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationController, DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { rpcLevel, rpcText, tr } from './locales.js'
import type { AttachmentsCalls, SessionsFace } from './types.js'
import type { UploadsStore } from './uploads-store.js'

/** 输入机公共动作面(ui-conversation 会话标准件的 inputActions)。 */
export interface InputActionsFace {
  setDraft(text: string): void
  addImages(ids: readonly DraftAttachmentId[]): boolean
  removeImage(id: DraftAttachmentId): void
  pruneImages(ids: readonly DraftAttachmentId[]): void
}

/** 一次批量落盘的文件数上限(误操作保险,不是类型限制)。 */
const MAX_FILES_PER_BATCH = 30

/** 人类可读的大小。 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 是否图片(仅用于生成本地预览,不影响落位路径)。 */
function isImage(file: File): boolean {
  return (file.type ?? '').toLowerCase().startsWith('image/')
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** 一次 intake 的执行摘要(供调试/日志)。 */
export interface IntakeReport {
  filesStashed: number
  failed: readonly { name: string; reason: string }[]
}

/** intake 的运行依赖(client/index.ts 组装后闭包传入)。 */
export interface IntakeEnv {
  readonly ctx: ClientContext
  readonly sessions: SessionsFace
  readonly api: () => AttachmentsCalls | undefined
  readonly store: UploadsStore
}

/**
 * 处理一批用户带来的文件:图片入原生附件管线,其余一切落盘暂存成卡片。
 * @param env - 组装期闭包的运行依赖。
 * @param sessionId - 目标会话。
 * @param files - 用户选择/拖入/粘贴的文件。
 * @param inputActions - 输入机动作面(图片落位需要)。
 * @returns 执行摘要。
 */
export async function runIntake(
  env: IntakeEnv,
  sessionId: SessionId,
  files: readonly File[],
  _inputActions: InputActionsFace | undefined,
): Promise<IntakeReport> {
  const { ctx, sessions, store } = env
  const failed: { name: string; reason: string }[] = []
  const report: IntakeReport = { filesStashed: 0, failed }
  const conversation = ctx.get('conversation') as ConversationController | undefined

  const notify = (level: 'info' | 'error', text: string): void => {
    if (conversation !== undefined) {
      const actx = ctx.sessions.scope(sessionId)
      if (actx !== undefined) {
        conversation.input.for(actx).notify(level, text)
        return
      }
    }
    console[level === 'error' ? 'error' : 'log'](`[dsh-attachment] ${text}`)
  }

  const batch = [...files]
  if (batch.length > MAX_FILES_PER_BATCH) {
    const dropped = batch.splice(MAX_FILES_PER_BATCH)
    for (const file of dropped) failed.push({ name: file.name, reason: 'batch-limit' })
    notify('error', tr('intake.err.batchLimit', { max: MAX_FILES_PER_BATCH, count: dropped.length }))
  }
  if (batch.length === 0) return report

  const api = env.api()
  const key = sessionId as unknown as string
  const cwd = sessions.list.getSnapshot().byId[key]?.cwd
  if (api === undefined) {
    notify('error', tr('intake.err.noApi'))
    for (const file of batch) failed.push({ name: file.name, reason: 'no-api' })
    return report
  }
  if (cwd === undefined) {
    notify('error', tr('intake.err.noCwd'))
    for (const file of batch) failed.push({ name: file.name, reason: 'no-cwd' })
    return report
  }
  for (const file of batch) {
    try {
      const data = await fileToBase64(file)
      const result = await api.stashFile(cwd, key, file.name, data)
      if (!result.ok) {
        // RPC 失败:dot-code 词典命中即本地化,否则回退宿主兜底文案。
        failed.push({ name: file.name, reason: result.error.message })
        notify(rpcLevel(result.error) === 'idle' ? 'info' : 'error', tr('intake.err.failed', {
          name: file.name,
          message: rpcText(result.error),
        }))
        continue
      }
      if (isImage(file)) store.setPreview(result.value.relPath, URL.createObjectURL(file))
      report.filesStashed += 1
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      failed.push({ name: file.name, reason: message })
      notify('error', tr('intake.err.failed', { name: file.name, message }))
    }
  }
  if (report.filesStashed > 0) store.bump(key)
  return report
}

/** 粘贴文本里的附件引用行(📎 … → .dsh/uploads/…)。 */
const REF_LINE = /^📎\s*.+?→\s*(\.dsh\/uploads\/\S+)/u

/**
 * 处理粘贴文本中的附件引用:逐行 restage 命中的引用,返回剩余文本
 * (剔除引用行与说明行)。没有引用行时 handled 为 false,调用方不拦截。
 * @param env - 组装期闭包的运行依赖。
 * @param sessionId - 目标会话。
 * @param text - 粘贴的纯文本。
 * @returns handled 与应插入草稿的剩余文本。
 */
export async function restagePastedText(
  env: IntakeEnv,
  sessionId: SessionId,
  text: string,
): Promise<{ handled: boolean; remaining: string }> {
  const lines = text.split('\n')
  const refs = lines.map(line => REF_LINE.exec(line.trim())?.[1]).filter((v): v is string => v !== undefined)
  if (refs.length === 0) return { handled: false, remaining: text }
  const key = sessionId as unknown as string
  const api = env.api()
  const cwd = env.sessions.list.getSnapshot().byId[key]?.cwd
  if (api === undefined || cwd === undefined) return { handled: false, remaining: text }
  const conversation = env.ctx.get('conversation') as { input: { for(actx: unknown): { notify(level: string, text: string): void } } } | undefined
  let staged = 0
  for (const relPath of refs) {
    try {
      const result = await api.restageFile(cwd, key, relPath)
      if (!result.ok) {
        const actx = env.ctx.sessions.scope(sessionId)
        if (conversation !== undefined && actx !== undefined) {
          conversation.input.for(actx).notify(rpcLevel(result.error) === 'idle' ? 'info' : 'error', tr('intake.err.restage', {
            path: relPath,
            message: rpcText(result.error),
          }))
        }
        continue
      }
      staged += 1
    } catch (error: unknown) {
      const actx = env.ctx.sessions.scope(sessionId)
      if (conversation !== undefined && actx !== undefined) {
        conversation.input.for(actx).notify('error', tr('intake.err.restage', {
          path: relPath,
          message: error instanceof Error ? error.message : String(error),
        }))
      }
    }
  }
  if (staged > 0) env.store.bump(key)
  const remaining = lines
    .filter(line => REF_LINE.exec(line.trim()) === null && !line.trim().startsWith('(附件已存入工作区'))
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
  return { handled: staged > 0, remaining }
}
