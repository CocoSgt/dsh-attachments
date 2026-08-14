/**
 * 附件卡片与拖放遮罩样式:<style data-plugin="dsh-attachment"> 注入,
 * dat- 前缀。颜色走 --dsw-alias-* 设计令牌,深浅色随宿主主题自动适配。
 * 卡片形态对齐主流平台(Claude/DeepSeek):图标块 + 文件名 + 大小 + ✕。
 */

const CSS = `
.dat-dock {
  display: flex;
  flex-wrap: wrap;
  justify-content: center; /* input.dock 是面板全宽行,居中贴合下方的 composer 列 */
  gap: 8px;
  padding: 2px 8px 8px;
}
.dat-card {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: 320px;
  padding: 12px 34px 12px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
}
.dat-card-icon {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: #4c82fb; /* DeepSeek 同款蓝;brand 令牌在部分主题下渲染为黑,不用 */
  /* 文档图形:三道白色文本线(纯 CSS,免图片资源) */
  background-image:
    linear-gradient(#fff, #fff),
    linear-gradient(rgba(255,255,255,.95), rgba(255,255,255,.95)),
    linear-gradient(rgba(255,255,255,.95), rgba(255,255,255,.95));
  background-repeat: no-repeat;
  background-size: 18px 3px, 12px 3px, 18px 3px;
  background-position: 11px 13px, 11px 19px, 11px 25px;
}
.dat-card-icon-img {
  background-color: transparent;
  background-image: none;
  background-size: cover !important;
  background-position: center !important;
}
.dat-card-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}
.dat-card-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dat-card-meta {
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}
.dat-card-remove {
  position: absolute;
  top: 6px;
  right: 6px;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 6px;
  cursor: pointer;
  opacity: 0;
  transition: opacity .12s;
}
.dat-card:hover .dat-card-remove { opacity: 1; }
.dat-card-remove:hover {
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
}
.dat-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: none;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 86%, transparent);
  backdrop-filter: blur(14px);
  pointer-events: none;
}
.dat-overlay-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  box-shadow: none;
}
.dat-overlay-icons {
  position: relative;
  width: 104px;
  height: 78px;
  margin-bottom: 6px;
}
.dat-overlay-tile {
  position: absolute;
  width: 46px;
  height: 46px;
  border-radius: 13px;
  background-repeat: no-repeat;
}
.dat-overlay-tile[data-t='1'] {
  left: 2px; top: 10px;
  background-color: #79dfd2;
  transform: rotate(-14deg);
  background-image: linear-gradient(#fff, #fff), linear-gradient(#fff, #fff);
  background-size: 20px 4px, 4px 20px;
  background-position: 13px 21px, 21px 13px;
}
.dat-overlay-tile[data-t='2'] {
  right: 2px; top: 0;
  background-color: #7c9bff;
  transform: rotate(12deg);
  background-image: linear-gradient(#fff,#fff), linear-gradient(#fff,#fff), linear-gradient(#fff,#fff);
  background-size: 20px 4px, 14px 4px, 20px 4px;
  background-position: 13px 13px, 13px 21px, 13px 29px;
}
.dat-overlay-tile[data-t='3'] {
  left: 30px; top: 24px;
  background-color: #4c82fb;
  box-shadow: 0 4px 14px rgba(76,130,251,.35);
  background-image: radial-gradient(circle, #fff 0 4px, transparent 4px),
    linear-gradient(135deg, transparent 46%, #fff 46% 54%, transparent 54%),
    linear-gradient(45deg, transparent 46%, #fff 46% 54%, transparent 54%);
  background-size: 14px 14px, 24px 14px, 24px 14px;
  background-position: 8px 8px, 11px 24px, 11px 24px;
}
.dat-overlay-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #111);
}
.dat-overlay-sub {
  font-size: 14px;
  color: var(--dsw-alias-label-tertiary, #8a94a6);
}
.dat-portal-inline { display: contents; }
.dat-portal-inline .dat-cards { display: contents; }
.dat-portal-block { display: block; }
.dat-portal-block .dat-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 14px 16px 4px;
}
/* 行内(与缩略图同排)模式:严格等高、紧凑排版、垂直居中 */
.dat-portal-inline .dat-card {
  height: var(--dat-thumb-h, 68px);
  box-sizing: border-box;
  margin: 0 0 0 8px;
  align-self: center;
  background: var(--dsw-alias-bg-layer-1, #fff);
  padding: 6px 26px 6px 8px;
  gap: 8px;
  max-width: 240px;
}
.dat-portal-inline .dat-card-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background-size: 14px 3px, 10px 3px, 14px 3px;
  background-position: 9px 10px, 9px 15px, 9px 20px;
}
.dat-portal-inline .dat-card-name { font-size: 13px; line-height: 18px; }
.dat-portal-inline .dat-card-meta { font-size: 11px; line-height: 14px; }
/* 折叠原始文本(裸文本节点无法用选择器隐藏,用字号归零) */
.dat-carded { font-size: 0 !important; line-height: 0 !important; }
.dat-carded > :not(.dat-msg-cards) { display: none; }
.dat-carded .dat-msg-cards { font-size: 13px; line-height: normal; }
/* 气泡容器中和:卡片独立悬浮,无底色包裹 */
.dat-carded-bg {
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
  padding: 0 !important;
}
.dat-msg-cards {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
/* 附件行与下方文字行合并成一个信息块:隐藏本行动作条(时间/复制),收拢间距 */
.dat-carded-row [class*='actions'] { display: none !important; }
.dat-carded-row { margin-bottom: -10px !important; }
.dat-msg-cards { align-self: flex-end; max-width: 100%; margin-bottom: 6px; }
.dat-card-copied { outline: 2px solid var(--dsw-alias-brand-primary, #4c82fb); outline-offset: 1px; }
.dat-msg-cards .dat-card {
  background: var(--dsw-alias-bg-layer-1, #fff);
  padding-right: 12px;
}
.dat-preview {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, #000 45%, transparent);
  backdrop-filter: blur(4px);
}
.dat-preview-panel {
  display: flex;
  flex-direction: column;
  width: min(860px, 92vw);
  max-height: 86vh;
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  box-shadow: 0 12px 48px rgba(0,0,0,.28);
  overflow: hidden;
}
.dat-preview-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7ec);
}
.dat-preview-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #111);
}
.dat-preview-btn {
  border: 1px solid var(--dsw-alias-border-l2, #e5e7ec);
  background: transparent;
  color: var(--dsw-alias-label-primary, #111);
  border-radius: 14px;
  height: 28px;
  padding: 0 10px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dat-preview-btn:hover { background: var(--dsw-alias-interactive-bg-hover, #f2f4f7); }
.dat-preview-body {
  overflow: auto;
  padding: 14px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary, #111);
}
.dat-preview-img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
  border-radius: 8px;
}
.dat-preview-text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 12.5px;
  line-height: 1.6;
}
.dat-preview-hint { color: var(--dsw-alias-label-tertiary, #8a94a6); margin-bottom: 10px; }
.dat-preview-open { align-self: flex-start; }
`

/** 幂等注入插件样式表。 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin="dsh-attachment"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-attachment'
  tag.textContent = CSS
  document.head.appendChild(tag)
}
