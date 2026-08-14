/**
 * 手写的 fileStash 客户端调用描述符。
 * wire 字段名 = 宿主方法参数名(cwd/sessionId/name/dataBase64/relPath);
 * $mount 时用 strict zod schema 做边界校验,与宿主实现一一对应。
 */

import { z } from 'zod'
import type { InvocationDescriptorLike, ParameterDescriptor, StrictCodec } from './types.js'

const stringParameter = (name: string, typeSymbol: string): ParameterDescriptor => ({
  name,
  wire: name,
  source: 'json',
  codec: { mode: 'strict', typeSymbol, schema: z.string() },
})

const resultCodec = (symbol: string, schema: { parse(value: unknown): unknown }): StrictCodec =>
  ({ mode: 'strict', typeSymbol: symbol, schema })

const stashResult = z.object({ relPath: z.string(), size: z.number() })
const removeStashResult = z.object({ removed: z.boolean() })
const readStashResult = z.object({ dataBase64: z.string(), size: z.number() })
const listStashResult = z.object({
  files: z.array(z.object({ relPath: z.string(), name: z.string(), size: z.number() })),
})

const cwdParameter = stringParameter('cwd', 'dsh-attachments#Cwd')
const sessionParameter = stringParameter('sessionId', 'dsh-attachments#SessionId')

/** 构造 fileStash 命名空间的全部调用描述符。 */
export function buildDescriptors(): readonly InvocationDescriptorLike[] {
  return [
    {
      id: 'dsh-attachments#fileStash/stashFile',
      service: 'fileStash',
      namespace: 'fileStash',
      method: 'stashFile',
      invocation: { kind: 'direct' },
      parameters: [
        cwdParameter,
        sessionParameter,
        stringParameter('name', 'dsh-attachments#Name'),
        stringParameter('dataBase64', 'dsh-attachments#Data'),
      ],
      result: resultCodec('dsh-attachments#StashResult', stashResult),
    },
    {
      id: 'dsh-attachments#fileStash/removeStash',
      service: 'fileStash',
      namespace: 'fileStash',
      method: 'removeStash',
      invocation: { kind: 'direct' },
      parameters: [
        cwdParameter,
        sessionParameter,
        stringParameter('relPath', 'dsh-attachments#RelPath'),
      ],
      result: resultCodec('dsh-attachments#RemoveStashResult', removeStashResult),
    },
    {
      id: 'dsh-attachments#fileStash/restageFile',
      service: 'fileStash',
      namespace: 'fileStash',
      method: 'restageFile',
      invocation: { kind: 'direct' },
      parameters: [
        cwdParameter,
        sessionParameter,
        stringParameter('relPath', 'dsh-attachments#RelPath'),
      ],
      result: resultCodec('dsh-attachments#StashResult', stashResult),
    },
    {
      id: 'dsh-attachments#fileStash/clearStash',
      service: 'fileStash',
      namespace: 'fileStash',
      method: 'clearStash',
      invocation: { kind: 'direct' },
      parameters: [cwdParameter, sessionParameter],
      result: resultCodec('dsh-attachments#RemoveStashResult', removeStashResult),
    },
    {
      id: 'dsh-attachments#fileStash/readStash',
      service: 'fileStash',
      namespace: 'fileStash',
      method: 'readStash',
      invocation: { kind: 'direct' },
      parameters: [cwdParameter, stringParameter('relPath', 'dsh-attachments#RelPath')],
      result: resultCodec('dsh-attachments#ReadStashResult', readStashResult),
    },
    {
      id: 'dsh-attachments#fileStash/listStash',
      service: 'fileStash',
      namespace: 'fileStash',
      method: 'listStash',
      invocation: { kind: 'direct' },
      parameters: [sessionParameter],
      result: resultCodec('dsh-attachments#ListStashResult', listStashResult),
    },
  ]
}
