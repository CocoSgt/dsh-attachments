/**
 * 附件卡片(conversation.input.dock 槽驱动,portal 渲染进 composer 内部)。
 *
 * 卡片数据以宿主 pending 为真相源(fileStash/listStash):
 * - intake 落盘成功 → store.bump → 重取;
 * - 低频轮询兜底(发送后附件被注入消费 → 卡片自动消失);
 * - ✕ → removeStash(移出暂存 + 删落盘文件)→ 重取。
 *
 * 摆放:第三方插槽拿不到 composer 内部席位,这里用 DOM portal 把卡片
 * 投进 composer 卡片内——从本组件 DOM 向上探测「下一兄弟子树含
 * textarea 的祖先」,该兄弟即 composer;若其中已有原生图片附件栏
 * (含 <img> 的顶层行),把卡片并进同一行(display:contents),否则插在
 * 输入区上方。MutationObserver 兜底(原生栏出现/消失、宿主重渲染移除
 * 宿主节点时重新安置);探测失败回退为 dock 行内居中展示。
 *
 * 本组件也是「当前 composer 上下文」的捕捉点(拖拽/粘贴路由)。
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { StashedFile } from '../index.js'
import { formatSize, type InputActionsFace } from './intake.ts'
import type { AttachmentsCalls, SessionsFace } from './types.js'
import type { UploadsStore } from './uploads-store.js'

/** 组件消费的 props(槽标准 props + inject 面,全部按可缺失防御)。 */
export interface UploadDockProps {
  sessionId?: SessionId
  inputActions?: InputActionsFace
  store?: UploadsStore
  api?: () => AttachmentsCalls | undefined
  sessions?: SessionsFace
  /** 打开预览弹层(client/index.ts 注入)。 */
  openPreview?: (relPath: string, name: string, line: string) => void
}

/** 本次页面加载已做过「刷新清空」的会话(模块级 = 页生命周期)。 */
const clearedOnLoad = new Set<string>()

function extLabel(name: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toUpperCase() : ''
  return ext.length > 0 && ext.length <= 5 ? ext : 'FILE'
}

/** 从 dock 根向上找包含 textarea 的最近祖先作用域(composer 栈)。 */
function findComposer(from: HTMLElement): HTMLElement | undefined {
  let scope: HTMLElement | null = from.parentElement
  while (scope !== null && scope.querySelector('textarea') === null) scope = scope.parentElement
  return scope ?? undefined
}

/**
 * 在 composer 作用域内为卡片挑安置点——钻到可视白卡内部:
 * - 有原生图片缩略图:img 向上溯到「其父层同时含 textarea」的那一层,
 *   该层即与输入块平级的图片行,把宿主并进这一行(同一行并排);
 * - 无图片:直接插在 textarea 之前(同一父层),必然在卡片边框之内。
 */
function placeHost(scope: HTMLElement, host: HTMLElement): void {
  const textarea = scope.querySelector('textarea')
  if (textarea === null) return
  const img = scope.querySelector('img')
  if (img !== null && !host.contains(img)) {
    // 找缩略图所在的横向行:收集 img 到输入区祖先之间的全部祖先,
    // 用计算样式挑「flex 横向 + overflow-x 可滚」的那层(原生 rail 的特征,
    // 带翻页箭头与滚轮翻页);没有再退到最外层 flex 横向行。层数/类名都不猜。
    const ancestors: HTMLElement[] = []
    let node: HTMLElement | null = (img as HTMLElement).parentElement
    while (node !== null && node.querySelector('textarea') === null) {
      ancestors.push(node)
      node = node.parentElement
    }
    const flexRows = ancestors.filter(el => {
      const style = getComputedStyle(el)
      return (style.display === 'flex' || style.display === 'inline-flex') && !style.flexDirection.startsWith('column')
    })
    const rail = flexRows.find(el => {
      const overflow = getComputedStyle(el).overflowX
      return overflow === 'auto' || overflow === 'scroll'
    }) ?? flexRows.at(-1)
    if (rail !== undefined && rail !== host) {
      host.className = 'dat-portal dat-portal-inline'
      // 与缩略图条目严格等高:实测行内首个条目高度写进 CSS 变量。
      const sample = [...rail.children].find(child =>
        child !== host && child instanceof HTMLElement && child.offsetHeight > 0) as HTMLElement | undefined
      if (sample !== undefined) host.style.setProperty('--dat-thumb-h', `${sample.offsetHeight}px`)
      if (host.parentElement !== rail) rail.appendChild(host)
      return
    }
  }
  host.className = 'dat-portal dat-portal-block'
  // 以工具行为地标找「卡片内容列」:textarea 上溯,直到所在容器同层含
  // 工具按钮(+ / 回形针等)。把宿主插在输入块之前——列式块流把文字区
  // 往下推,对话框自然拉高,不与文字重叠。
  let anchor: HTMLElement = textarea as HTMLElement
  let column: HTMLElement | null = anchor.parentElement
  while (column !== null && column.querySelector('button') === null) {
    anchor = column
    column = column.parentElement
  }
  if (column === null) {
    // 找不到工具行地标:退回 textarea 父层(可能重叠,但至少在框内)。
    const parent = (textarea as HTMLElement).parentElement
    if (parent !== null && (host.parentElement !== parent || host.nextElementSibling !== textarea)) {
      parent.insertBefore(host, textarea)
    }
    return
  }
  if (host.parentElement !== column || host.nextElementSibling !== anchor) {
    column.insertBefore(host, anchor)
  }
}

/** 附件卡片组件。 */
export function UploadDock({ sessionId, inputActions, store, api, sessions, openPreview }: UploadDockProps): ReactNode {
  const key = sessionId as unknown as string | undefined
  const version = useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    () => (store !== undefined && key !== undefined ? store.version(key) : 0),
    () => 0,
  )
  const [files, setFiles] = useState<readonly StashedFile[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLElement | undefined>(undefined)
  const [host, setHost] = useState<HTMLElement | undefined>(undefined)

  // 捕捉当前 composer 上下文(渲染期回写,不触发通知)。
  if (store !== undefined && key !== undefined) {
    store.capture({ sessionId: key, inputActions })
  }

  // 真相源同步:版本变化(本端落盘)立即重取;2s 轮询兜底注入消费。
  useEffect(() => {
    if (key === undefined) return
    const calls = api?.()
    if (calls === undefined) return
    let cancelled = false
    const pull = (): void => {
      void calls.listStash(key)
        .then(result => {
          if (!cancelled && result.ok) setFiles(result.value.files)
        })
        .catch(() => undefined)
    }
    // 刷新一致性:与原生图片草稿同寿命——本页首次接触该会话时,先清掉
    // 上个页面生命周期遗留的暂存(未发送的落盘文件一并删除),再开始拉取。
    if (!clearedOnLoad.has(key)) {
      clearedOnLoad.add(key)
      const cwd = sessions?.list.getSnapshot().byId[key]?.cwd
      if (cwd !== undefined) {
        void calls.clearStash(cwd, key).catch(() => undefined).finally(() => { if (!cancelled) pull() })
      } else {
        pull()
      }
    } else {
      pull()
    }
    const timer = setInterval(pull, 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [api, key, version])

  // portal 安置与看护。
  useEffect(() => {
    const root = rootRef.current
    if (root === null || files.length === 0) {
      hostRef.current?.remove()
      hostRef.current = undefined
      setHost(undefined)
      return
    }
    const composer = findComposer(root)
    if (composer === undefined) {
      setHost(undefined) // 回退:行内展示
      return
    }
    const element = hostRef.current ?? document.createElement('div')
    hostRef.current = element
    element.dataset.plugin = 'dsh-attachments'
    placeHost(composer, element)
    setHost(element)
    let scheduled = false
    const observer = new MutationObserver(() => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        const current = hostRef.current
        if (current !== undefined) placeHost(composer, current)
      })
    })
    observer.observe(composer, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      element.remove()
      if (hostRef.current === element) hostRef.current = undefined
    }
  }, [files.length, key])

  if (key === undefined) return null

  const removeCard = (file: StashedFile): void => {
    const calls = api?.()
    const cwd = sessions?.list.getSnapshot().byId[key]?.cwd
    if (calls === undefined || cwd === undefined) return
    void calls.removeStash(cwd, key, file.relPath)
      .catch(() => undefined)
      .finally(() => { store?.bump(key) })
  }

  const cards = files.map(file => (
    <div
      key={file.relPath}
      className="dat-card"
      title={`${file.relPath} · 点击预览`}
      style={{ cursor: 'pointer' }}
      onClick={() => { openPreview?.(file.relPath, file.name, `📎 ${file.name}(${formatSize(file.size)}) → ${file.relPath}`) }}
    >
      {store?.preview(file.relPath) !== undefined
        ? <span className="dat-card-icon dat-card-icon-img" aria-hidden="true" style={{ backgroundImage: `url(${store.preview(file.relPath)!})` }} />
        : <span className="dat-card-icon" aria-hidden="true" />}
      <span className="dat-card-main">
        <span className="dat-card-name">{file.name}</span>
        <span className="dat-card-meta">{`${extLabel(file.name)} ${formatSize(file.size)}`}</span>
      </span>
      <button
        type="button"
        className="dat-card-remove"
        aria-label={`移除附件 ${file.name}`}
        onClick={() => { removeCard(file) }}
      >✕</button>
    </div>
  ))

  return (
    <div ref={rootRef} style={{ display: 'contents' }} data-plugin="dsh-attachments">
      {files.length === 0
        ? null
        : host !== undefined
          ? createPortal(<div className="dat-cards">{cards}</div>, host)
          : <div className="dat-dock">{cards}</div>}
    </div>
  )
}
