/**
 * 文件分诊与入草稿的核心逻辑（浏览器半体）。
 *
 * dsh 的发送管线只接受两种内容块：text 与 image（base64）。因此附件的
 * 归宿由类型决定：
 *   - 图片（png/jpeg/webp/gif）→ ConversationController.createDraftImages
 *     注册进原生附件管线，缩略图由内置 AttachmentRail 展示 —— 和粘贴
 *     图片完全同一条路径；
 *   - 文本类文件 → 读出内容，以带文件名标注的围栏代码块追加进输入框
 *     草稿（这是无提交钩子前提下唯一合法的发送通道）；
 *   - 其余二进制 → 通过会话输入面板的 notice 通道明确拒绝。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// 类型边界：ConversationController（含 createDraftImages 等具体方法）与
// Context 服务合并。仅类型导入，编译后全部擦除。
import type { ConversationController, DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** 输入机公共动作面（ui-conversation 会话标准件的 inputActions）。 */
export interface InputActionsFace {
  setDraft(text: string): void
  addImages(ids: readonly DraftAttachmentId[]): boolean
  removeImage(id: DraftAttachmentId): void
  pruneImages(ids: readonly DraftAttachmentId[]): void
}

/** createDraftImages 接受的图片 MIME 白名单（与其内部 imageMediaType 一致）。 */
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** 按扩展名认定为文本的文件（MIME 缺失或不可信时的兜底）。 */
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'mdx', 'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml',
  'ini', 'cfg', 'conf', 'csv', 'tsv', 'log', 'xml', 'html', 'htm', 'css', 'scss',
  'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'py', 'pyi', 'rb',
  'go', 'rs', 'java', 'kt', 'kts', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'swift',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'graphql', 'gql', 'vue', 'svelte',
  'astro', 'env', 'gitignore', 'dockerignore', 'editorconfig', 'svg',
])

/** 扩展名 → 围栏代码块语言标注。 */
const FENCE_LANG = new Map([
  ['md', 'markdown'], ['markdown', 'markdown'], ['mdx', 'markdown'],
  ['json', 'json'], ['jsonc', 'json'], ['json5', 'json'],
  ['yaml', 'yaml'], ['yml', 'yaml'], ['toml', 'toml'], ['ini', 'ini'],
  ['csv', 'csv'], ['tsv', 'csv'], ['log', 'log'], ['xml', 'xml'],
  ['html', 'html'], ['htm', 'html'], ['css', 'css'], ['scss', 'scss'], ['less', 'less'],
  ['js', 'javascript'], ['mjs', 'javascript'], ['cjs', 'javascript'], ['jsx', 'jsx'],
  ['ts', 'typescript'], ['mts', 'typescript'], ['cts', 'typescript'], ['tsx', 'tsx'],
  ['py', 'python'], ['pyi', 'python'], ['rb', 'ruby'], ['go', 'go'], ['rs', 'rust'],
  ['java', 'java'], ['kt', 'kotlin'], ['kts', 'kotlin'], ['c', 'c'], ['h', 'c'],
  ['cpp', 'cpp'], ['hpp', 'cpp'], ['cs', 'csharp'], ['php', 'php'], ['swift', 'swift'],
  ['sh', 'bash'], ['bash', 'bash'], ['zsh', 'bash'], ['sql', 'sql'],
  ['graphql', 'graphql'], ['gql', 'graphql'], ['vue', 'vue'], ['svelte', 'svelte'],
  ['svg', 'xml'],
])

/** 单个文本文件内联进草稿的大小上限；超出部分截断并标注。 */
const MAX_TEXT_BYTES = 256 * 1024

/** 一次批量选择里最多内联的文本文件数；超出部分拒绝并提示。 */
const MAX_TEXT_FILES_PER_BATCH = 8

/** 一个待处理文件的分诊结果。 */
type Verdict =
  | { kind: 'image'; file: File }
  | { kind: 'text'; file: File }
  | { kind: 'reject'; file: File; reason: string }

/** 判定一个浏览器文件的归宿。 */
function classify(file: File): Verdict {
  const type = (file.type ?? '').toLowerCase()
  if (IMAGE_MIME.has(type)) return { kind: 'image', file }
  if (file.name.toLowerCase().endsWith('.svg')) return { kind: 'text', file }
  if (type.startsWith('text/')) return { kind: 'text', file }
  if (/^application\/(json|xml|yaml|toml|x-yaml|javascript|sql)/.test(type)) return { kind: 'text', file }
  if (type === '') {
    // 无 MIME（常见于某些来源的本地文件）时按扩展名兜底
    if (extensionOf(file.name) !== '') return { kind: 'text', file }
    return { kind: 'reject', file, reason: 'unknown' }
  }
  if (extensionOf(file.name) !== '' && TEXT_EXTENSIONS.has(extensionOf(file.name))) return { kind: 'text', file }
  return { kind: 'reject', file, reason: 'binary' }
}

/** 小写扩展名（不含点；无扩展名为空串）。 */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** 人类可读的大小。 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 读取一个文本文件为（可能截断的）内容。 */
async function readText(file: File): Promise<{ content: string; truncated: boolean }> {
  const raw = await file.text()
  if (raw.length <= MAX_TEXT_CHARS) return { content: raw, truncated: false }
  return { content: raw.slice(0, MAX_TEXT_CHARS), truncated: true }
}

/** 字符数上限（按 UTF-16 码元计，约等于 256KB ASCII）。 */
const MAX_TEXT_CHARS = MAX_TEXT_BYTES

/** 把一批文本文件渲染为追加进草稿的标注块。 */
async function renderTextBlock(files: readonly File[], zh: boolean): Promise<string> {
  const parts: string[] = []
  for (const file of files) {
    const { content, truncated } = await readText(file)
    const lang = FENCE_LANG.get(extensionOf(file.name)) ?? ''
    const lines = content.split('\n').length
    const notes: string[] = [formatSize(file.size), `${lines} ${zh ? '行' : 'lines'}`]
    if (truncated) notes.push(zh ? `已截断至 ${formatSize(MAX_TEXT_BYTES)}` : `truncated to ${formatSize(MAX_TEXT_BYTES)}`)
    const header = `${zh ? '【文件' : '[File'}: ${file.name} | ${notes.join(' | ')}${zh ? '】' : ']'}`
    parts.push(`${header}\n\`\`\`${lang}\n${content}\n\`\`\`\n`)
  }
  return parts.join('\n')
}

/** 一次 intake 的执行摘要（供调试/日志）。 */
export interface IntakeReport {
  imagesAdded: number
  textFilesInlined: number
  rejected: readonly { name: string; reason: string }[]
}

/**
 * 处理一批用户选择的文件：图片入附件管线、文本入草稿、其余拒绝。
 * 全部落位后按需通过会话 notice 通道反馈拒绝与错误。
 */
export async function runIntake(
  ctx: ClientContext,
  sessionId: SessionId,
  files: readonly File[],
  inputActions: InputActionsFace | undefined,
  currentDraft: string,
): Promise<IntakeReport> {
  const zh = navigator.language.toLowerCase().startsWith('zh')
  const rejected: { name: string; reason: string }[] = []
  const report: IntakeReport = { imagesAdded: 0, textFilesInlined: 0, rejected }
  const conversation = ctx.get('conversation') as ConversationController | undefined

  /** 会话输入面板的 notice（服务缺失时静默降级为 console）。 */
  const notify = (level: 'info' | 'error', text: string): void => {
    if (conversation !== undefined) {
      const actx = ctx.sessions.scope(sessionId)
      if (actx !== undefined) {
        conversation.input.for(actx).notify(level, text)
        return
      }
    }
    console[level === 'error' ? 'error' : 'log'](`[dsh-file-upload] ${text}`)
  }

  const images: File[] = []
  const texts: File[] = []
  for (const file of files) {
    const verdict = classify(file)
    if (verdict.kind === 'image') images.push(verdict.file)
    else if (verdict.kind === 'text') texts.push(verdict.file)
    else rejected.push({ name: verdict.file.name, reason: verdict.reason })
  }

  // 图片：走原生附件管线（与内置粘贴路径完全一致）
  if (images.length > 0 && conversation !== undefined && inputActions !== undefined) {
    try {
      const drafts = conversation.createDraftImages(images)
      if (inputActions.addImages(drafts.map(draft => draft.id))) {
        report.imagesAdded = drafts.length
      } else {
        conversation.releaseDraftImages(drafts)
        notify('error', zh
          ? `图片未加入：当前输入阶段不接受附件（可能已超出单条消息的图片上限）`
          : `Images not added: the composer refused attachments (image-per-message limit may be reached)`)
      }
    } catch (error: unknown) {
      notify('error', zh
        ? `图片加入失败：${error instanceof Error ? error.message : String(error)}`
        : `Failed to add images: ${error instanceof Error ? error.message : String(error)}`)
    }
  } else if (images.length > 0) {
    notify('error', zh ? '会话服务不可用，图片未加入' : 'Conversation service unavailable; images not added')
  }

  // 文本类：内联进草稿
  const overflow = texts.splice(MAX_TEXT_FILES_PER_BATCH)
  for (const file of overflow) rejected.push({
    name: file.name,
    reason: zh ? `batch-limit:${MAX_TEXT_FILES_PER_BATCH}` : `batch-limit:${MAX_TEXT_FILES_PER_BATCH}`,
  })
  if (texts.length > 0 && inputActions !== undefined) {
    try {
      const block = await renderTextBlock(texts, zh)
      inputActions.setDraft(currentDraft + (currentDraft === '' ? '' : '\n\n') + block)
      report.textFilesInlined = texts.length
    } catch (error: unknown) {
      notify('error', zh
        ? `文本文件读取失败：${error instanceof Error ? error.message : String(error)}`
        : `Failed to read text files: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // 拒绝项反馈
  if (report.rejected.length > 0) {
    const names = report.rejected.map(item => item.name).join('、')
    notify('error', zh
      ? `已忽略 ${report.rejected.length} 个文件（仅支持图片与文本类文件）：${names}`
      : `Ignored ${report.rejected.length} file(s) (only images and text-like files are supported): ${names}`)
  }

  return report
}
