export const NOTEBOOK_KEY = 'moxi-notebook-v1';
const PREVIOUS_KEY = 'moxi-notebook-v1:previous';
const empty = () => ({ notes: [], overrides: [], aliases: [] });
function parse(raw) {
  const value = JSON.parse(raw);
  if (!value || !Array.isArray(value.notes) || !Array.isArray(value.overrides) || !Array.isArray(value.aliases)) throw new Error('本机笔记格式无效，原有存储未清除。');
  return { notes: value.notes, overrides: value.overrides, aliases: value.aliases };
}
export function readNotebook() {
  try { const raw = localStorage.getItem(NOTEBOOK_KEY); return { data: raw ? parse(raw) : empty(), error: null }; }
  catch (error) { return { data: empty(), error: error.message || '无法读取浏览器存储。' }; }
}
export function saveNotebook(data) {
  try {
    const serialized = JSON.stringify({ version: 1, ...data });
    const previous = localStorage.getItem(NOTEBOOK_KEY);
    if (previous !== null) localStorage.setItem(PREVIOUS_KEY, previous);
    localStorage.setItem(NOTEBOOK_KEY, serialized);
    return { saved: true, error: null };
  } catch (error) { return { saved: false, error: error.message || '浏览器存储写入失败。' }; }
}
export function readPreviousNotebook() {
  try { const raw = localStorage.getItem(PREVIOUS_KEY); return raw ? { data: parse(raw), error: null } : { data: null, error: null }; }
  catch (error) { return { data: null, error: error.message || '无法读取上一份备份。' }; }
}
