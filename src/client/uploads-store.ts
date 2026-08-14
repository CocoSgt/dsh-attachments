/**
 * 附件卡片的轻量协调 store。
 *
 * 卡片数据的**真相源在宿主端**(fileStash/listStash);本 store 只做两件事:
 * 1. `bump(sessionId)`:intake 落盘成功后递增版本号,通知 UploadDock 重取;
 * 2. `capture()/current()`:捕捉「当前可见 composer」的会话上下文,供
 *    全窗拖拽/粘贴这类无槽位标准 props 的入口路由到正确会话。
 */

/** 输入动作面(拖拽/粘贴入口需要的最小子集)。 */
export interface DraftActionsFace {
  setDraft(text: string): void
}

/** 当前 composer 的会话上下文快照(由槽组件每次渲染回写)。 */
export interface ComposerCapture {
  readonly sessionId: string
  readonly inputActions: unknown
}

/** store 对外面。 */
export interface UploadsStore {
  /** 记录一个落盘附件的本地预览(图片 objectURL,页生命周期)。 */
  setPreview(relPath: string, url: string): void
  /** 取预览 URL(无则 undefined)。 */
  preview(relPath: string): string | undefined
  /** 某会话的刷新版本号(变化即应重取 listStash)。 */
  version(sessionId: string): number
  subscribe(fn: () => void): () => void
  /** 落盘成功后递增版本并通知。 */
  bump(sessionId: string): void
  /** 槽组件每次渲染回写当前 composer 上下文(不触发通知)。 */
  capture(entry: ComposerCapture): void
  /** 最近一次捕捉的 composer 上下文(全窗拖拽/粘贴用)。 */
  current(): ComposerCapture | undefined
}

/** 创建 uploads store。 */
export function createUploadsStore(): UploadsStore {
  const versions = new Map<string, number>()
  const previews = new Map<string, string>()
  const listeners = new Set<() => void>()
  let captured: ComposerCapture | undefined
  const emit = (): void => {
    for (const listener of listeners) listener()
  }
  return {
    setPreview(relPath, url) { previews.set(relPath, url) },
    preview: relPath => previews.get(relPath),
    version: sessionId => versions.get(sessionId) ?? 0,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    bump(sessionId) {
      versions.set(sessionId, (versions.get(sessionId) ?? 0) + 1)
      emit()
    },
    capture(entry) {
      captured = entry
    },
    current: () => captured,
  }
}
