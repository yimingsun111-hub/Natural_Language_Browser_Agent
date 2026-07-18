// 主题配置：统一管理界面颜色（侧边栏/浮窗/设置页共用）和页面光效颜色
export const DEFAULT_THEME = {
  bg: "#fafafa",      // 页面背景
  surface: "#ffffff", // 卡片/输入区表面
  text: "#1f1f1f",    // 文字
  border: "#e8e8e8",  // 边框
  accent: "#2563eb",  // 强调色（按钮/用户气泡）
  glow: "#4285f4",    // 运行时页面四周光效颜色
  liquidGlass: false   // 浮动小窗的液态玻璃效果
};

const KEY = "themeConfig";

export async function loadTheme() {
  const d = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_THEME, ...(d[KEY] || {}) };
}

export async function saveTheme(theme) {
  await chrome.storage.local.set({ [KEY]: { ...DEFAULT_THEME, ...theme } });
}

// 把主题写入某个文档的 CSS 变量（panel 和 options 都用这一套变量名）
export function applyTheme(doc, theme) {
  const resolved = { ...DEFAULT_THEME, ...(theme || {}) };
  const map = { bg: "--bg", surface: "--surface", text: "--text", border: "--border", accent: "--accent" };
  for (const [k, v] of Object.entries(map)) {
    doc.documentElement.style.setProperty(v, resolved[k]);
  }

  const root = doc.documentElement;
  const bgDark = relativeLuminance(resolved.bg) < 0.42;
  const accentDark = relativeLuminance(resolved.accent) < 0.46;
  root.dataset.themeTone = bgDark ? "dark" : "light";
  root.dataset.liquidGlass = resolved.liquidGlass ? "on" : "off";

  // 由用户颜色派生出的语义颜色，深浅主题和高亮强调色都能保持可读性。
  root.style.setProperty("--text-muted", mixColor(resolved.text, resolved.bg, bgDark ? 0.66 : 0.56));
  root.style.setProperty("--on-accent", accentDark ? "#ffffff" : "#111111");
  root.style.setProperty("--accent-soft", hexToRgba(resolved.accent, bgDark ? 0.20 : 0.10));
  root.style.setProperty("--surface-soft", hexToRgba(resolved.surface, bgDark ? 0.66 : 0.72));
  root.style.setProperty("--hover", hexToRgba(resolved.text, bgDark ? 0.12 : 0.07));

  // 浮窗内部使用的自适应玻璃层；外壳会由 panel.js 同步同一份主题。
  // 深色玻璃需要更高底色浓度：既保证文字可读，也兼容会给透明 iframe 铺白底的 Chromium 合成路径。
  root.style.setProperty("--glass-panel", hexToRgba(resolved.bg, bgDark ? 0.74 : 0.13));
  root.style.setProperty("--glass-header", hexToRgba(resolved.surface, bgDark ? 0.34 : 0.10));
  root.style.setProperty("--glass-surface", hexToRgba(resolved.surface, bgDark ? 0.50 : 0.24));
  root.style.setProperty("--glass-surface-strong", hexToRgba(resolved.surface, bgDark ? 0.68 : 0.42));
  root.style.setProperty("--glass-border", hexToRgba(resolved.border, bgDark ? 0.78 : 0.66));
  root.style.setProperty("--glass-shadow", bgDark ? "rgba(0,0,0,.38)" : "rgba(20,30,50,.14)");
}

// #rrggbb → rgba(r,g,b,a)，光效需要带透明度
export function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return `rgba(66,133,244,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function rgbFromHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance(hex) {
  const values = rgbFromHex(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}

function mixColor(foreground, background, foregroundWeight) {
  const fg = rgbFromHex(foreground);
  const bg = rgbFromHex(background);
  const amount = Math.max(0, Math.min(1, foregroundWeight));
  const mixed = fg.map((channel, index) => Math.round(channel * amount + bg[index] * (1 - amount)));
  return `rgb(${mixed[0]},${mixed[1]},${mixed[2]})`;
}
