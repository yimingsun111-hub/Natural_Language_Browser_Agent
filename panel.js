import { PRESETS, loadConfig } from "./lib/providers.js";
import { runTask } from "./lib/agent.js";
import { loadTheme, applyTheme } from "./lib/theme.js";
import { mountFloatingPanel } from "./lib/page.js";
import { LANGUAGES, loadLang, saveLang, setCurrent, detectDefault, t } from "./lib/i18n.js";
import { DOCUMENT_EXTENSIONS, extractDocumentAttachment, extractDocumentText } from "./lib/document-parser.js";

const logEl = document.getElementById("log");
const inputEl = document.getElementById("input");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");
const pauseBtn = document.getElementById("pause");
const resumeBtn = document.getElementById("resume");
const activeModelEl = document.getElementById("active-model");
const isFloatingMode = new URLSearchParams(location.search).get("float") === "1";

let stopped = false;
let running = false;
let runController = null;
let paused = false;
let pauseWaiters = [];
let currentApproval = null;
let pendingAttachmentReads = 0;
let attachmentQueue = Promise.resolve();
const conversation = []; // 跨轮对话上下文：{role:'user'|'assistant', content}

// ── 聊天记录持久化（会话级：浏览器关闭即清空）──────────────
// 侧边栏和浮窗是两个独立页面实例，记录存到 storage.session 里两边共享、切换不丢。
const HISTORY_KEY = "chatHistory";
const SELECTION_TASK_KEY = "pendingSelectionTask";
let transcript = []; // 所有显示过的消息：{role, text}

function renderMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function addMessage(role, text) {
  renderMessage(role, text);
  transcript.push({ role, text });
  chrome.storage.session.set({ [HISTORY_KEY]: transcript }).catch(() => {});
}

function requestApproval(risk) {
  return new Promise((resolve) => {
    const card = document.createElement("div");
    card.className = "approval-card";
    const title = document.createElement("div");
    title.className = "approval-title";
    title.textContent = risk.title || t("riskConfirmTitle");
    const detail = document.createElement("div");
    detail.className = "approval-detail";
    detail.textContent = `${risk.detail || ""}\n${risk.action || ""}`.trim();
    const domain = document.createElement("div");
    domain.className = "approval-domain";
    domain.textContent = risk.domain ? t("riskDomain", risk.domain) : "";
    const actions = document.createElement("div");
    actions.className = "approval-actions";
    const finish = (decision) => {
      if (currentApproval?.card === card) currentApproval = null;
      card.remove();
      resolve(decision);
    };
    for (const [decision, cls, label] of [
      ["once", "approval-once", t("riskAllowOnce")],
      ["task", "approval-task", t("riskAllowTask")],
      ["deny", "approval-deny", t("riskDeny")]
    ]) {
      const button = document.createElement("button");
      button.className = cls;
      button.textContent = label;
      button.addEventListener("click", () => finish(decision));
      actions.appendChild(button);
    }
    card.append(title, detail, domain, actions);
    logEl.appendChild(card);
    logEl.scrollTop = logEl.scrollHeight;
    currentApproval = { card, finish };
  });
}

function waitIfPaused() {
  if (!paused) return Promise.resolve(false);
  return new Promise((resolve) => pauseWaiters.push(() => resolve(true)));
}

function setPaused(on) {
  paused = on;
  document.body.classList.toggle("paused", on);
  if (!on) {
    const waiters = pauseWaiters.splice(0);
    waiters.forEach((resume) => resume());
  }
}

async function restoreHistory() {
  try {
    const d = await chrome.storage.session.get(HISTORY_KEY);
    transcript = d[HISTORY_KEY] || [];
    for (const m of transcript) {
      renderMessage(m.role, m.text);
      // 只有用户指令和 AI 回复进入模型上下文
      if (m.role === "user") conversation.push({ role: "user", content: m.text });
      else if (m.role === "assistant") conversation.push({ role: "assistant", content: m.text });
    }
  } catch (_) {}
}

async function consumeSelectionTask(payload = null) {
  if (document.visibilityState !== "visible") return;
  if (!payload) {
    const data = await chrome.storage.session.get(SELECTION_TASK_KEY);
    payload = data[SELECTION_TASK_KEY];
  }
  if (!payload?.selection) return;
  if (Date.now() - Number(payload.createdAt || 0) > 60000) {
    await chrome.storage.session.remove(SELECTION_TASK_KEY);
    return;
  }
  const key = {
    ask: "selectionAsk",
    summarize: "selectionSummarize",
    translate: "selectionTranslate",
    explain: "selectionExplain"
  }[payload.action] || "selectionAsk";
  // JSON 字符串会转义换行和引号，网页文字无法伪造模板的结束标记。
  const quotedSelection = JSON.stringify(String(payload.selection).slice(0, 12000));
  inputEl.value = t(key, quotedSelection);
  await chrome.storage.session.remove(SELECTION_TASK_KEY);
  inputEl.focus();
  inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
  if (payload.autoRun && !running) queueMicrotask(run);
}

// ── 多语言 ──────────────────────────
// 把当前语言文案写进界面（静态部分）
function applyI18n() {
  const primaryKey = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? "Cmd" : "Ctrl";
  inputEl.placeholder = t("inputPlaceholder");
  document.getElementById("hint").textContent = t("runHint").replace("Cmd", primaryKey);
  document.getElementById("float").title = t("tFloat");
  document.getElementById("newchat").title = t("tNewchat");
  document.getElementById("settings").title = t("tSettings");
  document.getElementById("attach").title = t("tAttach");
  runBtn.title = t("tRun").replace("Cmd", primaryKey);
  stopBtn.title = t("tStop");
  pauseBtn.title = t("tPause");
  resumeBtn.title = t("tResume");
  logEl.dataset.l1 = t("emptyTitle");
  logEl.dataset.l2 = t("emptyEx1");
  logEl.dataset.l3 = t("emptyEx2");
}

// 首次启动：让用户选语言（各语言用母语显示，无需翻译标题）
function showLangPicker() {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.id = "langpick";
    const box = document.createElement("div");
    box.className = "lp-box";
    const title = document.createElement("div");
    title.className = "lp-title";
    title.textContent = "选择语言 · Choose language";
    box.appendChild(title);
    for (const l of LANGUAGES) {
      const btn = document.createElement("button");
      btn.textContent = l.name;
      btn.addEventListener("click", async () => {
        await saveLang(l.id);
        setCurrent(l.id);
        applyI18n();
        ov.remove();
        resolve();
      });
      box.appendChild(btn);
    }
    ov.appendChild(box);
    document.body.appendChild(ov);
  });
}

async function initLang() {
  const saved = await loadLang();
  if (saved) {
    setCurrent(saved);
    applyI18n();
  } else {
    setCurrent(detectDefault());
    applyI18n();
    await showLangPicker();
  }
}

// 顶栏显示当前使用的模型 / 是否已配置
async function refreshActiveModel() {
  const cfg = await loadConfig();
  if (cfg.apiKey) {
    const preset = PRESETS.find((p) => p.id === cfg.providerId);
    const providerName = preset ? t(preset.labelKey) : (cfg.name || "Custom");
    activeModelEl.textContent = `${providerName} · ${cfg.model}`;
    activeModelEl.style.color = "";
  } else {
    activeModelEl.textContent = t("notConfigured");
    activeModelEl.style.color = "var(--danger)";
  }
}

document.getElementById("settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("newchat").addEventListener("click", () => {
  conversation.length = 0;
  transcript = [];
  logEl.innerHTML = "";
  chrome.storage.session.remove(HISTORY_KEY).catch(() => {});
});

// 浮窗模式：把本面板作为悬浮窗挂到当前网页上
document.getElementById("float").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || /^(chrome|edge|about|chrome-extension|devtools|view-source|file):/i.test(tab.url || "")) {
    addMessage("error", t("floatInternalPage"));
    return;
  }
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: mountFloatingPanel,
      args: [chrome.runtime.getURL("panel.html?float=1")]
    });
    if (res?.result?.ok) {
      // 侧边栏无法用 window.close() 关闭，让后台 disable/enable 一下来收起它
      chrome.runtime.sendMessage({ type: "closeSidePanel" }).catch(() => {});
    } else {
      addMessage("error", t("floatFailed", res?.result?.error || "unknown"));
    }
  } catch (e) {
    addMessage("error", t("floatError", e.message));
  }
});

// 浮窗里运行时：隐藏"以浮窗打开"按钮（已经是浮窗了）
if (isFloatingMode) {
  document.body.classList.add("float-mode");
  document.getElementById("float").style.display = "none";
}

// 主题
async function refreshTheme() {
  const theme = await loadTheme();
  applyTheme(document, theme);
  if (isFloatingMode && window.parent !== window) {
    // 只同步视觉配置，不包含 API Key 或聊天内容。网页外壳据此做真正的背景模糊。
    window.parent.postMessage({
      type: "nlba-floating-theme",
      theme: {
        bg: theme.bg,
        surface: theme.surface,
        text: theme.text,
        border: theme.border,
        accent: theme.accent,
        liquidGlass: !!theme.liquidGlass
      }
    }, "*");
  }
}
refreshTheme();

// 配置/主题/语言变化时（在设置页保存后）实时刷新——只关心 local 区，避免每条聊天记录写入都触发
chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area !== "local") return;
  const lang = await loadLang();
  if (lang) { setCurrent(lang); applyI18n(); }
  refreshActiveModel();
  refreshTheme();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[SELECTION_TASK_KEY]?.newValue) {
    consumeSelectionTask(changes[SELECTION_TASK_KEY].newValue).catch(() => {});
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") consumeSelectionTask().catch(() => {});
});

function setRunning(on) {
  running = on;
  document.body.classList.toggle("running", on);
  runBtn.disabled = on || pendingAttachmentReads > 0;
  if (!on) setPaused(false);
}

// ── 附件（图片/文本/文档，本地提取后随任务发给模型）──────────────
const attachmentsEl = document.getElementById("attachments");
const fileInputEl = document.getElementById("file-input");
const MAX_IMAGES = 6;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARS = 60000;
const MAX_TOTAL_TEXT_CHARS = 120000;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;
const TEXT_EXT = /\.(txt|md|markdown|csv|json|js|ts|py|html?|css|xml|ya?ml|log|tsv)$/i;
const DOCUMENT_EXT = new RegExp(`\\.(${DOCUMENT_EXTENSIONS.join("|")})$`, "i");

let attachments = []; // {kind:'image', dataUrl, name} | {kind:'text', text, name}

function renderAttachments() {
  attachmentsEl.innerHTML = "";
  attachments.forEach((att, i) => {
    const card = document.createElement("div");
    card.className = "att-card";
    if (att.kind === "image") {
      const img = document.createElement("img");
      img.src = att.dataUrl;
      card.appendChild(img);
    } else {
      const icon = document.createElement("div");
      icon.className = "att-file-icon";
      icon.innerHTML =
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>';
      card.appendChild(icon);
    }
    const name = document.createElement("span");
    name.className = "att-name";
    name.textContent = att.name;
    name.title = att.name;
    card.appendChild(name);

    const rm = document.createElement("button");
    rm.className = "att-remove";
    rm.innerHTML =
      '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    rm.addEventListener("click", () => {
      const groupId = att.uploadId || att.sourceUploadId;
      if (groupId) attachments = attachments.filter((item) => item.uploadId !== groupId && item.sourceUploadId !== groupId);
      else attachments.splice(i, 1);
      renderAttachments();
    });
    card.appendChild(rm);
    attachmentsEl.appendChild(card);
  });
}

// 大图缩到最长边 1600px 再发，省 token 和带宽
function downscaleImage(dataUrl, maxDim = 1600) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      if (scale >= 1) return resolve(dataUrl);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; // 透明 PNG 转 JPEG 时垫白底
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function readFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

async function addFiles(fileList) {
  for (const file of fileList) {
    const name = file.name || "file";
    try {
      if (file.size > MAX_FILE_BYTES) {
        addMessage("system", t("attachTooLarge", name));
        continue;
      }
      const uploadMeta = {
        uploadId: crypto.randomUUID(),
        uploadDataUrl: await readFileDataUrl(file),
        uploadMimeType: file.type || "application/octet-stream",
        uploadName: name,
        uploadSize: file.size,
        uploadLastModified: file.lastModified || Date.now()
      };
      if (file.type.startsWith("image/") || IMAGE_EXT.test(name)) {
        if (attachments.filter((a) => a.kind === "image").length >= MAX_IMAGES) {
          addMessage("system", t("attachTooMany"));
          attachments.push({ kind: "file", name, uploadOnly: true, ...uploadMeta });
          continue;
        }
        const dataUrl = await downscaleImage(uploadMeta.uploadDataUrl);
        attachments.push({ kind: "image", dataUrl, name, ...uploadMeta });
        continue;
      }

      let text = "";
      let renderedOcrPages = 0;
      const derivedStart = attachments.length;
      if (file.type.startsWith("text/") || TEXT_EXT.test(name)) {
        text = await file.text();
      } else if (DOCUMENT_EXT.test(name)) {
        addMessage("system", t("attachReading", name));
        if (/\.pdf$/i.test(name)) {
          const availableImages = Math.max(0, MAX_IMAGES - attachments.filter((a) => a.kind === "image").length);
          const parsed = await extractDocumentAttachment(file, { maxOcrPages: availableImages });
          text = parsed.text || "";
          for (const page of parsed.images || []) {
            attachments.push({
              kind: "image",
              dataUrl: page.dataUrl,
              name: `${name} · page ${page.pageNumber}`,
              documentName: name,
              pageNumber: page.pageNumber,
              ocr: true,
              sourceUploadId: uploadMeta.uploadId
            });
          }
          renderedOcrPages = parsed.images?.length || 0;
          if (renderedOcrPages) addMessage("system", t("attachOcrReady", name, renderedOcrPages));
          if (parsed.omittedOcrPages) addMessage("system", t("attachOcrLimited", name, parsed.omittedOcrPages));
        } else {
          text = await extractDocumentText(file);
        }
      } else {
        attachments.push({ kind: "file", name, uploadOnly: true, ...uploadMeta });
        addMessage("system", t("attachUploadOnly", name));
        continue;
      }

      if (!text.trim()) {
        if (renderedOcrPages && attachments[derivedStart]) Object.assign(attachments[derivedStart], uploadMeta);
        else attachments.push({ kind: "file", name, uploadOnly: true, ...uploadMeta });
        if (!renderedOcrPages) addMessage("system", t("attachUploadOnly", name));
        continue;
      }
      const existingChars = attachments
        .filter((a) => a.kind === "text")
        .reduce((sum, a) => sum + a.text.length, 0);
      const remaining = Math.max(0, MAX_TOTAL_TEXT_CHARS - existingChars);
      const limit = Math.min(MAX_TEXT_CHARS, remaining);
      if (!limit) {
        addMessage("system", t("attachTextLimit", name));
        if (renderedOcrPages && attachments[derivedStart]) Object.assign(attachments[derivedStart], uploadMeta);
        else attachments.push({ kind: "file", name, uploadOnly: true, ...uploadMeta });
        continue;
      }
      const clipped = text.slice(0, limit);
      attachments.push({ kind: "text", text: clipped, name, document: DOCUMENT_EXT.test(name), ...uploadMeta });
      if (clipped.length < text.length) addMessage("system", t("attachTruncated", name));
    } catch (error) {
      addMessage("system", t("attachReadFailed", name, error?.message || String(error)));
    }
  }
  renderAttachments();
}

function queueFiles(files) {
  if (!files.length) return attachmentQueue;
  pendingAttachmentReads++;
  runBtn.disabled = true;
  const job = attachmentQueue.then(() => addFiles(files));
  attachmentQueue = job.catch(() => {}).finally(() => {
    pendingAttachmentReads--;
    runBtn.disabled = running || pendingAttachmentReads > 0;
  });
  return attachmentQueue;
}

document.getElementById("attach").addEventListener("click", () => fileInputEl.click());
fileInputEl.addEventListener("change", async () => {
  await queueFiles([...fileInputEl.files]);
  fileInputEl.value = ""; // 允许重复选同一个文件
});

// 粘贴图片
inputEl.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) {
    e.preventDefault();
    queueFiles(files);
  }
});

// 拖拽文件到面板
const composerEl = document.getElementById("composer");
document.body.addEventListener("dragover", (e) => {
  e.preventDefault();
  composerEl.classList.add("dragover");
});
document.body.addEventListener("dragleave", () => composerEl.classList.remove("dragover"));
document.body.addEventListener("drop", (e) => {
  e.preventDefault();
  composerEl.classList.remove("dragover");
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) queueFiles(files);
});

async function run() {
  if (running) return;
  await attachmentQueue;
  const task = inputEl.value.trim();
  if (!task || running) return;

  const taskAttachments = attachments;
  attachments = [];
  renderAttachments();

  // 用户气泡里带上附件名，跨轮上下文也只记文字（附件本体不进历史，保持轻量）
  const names = [...new Set(taskAttachments.map((a) => a.documentName || a.name))].join(", ");
  const shownTask = names ? `${task}\n${t("attachLine", names)}` : task;
  addMessage("user", shownTask);
  inputEl.value = "";

  stopped = false;
  runController = new AbortController();
  setRunning(true);

  try {
    const answer = await runTask(task, addMessage, () => stopped, conversation, taskAttachments, runController.signal, {
      confirmAction: requestApproval,
      waitIfPaused
    });
    conversation.push({ role: "user", content: shownTask });
    if (answer) conversation.push({ role: "assistant", content: answer });
  } catch (e) {
    addMessage("error", t("errPrefix", e.message));
  } finally {
    runController = null;
    setRunning(false);
  }
}

runBtn.addEventListener("click", run);
stopBtn.addEventListener("click", () => {
  stopped = true;
  currentApproval?.finish("deny");
  setPaused(false);
  runController?.abort();
});
pauseBtn.addEventListener("click", () => {
  if (!running || paused) return;
  setPaused(true);
  addMessage("system", t("aPaused"));
});
resumeBtn.addEventListener("click", () => {
  if (!running || !paused) return;
  setPaused(false);
  addMessage("system", t("aResumed"));
});
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
});

// 启动：先定语言（首次会弹选择），再恢复记录和顶栏
(async () => {
  await initLang();
  await restoreHistory();
  await refreshActiveModel();
  await consumeSelectionTask();
})();
