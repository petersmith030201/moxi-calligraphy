// Local-only PDF reader. No file bytes are transmitted by this module.
const loaded = new Map();
let booksPromise, desiredBook, desiredPage = 1, activePdf, pageToken = 0, lastFocus;
let renderTask;
const dialog = document.createElement('dialog');
dialog.className = 'pdf-reader';
dialog.setAttribute('aria-labelledby', 'pdf-reader-title');
dialog.innerHTML = `<form method="dialog" class="pdf-reader-top"><div><small>原页核查 · 文件仅在本次浏览器会话中读取</small><h2 id="pdf-reader-title">教材原页</h2></div><button aria-label="关闭原页查看">关闭 ×</button></form>
<p id="pdf-reader-help">选择与你提供的版本一致的本地 PDF。原件不会上传到 GitHub 或模型接口。</p>
<div class="pdf-controls"><label>教材 <select id="pdf-book"></select></label><label class="pdf-file-label">选择本地 PDF<input id="pdf-file" type="file" accept="application/pdf,.pdf"></label><label>PDF 页码 <input id="pdf-page" type="number" min="1" value="1" inputmode="numeric"></label><button id="pdf-prev">上一页</button><button id="pdf-next">下一页</button><button id="pdf-goto">跳转</button></div>
<p id="pdf-status" role="status" aria-live="polite"></p><div class="pdf-canvas-wrap"><canvas id="pdf-canvas" aria-label="用户选择的教材原页"></canvas></div>`;
const style = document.createElement('style');
style.textContent = `.pdf-reader{width:min(1050px,95vw);max-height:94vh;border:1px solid #d9d1c1;border-radius:16px;background:#faf8f2;color:#262b28;padding:22px;box-sizing:border-box}.pdf-reader::backdrop{background:#18221ec4}.pdf-reader-top{display:flex;align-items:center;justify-content:space-between;gap:16px}.pdf-reader h2{margin:6px 0;font-family:serif}.pdf-reader small{color:#72796e}.pdf-reader button,.pdf-reader select,.pdf-reader input{font:inherit;padding:9px;border:1px solid #d9d1c1;border-radius:7px;background:white;color:#262b28}.pdf-reader button{cursor:pointer}.pdf-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:end}.pdf-controls label{display:flex;flex-direction:column;gap:6px;font-size:13px}.pdf-controls input[type=number]{width:76px}.pdf-controls input[type=file]{max-width:245px}.pdf-canvas-wrap{overflow:auto;max-height:65vh;text-align:center;background:#e9e5db;border-radius:8px}.pdf-canvas-wrap canvas{max-width:100%;height:auto;background:white}.pdf-reader [role=status]{font-size:13px;line-height:1.7;color:#666b61;min-height:23px}@media(max-width:600px){.pdf-reader{padding:14px}.pdf-controls select{max-width:82vw}.pdf-reader small{font-size:11px}}`;
document.head.append(style);
document.body.append(dialog);
const $ = id => dialog.querySelector(`#${id}`);
function status(text) { $('pdf-status').textContent = text; }
async function books() {
  booksPromise ||= fetch(new URL('./data/knowledge.json', import.meta.url)).then(r => {
    if (!r.ok) throw Error('教材目录读取失败。');
    return r.json();
  }).then(data => data.books);
  return booksPromise;
}
async function render() {
  const token = ++pageToken;
  if (!activePdf) { status('请先选择对应版本的本地 PDF，再查看引用页。'); return; }
  const n = Math.max(1, Math.min(activePdf.numPages, Number($('pdf-page').value) || 1));
  $('pdf-page').value = n;
  desiredPage = n;
  try {
    if (renderTask) { renderTask.cancel(); try { await renderTask.promise; } catch {} renderTask = null; }
    const page = await activePdf.getPage(n);
    if (token !== pageToken) return;
    const natural = page.getViewport({scale:1});
    const width = Math.min(1600, Math.max(650, dialog.clientWidth * Math.min(devicePixelRatio || 1, 2)));
    const viewport = page.getViewport({scale:Math.min(width / natural.width, Math.sqrt(5_000_000/(natural.width*natural.height)))});
    const canvas = $('pdf-canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    renderTask = page.render({canvasContext:canvas.getContext('2d'), viewport});
    await renderTask.promise;
    if (token === pageToken) status(`版本 SHA-256 已匹配 · PDF 第 ${n} / ${activePdf.numPages} 页。页面中的印刷页码可能不同，请以引用卡片为准。`);
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException' && token === pageToken) status(`原页显示失败：${e.message}`);
  }
}
async function selectBook(id, page=1) {
  desiredBook = id; desiredPage = page;
  $('pdf-book').value = id; $('pdf-page').value = page;
  activePdf = loaded.get(id);
  $('pdf-page').max = activePdf?.numPages || 10000;
  const canvas = $('pdf-canvas'); canvas.width = 1; canvas.height = 1;
  await render();
}
async function openSource(detail={}) {
  try {
    const list = await books();
    $('pdf-book').replaceChildren(...list.map(b => {
      const option = document.createElement('option'); option.value=b.id; option.textContent=b.title; return option;
    }));
    lastFocus = document.activeElement;
    if (!dialog.open) dialog.showModal();
    await selectBook(list.some(b=>b.id===detail.bookId) ? detail.bookId : list[0].id, detail.page || 1);
  } catch(e) { alert(`无法打开教材目录：${e.message}`); }
}
window.addEventListener('open-source', e => openSource(e.detail));
dialog.addEventListener('close', () => { ++pageToken; renderTask?.cancel(); lastFocus?.focus?.(); });
$('pdf-book').addEventListener('change', e => selectBook(e.target.value));
$('pdf-file').addEventListener('change', async e => {
  const file = e.target.files?.[0]; if (!file) return;
  const bookId = desiredBook, targetPage = desiredPage;
  const book = (await books()).find(b=>b.id===bookId);
  try {
    if (file.size > 300*1024*1024) throw Error('此版阅读器仅接受 300 MB 以内文件。');
    status('正在本地读取并核对文件版本，较大的扫描册可能需要几秒钟……');
    const buffer = await file.arrayBuffer();
    const signature = new TextDecoder().decode(buffer.slice(0,8));
    if (!signature.startsWith('%PDF-')) throw Error('文件头不是 PDF。');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if (hash !== book.sha256) throw Error('文件与该教材的已核对版本不匹配。请选择对应原文件，以免引用页错位。');
    const pdfjs = await import('./vendor/pdf.js');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.js', import.meta.url).href;
    const pdf = await pdfjs.getDocument({data:new Uint8Array(buffer),isEvalSupported:false,enableXfa:false,maxImageSize:35_000_000}).promise;
    if (pdf.numPages !== book.pageCount) { await pdf.destroy(); throw Error('页数不匹配。'); }
    const previous = loaded.get(bookId);
    loaded.set(bookId,pdf); if (previous) await previous.destroy();
    if (desiredBook === bookId) await selectBook(bookId,targetPage);
  } catch(err) { status(`未加载：${err.message}`); }
  finally { e.target.value=''; }
});
$('pdf-prev').addEventListener('click', () => { $('pdf-page').value=Number($('pdf-page').value)-1; render(); });
$('pdf-next').addEventListener('click', () => { $('pdf-page').value=Number($('pdf-page').value)+1; render(); });
$('pdf-goto').addEventListener('click', render);
$('pdf-page').addEventListener('keydown', e => { if(e.key==='Enter') render(); });
