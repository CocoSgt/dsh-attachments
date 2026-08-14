/**
 * 全窗拖拽与粘贴入口。
 *
 * 所有权规则:一次文件拖拽进入窗口时**一次性判定归属**——有可用的
 * composer 上下文就由本插件全程接管(捕获阶段抑制宿主原生的四个拖拽
 * 事件,只显示本插件的遮罩;drop 后图片经 intake 送原生管线,其余落盘),
 * 否则完全不干预(原生行为原样保留)。绝不出现「原生遮罩弹出、drop 却被
 * 本插件吞掉」的悬挂状态。
 *
 * 粘贴:纯图片让宿主原生管线处理;含非图片文件时整批接管(intake 内部
 * 仍把图片送进原生管线,不丢不重)。
 * 返回清理函数,随插件卸载移除监听与遮罩。
 */
import type { InputActionsFace } from './intake.ts'
import { tr } from './locales.js'
import type { UploadsStore } from './uploads-store.js'

/** dropzone 的运行依赖。 */
export interface DropzoneEnv {
  readonly store: UploadsStore
  readonly runIntake: (
    sessionId: string,
    files: readonly File[],
    inputActions: InputActionsFace | undefined,
  ) => Promise<unknown>
  /** 粘贴文本里的附件引用再物化;返回剩余应插入的文本。 */
  readonly restageText: (sessionId: string, text: string) => Promise<{ handled: boolean; remaining: string }>
}

function hasFiles(transfer: DataTransfer | null): boolean {
  return transfer !== null && [...transfer.types].includes('Files')
}

/** 安装全窗拖拽遮罩与粘贴监听;返回清理函数。 */
export function installDropzone(env: DropzoneEnv): () => void {
  const overlay = document.createElement('div')
  overlay.className = 'dat-overlay'
  overlay.dataset.plugin = 'dsh-attachment'
  const card = document.createElement('div')
  card.className = 'dat-overlay-card'
  const icons = document.createElement('div')
  icons.className = 'dat-overlay-icons'
  for (const t of ['1', '2', '3']) {
    const tile = document.createElement('div')
    tile.className = 'dat-overlay-tile'
    tile.dataset.t = t
    icons.append(tile)
  }
  const title = document.createElement('div')
  title.className = 'dat-overlay-title'
  const sub = document.createElement('div')
  sub.className = 'dat-overlay-sub'
  card.append(icons, title, sub)
  overlay.append(card)
  document.body.appendChild(overlay)

  /** 本次拖拽是否由本插件接管(dragenter 一次性判定,drop/离开后复位)。 */
  let owning = false
  let depth = 0
  const show = (visible: boolean): void => {
    // 遮罩文案在每次显示时取词:窗口级模块无 t 席位,tr() 调用时读当前语言。
    if (visible) {
      title.textContent = tr('drop.title')
      sub.textContent = tr('drop.sub')
    }
    overlay.style.display = visible ? 'flex' : 'none'
  }
  const reset = (): void => {
    owning = false
    depth = 0
    show(false)
  }

  const onDragEnter = (event: DragEvent): void => {
    if (!hasFiles(event.dataTransfer)) return
    if (depth === 0) {
      // 拖拽进入窗口的第一事件:一次性判定归属。
      owning = env.store.current() !== undefined
    }
    depth += 1
    if (!owning) return
    event.stopPropagation() // 原生遮罩不得启动
    show(true)
  }
  const onDragOver = (event: DragEvent): void => {
    if (!owning || !hasFiles(event.dataTransfer)) return
    event.preventDefault() // 允许 drop
    event.stopPropagation()
  }
  const onDragLeave = (event: DragEvent): void => {
    if (depth === 0) return
    depth = Math.max(0, depth - 1)
    if (owning) event.stopPropagation()
    if (depth === 0) reset()
  }
  const onDrop = (event: DragEvent): void => {
    const wasOwning = owning
    const current = env.store.current()
    reset()
    if (!wasOwning || !hasFiles(event.dataTransfer)) return // 未接管:原生自理
    event.preventDefault()
    event.stopPropagation()
    if (current === undefined) return
    const files = [...event.dataTransfer?.files ?? []]
    if (files.length === 0) return
    void env.runIntake(current.sessionId, files, current.inputActions as InputActionsFace | undefined)
  }
  const onPaste = (event: ClipboardEvent): void => {
    const current = env.store.current()
    if (current === undefined) return
    const items = [...event.clipboardData?.files ?? []]
    if (items.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      void env.runIntake(current.sessionId, items, current.inputActions as InputActionsFace | undefined)
      return
    }
    // 文本粘贴:含 📎 引用行时再物化为卡片,剩余文字插回光标处。
    const text = event.clipboardData?.getData('text/plain') ?? ''
    if (!text.includes('📎') || !text.includes('.dsh/uploads/')) return
    event.preventDefault()
    event.stopPropagation()
    const target = event.target
    void env.restageText(current.sessionId, text).then(({ handled, remaining }) => {
      const insert = handled ? remaining : text
      if (insert === '') return
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        target.focus()
        document.execCommand('insertText', false, insert)
      }
    })
  }

  // 全部走捕获阶段:在宿主 composer 的监听器之前拿到事件。
  window.addEventListener('dragenter', onDragEnter, true)
  window.addEventListener('dragover', onDragOver, true)
  window.addEventListener('dragleave', onDragLeave, true)
  window.addEventListener('drop', onDrop, true)
  window.addEventListener('paste', onPaste, true)
  return () => {
    window.removeEventListener('dragenter', onDragEnter, true)
    window.removeEventListener('dragover', onDragOver, true)
    window.removeEventListener('dragleave', onDragLeave, true)
    window.removeEventListener('drop', onDrop, true)
    window.removeEventListener('paste', onPaste, true)
    overlay.remove()
  }
}
