// 后台 service worker：保持侧栏可用，并处理面板发来的控制消息。
// Edge 有一个已知问题：切换标签后侧栏不一定自动重新显示。
// 浏览器不允许扩展在没有用户手势时强制 open()，所以这里尽量保证：
// 1) 每个激活标签的侧栏都处于 enabled；2) 工具栏点击/快捷键可随时恢复。
import { loadActionPermissions } from "./lib/permissions.js";
import { detectDefault, loadLang, setCurrent, t } from "./lib/i18n.js";

const PANEL_PATH = "panel.html";
const SELECTION_TASK_KEY = "pendingSelectionTask";
const MENU_ROOT = "nlba-selection";

function removeAllMenus() {
  return new Promise((resolve) => chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    resolve();
  }));
}

function createMenu(options) {
  chrome.contextMenus.create(options, () => { void chrome.runtime.lastError; });
}

async function refreshContextMenus() {
  if (!chrome.contextMenus) return;
  await removeAllMenus();
  const permissions = await loadActionPermissions();
  if (!permissions.contextMenu) return;
  const lang = await loadLang();
  setCurrent(lang || detectDefault());
  createMenu({ id: MENU_ROOT, title: t("ctxRoot"), contexts: ["selection"] });
  for (const [id, key] of [
    ["ask", "ctxAsk"], ["summarize", "ctxSummarize"],
    ["translate", "ctxTranslate"], ["explain", "ctxExplain"]
  ]) {
    createMenu({ id: `${MENU_ROOT}-${id}`, parentId: MENU_ROOT, title: t(key), contexts: ["selection"] });
  }
}

let contextMenuRefresh = Promise.resolve();
function scheduleContextMenuRefresh() {
  contextMenuRefresh = contextMenuRefresh.then(refreshContextMenus, refreshContextMenus).catch(() => {});
  return contextMenuRefresh;
}

async function ensureSidePanel(tabId) {
  if (!chrome.sidePanel?.setOptions) return;
  const options = { path: PANEL_PATH, enabled: true };
  if (Number.isInteger(tabId)) options.tabId = tabId;
  await chrome.sidePanel.setOptions(options);
}

async function enableSidePanel() {
  if (!chrome.sidePanel) return;
  await chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
  await ensureSidePanel().catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  enableSidePanel();
  scheduleContextMenuRefresh();
});
chrome.runtime.onStartup.addListener(() => {
  enableSidePanel();
  scheduleContextMenuRefresh();
});
enableSidePanel();
scheduleContextMenuRefresh();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.globalActionPermissions || changes.uiLang)) scheduleContextMenuRefresh();
});

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (!String(info.menuItemId).startsWith(`${MENU_ROOT}-`) || !info.selectionText?.trim()) return;
  const action = String(info.menuItemId).slice(MENU_ROOT.length + 1);
  const payload = {
    id: crypto.randomUUID(),
    action,
    selection: info.selectionText.trim().slice(0, 12000),
    pageUrl: info.pageUrl || tab?.url || "",
    autoRun: action !== "ask",
    createdAt: Date.now()
  };
  const openPromise = Number.isInteger(tab?.windowId) && chrome.sidePanel?.open
    ? chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {})
    : Promise.resolve();
  await chrome.storage.session.set({ [SELECTION_TASK_KEY]: payload });
  await openPromise;
});

// 切换标签时重新声明该标签可使用侧栏。此操作不会违反用户手势限制，
// 但能避免 Edge 在标签切换后把扩展侧栏留在 disabled/stale 状态。
chrome.tabs.onActivated.addListener(({ tabId }) => {
  ensureSidePanel(tabId).catch(() => {});
});

// _execute_action 快捷键会按浏览器原生方式触发工具栏按钮；
// 配合 openPanelOnActionClick，可在 Edge 未自动恢复侧栏时一键重新打开。
chrome.commands?.onCommand.addListener((command) => {
  if (command !== "_execute_action") return;
  enableSidePanel().catch(() => {});
});

// 侧边栏页面自己调 window.close() 无效，必须由后台 disable 一下才会收起。
// 之后立刻重新 enable，保证工具栏图标下次还能打开侧边栏。
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "closeSidePanel") {
    chrome.sidePanel
      .setOptions({ enabled: false })
      .then(() => new Promise((r) => setTimeout(r, 250)))
      .then(() => ensureSidePanel())
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // 异步 sendResponse
  }
});
