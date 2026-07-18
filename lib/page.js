// 这些函数会被注入到目标网页里执行（通过 chrome.scripting.executeScript）。
// 注意：注入函数必须"自包含"，不能引用外部变量。

// 扫描页面，给可交互元素编号，返回一份精简的页面快照
export function buildSnapshot() {
  const MAX_ELEMENTS = 80;
  const selectors = [
    "a[href]", "button", "input", "textarea", "select",
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="checkbox"]',
    '[role="menuitem"]', '[role="option"]', "[onclick]",
    '[contenteditable="true"]', "summary", "label"
  ].join(",");

  // 同时扫描 document 和开放式 Shadow DOM。iframe 由 agent 通过 allFrames 单独注入本函数。
  const roots = [document];
  for (let i = 0; i < roots.length; i++) {
    for (const el of roots[i].querySelectorAll("*")) {
      if (el.shadowRoot && !roots.includes(el.shadowRoot)) roots.push(el.shadowRoot);
    }
  }
  const all = (selector) => roots.flatMap((root) => [...root.querySelectorAll(selector)]);

  // 清除上一轮的编号和敏感标记
  all("[data-ai-agent-id]").forEach((e) => e.removeAttribute("data-ai-agent-id"));
  all("[data-ai-agent-sensitive]").forEach((e) => e.removeAttribute("data-ai-agent-sensitive"));

  const elements = [];
  let id = 0;
  for (const el of all(selectors)) {
    if (id >= MAX_ELEMENTS) break;
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute("type") || "";
    const isFileInput = tag === "input" && type.toLowerCase() === "file";
    const rect = el.getBoundingClientRect();
    if (!isFileInput && (rect.width === 0 || rect.height === 0)) continue;
    const style = getComputedStyle(el);
    if (!isFileInput && (style.visibility === "hidden" || style.display === "none" || style.opacity === "0")) continue;
    // 只保留大致在视口范围内的元素
    if (!isFileInput && (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth)) continue;

    el.setAttribute("data-ai-agent-id", String(id));
    const sensitiveHint = [
      type, el.getAttribute("autocomplete"), el.getAttribute("name"), el.id,
      el.getAttribute("aria-label"), el.getAttribute("placeholder")
    ].filter(Boolean).join(" ");
    const sensitive = tag === "input" && (
      /^(password|email|tel)$/i.test(type) ||
      /password|passcode|passwd|one-time-code|\botp\b|verification|验证码|card.?number|cc-number|cc-csc|\bcvv\b|\bcvc\b|security.?code|ssn|身份证|api.?key|access.?token|client.?secret|street.?address|postal.?code|phone|mobile|e-?mail|birth|姓名|地址|邮编|手机号|邮箱/i.test(sensitiveHint)
    );
    if (sensitive) el.setAttribute("data-ai-agent-sensitive", "true");
    const selectedText = tag === "select" ? el.selectedOptions?.[0]?.textContent || "" : "";
    const associatedLabel = [...(el.labels || [])].map((node) => node.innerText || node.textContent || "").join(" ");
    // 不把任何输入框的当前 value 发给模型；模型只需知道字段用途和是否已填写。
    const label = (
      el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") ||
      el.getAttribute("title") || associatedLabel || el.getAttribute("name") || selectedText || ""
    ).trim().replace(/\s+/g, " ").slice(0, 120);
    elements.push({
      id, tag, type, label: sensitive ? "[敏感字段，内容已隐藏]" : label,
      editable: !!el.isContentEditable, sensitive,
      filled: sensitive ? !!el.value : (tag === "input" || tag === "textarea" ? !!el.value : undefined),
      role: el.getAttribute("role") || "",
      accept: tag === "input" && type.toLowerCase() === "file" ? el.getAttribute("accept") || "" : undefined,
      multiple: tag === "input" && type.toLowerCase() === "file" ? !!el.multiple : undefined,
      cx: Math.round(rect.left + rect.width / 2),
      cy: Math.round(rect.top + rect.height / 2)
    });
    id++;
  }

  return {
    url: location.href,
    title: document.title,
    text: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 3000),
    elements,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    canScrollDown: window.scrollY + window.innerHeight < document.body.scrollHeight - 10,
    canScrollUp: window.scrollY > 10
  };
}

// 截图前覆盖敏感输入框。每个 frame 都会单独注入，因此跨域 iframe 内也能遮住。
export function maskSensitiveFields() {
  document.getElementById("__ai_sensitive_mask__")?.remove();
  const roots = [document];
  for (let i = 0; i < roots.length; i++) {
    for (const el of roots[i].querySelectorAll("*")) {
      if (el.shadowRoot && !roots.includes(el.shadowRoot)) roots.push(el.shadowRoot);
    }
  }
  const fields = roots.flatMap((root) => [...root.querySelectorAll("[data-ai-agent-sensitive]")]);
  if (!fields.length) return 0;
  const layer = document.createElement("div");
  layer.id = "__ai_sensitive_mask__";
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  for (const field of fields) {
    const r = field.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const mask = document.createElement("div");
    mask.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;` +
      "box-sizing:border-box;border-radius:4px;background:#2f3136;color:#fff;display:flex;align-items:center;" +
      "justify-content:center;font:11px -apple-system,sans-serif;letter-spacing:.2px;";
    mask.textContent = "Sensitive data hidden";
    layer.appendChild(mask);
  }
  document.documentElement.appendChild(layer);
  return fields.length;
}

export function clearSensitiveMasks() {
  document.getElementById("__ai_sensitive_mask__")?.remove();
}

// 把面板中用户明确附加的原始文件放入网页文件框。文件字节只在执行此动作时注入目标 frame。
export function uploadFileToInput(index, payload) {
  try {
    const roots = [document];
    for (let i = 0; i < roots.length; i++) {
      for (const node of roots[i].querySelectorAll("*")) {
        if (node.shadowRoot && !roots.includes(node.shadowRoot)) roots.push(node.shadowRoot);
      }
    }
    const input = roots.map((root) => root.querySelector(`[data-ai-agent-id="${index}"]`)).find(Boolean);
    if (!input || input.tagName !== "INPUT" || String(input.type).toLowerCase() !== "file") {
      return { ok: false, error: "目标不是可用的文件上传框" };
    }
    if (input.webkitdirectory) return { ok: false, error: "暂不支持上传整个文件夹" };
    const dataUrl = String(payload?.dataUrl || "");
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return { ok: false, error: "附件数据无效" };
    const header = dataUrl.slice(0, comma);
    const encoded = dataUrl.slice(comma + 1);
    let bytes;
    if (/;base64/i.test(header)) {
      const binary = atob(encoded);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(encoded));
    }
    const mime = payload?.mimeType || header.match(/^data:([^;,]+)/i)?.[1] || "application/octet-stream";
    const file = new File([bytes], payload?.name || "upload", { type: mime, lastModified: payload?.lastModified || Date.now() });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return { ok: true, name: file.name, size: file.size, type: file.type, accept: input.accept || "" };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// 动作执行前重新读取编号元素的实时位置，避免观察后页面布局变化、缩放或滚动导致坐标过期。
export function locateMarkedElement(index) {
  try {
    const roots = [document];
    for (let i = 0; i < roots.length; i++) {
      for (const node of roots[i].querySelectorAll("*")) {
        if (node.shadowRoot && !roots.includes(node.shadowRoot)) roots.push(node.shadowRoot);
      }
    }
    const el = roots.map((root) => root.querySelector(`[data-ai-agent-id="${index}"]`)).find(Boolean);
    if (!el) return { ok: false, error: "找不到该编号的元素，页面内容可能已经更新" };
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (
      rect.width <= 0 || rect.height <= 0 ||
      style.visibility === "hidden" || style.display === "none" || style.opacity === "0"
    ) {
      return { ok: false, error: "该元素当前不可见" };
    }
    let x = Math.round(rect.left + rect.width / 2);
    let y = Math.round(rect.top + rect.height / 2);
    let trustedCoordinates = window === window.top;
    if (!trustedCoordinates) {
      try {
        let current = window;
        while (current !== current.top) {
          const frame = current.frameElement;
          if (!frame) throw new Error("cross-origin frame");
          const frameRect = frame.getBoundingClientRect();
          x += frameRect.left;
          y += frameRect.top;
          current = current.parent;
        }
        trustedCoordinates = true;
      } catch (_) { trustedCoordinates = false; }
    }
    return {
      ok: true,
      x, y, trustedCoordinates,
      viewport: { width: innerWidth, height: innerHeight }
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// 返回执行动作这一刻的视口，用于把上一张截图中的坐标映射到当前页面。
export function readViewport() {
  return {
    width: innerWidth,
    height: innerHeight,
    devicePixelRatio: devicePixelRatio || 1,
    visualScale: window.visualViewport?.scale || 1
  };
}

// 为动态等待提供轻量页面状态。MutationObserver 保存在注入世界中，
// 后续轮询只读取递增版本号，不必反复扫描完整 DOM。
export function readPageState() {
  const KEY = "__nl_agent_page_state__";
  let state = window[KEY];
  if (!state || state.document !== document) {
    state = { document, version: 0, observer: null };
    try {
      state.observer = new MutationObserver(() => { state.version += 1; });
      state.observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true
      });
    } catch (_) {}
    window[KEY] = state;
  }
  return {
    url: location.href,
    readyState: document.readyState,
    mutationVersion: state.version,
    title: document.title,
    scrollX: Math.round(scrollX),
    scrollY: Math.round(scrollY)
  };
}

// 在页面上画出编号标记（set-of-marks），让视觉模型能把截图里的位置和编号对应上
export function drawOverlay() {
  document.getElementById("__ai_overlay__")?.remove(); // 内联清除（注入函数不能引用其他函数）
  const layer = document.createElement("div");
  layer.id = "__ai_overlay__";
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  for (const el of document.querySelectorAll("[data-ai-agent-id]")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const id = el.getAttribute("data-ai-agent-id");
    const box = document.createElement("div");
    box.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:2px solid #ff2d95;box-sizing:border-box;`;
    const tag = document.createElement("div");
    tag.textContent = id;
    tag.style.cssText = `position:absolute;left:${Math.max(0, r.left)}px;top:${Math.max(0, r.top - 14)}px;background:#ff2d95;color:#fff;font:bold 11px monospace;padding:0 3px;border-radius:3px;line-height:14px;`;
    layer.appendChild(box);
    layer.appendChild(tag);
  }
  document.documentElement.appendChild(layer);
}

export function clearOverlay() {
  document.getElementById("__ai_overlay__")?.remove();
}

// 合成事件的按键（无 debugger 时的降级方案，尽力而为）
export function performKey(action) {
  try {
    const el = document.activeElement || document.body;
    for (const t of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(new KeyboardEvent(t, { key: action.key, bubbles: true }));
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// 在页面上执行一个动作（click / type / scroll）
export function performAction(action) {
  const roots = [document];
  for (let i = 0; i < roots.length; i++) {
    for (const node of roots[i].querySelectorAll("*")) {
      if (node.shadowRoot && !roots.includes(node.shadowRoot)) roots.push(node.shadowRoot);
    }
  }
  const find = (i) => roots.map((root) => root.querySelector(`[data-ai-agent-id="${i}"]`)).find(Boolean);
  try {
    if (action.type === "click") {
      const el = find(action.index);
      if (!el) return { ok: false, error: "找不到该编号的元素" };
      el.scrollIntoView({ block: "center", behavior: "instant" });
      el.focus?.();
      el.click();
      return { ok: true };
    }
    if (action.type === "type") {
      const el = find(action.index);
      if (!el) return { ok: false, error: "找不到该编号的元素" };
      el.scrollIntoView({ block: "center", behavior: "instant" });
      el.focus();
      if (el.isContentEditable) {
        el.textContent = action.text;
      } else {
        el.value = action.text;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      if (action.enter) {
        for (const t of ["keydown", "keypress", "keyup"]) {
          el.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
        }
        if (el.form && el.form.requestSubmit) {
          try { el.form.requestSubmit(); } catch (_) {}
        }
      }
      return { ok: true };
    }
    if (action.type === "scroll") {
      window.scrollBy(0, action.direction === "up" ? -innerHeight * 0.8 : innerHeight * 0.8);
      return { ok: true };
    }
    return { ok: false, error: "未知动作类型" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ===== 确定性查找替换（Google Docs 等）=====
// 对话框是普通 DOM。以下函数定位各控件、打标记、返回坐标，由 agent 用真实点击可靠操作。
// 注意：注入函数必须自包含。

// 定位已打开的查找替换对话框，给控件打上 data-ai-fr 标记，返回状态和各控件中心坐标。
// 已对照真实 Docs（2026-07，Material Design 3 新版对话框）验证：容器是 [role="dialog"]，
// 输入框带 aria-label，勾选框是原生 checkbox，按钮是真 <button>。同时保留旧版 .modal-dialog 兼容。
export function locateFindReplace() {
  try {
    const visible = (d) => {
      const s = getComputedStyle(d);
      return s.display !== "none" && s.visibility !== "hidden" && d.getBoundingClientRect().width > 50;
    };
    const candidates = [...document.querySelectorAll('[role="dialog"], .modal-dialog')].filter(visible);
    // 优先选标题含"查找和替换"的对话框，找不到再退回任意可见对话框
    const dlg = candidates.find((d) => /查找和替换|find\s*(and|&)\s*replace/i.test(d.innerText || "")) || candidates[0];
    if (!dlg) return { open: false };

    const center = (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    };

    // 查找/替换输入框：优先按 aria-label 认，兜底用"前两个可见文本框"
    const textInputs = [...dlg.querySelectorAll('input')].filter(
      (i) => (!i.type || i.type === "text") && i.getBoundingClientRect().width > 30
    );
    let findInput = textInputs.find((i) => /查找|find/i.test(i.getAttribute("aria-label") || ""));
    let replaceInput = textInputs.find((i) => /替换|replace/i.test(i.getAttribute("aria-label") || ""));
    if (!findInput) findInput = textInputs[0];
    if (!replaceInput) replaceInput = textInputs.find((i) => i !== findInput);
    if (!findInput) return { open: true, error: "对话框里找不到输入框" };
    findInput.setAttribute("data-ai-fr", "find");
    if (replaceInput) replaceInput.setAttribute("data-ai-fr", "replace");

    // 正则勾选框：checkbox 所在"行"的文字含"正则/regular"。
    // 只看离 checkbox 最近的、有文字的祖先，绝不爬到对话框层——否则整框都含"正则"会认错。
    let regexBox = null;
    for (const b of dlg.querySelectorAll('input[type="checkbox"], [role="checkbox"]')) {
      let n = b.parentElement;
      for (let up = 0; up < 6 && n && n !== dlg; up++, n = n.parentElement) {
        const t = (n.innerText || "").trim();
        if (!t) continue;
        if (/正则|regular/i.test(t)) regexBox = b;
        break; // 找到最近有文字的祖先后就停，不再向上
      }
      if (regexBox) break;
    }
    if (regexBox) regexBox.setAttribute("data-ai-fr", "regex");

    // "全部替换"按钮（真实 Docs 是 <button>，disabled 属性直接可读）
    let allBtn = null;
    for (const b of dlg.querySelectorAll('button, [role="button"]')) {
      const t = (b.innerText || b.textContent || "").trim();
      if (/全部替换|replace all/i.test(t)) { allBtn = b; break; }
    }
    if (allBtn) allBtn.setAttribute("data-ai-fr", "replaceall");

    // 关闭按钮：aria-label=关闭/Close，或旧版 .modal-dialog-title-close
    const closeBtn =
      [...dlg.querySelectorAll("button, [role=\"button\"]")].find((b) => /关闭|close/i.test(b.getAttribute("aria-label") || "")) ||
      dlg.querySelector(".modal-dialog-title-close");
    if (closeBtn) closeBtn.setAttribute("data-ai-fr", "close");

    const regexChecked = regexBox
      ? (regexBox.checked === true || regexBox.getAttribute("aria-checked") === "true")
      : null;
    const allDisabled = allBtn
      ? (allBtn.disabled === true || allBtn.getAttribute("aria-disabled") === "true" || /disabled/.test(allBtn.className))
      : null;

    return {
      open: true,
      hasReplace: !!replaceInput,
      hasRegex: !!regexBox,
      regexChecked,
      hasReplaceAll: !!allBtn,
      allDisabled,
      findValue: findInput.value || "",
      replaceValue: replaceInput?.value || "",
      coords: {
        find: center(findInput),
        replace: replaceInput ? center(replaceInput) : null,
        regex: regexBox ? center(regexBox) : null,
        replaceall: allBtn ? center(allBtn) : null,
        close: closeBtn ? center(closeBtn) : null
      },
      text: (dlg.innerText || "").replace(/\s+/g, " ").slice(-300)
    };
  } catch (e) {
    return { open: false, error: String(e) };
  }
}

// 定位 Docs 正文编辑区中心（发查找替换快捷键前需要先点它拿焦点）
export function locateDocsCanvas() {
  const el = document.querySelector(".kix-appview-editor") || document.querySelector('[role="document"]');
  if (!el) return { ok: false };
  const r = el.getBoundingClientRect();
  if (r.width < 50) return { ok: false };
  return { ok: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(r.height / 2, 300)) };
}

// 往打过标记的查找/替换输入框里填值
export function fillFindReplace(args) {
  try {
    const setVal = (sel, v) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    };
    const okFind = setVal('[data-ai-fr="find"]', args.find);
    const okReplace = args.replace === undefined ? true : setVal('[data-ai-fr="replace"]', args.replace);
    if (!okFind) return { ok: false, error: "找不到查找输入框（先调 locate）" };
    return { ok: true, replaceFilled: okReplace };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// 无 debugger 时的降级：对打了标记的控件派发合成鼠标事件（closure 组件需要 mousedown/up）
export function clickMarked(kind) {
  try {
    const el = document.querySelector(`[data-ai-fr="${kind}"]`);
    if (!el) return { ok: false, error: "找不到标记控件 " + kind };
    for (const t of ["mousedown", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// 读取对话框当前文字（用于拿"已替换 N 处"的结果——结果通常显示在对话框末尾，取尾部）
export function readDialogText() {
  const dialogs = [...document.querySelectorAll(".modal-dialog")];
  const dlg = dialogs.find((d) => d.getBoundingClientRect().width > 50);
  return dlg ? (dlg.innerText || "").replace(/\s+/g, " ").slice(-300) : "";
}

// ===== 任务运行时的屏幕光效（类似 Claude in Chrome），颜色可由主题配置 =====
export function showGlow(color) {
  const c = color || "rgba(66,133,244,.6)";
  const existing = document.getElementById("__ai_glow__");
  if (existing && existing.dataset.c === c) return; // 已存在且颜色一致，幂等
  existing?.remove();
  document.getElementById("__ai_glow_style__")?.remove();
  const style = document.createElement("style");
  style.id = "__ai_glow_style__";
  style.textContent =
    "@keyframes __aiGlowPulse{0%,100%{opacity:.45}50%{opacity:.95}}" +
    "#__ai_glow__{position:fixed;inset:0;pointer-events:none;z-index:2147483646;" +
    `box-shadow:inset 0 0 26px 7px ${c};` +
    "animation:__aiGlowPulse 1.6s ease-in-out infinite;}";
  const el = document.createElement("div");
  el.id = "__ai_glow__";
  el.dataset.c = c;
  document.documentElement.appendChild(style);
  document.documentElement.appendChild(el);
}

export function hideGlow() {
  document.getElementById("__ai_glow__")?.remove();
  document.getElementById("__ai_glow_style__")?.remove();
}

// ===== 页面浮窗：往网页里挂一个可拖动、可调大小的悬浮面板，内嵌扩展的 panel 页面 =====
export function mountFloatingPanel(panelUrl) {
  try {
    if (document.getElementById("__ai_float__")) return { ok: true, existed: true };

    const parseColor = (hex, fallback = [255, 255, 255]) => {
      const match = /^#?([0-9a-f]{6})$/i.exec(hex || "");
      if (!match) return fallback;
      const value = parseInt(match[1], 16);
      return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    };
    const rgba = (hex, alpha, fallback) => {
      const [r, g, b] = parseColor(hex, fallback);
      return `rgba(${r},${g},${b},${alpha})`;
    };
    const luminance = (hex) => {
      const channels = parseColor(hex, [250, 250, 250]).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };

    const host = document.createElement("div");
    host.id = "__ai_float__";
    host.style.cssText =
      "position:fixed;top:80px;right:24px;width:380px;height:560px;box-sizing:border-box;" +
      "z-index:2147483647;background:#fff;border:1px solid #ddd;border-radius:12px;" +
      "box-shadow:0 8px 32px rgba(0,0,0,.18);display:flex;flex-direction:column;overflow:hidden;" +
      "transition:background .24s ease,border-color .24s ease,box-shadow .24s ease,border-radius .24s ease;";

    // 标题栏（拖动把手）
    const bar = document.createElement("div");
    bar.style.cssText =
      "height:34px;flex:none;display:flex;align-items:center;gap:8px;padding:0 10px;" +
      "background:#f5f5f5;border-bottom:1px solid #e5e5e5;cursor:move;user-select:none;" +
      "font:12px -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;color:#666;";
    const title = document.createElement("span");
    title.textContent = "Natural Language Browser Agent";
    title.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    const closeBtn = document.createElement("div");
    closeBtn.style.cssText = "width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:6px;cursor:pointer;color:#666;transition:background .15s ease;";
    closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    closeBtn.addEventListener("mouseenter", () => (closeBtn.style.background = host.style.getPropertyValue("--nl-float-hover") || "#e5e5e5"));
    closeBtn.addEventListener("mouseleave", () => (closeBtn.style.background = "transparent"));
    bar.appendChild(title);
    bar.appendChild(closeBtn);

    // 内容：扩展的 panel 页面
    const iframe = document.createElement("iframe");
    iframe.src = panelUrl;
    iframe.setAttribute("allowtransparency", "true");
    iframe.style.cssText = "flex:1;border:none;width:100%;background:transparent;position:relative;z-index:1;";

    // 右下角缩放把手
    const grip = document.createElement("div");
    grip.style.cssText = "position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;display:flex;align-items:flex-end;justify-content:flex-end;z-index:4;color:#bbb;";
    grip.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M14 8L8 14M14 12l-2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>';

    host.appendChild(bar);
    host.appendChild(iframe);
    host.appendChild(grip);
    document.documentElement.appendChild(host);

    const applyFloatingTheme = (theme = {}) => {
      const bg = theme.bg || "#fafafa";
      const surface = theme.surface || "#ffffff";
      const text = theme.text || "#1f1f1f";
      const border = theme.border || "#e8e8e8";
      const dark = luminance(bg) < 0.42;
      const glass = !!theme.liquidGlass;

      host.dataset.glass = glass ? "on" : "off";
      host.style.setProperty("--nl-float-hover", rgba(text, dark ? 0.14 : 0.08, [31, 31, 31]));
      title.style.color = text;
      closeBtn.style.color = text;
      grip.style.color = rgba(text, dark ? 0.54 : 0.38, [31, 31, 31]);
      iframe.style.colorScheme = dark ? "dark" : "light";

      if (!glass) {
        host.style.background = surface;
        host.style.borderColor = border;
        host.style.borderRadius = "12px";
        host.style.boxShadow = dark ? "0 12px 38px rgba(0,0,0,.42)" : "0 8px 32px rgba(0,0,0,.18)";
        host.style.backdropFilter = "none";
        host.style.webkitBackdropFilter = "none";
        bar.style.background = bg;
        bar.style.borderBottomColor = border;
        iframe.style.background = surface;
        return;
      }

      host.style.background = `linear-gradient(145deg,${rgba(surface, dark ? 0.50 : 0.32)},${rgba(bg, dark ? 0.36 : 0.18)})`;
      host.style.borderColor = dark ? "rgba(255,255,255,.12)" : rgba(border, 0.56, [232, 232, 232]);
      host.style.borderRadius = "22px";
      host.style.boxShadow = dark
        ? "0 24px 64px rgba(0,0,0,.46),0 8px 26px rgba(0,0,0,.18)"
        : "0 24px 64px rgba(24,32,54,.18),0 8px 26px rgba(24,32,54,.10)";
      host.style.backdropFilter = "blur(28px) saturate(175%) contrast(106%)";
      host.style.webkitBackdropFilter = "blur(28px) saturate(175%) contrast(106%)";
      bar.style.background = rgba(surface, dark ? 0.30 : 0.16);
      bar.style.borderBottomColor = dark ? "rgba(255,255,255,.10)" : rgba(border, 0.48, [232, 232, 232]);
      iframe.style.background = "transparent";
    };

    // 浮窗 iframe 会在主题载入或设置变化时发送新的安全视觉配置。
    const onThemeMessage = (event) => {
      if (event.source !== iframe.contentWindow || event.data?.type !== "nlba-floating-theme") return;
      applyFloatingTheme(event.data.theme);
    };
    window.addEventListener("message", onThemeMessage);

    closeBtn.addEventListener("click", () => {
      window.removeEventListener("message", onThemeMessage);
      host.remove();
    });

    // 把 right 定位换成 left，方便拖动/缩放计算
    const pin = () => {
      const r = host.getBoundingClientRect();
      host.style.right = "auto";
      host.style.left = r.left + "px";
      host.style.top = r.top + "px";
      return r;
    };

    // 拖动
    let drag = null;
    bar.addEventListener("pointerdown", (e) => {
      if (closeBtn.contains(e.target)) return;
      const r = pin();
      drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top };
      iframe.style.pointerEvents = "none"; // 拖动期间别让 iframe 吃事件
      bar.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    bar.addEventListener("pointermove", (e) => {
      if (!drag) return;
      host.style.left = Math.min(Math.max(0, drag.ox + e.clientX - drag.sx), innerWidth - 80) + "px";
      host.style.top = Math.min(Math.max(0, drag.oy + e.clientY - drag.sy), innerHeight - 40) + "px";
    });
    bar.addEventListener("pointerup", () => { drag = null; iframe.style.pointerEvents = "auto"; });

    // 缩放
    let rs = null;
    grip.addEventListener("pointerdown", (e) => {
      const r = pin();
      rs = { sx: e.clientX, sy: e.clientY, w: r.width, h: r.height };
      iframe.style.pointerEvents = "none";
      grip.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    grip.addEventListener("pointermove", (e) => {
      if (!rs) return;
      host.style.width = Math.max(300, rs.w + e.clientX - rs.sx) + "px";
      host.style.height = Math.max(360, rs.h + e.clientY - rs.sy) + "px";
    });
    grip.addEventListener("pointerup", () => { rs = null; iframe.style.pointerEvents = "auto"; });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
