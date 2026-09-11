/* Jotly — app.js
   One document type: a Word-style page (or a flexible note/checklist)
   with an optional floating-objects layer for shapes, text boxes and
   pictures — like Word's Insert > Shapes / Text Box, with a bit of
   Affinity/InDesign-style fill, gradient, and blend-mode control.
   All state lives in localStorage under 'jotly.docs.v1'.
*/
(() => {
  'use strict';

  /* =========================================================
     Storage
  ========================================================= */
  const STORAGE_KEY = 'jotly.docs.v1';
  function loadDocs() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveDocs(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
  function uid() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function elId() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  let docs = loadDocs();
  let currentDocId = null;
  let activeFilter = 'all';
  let saveTimer = null;

  /* =========================================================
     Units & page presets
  ========================================================= */
  const MM_PER_PX = 25.4 / 96;
  function pxPerUnit(unit) { return unit === 'mm' ? 96 / 25.4 : unit === 'in' ? 96 : 1; }

  const PRESETS = [
    { key: 'a4', label: 'A4', w: 210, h: 297, unit: 'mm' },
    { key: 'a3', label: 'A3', w: 297, h: 420, unit: 'mm' },
    { key: 'a5', label: 'A5', w: 148, h: 210, unit: 'mm' },
    { key: 'letter', label: 'US Letter', w: 215.9, h: 279.4, unit: 'mm' },
    { key: 'legal', label: 'US Legal', w: 215.9, h: 355.6, unit: 'mm' },
    { key: 'square', label: 'Square post', w: 1080, h: 1080, unit: 'px' },
    { key: 'igstory', label: 'Story / Reel', w: 1080, h: 1920, unit: 'px' },
    { key: 'bizcard', label: 'Business card', w: 89, h: 51, unit: 'mm' },
    { key: 'custom', label: 'Custom size', w: null, h: null, unit: null },
  ];
  const FILL_COLORS = ['#FFC900', '#5B21B6', '#0EA968', '#E8447A', '#D53F3F', '#1D4ED8', '#16130F', '#FFFFFF'];

  /* =========================================================
     Generic helpers
  ========================================================= */
  function plainTextPreview(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    return (div.textContent || '').trim().slice(0, 160);
  }
  function plainTextFull(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    return div.textContent || '';
  }
  function wordCount(html) {
    const m = plainTextFull(html).trim().match(/\S+/g);
    return m ? m.length : 0;
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
  function escapeHtml(s) {
    return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 1800);
  }

  /* =========================================================
     Screens
  ========================================================= */
  const screenHome = document.getElementById('screen-home');
  const screenEditor = document.getElementById('screen-editor');

  function showHome() {
    screenEditor.classList.add('hidden');
    screenHome.classList.remove('hidden');
    currentDocId = null;
    deselectObject();
    renderHome();
  }
  function openDoc(id) {
    currentDocId = id;
    const doc = docs.find(d => d.id === id);
    if (!doc) return showHome();
    screenHome.classList.add('hidden');
    screenEditor.classList.remove('hidden');
    document.getElementById('doc-title').value = doc.title || '';
    updateStarButton(doc);
    setSaveStatus('Saved');
    setupPageUI(doc);
    setupBands(doc);
    const page = document.getElementById('editor-page');
    page.innerHTML = doc.content || '';
    page.setAttribute('data-placeholder', doc.kind === 'note' ? 'Start typing your note…' : 'Start writing…');
    deselectObject();
    renderObjects();
    requestAnimationFrame(() => fitZoomToScreen(doc));
  }
  function getCurrentDoc() { return docs.find(d => d.id === currentDocId); }

  /* =========================================================
     Home rendering
  ========================================================= */
  const docGrid = document.getElementById('doc-grid');
  const emptyState = document.getElementById('empty-state');
  const CARD_COLORS = ['#FFC900', '#5B21B6', '#0EA968', '#E8447A'];

  function renderHome() {
    const query = document.getElementById('search-input').value.trim().toLowerCase();
    let list = docs.filter(d => !d.trashed);
    if (activeFilter === 'docs') list = list.filter(d => d.kind === 'doc');
    if (activeFilter === 'notes') list = list.filter(d => d.kind === 'note' || d.kind === 'checklist');
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
      const kindLabel = d.kind === 'note' ? 'Note' : d.kind === 'checklist' ? 'Checklist' : (d.page ? d.page.presetLabel + ' · ' + d.page.orientation : 'Document');
      const objCount = (d.elements && d.elements.length) ? ` · ${d.elements.length} objects` : '';
      card.innerHTML = `
        <div class="doc-card-top">
          <span class="doc-kind">${kindLabel}</span>
          <span class="doc-star" data-star="${d.id}">${d.starred ? '★' : '☆'}</span>
        </div>
        <h3>${escapeHtml(d.title || 'Untitled')}</h3>
        <p class="doc-preview">${escapeHtml(plainTextPreview(d.content)) || 'Empty — tap to start writing'}</p>
        <div class="doc-meta"><span>${timeAgo(d.updatedAt)}</span><span>${wordCount(d.content)} words${objCount}</span></div>
      `;
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-star]')) return;
        openDoc(d.id);
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

  document.getElementById('search-input').addEventListener('input', renderHome);
  document.getElementById('filter-row').addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    activeFilter = chip.dataset.filter;
    renderHome();
  });

  /* =========================================================
     Sheet plumbing (shared)
  ========================================================= */
  function openSheet(sheetEl) { sheetEl.classList.remove('hidden'); }
  function closeSheet(sheetEl) { sheetEl.classList.add('hidden'); }
  document.querySelectorAll('.sheet').forEach(sheet => {
    sheet.addEventListener('click', (e) => {
      if (e.target.hasAttribute('data-close-sheet')) closeSheet(sheet);
    });
  });

  /* =========================================================
     New document sheet + page preset sheet
  ========================================================= */
  const newSheet = document.getElementById('new-sheet');
  document.getElementById('btn-new').addEventListener('click', () => openSheet(newSheet));

  newSheet.querySelectorAll('[data-new]').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.new;
      closeSheet(newSheet);
      if (kind === 'doc') { openPresetSheet(); return; }
      const doc = {
        id: uid(), title: '', kind,
        content: kind === 'checklist' ? '<ul class="checklist"><li class="checklist-item"><input type="checkbox"><span contenteditable="true">To-do</span></li></ul>' : '',
        elements: [], page: null,
        starred: false, trashed: false,
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      docs.push(doc);
      saveDocs(docs);
      openDoc(doc.id);
      setTimeout(() => document.getElementById('doc-title').focus(), 150);
    });
  });

  const sheetPreset = document.getElementById('sheet-preset');
  const presetGrid = document.getElementById('preset-grid');
  const customRow = document.getElementById('custom-size-row');
  let selectedPreset = PRESETS[0];
  let presetOrientation = 'portrait';
  let presetHasHF = true;

  function buildPresetGrid() {
    presetGrid.innerHTML = '';
    PRESETS.forEach(p => {
      const b = document.createElement('button');
      b.className = 'style-opt preset-btn' + (p.key === selectedPreset.key ? ' is-active' : '');
      b.innerHTML = p.key === 'custom'
        ? `<strong>Custom size</strong><small>Set your own W × H</small>`
        : `<strong>${p.label}</strong><small>${p.w} × ${p.h} ${p.unit}</small>`;
      b.addEventListener('click', () => {
        selectedPreset = p;
        presetGrid.querySelectorAll('.preset-btn').forEach(x => x.classList.remove('is-active'));
        b.classList.add('is-active');
        customRow.classList.toggle('hidden', p.key !== 'custom');
      });
      presetGrid.appendChild(b);
    });
  }
  buildPresetGrid();

  document.getElementById('orientation-row').addEventListener('click', (e) => {
    const b = e.target.closest('[data-orientation]');
    if (!b) return;
    presetOrientation = b.dataset.orientation;
    document.querySelectorAll('#orientation-row .row-opt').forEach(x => x.classList.remove('is-active'));
    b.classList.add('is-active');
  });
  document.getElementById('headerfooter-row').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hf]');
    if (!b) return;
    presetHasHF = b.dataset.hf === 'yes';
    document.querySelectorAll('#headerfooter-row .row-opt').forEach(x => x.classList.remove('is-active'));
    b.classList.add('is-active');
  });

  function openPresetSheet() { openSheet(sheetPreset); }

  document.getElementById('btn-preset-confirm').addEventListener('click', () => {
    let w, h, unit;
    if (selectedPreset.key === 'custom') {
      w = parseFloat(document.getElementById('custom-width').value) || 210;
      h = parseFloat(document.getElementById('custom-height').value) || 297;
      unit = document.getElementById('custom-unit').value;
    } else {
      w = selectedPreset.w; h = selectedPreset.h; unit = selectedPreset.unit;
    }
    if (presetOrientation === 'landscape' && h > w) { const t = w; w = h; h = t; }
    if (presetOrientation === 'portrait' && w > h) { const t = w; w = h; h = t; }

    const ppu = pxPerUnit(unit);
    const widthPx = Math.round(w * ppu);
    const heightPx = Math.round(h * ppu);
    const hfHeight = Math.min(90, Math.max(40, Math.round(heightPx * 0.07)));

    const doc = {
      id: uid(), title: '', kind: 'doc',
      content: '', elements: [],
      page: {
        widthPx, heightPx, unit, orientation: presetOrientation,
        presetLabel: selectedPreset.key === 'custom' ? `${w}×${h}${unit}` : selectedPreset.label,
      },
      header: { enabled: presetHasHF, heightPx: hfHeight, content: '' },
      footer: { enabled: presetHasHF, heightPx: hfHeight, content: '' },
      starred: false, trashed: false,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    docs.push(doc);
    saveDocs(docs);
    closeSheet(sheetPreset);
    openDoc(doc.id);
  });

  /* =========================================================
     Editor: back / title / star
  ========================================================= */
  document.getElementById('btn-back').addEventListener('click', () => { flushSave(); showHome(); });
  document.getElementById('doc-title').addEventListener('input', scheduleSave);
  document.getElementById('btn-star').addEventListener('click', () => {
    const doc = getCurrentDoc(); if (!doc) return;
    doc.starred = !doc.starred;
    saveDocs(docs);
    updateStarButton(doc);
  });
  function updateStarButton(doc) { document.getElementById('btn-star').textContent = doc.starred ? '★' : '☆'; }

  /* =========================================================
     Autosave
  ========================================================= */
  function setSaveStatus(text) { document.getElementById('save-status').textContent = text; }
  function scheduleSave() {
    setSaveStatus('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 500);
  }
  function flushSave() {
    const doc = getCurrentDoc();
    if (!doc) return;
    doc.title = document.getElementById('doc-title').value;
    doc.content = document.getElementById('editor-page').innerHTML;
    if (doc.header) doc.header.content = document.getElementById('editor-header-band').innerHTML;
    if (doc.footer) doc.footer.content = document.getElementById('editor-footer-band').innerHTML;
    doc.updatedAt = Date.now();
    saveDocs(docs);
    setSaveStatus('Saved');
  }
  window.addEventListener('beforeunload', flushSave);

  const page = document.getElementById('editor-page');
  page.addEventListener('input', scheduleSave);
  document.getElementById('editor-header-band').addEventListener('input', scheduleSave);
  document.getElementById('editor-footer-band').addEventListener('input', scheduleSave);

  /* =========================================================
     Page / header / footer / rulers / zoom setup
  ========================================================= */
  const editorFrame = document.getElementById('editor-frame');
  const editorScroll = document.getElementById('editor-scroll');
  const pageWrap = document.getElementById('editor-page-wrap');
  const rulerH = document.getElementById('ruler-h');
  const rulerV = document.getElementById('ruler-v');
  const rulerCorner = document.getElementById('ruler-corner');
  let currentZoom = 1;
  let rulersOn = true;

  function togglePageOnlyUI(hasPage) {
    document.querySelectorAll('.insert-page-only').forEach(el => el.classList.toggle('hidden', !hasPage));
    document.getElementById('insert-page-only-divider').classList.toggle('hidden', !hasPage);
    document.getElementById('zoom-sep').classList.toggle('hidden', !hasPage);
    document.getElementById('btn-zoom-in').classList.toggle('hidden', !hasPage);
    document.getElementById('btn-zoom-out').classList.toggle('hidden', !hasPage);
    document.getElementById('zoom-label').classList.toggle('hidden', !hasPage);
    pageWrap.classList.toggle('has-rulers', hasPage && rulersOn);
  }

  function setupPageUI(doc) {
    const hasPage = !!doc.page;
    togglePageOnlyUI(hasPage);
    if (hasPage) {
      editorFrame.style.width = doc.page.widthPx + 'px';
      editorFrame.classList.add('is-page');
      document.getElementById('page-setup-size-label').textContent =
        `${doc.page.presetLabel} · ${doc.page.orientation === 'landscape' ? 'Landscape' : 'Portrait'}`;
    } else {
      editorFrame.style.width = '';
      editorFrame.classList.remove('is-page');
    }
    currentZoom = 1;
    document.getElementById('zoom-label').textContent = '100%';
    editorFrame.style.zoom = 1;
  }

  function setupBands(doc) {
    const headerBand = document.getElementById('editor-header-band');
    const footerBand = document.getElementById('editor-footer-band');
    const hasHeader = !!(doc.page && doc.header && doc.header.enabled);
    const hasFooter = !!(doc.page && doc.footer && doc.footer.enabled);
    headerBand.classList.toggle('hidden', !hasHeader);
    footerBand.classList.toggle('hidden', !hasFooter);
    headerBand.innerHTML = (doc.header && doc.header.content) || '';
    footerBand.innerHTML = (doc.footer && doc.footer.content) || '';
    if (doc.header) headerBand.style.minHeight = doc.header.heightPx + 'px';
    if (doc.footer) footerBand.style.minHeight = doc.footer.heightPx + 'px';
  }

  function fitZoomToScreen(doc) {
    if (!doc.page) { drawRulers(); return; }
    const containerW = editorScroll.clientWidth - 48;
    const fit = Math.max(0.2, Math.min(1.5, containerW / doc.page.widthPx));
    setZoom(Math.round(fit * 100) / 100);
  }
  function setZoom(z) {
    currentZoom = Math.max(0.2, Math.min(3, z));
    editorFrame.style.zoom = currentZoom;
    document.getElementById('zoom-label').textContent = Math.round(currentZoom * 100) + '%';
    drawRulers();
  }
  document.getElementById('btn-zoom-in').addEventListener('click', () => setZoom(currentZoom + 0.1));
  document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(currentZoom - 0.1));

  function drawRulers() {
    const doc = getCurrentDoc();
    if (!doc || !doc.page || !rulersOn) return;
    const dpr = window.devicePixelRatio || 1;
    rulerH.width = rulerH.clientWidth * dpr; rulerH.height = rulerH.clientHeight * dpr;
    rulerV.width = rulerV.clientWidth * dpr; rulerV.height = rulerV.clientHeight * dpr;
    const unit = doc.page.unit;
    const ppu = pxPerUnit(unit) * currentZoom;
    const major = unit === 'in' ? 1 : unit === 'mm' ? 10 : 100;
    const minor = major / 5;
    const padding = 24;
    const scrollLeft = editorScroll.scrollLeft, scrollTop = editorScroll.scrollTop;

    const hctx = rulerH.getContext('2d');
    hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hctx.clearRect(0, 0, rulerH.clientWidth, rulerH.clientHeight);
    hctx.fillStyle = '#746C60'; hctx.font = '9px Inter, sans-serif'; hctx.strokeStyle = '#C9C2B2';
    for (let v = 0; ; v += minor) {
      const x = padding + v * ppu - scrollLeft;
      if (x > rulerH.clientWidth) break;
      if (x < 0) continue;
      const isMajor = Math.round(v / minor) % 5 === 0;
      hctx.beginPath(); hctx.moveTo(x + 0.5, isMajor ? 6 : 14); hctx.lineTo(x + 0.5, 22); hctx.stroke();
      if (isMajor) hctx.fillText(String(Math.round(v)), x + 3, 12);
    }
    const vctx = rulerV.getContext('2d');
    vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vctx.clearRect(0, 0, rulerV.clientWidth, rulerV.clientHeight);
    vctx.fillStyle = '#746C60'; vctx.font = '9px Inter, sans-serif'; vctx.strokeStyle = '#C9C2B2';
    for (let v = 0; ; v += minor) {
      const y = padding + v * ppu - scrollTop;
      if (y > rulerV.clientHeight) break;
      if (y < 0) continue;
      const isMajor = Math.round(v / minor) % 5 === 0;
      vctx.beginPath(); vctx.moveTo(isMajor ? 6 : 14, y + 0.5); vctx.lineTo(22, y + 0.5); vctx.stroke();
      if (isMajor) { vctx.save(); vctx.translate(10, y + 3); vctx.rotate(-Math.PI / 2); vctx.fillText(String(Math.round(v)), 0, 0); vctx.restore(); }
    }
  }
  editorScroll.addEventListener('scroll', drawRulers);
  window.addEventListener('resize', drawRulers);

  document.getElementById('btn-toggle-rulers').addEventListener('click', () => {
    rulersOn = !rulersOn;
    const doc = getCurrentDoc();
    pageWrap.classList.toggle('has-rulers', !!(doc && doc.page) && rulersOn);
    if (rulersOn) drawRulers();
  });

  /* Page setup sheet: header/footer on/off */
  document.getElementById('btn-page-setup').addEventListener('click', () => {
    closeSheet(document.getElementById('sheet-menu'));
    openSheet(document.getElementById('sheet-page-setup'));
  });
  document.getElementById('sheet-page-setup').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hf-toggle]');
    if (!b) return;
    const doc = getCurrentDoc(); if (!doc) return;
    const val = b.dataset.hfToggle;
    if (val === 'header-on') doc.header.enabled = true;
    if (val === 'header-off') doc.header.enabled = false;
    if (val === 'footer-on') doc.footer.enabled = true;
    if (val === 'footer-off') doc.footer.enabled = false;
    setupBands(doc);
    scheduleSave();
  });

  /* =========================================================
     Text formatting toolbar
  ========================================================= */
  function exec(cmd, val) { page.focus(); document.execCommand(cmd, false, val || null); scheduleSave(); }

  document.getElementById('toolbar-text').addEventListener('click', (e) => {
    const cmdBtn = e.target.closest('[data-cmd]');
    if (cmdBtn) { exec(cmdBtn.dataset.cmd); return; }
    const openBtn = e.target.closest('[data-open]');
    if (openBtn) { const sheet = document.getElementById('sheet-' + openBtn.dataset.open); if (sheet) openSheet(sheet); }
  });
  document.getElementById('sheet-align').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]'); if (b) { exec(b.dataset.cmd); closeSheet(document.getElementById('sheet-align')); }
  });
  document.getElementById('sheet-indent').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]'); if (b) { exec(b.dataset.cmd); closeSheet(document.getElementById('sheet-indent')); }
  });
  document.getElementById('sheet-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd],[data-action]'); if (!b) return;
    if (b.dataset.cmd) exec(b.dataset.cmd);
    if (b.dataset.action === 'checklist') insertChecklistItem();
    closeSheet(document.getElementById('sheet-list'));
  });
  document.getElementById('sheet-headings').addEventListener('click', (e) => {
    const b = e.target.closest('[data-block]'); if (b) { exec('formatBlock', '<' + b.dataset.block + '>'); closeSheet(document.getElementById('sheet-headings')); }
  });
  function insertChecklistItem() {
    page.focus();
    document.execCommand('insertHTML', false, '<ul class="checklist"><li class="checklist-item"><input type="checkbox"><span contenteditable="true">To-do</span></li></ul>');
    scheduleSave();
  }
  page.addEventListener('click', (e) => {
    if (e.target.matches('.checklist-item input[type="checkbox"]')) {
      e.target.closest('.checklist-item').classList.toggle('is-done', e.target.checked);
      scheduleSave();
    }
  });
  document.getElementById('font-family-select').addEventListener('change', (e) => exec('fontName', e.target.value));
  document.getElementById('font-size-select').addEventListener('change', (e) => exec('fontSize', e.target.value));
  document.getElementById('btn-undo').addEventListener('click', () => exec('undo'));
  document.getElementById('btn-redo').addEventListener('click', () => exec('redo'));

  const TEXT_COLORS = ['#16130F', '#D53F3F', '#E8447A', '#5B21B6', '#1D4ED8', '#0EA968', '#B45309', '#746C60'];
  const HILITE_COLORS = ['#FFF3C4', '#DFF6EC', '#FCE3EC', '#EFE6FB', '#DDEBFF', '#FBE4E4', 'transparent'];
  function buildSwatches(container, colors, onPick) {
    container.innerHTML = '';
    colors.forEach(c => {
      const b = document.createElement('button');
      b.className = 'color-swatch';
      b.style.background = c === 'transparent' ? '#fff' : c;
      if (c === 'transparent') b.textContent = '✕';
      b.addEventListener('click', () => onPick(c));
      container.appendChild(b);
    });
  }
  buildSwatches(document.getElementById('text-color-row'), TEXT_COLORS, (c) => { exec('foreColor', c); closeSheet(document.getElementById('sheet-color')); });
  buildSwatches(document.getElementById('highlight-color-row'), HILITE_COLORS, (c) => { exec('hiliteColor', c === 'transparent' ? 'inherit' : c); closeSheet(document.getElementById('sheet-color')); });

  /* Insert sheet: inline picture / link / hr / page break */
  document.getElementById('btn-insert-image').addEventListener('click', () => document.getElementById('image-file-input').click());
  document.getElementById('image-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { exec('insertImage', reader.result); closeSheet(document.getElementById('sheet-insert')); };
    reader.readAsDataURL(file);
    e.target.value = '';
  });
  document.getElementById('btn-insert-link').addEventListener('click', () => {
    const url = prompt('Link URL (https://…)');
    if (url) exec('createLink', url);
    closeSheet(document.getElementById('sheet-insert'));
  });
  document.getElementById('btn-insert-hr').addEventListener('click', () => { exec('insertHorizontalRule'); closeSheet(document.getElementById('sheet-insert')); });
  document.getElementById('btn-insert-pagebreak').addEventListener('click', () => {
    document.execCommand('insertHTML', false, '<div class="page-break"></div>');
    scheduleSave();
    closeSheet(document.getElementById('sheet-insert'));
  });

  /* Table insert */
  const tablePicker = document.getElementById('table-picker');
  const tablePickerLabel = document.getElementById('table-picker-label');
  const TABLE_COLS = 8, TABLE_ROWS = 6;
  (function buildTablePicker() {
    for (let r = 0; r < TABLE_ROWS; r++) for (let c = 0; c < TABLE_COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'table-picker-cell'; cell.dataset.r = r + 1; cell.dataset.c = c + 1;
      tablePicker.appendChild(cell);
    }
  })();
  function highlightTablePicker(r, c) {
    tablePickerLabel.textContent = `${r} × ${c} table`;
    tablePicker.querySelectorAll('.table-picker-cell').forEach(cell => {
      cell.classList.toggle('is-active', +cell.dataset.r <= r && +cell.dataset.c <= c);
    });
  }
  tablePicker.addEventListener('pointerover', (e) => { const cell = e.target.closest('.table-picker-cell'); if (cell) highlightTablePicker(+cell.dataset.r, +cell.dataset.c); });
  tablePicker.addEventListener('click', (e) => {
    const cell = e.target.closest('.table-picker-cell'); if (!cell) return;
    insertTable(+cell.dataset.r, +cell.dataset.c);
    closeSheet(document.getElementById('sheet-table'));
  });
  highlightTablePicker(3, 3);
  function insertTable(rows, cols) {
    let html = '<table>';
    for (let r = 0; r < rows; r++) { html += '<tr>'; for (let c = 0; c < cols; c++) html += '<td>&nbsp;</td>'; html += '</tr>'; }
    html += '</table><p><br></p>';
    page.focus();
    document.execCommand('insertHTML', false, html);
    scheduleSave();
  }

  /* Find & replace */
  document.getElementById('btn-find-next').addEventListener('click', () => {
    const term = document.getElementById('find-input').value;
    const status = document.getElementById('find-status');
    if (!term) return;
    const found = window.find ? window.find(term) : false;
    status.textContent = found ? 'Found a match' : 'No more matches — starting over';
    if (!found) { window.getSelection().removeAllRanges(); window.find && window.find(term); }
  });
  document.getElementById('btn-replace-all').addEventListener('click', () => {
    const term = document.getElementById('find-input').value;
    const repl = document.getElementById('replace-input').value;
    const status = document.getElementById('find-status');
    if (!term) return;
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const count = (plainTextFull(page.innerHTML).match(re) || []).length;
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    const nodes = []; let n; while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(node => { node.nodeValue = node.nodeValue.replace(re, repl); });
    scheduleSave();
    status.textContent = `Replaced ${count} occurrence${count === 1 ? '' : 's'}`;
  });
  document.getElementById('btn-wordcount').addEventListener('click', () => {
    const text = plainTextFull(page.innerHTML);
    const words = (text.trim().match(/\S+/g) || []).length;
    toast(`${words} words · ${text.length} characters`);
  });

  /* =========================================================
     Floating objects: shapes, text boxes, floating pictures
  ========================================================= */
  const objectsLayer = document.getElementById('objects-layer');
  const toolbarText = document.getElementById('toolbar-text');
  const toolbarObject = document.getElementById('toolbar-object');
  let selectedElId = null;

  function getObj(id) { const doc = getCurrentDoc(); return doc && doc.elements.find(e => e.id === id); }
  function nextZ() {
    const doc = getCurrentDoc();
    return doc.elements.length ? Math.max(...doc.elements.map(e => e.zIndex)) + 1 : 1;
  }

  function fillToCss(fill) {
    if (!fill || fill.type === 'none') return 'transparent';
    if (fill.type === 'gradient') return `linear-gradient(${fill.gradAngle || 90}deg, ${fill.gradFrom}, ${fill.gradTo})`;
    return fill.solid || 'transparent';
  }
  function applyObjStyle(obj) {
    const div = objectsLayer.querySelector(`[data-id="${obj.id}"]`);
    if (!div) return;
    div.style.left = obj.x + 'px'; div.style.top = obj.y + 'px';
    div.style.width = obj.w + 'px'; div.style.height = obj.h + 'px';
    div.style.zIndex = obj.zIndex;
    div.style.mixBlendMode = obj.blend || 'normal';
    div.style.opacity = (obj.opacity != null ? obj.opacity : 100) / 100;
    if (obj.type === 'text') {
      div.style.fontFamily = obj.fontFamily; div.style.fontSize = obj.fontSize + 'px';
      div.style.color = obj.color; div.style.textAlign = obj.align || 'left';
      div.style.background = fillToCss(obj.fill);
      div.style.borderRadius = (obj.radius || 0) + 'px';
      div.style.border = obj.strokeWidth ? `${obj.strokeWidth}px solid ${obj.strokeColor}` : 'none';
    } else if (obj.type === 'shape') {
      div.style.background = fillToCss(obj.fill);
      div.style.border = obj.strokeWidth ? `${obj.strokeWidth}px solid ${obj.strokeColor}` : 'none';
      div.style.borderRadius = obj.shapeType === 'ellipse' ? '50%' : (obj.radius || 0) + 'px';
      if (obj.shapeType === 'line') { div.style.background = obj.strokeColor || (obj.fill && obj.fill.solid) || '#16130F'; div.style.border = 'none'; }
    } else if (obj.type === 'image') {
      div.style.borderRadius = (obj.radius || 0) + 'px';
      div.style.border = obj.strokeWidth ? `${obj.strokeWidth}px solid ${obj.strokeColor}` : 'none';
    }
  }
  function renderObjects() {
    const doc = getCurrentDoc();
    objectsLayer.innerHTML = '';
    if (!doc) return;
    doc.elements.slice().sort((a, b) => a.zIndex - b.zIndex).forEach(obj => {
      const div = document.createElement('div');
      div.className = 'design-el'; div.dataset.id = obj.id; div.dataset.type = obj.type;
      if (obj.type === 'text') div.textContent = obj.text || '';
      if (obj.type === 'image') { const img = document.createElement('img'); img.src = obj.src; img.draggable = false; div.appendChild(img); }
      const handle = document.createElement('div'); handle.className = 'resize-handle'; div.appendChild(handle);
      if (obj.href) {
        const badge = document.createElement('a');
        badge.className = 'link-badge'; badge.href = obj.href; badge.target = '_blank'; badge.rel = 'noopener'; badge.title = obj.href; badge.textContent = '🔗';
        badge.addEventListener('pointerdown', ev => ev.stopPropagation());
        div.appendChild(badge);
      }
      objectsLayer.appendChild(div);
      applyObjStyle(obj);
    });
    updateSelectionClasses();
  }
  function updateSelectionClasses() {
    objectsLayer.querySelectorAll('.design-el').forEach(d => d.classList.toggle('is-selected', d.dataset.id === selectedElId));
  }
  function selectObject(id) {
    selectedElId = id;
    updateSelectionClasses();
    toolbarText.classList.toggle('hidden', !!id);
    toolbarObject.classList.toggle('hidden', !id);
  }
  function deselectObject() { selectObject(null); }

  function addTextBox() {
    const doc = getCurrentDoc(); if (!doc) return;
    const obj = {
      id: elId(), type: 'text', x: 40, y: 40, w: 220, h: 60,
      text: 'Double-tap to edit', fontFamily: "'Inter', sans-serif", fontSize: 20, color: '#16130F', align: 'left',
      fill: { type: 'none' }, blend: 'normal', opacity: 100, radius: 0, strokeWidth: 0, strokeColor: '#16130F',
      zIndex: nextZ(),
    };
    doc.elements.push(obj); renderObjects(); selectObject(obj.id); scheduleSave();
  }
  function addShape(shapeType) {
    const doc = getCurrentDoc(); if (!doc) return;
    const obj = {
      id: elId(), type: 'shape', shapeType,
      x: 60, y: 80, w: shapeType === 'line' ? 200 : 160, h: shapeType === 'line' ? 4 : 120,
      fill: { type: 'solid', solid: '#FFC900' }, blend: 'normal', opacity: 100,
      radius: shapeType === 'rect' ? 12 : 0, strokeWidth: 0, strokeColor: '#16130F',
      zIndex: nextZ(),
    };
    doc.elements.push(obj); renderObjects(); selectObject(obj.id); scheduleSave();
  }
  function addFloatingImage(dataUrl, naturalW, naturalH) {
    const doc = getCurrentDoc(); if (!doc) return;
    const maxW = Math.min((doc.page ? doc.page.widthPx : 400) * 0.6, 320);
    const ratio = naturalH / naturalW || 1;
    const obj = {
      id: elId(), type: 'image', x: 50, y: 50, w: maxW, h: Math.round(maxW * ratio),
      src: dataUrl, fill: { type: 'none' }, blend: 'normal', opacity: 100, radius: 0, strokeWidth: 0, strokeColor: '#16130F',
      zIndex: nextZ(),
    };
    doc.elements.push(obj); renderObjects(); selectObject(obj.id); scheduleSave();
  }

  document.getElementById('btn-insert-textbox').addEventListener('click', () => { addTextBox(); closeSheet(document.getElementById('sheet-insert')); });
  document.getElementById('btn-insert-shape').addEventListener('click', () => { closeSheet(document.getElementById('sheet-insert')); openSheet(document.getElementById('sheet-shape')); });
  document.getElementById('sheet-shape').addEventListener('click', (e) => {
    const b = e.target.closest('[data-shape]'); if (!b) return;
    addShape(b.dataset.shape); closeSheet(document.getElementById('sheet-shape'));
  });
  document.getElementById('btn-insert-floating-image').addEventListener('click', () => document.getElementById('floating-image-file-input').click());
  document.getElementById('floating-image-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => { addFloatingImage(reader.result, img.width, img.height); closeSheet(document.getElementById('sheet-insert')); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  /* drag / resize */
  let dragState = null;
  objectsLayer.addEventListener('pointerdown', (e) => {
    const div = e.target.closest('.design-el');
    if (!div) return;
    if (div.getAttribute('contenteditable') === 'true') return;
    selectObject(div.dataset.id);
    const obj = getObj(div.dataset.id);
    const handle = e.target.closest('.resize-handle');
    e.preventDefault();
    dragState = handle
      ? { mode: 'resize', id: obj.id, startX: e.clientX, startY: e.clientY, startW: obj.w, startH: obj.h }
      : { mode: 'move', id: obj.id, startX: e.clientX, startY: e.clientY, startXpos: obj.x, startYpos: obj.y };
    window.addEventListener('pointermove', onObjMove);
    window.addEventListener('pointerup', onObjUp);
  });
  function onObjMove(e) {
    if (!dragState) return;
    const obj = getObj(dragState.id); if (!obj) return;
    const dx = (e.clientX - dragState.startX) / currentZoom;
    const dy = (e.clientY - dragState.startY) / currentZoom;
    if (dragState.mode === 'move') { obj.x = Math.round(dragState.startXpos + dx); obj.y = Math.round(dragState.startYpos + dy); }
    else { obj.w = Math.max(16, Math.round(dragState.startW + dx)); obj.h = Math.max(16, Math.round(dragState.startH + dy)); }
    applyObjStyle(obj);
  }
  function onObjUp() {
    dragState = null;
    window.removeEventListener('pointermove', onObjMove);
    window.removeEventListener('pointerup', onObjUp);
    scheduleSave();
  }
  document.getElementById('editor-page').addEventListener('pointerdown', () => { if (selectedElId) deselectObject(); });

  /* text-box inline editing */
  objectsLayer.addEventListener('dblclick', (e) => {
    const div = e.target.closest('.design-el[data-type="text"]');
    if (!div) return;
    div.setAttribute('contenteditable', 'true'); div.focus();
    document.execCommand('selectAll', false, null);
  });
  objectsLayer.addEventListener('focusout', (e) => {
    const div = e.target.closest('.design-el[data-type="text"]');
    if (!div) return;
    div.setAttribute('contenteditable', 'false');
    const obj = getObj(div.dataset.id);
    if (obj) { obj.text = div.textContent; scheduleSave(); }
  });

  /* object toolbar: layer / duplicate / delete / style / done */
  document.getElementById('btn-obj-front').addEventListener('click', () => {
    const obj = getObj(selectedElId); if (!obj) return;
    obj.zIndex = nextZ(); renderObjects(); selectObject(obj.id); scheduleSave();
  });
  document.getElementById('btn-obj-back').addEventListener('click', () => {
    const obj = getObj(selectedElId); if (!obj) return;
    const doc = getCurrentDoc();
    const min = Math.min(...doc.elements.map(e => e.zIndex));
    obj.zIndex = min - 1; renderObjects(); selectObject(obj.id); scheduleSave();
  });
  document.getElementById('btn-obj-dup').addEventListener('click', () => {
    const obj = getObj(selectedElId); if (!obj) return;
    const doc = getCurrentDoc();
    const copy = JSON.parse(JSON.stringify(obj));
    copy.id = elId(); copy.x += 16; copy.y += 16; copy.zIndex = nextZ();
    doc.elements.push(copy); renderObjects(); selectObject(copy.id); scheduleSave();
  });
  document.getElementById('btn-obj-delete').addEventListener('click', () => {
    const doc = getCurrentDoc(); if (!doc || !selectedElId) return;
    doc.elements = doc.elements.filter(e => e.id !== selectedElId);
    deselectObject(); renderObjects(); scheduleSave();
  });
  document.getElementById('btn-obj-done').addEventListener('click', deselectObject);

  /* object properties sheet */
  const sheetProps = document.getElementById('sheet-obj-props');
  function buildSwatchRow(container, colors, onPick) {
    container.innerHTML = '';
    colors.forEach(c => { const b = document.createElement('button'); b.className = 'color-swatch'; b.style.background = c; b.addEventListener('click', () => onPick(c)); container.appendChild(b); });
  }
  buildSwatchRow(document.getElementById('props-font-color-row'), FILL_COLORS, (c) => { const o = getObj(selectedElId); if (!o) return; o.color = c; applyObjStyle(o); scheduleSave(); });
  buildSwatchRow(document.getElementById('props-fill-color-row'), FILL_COLORS, (c) => { const o = getObj(selectedElId); if (!o) return; o.fill = { type: 'solid', solid: c }; setFillTypeActive('solid'); applyObjStyle(o); scheduleSave(); });
  buildSwatchRow(document.getElementById('gradient-from-row'), FILL_COLORS, (c) => { const o = getObj(selectedElId); if (!o) return; o.fill.gradFrom = c; applyObjStyle(o); scheduleSave(); });
  buildSwatchRow(document.getElementById('gradient-to-row'), FILL_COLORS, (c) => { const o = getObj(selectedElId); if (!o) return; o.fill.gradTo = c; applyObjStyle(o); scheduleSave(); });
  buildSwatchRow(document.getElementById('props-stroke-color-row'), FILL_COLORS, (c) => { const o = getObj(selectedElId); if (!o) return; o.strokeColor = c; applyObjStyle(o); scheduleSave(); });

  function setFillTypeActive(type) {
    document.querySelectorAll('#fill-type-row .row-opt').forEach(b => b.classList.toggle('is-active', b.dataset.fillType === type));
    document.getElementById('gradient-controls').classList.toggle('hidden', type !== 'gradient');
  }
  document.getElementById('fill-type-row').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fill-type]'); if (!b) return;
    const o = getObj(selectedElId); if (!o) return;
    const type = b.dataset.fillType;
    if (type === 'gradient') o.fill = { type: 'gradient', gradFrom: (o.fill && o.fill.solid) || '#FFC900', gradTo: '#5B21B6', gradAngle: (o.fill && o.fill.gradAngle) || 90 };
    else if (type === 'none') o.fill = { type: 'none' };
    else o.fill = { type: 'solid', solid: (o.fill && (o.fill.solid || o.fill.gradFrom)) || '#FFC900' };
    setFillTypeActive(type); applyObjStyle(o); scheduleSave();
  });
  document.getElementById('gradient-angle').addEventListener('input', (e) => { const o = getObj(selectedElId); if (!o || o.fill.type !== 'gradient') return; o.fill.gradAngle = +e.target.value; applyObjStyle(o); });
  document.getElementById('gradient-angle').addEventListener('change', scheduleSave);
  document.getElementById('props-blend-mode').addEventListener('change', (e) => { const o = getObj(selectedElId); if (!o) return; o.blend = e.target.value; applyObjStyle(o); scheduleSave(); });
  document.getElementById('props-opacity').addEventListener('input', (e) => { const o = getObj(selectedElId); if (!o) return; o.opacity = +e.target.value; applyObjStyle(o); });
  document.getElementById('props-opacity').addEventListener('change', scheduleSave);
  document.getElementById('props-radius').addEventListener('input', (e) => { const o = getObj(selectedElId); if (!o) return; o.radius = +e.target.value; applyObjStyle(o); });
  document.getElementById('props-radius').addEventListener('change', scheduleSave);
  document.getElementById('props-stroke-width').addEventListener('input', (e) => { const o = getObj(selectedElId); if (!o) return; o.strokeWidth = +e.target.value; applyObjStyle(o); });
  document.getElementById('props-stroke-width').addEventListener('change', scheduleSave);
  document.getElementById('props-font-family').addEventListener('change', (e) => { const o = getObj(selectedElId); if (!o) return; o.fontFamily = e.target.value; applyObjStyle(o); scheduleSave(); });
  document.getElementById('props-font-size').addEventListener('change', (e) => { const o = getObj(selectedElId); if (!o) return; o.fontSize = +e.target.value; applyObjStyle(o); scheduleSave(); });
  document.getElementById('props-text-group-align').querySelectorAll('[data-align]').forEach(b => {
    b.addEventListener('click', () => { const o = getObj(selectedElId); if (!o) return; o.align = b.dataset.align; applyObjStyle(o); scheduleSave(); });
  });
  document.getElementById('props-link').addEventListener('change', (e) => {
    const o = getObj(selectedElId); if (!o) return;
    o.href = e.target.value.trim(); renderObjects(); selectObject(o.id); scheduleSave();
  });
  document.getElementById('btn-obj-style').addEventListener('click', () => {
    const o = getObj(selectedElId); if (!o) { toast('Tap an object on the page first'); return; }
    document.getElementById('props-title').textContent = o.type === 'text' ? 'Text box style' : o.type === 'image' ? 'Picture style' : 'Shape style';
    document.getElementById('props-link').value = o.href || '';
    document.getElementById('props-text-group').classList.toggle('hidden', o.type !== 'text');
    document.getElementById('props-shape-group').classList.toggle('hidden', o.type === 'text');
    setFillTypeActive(o.fill ? o.fill.type : 'solid');
    document.getElementById('props-blend-mode').value = o.blend || 'normal';
    document.getElementById('props-opacity').value = o.opacity != null ? o.opacity : 100;
    document.getElementById('props-radius').value = o.radius || 0;
    document.getElementById('props-stroke-width').value = o.strokeWidth || 0;
    if (o.fill && o.fill.type === 'gradient') document.getElementById('gradient-angle').value = o.fill.gradAngle || 90;
    if (o.type === 'text') { document.getElementById('props-font-family').value = o.fontFamily; document.getElementById('props-font-size').value = String(o.fontSize); }
    openSheet(sheetProps);
  });

  /* =========================================================
     Document menu: page setup / export / duplicate / delete
  ========================================================= */
  document.getElementById('btn-menu').addEventListener('click', () => openSheet(document.getElementById('sheet-menu')));

  document.getElementById('btn-export-pdf').addEventListener('click', () => {
    closeSheet(document.getElementById('sheet-menu'));
    flushSave();
    const doc = getCurrentDoc();
    let styleTag = document.getElementById('print-page-size');
    if (!styleTag) { styleTag = document.createElement('style'); styleTag.id = 'print-page-size'; document.head.appendChild(styleTag); }
    if (doc && doc.page) {
      const wMM = (doc.page.widthPx * MM_PER_PX).toFixed(1);
      const hMM = (doc.page.heightPx * MM_PER_PX).toFixed(1);
      styleTag.textContent = `@page { size: ${wMM}mm ${hMM}mm; margin: 0; }`;
    } else {
      styleTag.textContent = '';
    }
    const prevZoom = currentZoom;
    if (doc && doc.page) editorFrame.style.zoom = 1;
    setTimeout(() => { window.print(); if (doc && doc.page) editorFrame.style.zoom = prevZoom; }, 150);
  });
  document.getElementById('btn-export-docx').addEventListener('click', () => {
    const doc = getCurrentDoc(); if (!doc) return;
    flushSave();
    JotlyDocx.exportDocx(doc.title || 'Untitled document', page.innerHTML);
    closeSheet(document.getElementById('sheet-menu'));
  });
  document.getElementById('btn-export-txt').addEventListener('click', () => {
    const doc = getCurrentDoc(); if (!doc) return;
    flushSave();
    const text = plainTextFull(page.innerHTML);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = (doc.title || 'Untitled') + '.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    closeSheet(document.getElementById('sheet-menu'));
  });
  document.getElementById('btn-export-png').addEventListener('click', () => {
    closeSheet(document.getElementById('sheet-menu'));
    flushSave();
    exportPng();
  });
  function exportPng() {
    const doc = getCurrentDoc(); if (!doc || !doc.page) return;
    const clone = editorFrame.cloneNode(true);
    clone.removeAttribute('id'); clone.style.zoom = 1;
    clone.querySelectorAll('.resize-handle, .link-badge').forEach(h => h.remove());
    clone.querySelectorAll('.design-el').forEach(el => { el.classList.remove('is-selected'); el.removeAttribute('contenteditable'); });
    const w = doc.page.widthPx;
    const h = Math.max(editorFrame.scrollHeight, doc.page.heightPx);
    const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<foreignObject width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;background:#fff;font-family:Inter,sans-serif;">` +
      clone.outerHTML + `</div></foreignObject></svg>`;
    const url = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      try {
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (doc.title || 'document') + '.png'; a.click(); });
      } catch (err) { toast('PNG export isn\u2019t supported in this browser — try PDF instead'); }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { toast('PNG export failed — try PDF instead'); URL.revokeObjectURL(url); };
    img.src = url;
  }
  document.getElementById('btn-duplicate-doc').addEventListener('click', () => {
    const doc = getCurrentDoc(); if (!doc) return;
    flushSave();
    const copy = JSON.parse(JSON.stringify(doc));
    copy.id = uid(); copy.title = (doc.title || 'Untitled') + ' copy'; copy.createdAt = Date.now(); copy.updatedAt = Date.now();
    docs.push(copy); saveDocs(docs);
    closeSheet(document.getElementById('sheet-menu'));
    toast('Duplicated');
    openDoc(copy.id);
  });
  document.getElementById('btn-delete-doc').addEventListener('click', () => {
    const doc = getCurrentDoc(); if (!doc) return;
    doc.trashed = true; doc.updatedAt = Date.now();
    saveDocs(docs);
    closeSheet(document.getElementById('sheet-menu'));
    toast('Moved to trash');
    showHome();
  });

  /* =========================================================
     Trash
  ========================================================= */
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

  /* =========================================================
     Toolbar active-state sync for text formatting
  ========================================================= */
  document.addEventListener('selectionchange', () => {
    if (screenEditor.classList.contains('hidden') || selectedElId) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !page.contains(sel.anchorNode)) return;
    ['bold', 'italic', 'underline', 'strikeThrough'].forEach(cmd => {
      const btn = document.querySelector(`#toolbar-text .tb-btn[data-cmd="${cmd}"]`);
      if (!btn) return;
      let active = false;
      try { active = document.queryCommandState(cmd); } catch (e) {}
      btn.classList.toggle('is-active', active);
    });
  });

  /* =========================================================
     Init
  ========================================================= */
  renderHome();
  showHome();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
