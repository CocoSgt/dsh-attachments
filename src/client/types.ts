/**
 * 客户端本地的最小服务类型面(与 dsh-context-inspector 同款模式):
 * remote 挂载、sessions 列表快照、slots 注册。运行时契约由
 * dsh-client-runtime / ui-slots / api-gateway 提供。
 */

import type { ListStashResult, ReadStashResult, RemoveStashResult, StashResult } from '../index.js'

/** 一个 strict zod 编解码器(客户端描述符用)。 */
export interface StrictCodec {
  readonly mode: 'strict'
  readonly typeSymbol: string
  readonly schema: { parse(value: unknown): unknown }
}

/** 一个调用参数描述符。 */
export interface ParameterDescriptor {
  readonly name: string
  readonly wire: string
  readonly source: 'json'
  readonly codec: StrictCodec
}

/** 一个远端调用描述符(Typert InvocationDescriptor 的直调子集)。 */
export interface InvocationDescriptorLike {
  readonly id: string
  readonly service: string
  readonly namespace: string
  readonly method: string
  readonly invocation: { readonly kind: 'direct' }
  readonly parameters: readonly ParameterDescriptor[]
  readonly result: StrictCodec
}

/** RPC 结果的共用外形。 */
export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** fileStash 命名空间挂载后的调用面。 */
export interface AttachmentsCalls {
  stashFile(cwd: string, sessionId: string, name: string, dataBase64: string): Promise<RpcResult<StashResult>>
  removeStash(cwd: string, sessionId: string, relPath: string): Promise<RpcResult<RemoveStashResult>>
  restageFile(cwd: string, sessionId: string, relPath: string): Promise<RpcResult<StashResult>>
  clearStash(cwd: string, sessionId: string): Promise<RpcResult<RemoveStashResult>>
  readStash(cwd: string, relPath: string): Promise<RpcResult<ReadStashResult>>
  listStash(sessionId: string): Promise<RpcResult<ListStashResult>>
}

/** ctx.remote 的最小面。 */
export interface RemoteFace {
  $mount(contribution: { package: string; descriptors: readonly InvocationDescriptorLike[] }): Promise<() => Promise<void>>
  fileStash: AttachmentsCalls
}

/** 会话摘要中本插件关心的字段。 */
export interface SessionSummaryLike {
  readonly cwd?: string
}

/** sessions 列表快照中本插件关心的字段。 */
export interface SessionListStateLike {
  readonly current: string | undefined
  readonly byId: Readonly<Record<string, SessionSummaryLike | undefined>>
}

/** ctx.sessions 的最小面。 */
export interface SessionsFace {
  readonly list: {
    getSnapshot(): SessionListStateLike
    subscribe(fn: () => void): () => void
  }
}
