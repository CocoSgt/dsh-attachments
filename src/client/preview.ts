/**
 * 附件预览弹层。
 *
 * 点击附件卡打开:图片直接渲染;Markdown/文本/代码按纯文本渲染;其他
 * 类型提示并提供「用系统应用打开」。头部附「复制引用」(附件的文本协议
 * 形态,粘贴到输入框即等同重新携带)。Esc / 点击遮罩关闭。
 * 纯自建 DOM,与 React 树无交集。
 */

/** 预览请求的运行依赖。 */
export interface PreviewEnv {
  /** 读回文件字节(base64)。 */
  readonly load: (relPath: string) => Promise<{ dataBase64: string; size: number }>
  /** 用系统默认应用打开(host.openPath;不可用时为 undefined)。 */
  readonly openSystem?: (relPath: string) => void
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])
const TEXT_EXTS = new Set([
  'md', 'markdown', 'txt', 'log', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'csv', 'tsv',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h',
  'cpp', 'hpp', 'cs', 'php', 'swift', 'sh', 'bash', 'zsh', 'sql', 'html', 'htm', 'css',
  'scss', 'less', 'xml', 'svg', 'vue', 'svelte', 'env', 'gitignore', 'editorconfig',
])

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function base64ToBytes(dataBase64: string): Uint8Array {
  const binary = atob(dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 打开一个附件的预览弹层。 */
export function showPreview(env: PreviewEnv, relPath: string, name: string, referenceLine: string): void {
  document.querySelector('.dat-preview')?.remove()
  const overlay = document.createElement('div')
  overlay.className = 'dat-preview'
  overlay.dataset.plugin = 'dsh-attachments'
  const panel = document.createElement('div')
  panel.className = 'dat-preview-panel'
  const head = document.createElement('div')
  head.className = 'dat-preview-head'
  const title = document.createElement('span')
  title.className = 'dat-preview-title'
  title.textContent = name
  const copyBtn = document.createElement('button')
  copyBtn.type = 'button'
  copyBtn.className = 'dat-preview-btn'
  copyBtn.textContent = '复制引用'
  copyBtn.addEventListener('click', () => {
    void navigator.clipboard?.writeText(referenceLine).catch(() => undefined)
    copyBtn.textContent = '已复制 ✓'
    setTimeout(() => { copyBtn.textContent = '复制引用' }, 1200)
  })
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'dat-preview-btn'
  closeBtn.textContent = '✕'
  const body = document.createElement('div')
  body.className = 'dat-preview-body'
  body.textContent = '加载中…'
  head.append(title, copyBtn, closeBtn)
  panel.append(head, body)
  overlay.append(panel)
  document.body.append(overlay)

  let revoke: (() => void) | undefined
  const close = (): void => {
    revoke?.()
    overlay.remove()
    document.removeEventListener('keydown', onKey, true)
  }
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
    }
  }
  closeBtn.addEventListener('click', close)
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close()
  })
  document.addEventListener('keydown', onKey, true)

  const ext = extOf(name)
  void env.load(relPath)
    .then(({ dataBase64 }) => {
      if (!overlay.isConnected) return
      body.textContent = ''
      if (IMAGE_EXTS.has(ext)) {
        const bytes = base64ToBytes(dataBase64)
        const blob = new Blob([bytes.buffer as ArrayBuffer])
        const url = URL.createObjectURL(blob)
        revoke = () => { URL.revokeObjectURL(url) }
        const img = document.createElement('img')
        img.className = 'dat-preview-img'
        img.src = url
        img.alt = name
        body.append(img)
        return
      }
      if (TEXT_EXTS.has(ext) || ext === '') {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(base64ToBytes(dataBase64))
        const pre = document.createElement('pre')
        pre.className = 'dat-preview-text'
        pre.textContent = text.length > 300_000 ? `${text.slice(0, 300_000)}\n…(预览截断)` : text
        body.append(pre)
        return
      }
      const hint = document.createElement('div')
      hint.className = 'dat-preview-hint'
      hint.textContent = `暂不支持在页面内预览 .${ext} 文件。`
      body.append(hint)
      if (env.openSystem !== undefined) {
        const openBtn = document.createElement('button')
        openBtn.type = 'button'
        openBtn.className = 'dat-preview-btn dat-preview-open'
        openBtn.textContent = '用系统应用打开'
        openBtn.addEventListener('click', () => { env.openSystem?.(relPath) })
        body.append(openBtn)
      }
    })
    .catch((error: unknown) => {
      if (!overlay.isConnected) return
      body.textContent = `读取失败:${error instanceof Error ? error.message : String(error)}`
    })
}
