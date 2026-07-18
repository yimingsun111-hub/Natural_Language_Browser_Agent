# Privacy Policy · 隐私权政策

**NL Browser Agent (Natural Language Browser Agent)**

Last updated: 2026-07-18 · 最后更新：2026-07-18

---

## English

### What this extension does

NL Browser Agent lets you automate your browser with natural-language commands. To do this, when **you** run a task, the extension reads the content of the page being operated (interactive element structure, page text, and — if Vision is enabled — a screenshot) and sends it to the AI model API endpoint **that you yourself configured** (e.g. DeepSeek, OpenAI, or any OpenAI-compatible endpoint), so the model can decide the next action. For a multi-tab task, the model may also receive the titles and URLs of tabs in the current window and the content of a tab it selects for the task.

### Data we collect

**None.** The developer operates no server. No analytics, no telemetry, no tracking. Nothing is ever sent to the developer.

### Data stored on your device

- Your API key, provider settings, theme and language preferences — stored locally via `chrome.storage.local`, never uploaded anywhere by the extension.
- Session chat history — stored via `chrome.storage.session` and automatically erased when the browser closes.
- A pending right-click selected-text request — stored briefly via `chrome.storage.session` only while the side panel opens, then removed when consumed.
- Local task performance timing (durations and counts only, never page content) — stored via `chrome.storage.session` for the latest task and erased when the browser closes.

### Data sent to third parties

Page content (element structure, text, optional screenshots), current-window tab titles/URLs when needed for a multi-tab task, and your typed instructions/attachments are sent **only** to the model API endpoint you configured, **only** while a task you started is running. That transmission is governed by the privacy policy of the provider you chose. The only separate destination is the webpage you are operating when you explicitly confirm an upload, submission, or similar website action.

When you use a selected-text context-menu action, that selected text is treated as untrusted webpage data and is sent to your configured model as part of the task you explicitly started.

For supported document attachments such as PDF, DOCX, PPTX, and XLSX, text extraction happens locally inside the extension. The extracted text — not the original document file — is included in the request to your configured model. For scanned PDF pages without a usable text layer, the extension locally renders a limited number of pages as images and sends those derived page images to your configured vision model for OCR. Image attachments are sent as images. Attached files and derived page images are kept only in memory for the current task and are not permanently stored by the extension.

Input values are omitted from the page's structured snapshot. Before a vision screenshot is captured, recognized password, payment, API-key, contact, and identity fields are temporarily covered. This reduces accidental exposure but cannot guarantee that every sensitive value rendered elsewhere on a webpage will be detected.

If you explicitly attach a file and ask the agent to upload it to a webpage, the original file is kept only in memory and is transferred directly into that webpage's file input after an action-time confirmation. It is not sent to the model API as an original file; locally extracted text or derived preview images may still be sent as described above.

### Data we do NOT do

- We do not sell or transfer user data to third parties.
- We do not use or transfer user data for purposes unrelated to the extension's single purpose.
- We do not use or transfer user data to determine creditworthiness or for lending purposes.
- We do not continuously collect browsing history or monitor browsing. Pages and tab information are accessed only while a task you explicitly started is running, including a background tab only when that task switches to it.

### Contact

Questions or concerns: open an issue at
https://github.com/yimingsun111-hub/Natural_Language_Browser_Agent/issues

---

## 中文

### 本扩展做什么

NL Browser Agent 让你用自然语言指令自动化操作浏览器。为此，当**你**主动运行任务时，扩展会读取正在操作的页面内容（可交互元素结构、页面文字，若开启视觉功能则包含页面截图），并发送给**你自己配置的** AI 模型接口（如 DeepSeek、OpenAI 或任意 OpenAI 兼容接口），由模型决定下一步操作。执行多标签页任务时，模型还可能收到当前窗口中标签页的标题和网址，以及它为该任务选择的标签页内容。

### 我们收集哪些数据

**不收集。** 开发者不运营任何服务器，没有统计、没有遥测、没有跟踪，任何数据都不会发送给开发者。

### 存储在你设备上的数据

- API Key、服务商配置、主题与语言偏好——通过 `chrome.storage.local` 仅存本机，扩展不会将其上传到任何地方。
- 会话级聊天记录——存于 `chrome.storage.session`，浏览器关闭后自动清除。
- 等待处理的右键选中文字——仅在侧边栏打开期间短暂存于 `chrome.storage.session`，读取后立即移除。
- 最近一次任务的本地性能计时（仅耗时与次数，不含页面内容）——存于 `chrome.storage.session`，浏览器关闭后自动清除。

### 发送给第三方的数据

页面内容（元素结构、文字、可选的截图）、多标签页任务所需的当前窗口标签页标题/网址，以及你输入的指令/附件，**仅**在你主动运行任务期间、**仅**发送给你自己配置的模型接口。该传输受你所选服务商的隐私政策约束。唯一的额外目标，是你明确确认上传、提交或类似网站操作时正在操作的目标网页。

当你使用右键菜单处理选中文字时，该文字会作为不可信网页数据，随你明确启动的任务发送给你配置的模型。

对于 PDF、DOCX、PPTX、XLSX 等受支持的文档附件，扩展会在本机提取文字，发送给模型的是提取后的文字，而不是原始文档文件。对于没有可用文字层的扫描 PDF 页面，扩展会在本机把有限数量的页面渲染成图片，再发送给你配置的视觉模型进行 OCR；普通图片附件也会以图片形式发送。附件及衍生页面图片只会在当前任务期间保存在内存中，扩展不会永久保存。

页面结构快照不会包含输入框当前值。截取视觉画面前，扩展会临时遮住识别到的密码、支付、API Key、联系方式和身份信息字段。这能降低意外泄露风险，但不能保证识别网页其他位置渲染出的所有敏感信息。

如果你明确附加文件并要求代理上传到网页，原始文件只会暂存在内存中，并在执行时再次确认后直接放入该网页的文件输入框。原始文件不会作为文件发送给模型接口；在本机提取出的文字或衍生预览图片仍可能按上述说明发送给模型。

### 我们承诺不做的事

- 不向第三方出售或传输用户数据
- 不将用户数据用于与本扩展单一用途无关的目的
- 不将用户数据用于信用评估或放贷目的
- 不持续收集浏览历史或监控浏览行为；页面和标签页信息只会在你明确启动的任务期间访问，后台标签页也只有在任务切换到它时才会读取

### 联系方式

如有疑问，请在 GitHub 提 issue：
https://github.com/yimingsun111-hub/Natural_Language_Browser_Agent/issues
