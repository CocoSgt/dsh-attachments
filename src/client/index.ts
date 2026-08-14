/**
 * dsh-file-upload 的浏览器半体（产物 lib/client.js，经
 * window.__ModuleLoader__.load 注册进模块表）。
 *
 * 装配方式与官方 ui-goal 插件同构：ctx.slots.inject 挂进
 * conversation.input.left（输入框工具栏左端的 list 槽），按钮组件通过
 * slot inject 面拿到分诊入口；服务依赖由 cordis 层的 inject 列表把关
 * —— conversation 服务（ui-conversation）未就绪时本插件停驻等待。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// 类型边界：'conversation.input.left' 的 SlotMap 声明（ui-conversation 的
// declare module 合并）。仅类型，编译后擦除。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { runIntake, type InputActionsFace } from './intake.ts'
import { AttachButton } from './AttachButton.tsx'

export { AttachButton } from './AttachButton.tsx'
export { runIntake } from './intake.ts'
export type { InputActionsFace, IntakeReport } from './intake.ts'

/** 依赖的服务：槽系统、会话注册表、会话控制器（图片管线与 notice）。 */
export const inject = ['slots', 'sessions', 'conversation']

/**
 * 客户端插件体：把附件按钮注册进输入框工具栏左端。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'file-upload',
    order: 20,
    // 槽位 inject 面只在声明期拿到 sessionId；输入动作面与草稿快照由
    // 组件在调用时回传（它们是每次渲染的标准 props / 所有者份额）。
    inject: (sessionId: SessionId) => ({
      intake: (
        files: readonly File[],
        inputActions: InputActionsFace | undefined,
        draft: string,
      ): Promise<unknown> => runIntake(ctx, sessionId, files, inputActions, draft),
    }),
  }, AttachButton))
}
