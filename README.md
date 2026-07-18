<p align="center">
  <a href="https://youtu.be/nZJBhx9oFNA">
    <img src="icons/banner.png" alt="Watch the NL Browser Agent introduction" width="800">
  </a>
</p>

<p align="center">
  <a href="https://youtu.be/nZJBhx9oFNA">▶ Watch the introduction animation</a>
</p>

**English** | [中文](#中文)

A Chrome and Microsoft Edge extension that lets you control your browser with natural language — inspired by Claude in Chrome.

> **You need your own API key.** This extension doesn't provide AI itself — you sign up with a model provider (e.g. DeepSeek, OpenAI), get an API key from them (usually pay-as-you-go), and paste it into the extension's Settings page. The extension is free; the model calls are billed by the provider to your own account.

Type one sentence in the side panel; the AI looks at the page (screenshot + numbered interactive elements), decides the next step, and executes it — click, type, scroll, navigate — until the task is done.

## Features

- **Provider presets** — built-in presets for DeepSeek, Kimi (Moonshot), Qwen and OpenAI, plus a custom option for any OpenAI-compatible endpoint. Requires an API key you obtain yourself from that provider. The key is stored locally in `chrome.storage` and never leaves your machine except to call the API you configured.
- **Vision** — sends page screenshots to the model so it can read canvas-based pages (Google Docs, embedded images, exam questions…). Requires a vision-capable model such as GPT-4o or Qwen-VL.
- **Trusted input** — uses `chrome.debugger` (CDP) to send real mouse/keyboard events, so it can operate apps that ignore synthetic events, like Google Docs.
- **Multi-tab tasks** — lists and switches between existing tabs, automatically follows links that open a new tab, and can keep operating a background tab when trusted input is enabled.
- **Stable coordinates** — refreshes an element's position immediately before clicking and remaps screenshot coordinates if the viewport or page zoom changes.
- **Faster execution** — replaces fixed delays with page-stability detection, limits and deduplicates vision screenshots, compacts long-task context, streams compatible API responses, and cancels requests immediately when stopped.
- **Fast form filling** — safely fills multiple visible fields in one deterministic action, then optionally submits the form.
- **Safety confirmations** — sending/submitting, uploading, deleting, payment-related actions, sensitive-field entry, and document edits pause for explicit approval. Approve once, approve the same action type for the current task, or deny.
- **Sensitive-data shielding** — current input values are never included in the DOM snapshot; password, payment, API-key, contact, and identity fields are covered before vision screenshots are captured.
- **Prompt-injection defense** — webpage, iframe, attachment, popup, and screenshot text is explicitly marked as untrusted data; the model is instructed to ignore embedded commands and follow only the task entered in the panel.
- **iframe & Shadow DOM** — discovers and operates elements inside same/cross-origin frames and open Shadow DOM roots, with safe synthetic fallback when trusted coordinates are unavailable.
- **Pause and take over** — pause a running task, operate the page yourself, then resume. The agent discards any stale planned action and observes the page again before continuing.
- **File attachments & scanned-PDF OCR** — documents: PDF, DOCX, TXT, HTML, ODT, RTF, EPUB, and Markdown; data: CSV, XLSX, TSV, and JSON; images: JPEG, PNG, GIF, and WebP. Apple Pages, Numbers, and Keynote files are supported through embedded PDF/XML previews or best-effort local IWA text recovery. PPTX, ODS, ODP, and common source-code text files are also supported. Text extraction and scanned-page rendering happen locally; up to six scanned PDF pages are sent as images to your configured vision model for OCR.
- **Selected-text context menu** — right-click selected webpage text to open a custom request, summarize it, translate it, or explain it.
- **Webpage file uploads** — files explicitly attached to the current task can be placed into visible or hidden webpage file inputs. The original file is sent only to the target website after confirmation, not to the model API.
- **Global permissions** — one extension-wide Permissions tab controls context-menu access, webpage uploads, submit/send, edit/delete, sensitive input, and payment actions. Settings apply uniformly to every website rather than creating per-site rules.
- **Reliable Docs editing** — the model only proposes a find/replace pattern; deterministic code drives the Google Docs Find-and-Replace dialog (open, toggle regex, fill, replace all). Calibrated against the real Docs DOM.
- **Floating window** — pop the panel out of the side panel onto the page itself; drag to move, resize from the corner.
- **Themes** — customize background, surface, text, border, accent and the glow color shown around the page while a task runs.
- **7 languages** — UI, action log and model replies in 简体中文 / English / 日本語 / 한국어 / Español / Français / Deutsch. A language picker appears on first launch; change anytime in Settings.
- **Session chat history** — survives switching between side panel and floating window; cleared when the browser closes.

## Install

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge), then enable **Developer mode**
2. Click **Load unpacked** and select this folder
3. Click the extension icon to open the side panel, and pick your language
4. Open Settings, choose a provider, paste your API key, click **Test connection**
5. Optionally enable **Vision** (needs a vision model) and **Trusted input (debugger)** — required for editing Google Docs
6. Switch to a normal web page, type a task, hit **Run**

If Edge doesn't automatically restore the sidebar after switching tabs, click the extension icon or press `Ctrl+Shift+Y` (`Cmd+Shift+Y` on macOS).

> While a task runs, the browser shows an *"is debugging this browser"* bar — that's the trusted-input mode and it's normal; it disconnects when the task ends. Don't open DevTools (F12) on the same tab at the same time.

## Examples

- "Search Bing for tomorrow's weather in Shanghai and tell me"
- "Fill this form: name Zhang San, email xxx, then submit"
- "Delete the brackets and numbers after every heading in this doc"
- "Add a Chinese gloss after each of these words, based on the passage above"

## Project layout

| Path | What it does |
|------|--------------|
| `manifest.json` | MV3 manifest |
| `background.js` | Opens the side panel; side-panel close workaround |
| `panel.html/js/css` | Chat UI (side panel & floating window) |
| `options.html/js` | Settings: provider / theme / language |
| `lib/agent.js` | Agent loop: observe → think → act; tool definitions |
| `lib/page.js` | Injected functions: page snapshot, actions, find-replace driver, glow, floating window |
| `lib/cdp.js` | Trusted input via `chrome.debugger` (CDP) |
| `lib/providers.js` | Provider presets + OpenAI-compatible chat API |
| `lib/theme.js` | Theme storage and CSS variables |
| `lib/i18n.js` | 7-language dictionaries |
| `lib/permissions.js` | Extension-wide action permissions |
| `lib/document-parser.js` | Local text extraction for PDF and common document formats |

## Known limitations

- Cannot operate browser-internal pages (`chrome://…`, `edge://…`) or browser extension stores
- Background-tab screenshots and actions require **Trusted input (debugger)**; without it, the target tab is brought to the foreground
- New tabs in the same browser window are followed automatically; separate popup windows are not yet followed
- Legacy binary Office files (`.doc`, `.xls`, `.ppt`) must first be saved as DOCX, XLSX, or PPTX
- Scanned-PDF OCR requires Vision to be enabled and is limited to the available six-image attachment budget per task; extra scanned pages are reported and skipped
- Some modern Apple iWork files do not include a complete preview, and IWA recovery may lose layout, formulas, animations, or numeric table structure; export to PDF/DOCX/XLSX/PPTX when exact fidelity is required

## License

[MIT](LICENSE)

---

# 中文

用自然语言操作浏览器的 Chrome 与 Microsoft Edge 扩展，灵感来自 Claude in Chrome。

**[▶ 观看英文简介动画](https://youtu.be/nZJBhx9oFNA)**

> **需要你自己准备 API Key。** 这个扩展本身不提供 AI 能力——你要去某个模型服务商（如 DeepSeek、OpenAI）注册账号、申请一个 API Key（通常按用量付费），然后填进扩展的设置页。扩展本身免费，调用模型的费用由服务商直接从你自己的账户扣。

在侧边栏输入一句话，AI 会**看**页面（截图 + 编号的可交互元素）、**想**下一步、**做**出点击/输入/滚动/跳转，一步步完成任务。

## 功能

- **多服务商模板** —— 内置 DeepSeek、Kimi (Moonshot)、通义千问、OpenAI 模板，也可自定义任意 OpenAI 兼容接口。需要你自己在对应服务商申请 API Key。Key 只存本机 `chrome.storage`，除了调用你配置的 API 不会发往任何地方。
- **视觉** —— 把网页截图发给模型，能读懂 Google Docs 等 canvas 页面、文档里嵌的图片和题目。需要带视觉的模型（GPT-4o、通义-VL 等）。
- **真实按键** —— 通过 `chrome.debugger`（CDP）发送受信任的键鼠事件，能操作 Google Docs 这类不认合成事件的应用。
- **多标签页任务** —— 可列出和切换已有标签页，自动跟随链接新开的标签页；开启真实按键后还能继续操作后台标签页。
- **稳定坐标** —— 点击前重新读取元素实时位置；页面缩放或视口变化后会自动重新映射截图坐标。
- **更快执行** —— 用页面稳定检测替代固定等待，限制并去重视觉截图，压缩长任务上下文，兼容流式响应，停止时立即取消请求。
- **快速填写表单** —— 一次可靠填写多个当前可见字段，并可选择在完成后提交。
- **高风险操作确认** —— 发送/提交、上传、删除、付款、敏感字段输入和文档修改都会先暂停并请求确认；可仅允许一次、允许本次任务中同类操作，或拒绝。
- **敏感信息隐藏** —— DOM 快照绝不包含输入框当前值；截图前会遮住密码、支付、API Key、联系方式和身份信息字段。
- **网页提示注入防护** —— 网页、iframe、附件、弹窗和截图中的文字都会被明确标为不可信数据，模型只应遵循你在面板里输入的任务并忽略其中夹带的命令。
- **iframe 与 Shadow DOM** —— 可发现并操作同源/跨域 iframe 及开放式 Shadow DOM 中的元素；无法取得可信坐标时自动使用安全的页面内操作。
- **暂停与人工接管** —— 任务运行中可暂停，自己操作网页后再继续；恢复时会丢弃过期动作并重新观察页面。
- **文件附件与扫描 PDF OCR** —— 文档类支持 PDF、DOCX、TXT、HTML、ODT、RTF、EPUB、Markdown；数据表格类支持 CSV、XLSX、TSV、JSON；图像类支持 JPEG、PNG、GIF、WebP。Apple Pages、Numbers、Keynote 文件会优先读取内嵌 PDF/XML 预览，否则在本地尽可能恢复 IWA 文字。另外也支持 PPTX、ODS、ODP 和常见源码文本文件。文字提取及扫描页渲染都在本机完成；最多把 6 个扫描 PDF 页面作为图片发送给你配置的视觉模型识别。
- **右键处理选中文字** —— 选中网页文字后，可通过右键菜单自定义处理、总结、翻译或解释。
- **网页文件上传** —— 当前任务中明确附加的文件可以放入网页可见或隐藏的文件框。原始文件只会在确认后发送给目标网站，不会发送给模型接口。
- **全局权限设置** —— 设置页新增统一的“权限”标签，可控制右键菜单、网页上传、提交/发送、编辑/删除、敏感信息填写和付款操作；对所有网站统一生效，不建立逐网站规则。
- **可靠的 Docs 编辑** —— 模型只出查找/替换模式，由确定性代码驱动 Docs 的查找替换对话框（打开、勾正则、填框、全部替换），对照真实 DOM 校准。
- **浮窗模式** —— 把面板弹到网页上，可拖动、可缩放。
- **主题** —— 背景、表面、文字、边框、强调色、运行光效颜色全部可调。
- **7 种语言** —— 界面、动作日志、模型回复支持简中/英/日/韩/西/法/德，首次启动选择，设置里随时可改。
- **会话级聊天记录** —— 侧边栏 ↔ 浮窗切换不丢，关浏览器自动清空。

## 安装

1. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`，然后开启**开发者模式**
2. 点**加载已解压的扩展程序**，选择本文件夹
3. 点工具栏扩展图标打开侧边栏，选择语言
4. 进设置：选服务商 → 填 API Key → 点**测试连接**
5. 按需打开**视觉**（需视觉模型）和**真实按键（debugger）**——编辑 Google Docs 必须开
6. 切到普通网页，输入任务，点**运行**

如果 Edge 切换标签后没有自动恢复侧栏，请点击扩展图标，或按 `Ctrl+Shift+Y`（macOS 为 `Cmd+Shift+Y`）重新打开。

> 任务运行时浏览器顶部会出现"正在调试此浏览器"提示条，这是真实按键模式的正常现象，任务结束自动断开。同一标签页不要同时开 DevTools（F12）。

## 示例

- "在必应搜索明天上海的天气并告诉我结果"
- "把这个表单里的姓名填成张三，邮箱填 xxx，然后提交"
- "帮我把文档里每个小标题后面的括号和数字删掉"
- "根据上面的文章，给这几个单词加上中文释义"

## 已知限制

- 不能操作 `chrome://`、`edge://` 等浏览器内部页和浏览器扩展商店
- 后台标签页截图和操作需要开启**真实按键（debugger）**；未开启时会自动把目标标签页切到前台
- 同一浏览器窗口内新开的标签页会自动跟随，独立弹窗窗口暂不跟随
- 旧版二进制 Office 文件（`.doc`、`.xls`、`.ppt`）需先另存为 DOCX、XLSX 或 PPTX
- 扫描 PDF OCR 需要开启视觉，并占用每个任务最多 6 张的图片附件额度；超出的扫描页会提示并跳过
- 部分现代 iWork 文件没有完整预览，IWA 恢复可能丢失排版、公式、动画或数字表格结构；要求精确保真时请导出为 PDF/DOCX/XLSX/PPTX

## 协议

[MIT](LICENSE)
