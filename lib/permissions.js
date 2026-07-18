const STORAGE_KEY = "globalActionPermissions";

export const DEFAULT_ACTION_PERMISSIONS = Object.freeze({
  contextMenu: true,
  fileUpload: true,
  submit: true,
  edit: true,
  sensitiveInput: true,
  payment: true
});

export async function loadActionPermissions() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return { ...DEFAULT_ACTION_PERMISSIONS, ...(data[STORAGE_KEY] || {}) };
}

export async function saveActionPermissions(value) {
  const next = {};
  for (const key of Object.keys(DEFAULT_ACTION_PERMISSIONS)) next[key] = value[key] !== false;
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export function permissionForRisk(kind) {
  if (kind === "upload") return "fileUpload";
  if (kind === "submit") return "submit";
  if (kind === "payment") return "payment";
  if (kind === "sensitive-input") return "sensitiveInput";
  if (["edit-content", "delete-content", "delete"].includes(kind)) return "edit";
  return null;
}
