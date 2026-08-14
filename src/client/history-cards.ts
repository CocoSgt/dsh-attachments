/**
 * 历史消息附件卡装饰器。
 *
 * 注入的附件消息以 user 来源、**先于用户文字**落日志(pre-step 批次序
 * 决定日志序),历史里天然是「附件行在上、文字行在下」。本模块把附件行
 * 就地升级为文件卡(图标块 + 文件名 + 类型/大小),隐藏该行自己的
 * 时间/复制动作条并收拢与下方文字行的间距——两行视觉上合为一组消息:
 * 卡片、文字、一个时间戳、一个复制按钮。
 *
 * 安全边界:绝不移动/删除 React 自有节点——只加类(CSS 隐藏/收拢)与
 * 追加卡片子元素;虚拟列表卸载重建、React 重渲染抹掉类名时,
 * MutationObserver 重新装饰;文本被编辑得不再匹配时撤销装饰。
 * 禁区:composer 输入区(data-composer-seat)、含 textarea 的容器、
 * 本插件自己的 portal/卡片区,一律不装饰。
 * 点卡片 = 打开预览弹层(复制引用在弹层头部)。
 */

/** 预览打开器(client/index.ts 注入)。 */
let openPreview: (relPath: string, name: string, line: string) => void = () => {}
export function setPreviewOpener(fn: (relPath: string, name: string, line: string) => void): void {
  openPreview = fn
}

/** 一行附件引用的解析结果。 */
interface ParsedAttachment {
  name: string
  meta: string
  /** 原始引用行(弹层「复制引用」用)。 */
  line: string
  /** 工作区相对路径(预览读取用)。 */
  relPath: string
}

/** 解析气泡文本里的附件行(📎 name(size) → relPath)。 */
function parseAttachments(text: string): ParsedAttachment[] {
  const out: ParsedAttachment[] = []
  for (const line of text.split('\n')) {
    const match = /^📎\s*(.+?)\((.+?)\)\s*→\s*(\S+)/u.exec(line.trim())
    if (match === null) continue
    const name = match[1]!.trim()
    const dot = name.lastIndexOf('.')
    const ext = dot >= 0 ? name.slice(dot + 1).toUpperCase() : 'FILE'
    out.push({ name, meta: `${ext.length <= 5 ? ext : 'FILE'} ${match[2]!.trim()}`, line: line.trim(), relPath: match[3]! })
  }
  return out
}

/** 构造一张卡片的 DOM(与 composer 卡同款样式类);点击复制引用行。 */
function buildCard(entry: ParsedAttachment): HTMLElement {
  const card = document.createElement('div')
  card.className = 'dat-card'
  const icon = document.createElement('span')
  icon.className = 'dat-card-icon'
  icon.setAttribute('aria-hidden', 'true')
  const main = document.createElement('span')
  main.className = 'dat-card-main'
  const name = document.createElement('span')
  name.className = 'dat-card-name'
  name.textContent = entry.name
  const meta = document.createElement('span')
  meta.className = 'dat-card-meta'
  meta.textContent = entry.meta
  main.append(name, meta)
  card.append(icon, main)
  card.title = '点击预览'
  card.style.cursor = 'pointer'
  card.addEventListener('click', () => { openPreview(entry.relPath, entry.name, entry.line) })
  return card
}

/** 该元素是否处于禁区(composer 输入区/本插件 portal 内)。 */
function inForbiddenZone(el: Element): boolean {
  return el.closest('[data-composer-seat]') !== null
    || el.closest('.dat-portal') !== null
    || el.closest('.dat-msg-cards') !== null
    || el.querySelector('textarea') !== null
}

/** 撤销一次装饰(文本已不匹配时)。 */
function undecorate(el: HTMLElement): void {
  el.classList.remove('dat-carded')
  el.querySelector(':scope > .dat-msg-cards')?.remove()
  el.closest('.dat-carded-bg')?.classList.remove('dat-carded-bg')
  el.closest('.dat-carded-row')?.classList.remove('dat-carded-row')
}

/** 在一行消息里找可视气泡:最内层带背景且有文字的元素。 */
function findBubble(row: HTMLElement): HTMLElement | undefined {
  const candidates: HTMLElement[] = []
  for (const el of row.querySelectorAll('*')) {
    if (!(el instanceof HTMLElement)) continue
    if ((el.textContent ?? '').trim() === '') continue
    const style = getComputedStyle(el)
    if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') candidates.push(el)
  }
  return candidates.find(el => !candidates.some(other => other !== el && el.contains(other)))
}

/** 从附件装饰元素提取 📎 引用行(不含说明行)。 */
function referenceLines(carded: HTMLElement): string {
  const cardText = carded.querySelector(':scope > .dat-msg-cards')?.textContent ?? ''
  const own = (carded.textContent ?? '').replace(cardText, '')
  return own.split('\n').map(line => line.trim()).filter(line => line.startsWith('📎')).join('\n')
}

/** candidate 是否为「最深」匹配(没有子元素还包含完整特征)。 */
function isDeepestMatch(el: Element): boolean {
  for (const child of el.children) {
    if (child.textContent !== null && child.textContent.includes('📎') && child.textContent.includes('→ .dsh/uploads/')) {
      return false
    }
  }
  return true
}

function decorate(el: HTMLElement): void {
  el.classList.add('dat-carded')
  if (el.querySelector(':scope > .dat-msg-cards') !== null) return
  const parsed = parseAttachments(el.textContent ?? '')
  if (parsed.length === 0) {
    el.classList.remove('dat-carded')
    return
  }
  const row = document.createElement('div')
  row.className = 'dat-msg-cards'
  for (const entry of parsed) row.append(buildCard(entry))
  el.append(row)
  // 中和气泡底色:向上找最近的带背景元素,清掉底色/内边距,卡片独立悬浮。
  let bubble: HTMLElement | null = el
  for (let depth = 0; depth < 3 && bubble !== null; depth += 1) {
    const style = getComputedStyle(bubble)
    if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') {
      bubble.classList.add('dat-carded-bg')
      break
    }
    bubble = bubble.parentElement
  }
  // 行级合并:隐藏本行动作条(时间/复制),收拢与下方文字行的间距。
  let actionRow: HTMLElement | null = el
  for (let depth = 0; depth < 5 && actionRow !== null; depth += 1) {
    if (actionRow.querySelector('button') !== null) {
      actionRow.classList.add('dat-carded-row')
      break
    }
    actionRow = actionRow.parentElement
  }
}

/** 扫描一个子树,装饰所有附件气泡。 */
function sweep(root: Element): void {
  const text = root.textContent ?? ''
  if (!text.includes('📎') || !text.includes('→ .dsh/uploads/')) return
  const queue: Element[] = [root]
  while (queue.length > 0) {
    const el = queue.pop()!
    const content = el.textContent ?? ''
    if (!content.includes('📎') || !content.includes('→ .dsh/uploads/')) continue
    if (isDeepestMatch(el)) {
      if (el instanceof HTMLElement && !inForbiddenZone(el)) decorate(el)
      continue
    }
    for (const child of el.children) queue.push(child)
  }
}

/** 安装历史附件卡装饰器;返回清理函数。 */
export function installHistoryCards(): () => void {
  // 局部触发:只在新增节点携带附件签名时装饰该子树;巡检撤销失效装饰。
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        const el = node instanceof Element ? node : node.parentElement
        if (el === null) continue
        const text = el.textContent ?? ''
        if (text.includes('📎') && text.includes('→ .dsh/uploads/')) sweep(el)
      }
    }
    for (const el of document.querySelectorAll('.dat-carded')) {
      if (!(el instanceof HTMLElement)) continue
      const text = el.textContent ?? ''
      const cardText = el.querySelector(':scope > .dat-msg-cards')?.textContent ?? ''
      const own = text.replace(cardText, '')
      if (!own.includes('📎') || !own.includes('→ .dsh/uploads/') || inForbiddenZone(el)) undecorate(el)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  sweep(document.body)
  // 组合复制:文字行的复制按钮,若其行块前兄弟是附件装饰行,则拦截并
  // 写入「📎 引用行 + 文字」;无附件的行走宿主默认复制,不受影响。
  const onClickCapture = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null
    const button = target?.closest('button') ?? null
    if (button === null || button.closest('.dat-msg-cards') !== null) return
    let level: HTMLElement | null = button
    let carded: HTMLElement | null = null
    let rowLevel: HTMLElement | null = null
    for (let depth = 0; depth < 8 && level !== null; depth += 1) {
      const prev = level.previousElementSibling
      if (prev instanceof HTMLElement) {
        const found = prev.querySelector('.dat-carded')
        if (found instanceof HTMLElement) {
          carded = found
          rowLevel = level
          break
        }
      }
      level = level.parentElement
    }
    if (carded === null || rowLevel === null) return
    const refs = referenceLines(carded)
    const text = (findBubble(rowLevel)?.textContent ?? '').trim()
    if (refs === '' || text === '') return
    event.preventDefault()
    event.stopPropagation()
    void navigator.clipboard?.writeText(`${refs}\n${text}`).catch(() => undefined)
  }
  document.addEventListener('click', onClickCapture, true)
  return () => {
    observer.disconnect()
    document.removeEventListener('click', onClickCapture, true)
  }
}
