/* Jotly — app.js
   All document state lives in localStorage under 'jotly.docs'.
   No build step, no framework: plain DOM + contenteditable.
*/
(() => {
  'use strict';

  const STORAGE_KEY = 'jotly.docs.v1';

  /* ---------------- storage ---------------- */
  function loadDocs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function saveDocs(docs) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
  }
  function uid() {
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  let docs = loadDocs();
  let currentDocId = null;
  let activeFilter = 'all';
  let saveTimer = null;

  /* ---------------- helpers ---------------- */
  function plainTextPreview(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    return (div.textContent || '').trim().slice(0, 160);
  }
  function wordCount(html) {
    const text = plainTextFull(html);
    const m = text.trim().match(/\S+/g);
    return m ? m.length : 0;
  }
  function plainTextFull(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    return div.textContent || '';
  }
  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    const day = Math.floor(hr / 24);
    if (day < 7) return day + 'd ago';
    return new Date(ts).toLocaleDateString();
  }
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 1800);
  }

  /* ---------------- screens ---------------- */
  const screenHome = document.getElementById('screen-home');
  const screenEditor = document.getElementById('screen-editor');

  function showHome() {
    screenEditor.classList.add('hidden');
    screenHome.classList.remove('hidden');
    currentDocId = null;
    renderHome();
  }
  function showEditor(id) {
    currentDocId = id;
    const doc = docs.find(d => d.id === id);
    if (!doc) return showHome();
    screenHome.classList.add('hidden');
    screenEditor.classList.remove('hidden');
    document.getElementById('doc-title').value = doc.title || '';
    const page = document.getElementById('editor-page');
    page.innerHTML = doc.content || '';
    page.setAttribute('data-placeholder', doc.kind === 'note' ? 'Start typing your note…' : 'Start writing…');
    updateStarButton(doc);
    setSaveStatus('Saved');
  }

  /* ---------------- home rendering ---------------- */
  const docGrid = document.getElementById('doc-grid');
  const emptyState = document.getElementById('empty-state');
  const CARD_COLORS = ['#FFC900', '#5B21B6', '#0EA968', '#E8447A'];

  function renderHome() {
    const query = document.getElementById('search-input').value.trim().toLowerCase();
    let list = docs.filter(d => !d.trashed);
    if (activeFilter === 'docs') list = list.filter(d => d.kind !== 'note' && d.kind !== 'design');
    if (activeFilter === 'notes') list = list.filter(d => d.kind === 'note');
    if (activeFilter === 'designs') list = list.filter(d => d.kind === 'design');
    if (activeFilter === 'starred') list = list.filter(d => d.starred);
    if (query) {
      list = list.filter(d =>
        (d.title || '').toLowerCase().includes(query) ||
        plainTextFull(d.content).toLowerCase().includes(query)
      );
    }
    list = list.slice().sort((a, b) => b.updatedAt - a.updatedAt);

    docGrid.innerHTML = '';
    emptyState.classList.toggle('hidden', list.length > 0);

    list.forEach((d, i) => {
      const card = document.createElement('button');
      card.className = 'doc-card';
      card.style.borderTopColor = CARD_COLORS[i % CARD_COLORS.length];
      card.innerHTML = `
        <div class="doc-card-top">
          <span class="doc-kind">${d.kind === 'note' ? 'Note' : d.kind === 'checklist' ? 'Checklist' : d.kind === 'design' ? 'Design' : 'Document'}</span>
          <span class="doc-star" data-star="${d.id}">${d.starred ? '★' : '☆'}</span>
        </div>
        <h3>${escapeHtml(d.title || 'Untitled')}</h3>
        <p class="doc-preview">${d.kind === 'design' ? (d.page ? `${d.page.presetLabel || 'Custom'} · ${d.page.orientation}` : 'Free-form design') : (escapeHtml(plainTextPreview(d.content)) || 'Empty — tap to start writing')}</p>
        <div class="doc-meta"><span>${timeAgo(d.updatedAt)}</span><span>${d.kind === 'design' ? (d.elements ? d.elements.length + ' objects' : '0 objects') : wordCount(d.content) + ' words'}</span></div>
      `;
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-star]')) return;
        if (d.kind === 'design') { window.JotlyDesign && window.JotlyDesign.open(d.id); return; }
        showEditor(d.id);
      });
      card.querySelector('[data-star]').addEventListener('click', (e) => {
        e.stopPropagation();
        d.starred = !d.starred;
        saveDocs(docs);
        renderHome();
      });
      docGrid.appendChild(card);
    });
  }
  function escapeHtml(s) {
    return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  document.getElementById('search-input').addEventListener('input', renderHome);
  document.getElementById('filter-row').addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    activeFilter = chip.dataset.filter;
    renderHome();
  });

  /* ---------------- new document sheet ---------------- */
  const newSheet = document.getElementById('new-sheet');
  document.getElementById('btn-new').addEventListener('click', () => openSheet(newSheet));
  newSheet.querySelectorAll('[data-new]').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.new;
      if (kind === 'design') {
        closeSheet(newSheet);
        window.JotlyDesign && window.JotlyDesign.openPresetSheet();
        return;
      }
      const doc = {
        id: uid(),
        title: '',
        kind,
        content: kind === 'checklist' ? '<ul class="checklist"><li class="checklist-item"><input type="checkbox"><span contenteditable="false"></span></li></ul>' : '',
        starred: false,
        trashed: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      docs.push(doc);
      saveDocs(docs);
      closeSheet(newSheet);
      showEditor(doc.id);
      setTimeout(() => document.getElementById('doc-title').focus(), 150);
    });
  });

  /* ---------------- sheet plumbing ---------------- */
  function openSheet(sheetEl) { sheetEl.classList.remove('hidden'); }
  function closeSheet(sheetEl) { sheetEl.classList.add('hidden'); }
  document.querySelectorAll('.sheet').forEach(sheet => {
    sheet.addEventListener('click', (e) => {
      if (e.target.hasAttribute('data-close-sheet')) closeSheet(sheet);
    });
  });

  /* ---------------- editor: back / title / star ---------------- */
  document.getElementById('btn-back').addEventListener('click', () => {
    flushSave(true);
    showHome();
  });
  document.getElementById('doc-title').addEventListener('input', scheduleSave);
  document.getElementById('btn-star').addEventListener('click', () => {
    const doc = getCurrentDoc();
    if (!doc) return;
    doc.starred = !doc.starred;
    saveDocs(docs);
    updateStarButton(doc);
  });
  function updateStarButton(doc) {
    document.getElementById('btn-star').textContent = doc.starred ? '★' : '☆';
  }
  function getCurrentDoc() { return docs.find(d => d.id === currentDocId); }

  /* ---------------- autosave ---------------- */
  function setSaveStatus(text, saving) {
    const el = document.getElementById('save-status');
    el.textContent = text;
    el.classList.toggle('is-saving', !!saving);
  }
  function scheduleSave() {
    setSaveStatus('Saving…', true);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 500);
  }
  function flushSave() {
    const doc = getCurrentDoc();
    if (!doc) return;
    doc.title = document.getElementById('doc-title').value;
    doc.content = document.getElementById('editor-page').innerHTML;
    doc.updatedAt = Date.now();
    saveDocs(docs);
    setSaveStatus('Saved');
  }

  const page = document.getElementById('editor-page');
  page.addEventListener('input', scheduleSave);
  window.addEventListener('beforeunload', () => flushSave(true));

  /* ---------------- formatting toolbar ---------------- */
  function exec(cmd, val) {
    page.focus();
    document.execCommand(cmd, false, val || null);
    scheduleSave();
  }

  document.getElementById('toolbar').addEventListener('click', (e) => {
    const cmdBtn = e.target.closest('[data-cmd]');
    if (cmdBtn) { exec(cmdBtn.dataset.cmd); return; }
    const openBtn = e.target.closest('[data-open]');
    if (openBtn) {
      const sheet = document.getElementById('sheet-' + openBtn.dataset.open);
      if (sheet) openSheet(sheet);
    }
  });

  document.getElementById('sheet-align').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) { exec(b.dataset.cmd); closeSheet(document.getElementById('sheet-align')); }
  });
  document.getElementById('sheet-indent').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) { exec(b.dataset.cmd); closeSheet(document.getElementById('sheet-indent')); }
  });
  document.getElementById('sheet-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd],[data-action]');
    if (!b) return;
    if (b.dataset.cmd) exec(b.dataset.cmd);
    if (b.dataset.action === 'checklist') insertChecklistItem();
    closeSheet(document.getElementById('sheet-list'));
  });
  document.getElementById('sheet-headings').addEventListener('click', (e) => {
    const b = e.target.closest('[data-block]');
    if (b) { exec('formatBlock', '<' + b.dataset.block + '>'); closeSheet(document.getElementById('sheet-headings')); }
  });

  function insertChecklistItem() {
    page.focus();
    document.execCommand('insertHTML', false,
      '<ul class="checklist"><li class="checklist-item"><input type="checkbox"><span contenteditable="true">To-do</span></li></ul>');
    scheduleSave();
  }

  // toggle checked state / strike text on checklist click
  page.addEventListener('click', (e) => {
    if (e.target.matches('.checklist-item input[type="checkbox"]')) {
      const li = e.target.closest('.checklist-item');
      li.classList.toggle('is-done', e.target.checked);
      scheduleSave();
    }
  });

  /* ---------------- font family / size ---------------- */
  document.getElementById('font-family-select').addEventListener('change', (e) => {
    exec('fontName', e.target.value);
  });
  document.getElementById('font-size-select').addEventListener('change', (e) => {
    exec('fontSize', e.target.value);
  });
  document.getElementById('btn-undo').addEventListener('click', () => exec('undo'));
  document.getElementById('btn-redo').addEventListener('click', () => exec('redo'));

  /* ---------------- color / highlight ---------------- */
  const TEXT_COLORS = ['#16130F', '#D53F3F', '#E8447A', '#5B21B6', '#1D4ED8', '#0EA968', '#B45309', '#746C60'];
  const HILITE_COLORS = ['#FFF3C4', '#DFF6EC', '#FCE3EC', '#EFE6FB', '#DDEBFF', '#FBE4E4', 'transparent'];
  function buildSwatches(container, colors, cmd) {
    container.innerHTML = '';
    colors.forEach(c => {
      const b = document.createElement('button');
      b.className = 'color-swatch';
      b.style.background = c === 'transparent' ? '#fff' : c;
      if (c === 'transparent') b.textContent = '✕';
      b.addEventListener('click', () => {
        exec(cmd, c === 'transparent' ? 'inherit' : c);
        closeSheet(document.getElementById('sheet-color'));
      });
      container.appendChild(b);
    });
  }
  buildSwatches(document.getElementById('text-color-row'), TEXT_COLORS, 'foreColor');
  buildSwatches(document.getElementById('highlight-color-row'), HILITE_COLORS, 'hiliteColor');

  /* ---------------- insert: image / link / hr / page break ---------------- */
  document.getElementById('btn-insert-image').addEventListener('click', () => {
    document.getElementById('image-file-input').click();
  });
  document.getElementById('image-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      exec('insertImage', reader.result);
      closeSheet(document.getElementById('sheet-insert'));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });
  document.getElementById('btn-insert-link').addEventListener('click', () => {
    const url = prompt('Link URL (https://…)');
    if (url) exec('createLink', url);
    closeSheet(document.getElementById('sheet-insert'));
  });
  document.getElementById('btn-insert-hr').addEventListener('click', () => {
    exec('insertHorizontalRule');
    closeSheet(document.getElementById('sheet-insert'));
  });
  document.getElementById('btn-insert-pagebreak').addEventListener('click', () => {
    document.execCommand('insertHTML', false, '<div class="page-break"></div>');
    scheduleSave();
    closeSheet(document.getElementById('sheet-insert'));
  });

  /* ---------------- table insert ---------------- */
  const tablePicker = document.getElementById('table-picker');
  const tablePickerLabel = document.getElementById('table-picker-label');
  const TABLE_COLS = 8, TABLE_ROWS = 6;
  let pendingRows = 3, pendingCols = 3;
  (function buildTablePicker() {
    for (let r = 0; r < TABLE_ROWS; r++) {
      for (let c = 0; c < TABLE_COLS; c++) {
        const cell = document.createElement('div');
        cell.className = 'table-picker-cell';
        cell.dataset.r = r + 1;
        cell.dataset.c = c + 1;
        tablePicker.appendChild(cell);
      }
    }
  })();
  tablePicker.addEventListener('pointerover', (e) => {
    const cell = e.target.closest('.table-picker-cell');
    if (!cell) return;
    highlightTablePicker(+cell.dataset.r, +cell.dataset.c);
  });
  tablePicker.addEventListener('click', (e) => {
    const cell = e.target.closest('.table-picker-cell');
    if (!cell) return;
    insertTable(+cell.dataset.r, +cell.dataset.c);
    closeSheet(document.getElementById('sheet-table'));
  });
  function highlightTablePicker(r, c) {
    pendingRows = r; pendingCols = c;
    tablePickerLabel.textContent = `${r} × ${c} table`;
    tablePicker.querySelectorAll('.table-picker-cell').forEach(cell => {
      cell.classList.toggle('is-active', +cell.dataset.r <= r && +cell.dataset.c <= c);
    });
  }
  highlightTablePicker(3, 3);
  function insertTable(rows, cols) {
    let html = '<table>';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) html += '<td>&nbsp;</td>';
      html += '</tr>';
    }
    html += '</table><p><br></p>';
    page.focus();
    document.execCommand('insertHTML', false, html);
    scheduleSave();
  }

  /* ---------------- find & replace ---------------- */
  document.getElementById('btn-find-next').addEventListener('click', () => {
    const term = document.getElementById('find-input').value;
    const status = document.getElementById('find-status');
    if (!term) return;
    const found = window.find ? window.find(term) : false;
    status.textContent = found ? 'Found a match' : 'No more matches — starting over';
    if (!found) {
      window.getSelection().removeAllRanges();
      window.find && window.find(term);
    }
  });
  document.getElementById('btn-replace-all').addEventListener('click', () => {
    const term = document.getElementById('find-input').value;
    const repl = document.getElementById('replace-input').value;
    const status = document.getElementById('find-status');
    if (!term) return;
    const html = page.innerHTML;
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const count = (plainTextFull(html).match(re) || []).length;
    page.innerHTML = replaceInTextNodes(page, term, repl);
    scheduleSave();
    status.textContent = `Replaced ${count} occurrence${count === 1 ? '' : 's'}`;
  });
  function replaceInTextNodes(root, term, repl) {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(node => { node.nodeValue = node.nodeValue.replace(re, repl); });
    return root.innerHTML;
  }

  /* ---------------- word count sheet (quick toast) ---------------- */
  document.getElementById('btn-wordcount').addEventListener('click', () => {
    const text = plainTextFull(page.innerHTML);
    const words = (text.trim().match(/\S+/g) || []).length;
    const chars = text.length;
    toast(`${words} words · ${chars} characters`);
  });

  /* ---------------- document menu: export / duplicate / delete ---------------- */
  document.getElementById('btn-menu').addEventListener('click', () => openSheet(document.getElementById('sheet-menu')));

  document.getElementById('btn-export-pdf').addEventListener('click', () => {
    closeSheet(document.getElementById('sheet-menu'));
    flushSave(true);
    setTimeout(() => window.print(), 200);
  });
  document.getElementById('btn-export-docx').addEventListener('click', () => {
    const doc = getCurrentDoc();
    if (!doc) return;
    flushSave(true);
    JotlyDocx.exportDocx(doc.title || 'Untitled document', page.innerHTML);
    closeSheet(document.getElementById('sheet-menu'));
  });
  document.getElementById('btn-export-txt').addEventListener('click', () => {
    const doc = getCurrentDoc();
    if (!doc) return;
    flushSave(true);
    const text = plainTextFull(page.innerHTML);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (doc.title || 'Untitled') + '.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    closeSheet(document.getElementById('sheet-menu'));
  });
  document.getElementById('btn-duplicate-doc').addEventListener('click', () => {
    const doc = getCurrentDoc();
    if (!doc) return;
    flushSave(true);
    const copy = Object.assign({}, doc, {
      id: uid(),
      title: (doc.title || 'Untitled') + ' copy',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    docs.push(copy);
    saveDocs(docs);
    closeSheet(document.getElementById('sheet-menu'));
    toast('Duplicated');
    showEditor(copy.id);
  });
  document.getElementById('btn-delete-doc').addEventListener('click', () => {
    const doc = getCurrentDoc();
    if (!doc) return;
    doc.trashed = true;
    doc.updatedAt = Date.now();
    saveDocs(docs);
    closeSheet(document.getElementById('sheet-menu'));
    toast('Moved to trash');
    showHome();
  });

  /* ---------------- trash ---------------- */
  document.getElementById('btn-open-trash').addEventListener('click', () => {
    const trashed = docs.filter(d => d.trashed);
    if (!trashed.length) { toast('Trash is empty'); return; }
    const names = trashed.map(d => `• ${d.title || 'Untitled'}`).join('\n');
    if (confirm(`Trash (${trashed.length}):\n${names}\n\nRestore all trashed items?`)) {
      trashed.forEach(d => { d.trashed = false; });
      saveDocs(docs);
      renderHome();
      toast('Restored');
    }
  });

  /* ---------------- toolbar active-state sync ---------------- */
  document.addEventListener('selectionchange', () => {
    if (screenEditor.classList.contains('hidden')) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !page.contains(sel.anchorNode)) return;
    ['bold', 'italic', 'underline', 'strikeThrough'].forEach(cmd => {
      const btn = document.querySelector(`.tb-btn[data-cmd="${cmd}"]`);
      if (!btn) return;
      let active = false;
      try { active = document.queryCommandState(cmd); } catch (e) {}
      btn.classList.toggle('is-active', active);
    });
  });

  /* ---------------- expose a small API for design.js ---------------- */
  window.JotlyApp = {
    showHome,
    reloadDocs: function () { docs = loadDocs(); renderHome(); },
  };

  /* ---------------- init ---------------- */
  renderHome();
  showHome();

  /* ---------------- service worker ---------------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
