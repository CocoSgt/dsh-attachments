/**
 * dsh-file-upload 的 node 半体（host 侧入口）。
 *
 * 本插件的所有功能都在浏览器半体（src/client/，产物 lib/client.js）里：
 * 输入框工具栏的附件按钮、图片附件管线、文本文件内联。host 侧没有
 * 需要做的事 —— 无配置项、无服务、无工具 —— 因此 apply 为空。
 *
 * 这个文件必须存在且导出 apply：Loader 的行（见 cordis.patch.yml）按
 * 包名加载本入口；client-modules 的启动图扫描也以这一行为锚点。
 */
import type { Context } from '@deepseek-ai/cordis'

export function apply(_ctx: Context): void {
  // 有意为空：见上文文件注释。
}
