/**
 * 附件按钮:输入框工具栏左端(conversation.input.left 槽)的回形针按钮。
 * 点击打开文件选择器(多选,不设 accept 过滤——零类型拒绝);分诊与落位
 * 逻辑见 intake.ts。样式为与宿主工具栏按钮同尺寸的幽灵图标按钮。
 */
import { useCallback, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'
import { IconPaperclipOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InputActionsFace } from './intake.ts'
import { tr, type LocaleProps } from './locales.js'
import type { UploadsStore } from './uploads-store.js'

/** 组件消费的 props(全部按可缺失处理,防御宿主版本漂移)。 */
export interface AttachButtonProps extends LocaleProps {
  sessionId?: SessionId
  inputActions?: InputActionsFace
  /** 本插件通过 slot inject 提供的分诊入口。 */
  intake?: (files: readonly File[], inputActions: InputActionsFace | undefined) => Promise<unknown> | unknown
  /** 本插件的协调 store(捕捉当前 composer 上下文,拖拽/粘贴路由用)。 */
  store?: UploadsStore
}

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
export function AttachButton({ sessionId, inputActions, intake, store, t }: AttachButtonProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  // 冗余捕捉:与 UploadDock 双保险,任一渲染即可路由全窗拖拽/粘贴。
  if (store !== undefined && sessionId !== undefined) {
    store.capture({ sessionId: sessionId as unknown as string, inputActions })
  }
  const [busy, setBusy] = useState(false)
  // t 为槽注册声明 locale: 后框架合成的标准席位;缺失时回退模块级 tr()。
  const lc = t ?? tr

  const handleClick = useCallback(() => { fileInput.current?.click() }, [])

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    event.target.value = '' // 允许连续选择同一个文件
    if (files.length === 0 || sessionId === undefined) return
    if (intake === undefined) return // 装配异常(inject 面缺失):安全起见不落位
    setBusy(true)
    try {
      void Promise.resolve(intake(files, inputActions))
        .finally(() => { setBusy(false) })
    } catch {
      setBusy(false)
    }
  }, [sessionId, inputActions, intake])

  return (
    <>
      <button
        type="button"
        style={{ ...BUTTON_STYLE, opacity: busy ? 0.4 : 0.75 }}
        disabled={busy}
        onClick={handleClick}
        title={lc('attach.title')}
        aria-label={lc('attach.aria')}
        data-plugin="dsh-attachment"
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
