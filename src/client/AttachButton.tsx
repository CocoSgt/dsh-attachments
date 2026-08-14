/**
 * 附件按钮：输入框工具栏左端（conversation.input.left 槽）的回形针按钮。
 * 点击打开文件选择器（多选）；分诊与落位逻辑见 intake.ts。
 * 样式采用内联 style —— 与宿主工具栏按钮同尺寸的幽灵图标按钮，
 * 不依赖宿主 CSS 类名，避免跨版本漂移。
 */
import { useCallback, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'
import { IconPaperclipOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InputActionsFace } from './intake.ts'

/** 组件消费的 props（全部按可缺失处理，防御宿主版本漂移）。 */
export interface AttachButtonProps {
  /** 框架标准件：会话 id（session 槽位必有）。 */
  sessionId?: SessionId
  /** ui-conversation 会话标准件：输入机公共动作面。 */
  inputActions?: InputActionsFace
  /** InputZone 所有者份额：当前输入状态（读取草稿基线）。 */
  input?: { readonly draft: string }
  /** 本插件通过 slot inject 提供的分诊入口。 */
  intake?: (files: readonly File[], inputActions: InputActionsFace | undefined, draft: string) => Promise<unknown> | unknown
}

/** 按钮的行内样式。 */
const BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  border: 'none',
  background: 'transparent',
  borderRadius: 6,
  color: 'inherit',
  cursor: 'pointer',
  opacity: 0.75,
  padding: 0,
}

/** 附件按钮。 */
export function AttachButton({ sessionId, inputActions, input, intake }: AttachButtonProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const zh = navigator.language.toLowerCase().startsWith('zh')

  const handleClick = useCallback(() => { fileInput.current?.click() }, [])

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    event.target.value = '' // 允许连续选择同一个文件
    if (files.length === 0 || sessionId === undefined) return
    if (intake === undefined) return // 装配异常（inject 面缺失）：安全起见不落位
    setBusy(true)
    try {
      void Promise.resolve(intake(files, inputActions, input?.draft ?? ''))
        .finally(() => { setBusy(false) })
    } catch {
      setBusy(false)
    }
  }, [sessionId, inputActions, input, intake])

  return (
    <>
      <button
        type="button"
        style={{ ...BUTTON_STYLE, opacity: busy ? 0.4 : 0.75 }}
        disabled={busy}
        onClick={handleClick}
        title={zh ? '添加附件（图片直接上传，文本文件插入输入框）' : 'Attach files (images upload; text files insert into the draft)'}
        aria-label={zh ? '添加附件' : 'Attach files'}
        data-plugin="dsh-file-upload"
      >
        <IconPaperclipOutline16 />
      </button>
      <input
        ref={fileInput}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleChange}
      />
    </>
  )
}
