const MAX_ARCHIVE_ENTRY_BYTES = 24 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_BYTES = 64 * 1024 * 1024;

function extensionOf(name = "") {
  const match = name.toLowerCase().match(/\.([^.]+)$/);
  return match?.[1] || "";
}

function cleanText(text) {
  return text
    .replace(/\u0000/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function parseXml(xml, fileName) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error(`Invalid XML in ${fileName}`);
  return doc;
}

function nodesByLocalName(root, localName) {
  return [...root.getElementsByTagNameNS("*", localName)];
}

function textFromParagraph(node) {
  const chunks = [];
  const visit = (current) => {
    if (current.nodeType === Node.TEXT_NODE) return;
    const name = current.localName;
    if (name === "t") chunks.push(current.textContent || "");
    else if (name === "tab") chunks.push("\t");
    else if (name === "br" || name === "cr") chunks.push("\n");
    else for (const child of current.childNodes) visit(child);
  };
  visit(node);
  return chunks.join("").trim();
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decompress Office documents");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const minEocd = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minEocd; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Invalid or unsupported ZIP document");

  const totalEntries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map();
  const decoder = new TextDecoder("utf-8");
  let totalInflated = 0;

  for (let index = 0; index < totalEntries; index++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("Invalid ZIP directory");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    if (flags & 0x1) throw new Error("Password-protected documents are not supported");
    if (uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES) throw new Error("A document part is too large");
    totalInflated += uncompressedSize;
    if (totalInflated > MAX_ARCHIVE_TOTAL_BYTES) throw new Error("The expanded document is too large");
    if (name.endsWith("/")) continue;

    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error("Invalid ZIP entry");
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const end = start + compressedSize;
    if (end > bytes.length) throw new Error("Truncated ZIP entry");
    const compressed = bytes.subarray(start, end);
    let data;
    if (method === 0) data = compressed.slice();
    else if (method === 8) data = await inflateRaw(compressed);
    else throw new Error(`Unsupported ZIP compression method: ${method}`);
    entries.set(name, data);
  }
  return entries;
}

function decodeEntry(entries, name) {
  const bytes = entries.get(name);
  return bytes ? new TextDecoder("utf-8").decode(bytes) : "";
}

function exactArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function extractDocx(entries) {
  const xml = decodeEntry(entries, "word/document.xml");
  if (!xml) throw new Error("DOCX document body was not found");
  const doc = parseXml(xml, "word/document.xml");
  return cleanText(nodesByLocalName(doc, "p").map(textFromParagraph).filter(Boolean).join("\n"));
}

function numericSuffix(name) {
  return Number(name.match(/(\d+)(?=\.xml$)/)?.[1] || 0);
}

function extractPptx(entries) {
  const names = [...entries.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => numericSuffix(a) - numericSuffix(b));
  const slides = names.map((name, index) => {
    const doc = parseXml(decodeEntry(entries, name), name);
    const lines = nodesByLocalName(doc, "p").map(textFromParagraph).filter(Boolean);
    return lines.length ? `[Slide ${index + 1}]\n${lines.join("\n")}` : "";
  }).filter(Boolean);
  return cleanText(slides.join("\n\n"));
}

function extractXlsx(entries) {
  const sharedXml = decodeEntry(entries, "xl/sharedStrings.xml");
  const shared = sharedXml
    ? nodesByLocalName(parseXml(sharedXml, "xl/sharedStrings.xml"), "si").map((node) =>
      nodesByLocalName(node, "t").map((part) => part.textContent || "").join(""))
    : [];
  const names = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => numericSuffix(a) - numericSuffix(b));
  const sheets = names.map((name, index) => {
    const doc = parseXml(decodeEntry(entries, name), name);
    const rows = nodesByLocalName(doc, "row").map((row) => {
      const cells = nodesByLocalName(row, "c").map((cell) => {
        const type = cell.getAttribute("t") || "";
        const value = nodesByLocalName(cell, "v")[0]?.textContent || "";
        if (type === "s") return shared[Number(value)] ?? value;
        if (type === "inlineStr") return nodesByLocalName(cell, "t").map((n) => n.textContent || "").join("");
        if (type === "b") return value === "1" ? "TRUE" : "FALSE";
        return value;
      });
      return cells.join("\t").replace(/\t+$/g, "");
    }).filter(Boolean);
    return rows.length ? `[Sheet ${index + 1}]\n${rows.join("\n")}` : "";
  }).filter(Boolean);
  return cleanText(sheets.join("\n\n"));
}

function extractOpenDocument(entries) {
  const xml = decodeEntry(entries, "content.xml");
  if (!xml) throw new Error("OpenDocument content was not found");
  const doc = parseXml(xml, "content.xml");
  const blocks = [...nodesByLocalName(doc, "h"), ...nodesByLocalName(doc, "p")]
    .map((node) => node.textContent?.trim() || "")
    .filter(Boolean);
  return cleanText(blocks.join("\n"));
}

function resolveArchivePath(baseFile, href = "") {
  let decoded = href.split(/[?#]/, 1)[0];
  try { decoded = decodeURIComponent(decoded); } catch (_) {}
  const parts = decoded.startsWith("/") ? [] : baseFile.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function extractEpub(entries) {
  const containerXml = decodeEntry(entries, "META-INF/container.xml");
  if (!containerXml) throw new Error("EPUB container metadata was not found");
  const container = parseXml(containerXml, "META-INF/container.xml");
  const packagePath = nodesByLocalName(container, "rootfile")[0]?.getAttribute("full-path") || "";
  if (!packagePath) throw new Error("EPUB package document was not found");
  const packageXml = decodeEntry(entries, packagePath);
  if (!packageXml) throw new Error("EPUB package document is missing");
  const packageDoc = parseXml(packageXml, packagePath);

  const manifest = new Map();
  for (const item of nodesByLocalName(packageDoc, "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    const mediaType = item.getAttribute("media-type") || "";
    if (id && href && /xhtml|html/i.test(mediaType)) {
      manifest.set(id, resolveArchivePath(packagePath, href));
    }
  }
  const ordered = nodesByLocalName(packageDoc, "itemref")
    .map((item) => manifest.get(item.getAttribute("idref") || ""))
    .filter(Boolean);
  const chapterPaths = ordered.length ? ordered : [...manifest.values()];
  const chapters = [];
  for (const [index, path] of chapterPaths.entries()) {
    const source = decodeEntry(entries, path);
    if (!source) continue;
    const doc = new DOMParser().parseFromString(source, "text/html");
    doc.querySelectorAll("script,style,noscript").forEach((node) => node.remove());
    const blocks = [...doc.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote")]
      .map((node) => node.textContent?.replace(/\s+/g, " ").trim() || "")
      .filter(Boolean);
    const text = cleanText((blocks.length ? blocks.join("\n") : doc.body?.textContent || ""));
    if (text) chapters.push(`[Chapter ${index + 1}]\n${text}`);
  }
  return cleanText(chapters.join("\n\n"));
}

function extractRtf(source) {
  return cleanText(source
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, ""));
}

function readVarint(bytes, start) {
  let value = 0;
  let shift = 0;
  let offset = start;
  while (offset < bytes.length && shift < 35) {
    const byte = bytes[offset++];
    value += (byte & 0x7f) * (2 ** shift);
    if (!(byte & 0x80)) return { value, offset };
    shift += 7;
  }
  throw new Error("Invalid Snappy length");
}

function copyFromOutput(output, offset, length) {
  if (!offset || offset > output.length) throw new Error("Invalid Snappy copy offset");
  for (let i = 0; i < length; i++) output.push(output[output.length - offset]);
}

function decompressSnappy(bytes) {
  const header = readVarint(bytes, 0);
  const expectedLength = header.value;
  if (expectedLength > MAX_ARCHIVE_ENTRY_BYTES) throw new Error("An iWork data block is too large");
  const output = [];
  let cursor = header.offset;
  while (cursor < bytes.length && output.length < expectedLength) {
    const tag = bytes[cursor++];
    const type = tag & 0x03;
    if (type === 0) {
      let lengthCode = tag >>> 2;
      let length;
      if (lengthCode < 60) length = lengthCode + 1;
      else {
        const byteCount = lengthCode - 59;
        length = 0;
        for (let i = 0; i < byteCount; i++) length += bytes[cursor++] * (2 ** (8 * i));
        length += 1;
      }
      if (cursor + length > bytes.length) throw new Error("Truncated Snappy literal");
      for (let i = 0; i < length; i++) output.push(bytes[cursor++]);
    } else if (type === 1) {
      const length = 4 + ((tag >>> 2) & 0x07);
      const offset = ((tag & 0xe0) << 3) | bytes[cursor++];
      copyFromOutput(output, offset, length);
    } else if (type === 2) {
      const length = 1 + (tag >>> 2);
      const offset = bytes[cursor] | (bytes[cursor + 1] << 8);
      cursor += 2;
      copyFromOutput(output, offset, length);
    } else {
      const length = 1 + (tag >>> 2);
      const offset = bytes[cursor] | (bytes[cursor + 1] << 8) |
        (bytes[cursor + 2] << 16) | (bytes[cursor + 3] << 24);
      cursor += 4;
      copyFromOutput(output, offset >>> 0, length);
    }
    if (output.length > expectedLength) throw new Error("Invalid Snappy output length");
  }
  if (output.length !== expectedLength) throw new Error("Truncated Snappy block");
  return new Uint8Array(output);
}

function decompressIwa(bytes) {
  const chunks = [];
  let cursor = 0;
  let total = 0;
  while (cursor + 4 <= bytes.length) {
    if (bytes[cursor] !== 0) break;
    const compressedLength = bytes[cursor + 1] | (bytes[cursor + 2] << 8) | (bytes[cursor + 3] << 16);
    cursor += 4;
    if (!compressedLength || cursor + compressedLength > bytes.length) break;
    const chunk = decompressSnappy(bytes.subarray(cursor, cursor + compressedLength));
    cursor += compressedLength;
    total += chunk.length;
    if (total > MAX_ARCHIVE_TOTAL_BYTES) throw new Error("The expanded iWork document is too large");
    chunks.push(chunk);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

function recoverReadableStrings(bytes) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const found = [];
  const seen = new Set();
  let start = -1;
  const flush = (end) => {
    if (start < 0 || end - start < 3) { start = -1; return; }
    let value = "";
    try { value = decoder.decode(bytes.subarray(start, end)); } catch (_) { start = -1; return; }
    start = -1;
    value = value.replace(/\s+/g, " ").trim();
    if (value.length < 2 || value.length > 20000 || !/[\p{L}\p{N}]/u.test(value)) return;
    if (/^(?:[A-Z]{2,8}\.|com\.apple\.|[\w/-]+\.(?:iwa|jpg|png|mov|xml))/.test(value)) return;
    if (!seen.has(value)) { seen.add(value); found.push(value); }
  };
  for (let i = 0; i <= bytes.length; i++) {
    const byte = bytes[i];
    const printable = i < bytes.length && (byte === 9 || byte === 10 || byte === 13 || byte >= 0x20);
    if (printable && start < 0) start = i;
    else if (!printable && start >= 0) flush(i);
  }
  return found;
}

async function extractIwork(entries, ext) {
  const previewName = [...entries.keys()].find((name) =>
    /(?:^|\/)(?:quicklook\/)?preview\.pdf$/i.test(name));
  if (previewName) {
    const text = await extractPdf(exactArrayBuffer(entries.get(previewName)));
    if (text) return cleanText(`[${ext.toUpperCase()} PDF preview]\n${text}`);
  }

  const xmlNames = [...entries.keys()].filter((name) => /(?:^|\/)(?:index|document)\.xml$/i.test(name));
  const xmlText = [];
  for (const name of xmlNames) {
    const doc = parseXml(decodeEntry(entries, name), name);
    const text = cleanText(doc.documentElement?.textContent || "");
    if (text) xmlText.push(text);
  }
  if (xmlText.length) return cleanText(xmlText.join("\n\n"));

  const strings = [];
  const seen = new Set();
  for (const [name, data] of entries) {
    if (!/\.iwa$/i.test(name)) continue;
    let unpacked;
    try { unpacked = decompressIwa(data); } catch (_) { continue; }
    for (const value of recoverReadableStrings(unpacked)) {
      if (!seen.has(value)) { seen.add(value); strings.push(value); }
    }
  }
  if (strings.length) {
    return cleanText(`[Recovered text from Apple ${ext.toUpperCase()} document]\n${strings.join("\n")}`);
  }
  throw new Error(`No readable preview or text was found. Export this ${ext.toUpperCase()} file as PDF, DOCX, XLSX, or PPTX and try again.`);
}

async function extractPdf(arrayBuffer) {
  const pdfjs = await import("../vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
    cMapUrl: new URL("../vendor/pdfjs/cmaps/", import.meta.url).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("../vendor/pdfjs/standard_fonts/", import.meta.url).href,
    isEvalSupported: false
  });
  const pdf = await loadingTask.promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let line = "";
      const lines = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) { if (line.trim()) lines.push(line.trim()); line = ""; }
        else if (item.str && !/\s$/.test(item.str)) line += " ";
      }
      if (line.trim()) lines.push(line.trim());
      if (lines.length) pages.push(`[Page ${pageNumber}]\n${lines.join("\n")}`);
    }
  } finally {
    await loadingTask.destroy();
  }
  return cleanText(pages.join("\n\n"));
}

async function extractPdfWithOcrPages(arrayBuffer, maxOcrPages = 5) {
  const pdfjs = await import("../vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
    cMapUrl: new URL("../vendor/pdfjs/cmaps/", import.meta.url).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("../vendor/pdfjs/standard_fonts/", import.meta.url).href,
    isEvalSupported: false
  });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const pages = [];
  const images = [];
  let scannedPages = 0;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let line = "";
      const lines = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) { if (line.trim()) lines.push(line.trim()); line = ""; }
        else if (item.str && !/\s$/.test(item.str)) line += " ";
      }
      if (line.trim()) lines.push(line.trim());
      const pageText = cleanText(lines.join("\n"));
      if (pageText.length >= 20) {
        pages.push(`[Page ${pageNumber}]\n${pageText}`);
      } else {
        scannedPages++;
        if (images.length < maxOcrPages) {
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(2.25, 1400 / Math.max(1, base.width));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.ceil(viewport.width));
          canvas.height = Math.max(1, Math.ceil(viewport.height));
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("This browser cannot render PDF pages for OCR");
          context.fillStyle = "#fff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvas, canvasContext: context, viewport, background: "#fff" }).promise;
          images.push({ pageNumber, dataUrl: canvas.toDataURL("image/jpeg", 0.82) });
          canvas.width = 1;
          canvas.height = 1;
        }
      }
      page.cleanup?.();
    }
  } finally {
    await loadingTask.destroy();
  }
  return {
    text: cleanText(pages.join("\n\n")),
    images,
    pageCount,
    scannedPages,
    omittedOcrPages: Math.max(0, scannedPages - images.length)
  };
}

export const DOCUMENT_EXTENSIONS = ["pdf", "docx", "pptx", "xlsx", "odt", "ods", "odp", "rtf", "epub", "pages", "numbers", "key"];

export async function extractDocumentText(file) {
  const ext = extensionOf(file.name);
  if (!DOCUMENT_EXTENSIONS.includes(ext)) throw new Error("Unsupported document type");
  if (ext === "rtf") return extractRtf(await file.text());
  const arrayBuffer = await file.arrayBuffer();
  if (ext === "pdf") return extractPdf(arrayBuffer);
  const entries = await readZipEntries(arrayBuffer);
  if (ext === "docx") return extractDocx(entries);
  if (ext === "pptx") return extractPptx(entries);
  if (ext === "xlsx") return extractXlsx(entries);
  if (ext === "epub") return extractEpub(entries);
  if (["pages", "numbers", "key"].includes(ext)) return extractIwork(entries, ext);
  return extractOpenDocument(entries);
}

// PDF 没有可用文字层时，把扫描页在本地渲染为图片，后续由用户配置的视觉模型完成 OCR。
// 原始文件不会上传；只返回本地提取的文字和受限数量的页面图片。
export async function extractDocumentAttachment(file, { maxOcrPages = 5 } = {}) {
  const ext = extensionOf(file.name);
  if (ext !== "pdf") return { text: await extractDocumentText(file), images: [], scannedPages: 0, omittedOcrPages: 0 };
  return extractPdfWithOcrPages(await file.arrayBuffer(), Math.max(0, maxOcrPages));
}
