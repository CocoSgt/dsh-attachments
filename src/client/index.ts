/**
 * dsh-attachments 的浏览器半体(产物 lib/client.js)。
 *
 * 装配:
 * 1. $mount 手写描述符 → ctx.remote.fileStash(落盘网关调用面);
 * 2. conversation.input.left 注册附件按钮(文件选择器入口);
 * 3. conversation.input.dock 注册附件卡片栏(宿主 pending 真相源,
 *    同时捕捉当前 composer 上下文);
 * 4. 全窗拖拽遮罩 + 非图片粘贴监听(dropzone)。
 *
 * 附件哲学:零类型拒绝,草稿零污染——图片走原生附件管线,其余一切落盘
 * 暂存成卡片,发送时由宿主把附件清单注入模型请求。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { buildDescriptors } from './descriptors.js'
import { installDropzone } from './dropzone.js'
import { installHistoryCards, setPreviewOpener } from './history-cards.js'
import { showPreview } from './preview.js'
import { restagePastedText, runIntake, type InputActionsFace } from './intake.ts'
import { ensureStyles } from './styles.js'
import { AttachButton } from './AttachButton.tsx'
import { UploadDock } from './UploadDock.tsx'
import { createUploadsStore } from './uploads-store.js'
import type { AttachmentsCalls, RemoteFace, SessionsFace } from './types.js'

export { AttachButton } from './AttachButton.tsx'
export { runIntake } from './intake.ts'
export type { InputActionsFace, IntakeReport } from './intake.ts'

/** 依赖的服务:槽系统、会话注册表、会话控制器、remote 挂载面。 */
export const inject = ['slots', 'sessions', 'conversation', 'remote']

/**
 * 客户端插件体。
 * @param ctx - 客户端根上下文。
 */
export async function apply(ctx: ClientContext): Promise<void> {
  ensureStyles()
  const store = createUploadsStore()

  const remote = (ctx as unknown as { remote: RemoteFace }).remote
  const disposeRemote = await remote.$mount({
    package: 'dsh-attachments',
    descriptors: buildDescriptors(),
  })
  ctx.effect(() => () => { void disposeRemote() }, 'dsh-attachments: 远端描述符挂载')

  // 命名空间服务由 $mount 创建,不能写进静态 inject(会永久等待);
  // 动态 inject 后把调用面装进闭包,供 intake / 卡片栏使用。
  let calls: AttachmentsCalls | undefined
  ctx.inject(['remote', 'remote.fileStash'], (namespaceCtx: ClientContext): void => {
    calls = (namespaceCtx as unknown as { remote: RemoteFace }).remote.fileStash
  })
  const api = (): AttachmentsCalls | undefined => calls
  const sessions = ctx.sessions as unknown as SessionsFace
  const env = { ctx, sessions, api, store }

  const currentCwd = (): string | undefined => {
    const snapshot = sessions.list.getSnapshot()
    return snapshot.current === undefined ? undefined : snapshot.byId[snapshot.current]?.cwd
  }
  const openPreview = (relPath: string, name: string, line: string): void => {
    showPreview({
      load: async (path: string) => {
        const cwd = currentCwd()
        const remoteCalls = api()
        if (cwd === undefined || remoteCalls === undefined) throw new Error('会话或服务未就绪')
        const result = await remoteCalls.readStash(cwd, path)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      openSystem: (path: string) => {
        const cwd = currentCwd()
        if (cwd === undefined) return
        try {
          const connection = ctx.get('connection') as { api: { host: { openPath(payload: { path: string }): Promise<unknown> } } } | undefined
          void connection?.api.host.openPath({ path: `${cwd}/${path}` }).catch(() => undefined)
        } catch { /* connection 未就绪时静默忽略 */ }
      },
    }, relPath, name, line)
  }
  setPreviewOpener(openPreview)

  const intake = (
    sessionId: SessionId,
    files: readonly File[],
    inputActions: InputActionsFace | undefined,
  ): Promise<unknown> => runIntake(env, sessionId, files, inputActions)

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'attachments',
    order: 20,
    inject: (sessionId: SessionId) => ({
      store,
      intake: (
        files: readonly File[],
        inputActions: InputActionsFace | undefined,
      ): Promise<unknown> => intake(sessionId, files, inputActions),
    }),
  }, AttachButton))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'attachments-uploads',
    order: 30,
    inject: () => ({ store, api, sessions, openPreview }),
  }, UploadDock))

  ctx.effect(() => installHistoryCards(), 'dsh-attachments: 历史附件卡装饰')
  ctx.effect(() => installDropzone({
    store,
    runIntake: (sessionId, files, inputActions) =>
      intake(sessionId as unknown as SessionId, files, inputActions),
    restageText: (sessionId, text) =>
      restagePastedText(env, sessionId as unknown as SessionId, text),
  }), 'dsh-attachments: 全窗拖拽与粘贴')
}
