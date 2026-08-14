/**
 * dsh-attachment 的浏览器半体(产物 lib/client.js)。
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
import { NS, en, rpcText, setBoundT, tr, zh } from './locales.js'
import type { AttachmentsCalls, RemoteFace, SessionsFace } from './types.js'

/** locale 服务的最小注册面(ui-slots 的 LocaleFace 只有 bind/observable,register 在服务本体)。 */
interface LocaleServiceFace {
  register(ns: string, dicts: Record<string, Record<string, string>>): unknown
  bind(ns: string): (key: string, params?: Record<string, unknown>) => string
}

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
    package: 'dsh-attachment',
    descriptors: buildDescriptors(),
  })
  ctx.effect(() => () => { void disposeRemote() }, 'dsh-attachment: remote descriptors')

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
        if (cwd === undefined || remoteCalls === undefined) throw new Error(tr('preview.err.notReady'))
        const result = await remoteCalls.readStash(cwd, path)
        if (!result.ok) throw new Error(rpcText(result.error))
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

  // locale 服务由宿主装配(立即层基础设施);词典注册先于槽注册,席位才
  // 能在首渲染解析。注册项声明 locale: NS 后,框架给组件 props 合成标准
  // t 席位(随语言切换换引用、自然重渲染)。
  ctx.inject(['locale'], (localeCtx: ClientContext): void => {
    const locale = (localeCtx as unknown as { locale: LocaleServiceFace }).locale
    ctx.effect(() => {
      const dispose = locale.register(NS, { zh, en })
      return () => { if (typeof dispose === 'function') dispose() }
    }, 'dsh-attachment: dictionaries')
    // 无槽席位的窗口级模块(dropzone/preview/history-cards/intake)经
    // 模块级 tr() 取词:bind 的 t 调用时读当前语言。
    setBoundT(locale.bind(NS))

    ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
      name: 'conversation.input.left',
      id: 'attachments',
      order: 20,
      locale: NS,
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
      locale: NS,
      inject: () => ({ store, api, sessions, openPreview }),
    }, UploadDock))
  })

  ctx.effect(() => installHistoryCards(), 'dsh-attachment: history attachment cards')
  ctx.effect(() => installDropzone({
    store,
    runIntake: (sessionId, files, inputActions) =>
      intake(sessionId as unknown as SessionId, files, inputActions),
    restageText: (sessionId, text) =>
      restagePastedText(env, sessionId as unknown as SessionId, text),
  }), 'dsh-attachment: window drop and paste')
}
