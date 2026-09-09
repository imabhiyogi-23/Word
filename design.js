/* Jotly — design.js
   Free-form, InDesign/Affinity-style layout mode.
   Own document kind: 'design'. Shares localStorage with app.js via the
   same STORAGE_KEY, and pings window.JotlyApp.reloadDocs() so the home
   screen stays in sync after edits made here.
*/
(() => {
  'use strict';

  const STORAGE_KEY = 'jotly.docs.v1';
  function loadDocs() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveDocs(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
  function uid() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function elId() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

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

  /* ---------------- preset sheet state ---------------- */
  let selectedPreset = PRESETS[0];
  let orientation = 'portrait';
  let hasHF = true;

  const sheetPreset = document.getElementById('sheet-preset');
  const presetGrid = document.getElementById('preset-grid');
  const customRow = document.getElementById('custom-size-row');

  function buildPresetGrid() {
    presetGrid.innerHTML = '';
    PRESETS.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'style-opt preset-btn' + (p.key === selectedPreset.key ? ' is-active' : '');
      btn.dataset.preset = p.key;
      btn.innerHTML = p.key === 'custom'
        ? `<strong>Custom size</strong><small>Set your own W × H</small>`
        : `<strong>${p.label}</strong><small>${p.w} × ${p.h} ${p.unit}</small>`;
      btn.addEventListener('click', () => {
        selectedPreset = p;
        presetGrid.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        customRow.classList.toggle('hidden', p.key !== 'custom');
      });
      presetGrid.appendChild(btn);
    });
  }
  buildPresetGrid();
  customRow.classList.toggle('hidden', selectedPreset.key !== 'custom');

  document.getElementById('orientation-row').addEventListener('click', (e) => {
    const b = e.target.closest('[data-orientation]');
    if (!b) return;
    orientation = b.dataset.orientation;
    document.querySelectorAll('#orientation-row .row-opt').forEach(x => x.classList.remove('is-active'));
    b.classList.add('is-active');
  });
  document.getElementById('headerfooter-row').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hf]');
    if (!b) return;
    hasHF = b.dataset.hf === 'yes';
    document.querySelectorAll('#headerfooter-row .row-opt').forEach(x => x.classList.remove('is-active'));
    b.classList.add('is-active');
  });

  function openPresetSheet() {
    sheetPreset.classList.remove('hidden');
  }

  document.getElementById('btn-create-design').addEventListener('click', () => {
    let w, h, unit;
    if (selectedPreset.key === 'custom') {
      w = parseFloat(document.getElementById('custom-width').value) || 210;
      h = parseFloat(document.getElementById('custom-height').value) || 297;
      unit = document.getElementById('custom-unit').value;
    } else {
      w = selectedPreset.w; h = selectedPreset.h; unit = selectedPreset.unit;
    }
    if (orientation === 'landscape' && h > w) { const t = w; w = h; h = t; }
    if (orientation === 'portrait' && w > h) { const t = w; w = h; h = t; }

    const ppu = pxPerUnit(unit);
    const widthPx = Math.round(w * ppu);
    const heightPx = Math.round(h * ppu);
    const hfHeight = Math.min(90, Math.max(40, Math.round(heightPx * 0.08)));

    const doc = {
      id: uid(),
      title: '',
      kind: 'design',
      starred: false,
      trashed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      page: {
        widthPx, heightPx, unit, orientation,
        presetLabel: selectedPreset.key === 'custom' ? `${w}×${h}${unit}` : selectedPreset.label,
        hasHeaderFooter: hasHF,
        headerHeightPx: hfHeight,
        footerHeightPx: hfHeight,
      },
      elements: [],
    };

    const list = loadDocs();
    list.push(doc);
    saveDocs(list);
    sheetPreset.classList.add('hidden');
    window.JotlyApp && window.JotlyApp.reloadDocs();
    open(doc.id);
  });

  /* ---------------- editor state ---------------- */
  const screenDesign = document.getElementById('screen-design');
  const pageEl = document.getElementById('design-page');
  const elementsWrap = document.getElementById('design-elements');
  const zoomWrap = document.getElementById('design-page-zoom');
  const scrollWrap = document.getElementById('design-scroll');
  const canvasOuter = document.getElementById('design-canvas-outer');
  const rulerH = document.getElementById('ruler-h');
  const rulerV = document.getElementById('ruler-v');

  let docsCache = [];
  let currentDoc = null;
  let currentZoom = 1;
  let selectedElId = null;
  let rulersOn = true;
  let saveTimer = null;

  function getEl(id) { return currentDoc.elements.find(e => e.id === id); }

  function open(id) {
    docsCache = loadDocs();
    currentDoc = docsCache.find(d => d.id === id);
    if (!currentDoc) return;
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    screenDesign.classList.remove('hidden');
    document.getElementById('design-title').value = currentDoc.title || '';
    selectedElId = null;

    pageEl.style.width = currentDoc.page.widthPx + 'px';
    pageEl.style.height = currentDoc.page.heightPx + 'px';

    const hfOn = currentDoc.page.hasHeaderFooter;
    const headerBand = document.getElementById('design-band-header');
    const footerBand = document.getElementById('design-band-footer');
    headerBand.classList.toggle('hidden', !hfOn);
    footerBand.classList.toggle('hidden', !hfOn);
    headerBand.style.height = currentDoc.page.headerHeightPx + 'px';
    footerBand.style.height = currentDoc.page.footerHeightPx + 'px';

    renderElements();

    // fit-to-width zoom on first open
    requestAnimationFrame(() => {
      const containerW = scrollWrap.clientWidth - 80;
      const fit = Math.max(0.15, Math.min(2, containerW / currentDoc.page.widthPx));
      setZoom(fit);
      setSaveStatus('Saved');
    });
  }

  function setZoom(z) {
    currentZoom = Math.round(Math.max(0.15, Math.min(3, z)) * 100) / 100;
    pageEl.style.transform = `scale(${currentZoom})`;
    zoomWrap.style.width = Math.round(currentDoc.page.widthPx * currentZoom) + 'px';
    zoomWrap.style.height = Math.round(currentDoc.page.heightPx * currentZoom) + 'px';
    document.getElementById('design-zoom-label').textContent = Math.round(currentZoom * 100) + '%';
    drawRulers();
  }
  document.getElementById('btn-design-zoom-in').addEventListener('click', () => setZoom(currentZoom + 0.1));
  document.getElementById('btn-design-zoom-out').addEventListener('click', () => setZoom(currentZoom - 0.1));

  /* ---------------- rulers ---------------- */
  function sizeRulerCanvases() {
    rulerH.width = rulerH.clientWidth * devicePixelRatio;
    rulerH.height = rulerH.clientHeight * devicePixelRatio;
    rulerV.width = rulerV.clientWidth * devicePixelRatio;
    rulerV.height = rulerV.clientHeight * devicePixelRatio;
  }
  function drawRulers() {
    if (!rulersOn || !currentDoc) return;
    sizeRulerCanvases();
    const dpr = devicePixelRatio;
    const unit = currentDoc.page.unit;
    const ppu = pxPerUnit(unit) * currentZoom; // screen px per unit
    const major = unit === 'in' ? 1 : unit === 'mm' ? 10 : 100;
    const minor = major / 5;
    const scrollLeft = scrollWrap.scrollLeft;
    const scrollTop = scrollWrap.scrollTop;
    const padding = 40; // .design-page-zoom padding

    const hctx = rulerH.getContext('2d');
    hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hctx.clearRect(0, 0, rulerH.clientWidth, rulerH.clientHeight);
    hctx.fillStyle = '#746C60';
    hctx.font = '9px Inter, sans-serif';
    hctx.strokeStyle = '#C9C2B2';
    for (let v = 0; ; v += minor) {
      const x = padding + v * ppu - scrollLeft;
      if (x > rulerH.clientWidth) break;
      if (x < 0) continue;
      const isMajor = Math.round(v / minor) % 5 === 0;
      hctx.beginPath();
      hctx.moveTo(x + 0.5, isMajor ? 6 : 14);
      hctx.lineTo(x + 0.5, 22);
      hctx.stroke();
      if (isMajor) hctx.fillText(String(Math.round(v)), x + 3, 12);
    }

    const vctx = rulerV.getContext('2d');
    vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vctx.clearRect(0, 0, rulerV.clientWidth, rulerV.clientHeight);
    vctx.fillStyle = '#746C60';
    vctx.font = '9px Inter, sans-serif';
    vctx.strokeStyle = '#C9C2B2';
    for (let v = 0; ; v += minor) {
      const y = padding + v * ppu - scrollTop;
      if (y > rulerV.clientHeight) break;
      if (y < 0) continue;
      const isMajor = Math.round(v / minor) % 5 === 0;
      vctx.beginPath();
      vctx.moveTo(isMajor ? 6 : 14, y + 0.5);
      vctx.lineTo(22, y + 0.5);
      vctx.stroke();
      if (isMajor) {
        vctx.save();
        vctx.translate(10, y + 3);
        vctx.rotate(-Math.PI / 2);
        vctx.fillText(String(Math.round(v)), 0, 0);
        vctx.restore();
      }
    }
  }
  scrollWrap.addEventListener('scroll', drawRulers);
  window.addEventListener('resize', drawRulers);

  document.getElementById('btn-toggle-rulers').addEventListener('click', () => {
    rulersOn = !rulersOn;
    canvasOuter.classList.toggle('rulers-off', !rulersOn);
    if (rulersOn) drawRulers();
  });
  document.getElementById('btn-toggle-hf').addEventListener('click', () => {
    currentDoc.page.hasHeaderFooter = !currentDoc.page.hasHeaderFooter;
    document.getElementById('design-band-header').classList.toggle('hidden', !currentDoc.page.hasHeaderFooter);
    document.getElementById('design-band-footer').classList.toggle('hidden', !currentDoc.page.hasHeaderFooter);
    scheduleSave();
  });

  /* ---------------- rendering elements ---------------- */
  function fillToCss(fill) {
    if (!fill || fill.type === 'none') return 'transparent';
    if (fill.type === 'gradient') return `linear-gradient(${fill.gradAngle || 90}deg, ${fill.gradFrom}, ${fill.gradTo})`;
    return fill.solid || 'transparent';
  }

  function applyElementStyle(obj) {
    const div = elementsWrap.querySelector(`[data-id="${obj.id}"]`);
    if (!div) return;
    div.style.left = obj.x + 'px';
    div.style.top = obj.y + 'px';
    div.style.width = obj.w + 'px';
    div.style.height = obj.h + 'px';
    div.style.transform = obj.rotation ? `rotate(${obj.rotation}deg)` : '';
    div.style.zIndex = obj.zIndex;
    div.style.mixBlendMode = obj.blend || 'normal';
    div.style.opacity = (obj.opacity != null ? obj.opacity : 100) / 100;

    if (obj.type === 'text') {
      div.style.fontFamily = obj.fontFamily;
      div.style.fontSize = obj.fontSize + 'px';
      div.style.color = obj.color;
      div.style.textAlign = obj.align || 'left';
      div.style.background = fillToCss(obj.fill);
      div.style.borderRadius = (obj.radius || 0) + 'px';
      div.style.border = obj.strokeWidth ? `${obj.strokeWidth}px solid ${obj.strokeColor}` : 'none';
    } else if (obj.type === 'shape') {
      div.style.background = fillToCss(obj.fill);
      div.style.border = obj.strokeWidth ? `${obj.strokeWidth}px solid ${obj.strokeColor}` : 'none';
      div.style.borderRadius = obj.shapeType === 'ellipse' ? '50%' : (obj.radius || 0) + 'px';
      if (obj.shapeType === 'line') {
        div.style.background = obj.strokeColor || obj.fill.solid || '#16130F';
        div.style.border = 'none';
      }
    } else if (obj.type === 'image') {
      div.style.borderRadius = (obj.radius || 0) + 'px';
      div.style.border = obj.strokeWidth ? `${obj.strokeWidth}px solid ${obj.strokeColor}` : 'none';
    }
  }

  function renderElements() {
    elementsWrap.innerHTML = '';
    currentDoc.elements.slice().sort((a, b) => a.zIndex - b.zIndex).forEach(obj => {
      const div = document.createElement('div');
      div.className = 'design-el';
      div.dataset.id = obj.id;
      div.dataset.type = obj.type;
      if (obj.type === 'text') {
        div.textContent = obj.text || '';
      } else if (obj.type === 'image') {
        const img = document.createElement('img');
        img.src = obj.src;
        img.draggable = false;
        div.appendChild(img);
      }
      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      div.appendChild(handle);
      if (obj.href) {
        const badge = document.createElement('a');
        badge.className = 'link-badge';
        badge.href = obj.href;
        badge.target = '_blank';
        badge.rel = 'noopener';
        badge.title = obj.href;
        badge.textContent = '🔗';
        badge.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        div.appendChild(badge);
      }
      elementsWrap.appendChild(div);
      applyElementStyle(obj);
    });
    updateSelectionClasses();
  }

  function updateSelectionClasses() {
    elementsWrap.querySelectorAll('.design-el').forEach(d => {
      d.classList.toggle('is-selected', d.dataset.id === selectedElId);
    });
  }
  function selectElement(id) {
    selectedElId = id;
    updateSelectionClasses();
  }

  /* ---------------- add elements ---------------- */
  function nextZ() {
    return currentDoc.elements.length ? Math.max(...currentDoc.elements.map(e => e.zIndex)) + 1 : 1;
  }
  function addText() {
    const obj = {
      id: elId(), type: 'text',
      x: 40, y: 40, w: 220, h: 60, rotation: 0,
      text: 'Double-tap to edit',
      fontFamily: "'Inter', sans-serif", fontSize: 20, color: '#16130F', align: 'left',
      fill: { type: 'none' }, blend: 'normal', opacity: 100, radius: 0, strokeWidth: 0, strokeColor: '#16130F',
      zIndex: nextZ(),
    };
    currentDoc.elements.push(obj);
    renderElements();
    selectElement(obj.id);
    scheduleSave();
  }
  function addShape(shapeType) {
    const obj = {
      id: elId(), type: 'shape', shapeType,
      x: 60, y: 80, w: shapeType === 'line' ? 200 : 160, h: shapeType === 'line' ? 4 : 120, rotation: 0,
      fill: { type: 'solid', solid: '#FFC900' },
      blend: 'normal', opacity: 100, radius: shapeType === 'rect' ? 12 : 0,
      strokeWidth: 0, strokeColor: '#16130F',
      zIndex: nextZ(),
    };
    currentDoc.elements.push(obj);
    renderElements();
    selectElement(obj.id);
    scheduleSave();
  }
  function addImage(dataUrl, naturalW, naturalH) {
    const maxW = Math.min(currentDoc.page.widthPx * 0.6, 320);
    const ratio = naturalH / naturalW || 1;
    const obj = {
      id: elId(), type: 'image',
      x: 50, y: 50, w: maxW, h: Math.round(maxW * ratio), rotation: 0,
      src: dataUrl, fill: { type: 'none' }, blend: 'normal', opacity: 100, radius: 0,
      strokeWidth: 0, strokeColor: '#16130F',
      zIndex: nextZ(),
    };
    currentDoc.elements.push(obj);
    renderElements();
    selectElement(obj.id);
    scheduleSave();
  }

  document.getElementById('btn-add-text').addEventListener('click', addText);
  document.getElementById('btn-add-image').addEventListener('click', () => document.getElementById('design-image-input').click());
  document.getElementById('design-image-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => addImage(reader.result, img.width, img.height);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  document.getElementById('design-toolbar').addEventListener('click', (e) => {
    const openBtn = e.target.closest('[data-open]');
    if (openBtn) document.getElementById('sheet-' + openBtn.dataset.open).classList.remove('hidden');
  });
  document.getElementById('sheet-shape').addEventListener('click', (e) => {
    const b = e.target.closest('[data-shape]');
    if (!b) return;
    addShape(b.dataset.shape);
    document.getElementById('sheet-shape').classList.add('hidden');
  });

  /* ---------------- drag / resize ---------------- */
  let dragState = null;
  elementsWrap.addEventListener('pointerdown', (e) => {
    const div = e.target.closest('.design-el');
    if (!div) return;
    if (div.getAttribute('contenteditable') === 'true') return;
    selectElement(div.dataset.id);
    const obj = getEl(div.dataset.id);
    const handle = e.target.closest('.resize-handle');
    e.preventDefault();
    dragState = handle
      ? { mode: 'resize', id: obj.id, startX: e.clientX, startY: e.clientY, startW: obj.w, startH: obj.h }
      : { mode: 'move', id: obj.id, startX: e.clientX, startY: e.clientY, startXpos: obj.x, startYpos: obj.y };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
  function onMove(e) {
    if (!dragState) return;
    const obj = getEl(dragState.id);
    if (!obj) return;
    const dx = (e.clientX - dragState.startX) / currentZoom;
    const dy = (e.clientY - dragState.startY) / currentZoom;
    if (dragState.mode === 'move') {
      obj.x = Math.round(dragState.startXpos + dx);
      obj.y = Math.round(dragState.startYpos + dy);
    } else {
      obj.w = Math.max(16, Math.round(dragState.startW + dx));
      obj.h = Math.max(16, Math.round(dragState.startH + dy));
    }
    applyElementStyle(obj);
  }
  function onUp() {
    dragState = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    scheduleSave();
  }

  // deselect on empty page tap
  pageEl.addEventListener('pointerdown', (e) => {
    if (e.target === pageEl || e.target === elementsWrap) {
      selectedElId = null;
      updateSelectionClasses();
    }
  });

  // text editing
  elementsWrap.addEventListener('dblclick', (e) => {
    const div = e.target.closest('.design-el[data-type="text"]');
    if (!div) return;
    div.setAttribute('contenteditable', 'true');
    div.focus();
    document.execCommand('selectAll', false, null);
  });
  elementsWrap.addEventListener('focusout', (e) => {
    const div = e.target.closest('.design-el[data-type="text"]');
    if (!div) return;
    div.setAttribute('contenteditable', 'false');
    const obj = getEl(div.dataset.id);
    if (obj) { obj.text = div.textContent; scheduleSave(); }
  });

  /* ---------------- toolbar: layer / duplicate / delete ---------------- */
  document.getElementById('btn-layer-front').addEventListener('click', () => {
    const obj = getEl(selectedElId); if (!obj) return;
    obj.zIndex = nextZ();
    renderElements(); selectElement(obj.id); scheduleSave();
  });
  document.getElementById('btn-layer-back').addEventListener('click', () => {
    const obj = getEl(selectedElId); if (!obj) return;
    const min = Math.min(...currentDoc.elements.map(e => e.zIndex));
    obj.zIndex = min - 1;
    renderElements(); selectElement(obj.id); scheduleSave();
  });
  document.getElementById('btn-duplicate-el').addEventListener('click', () => {
    const obj = getEl(selectedElId); if (!obj) return;
    const copy = JSON.parse(JSON.stringify(obj));
    copy.id = elId(); copy.x += 16; copy.y += 16; copy.zIndex = nextZ();
    currentDoc.elements.push(copy);
    renderElements(); selectElement(copy.id); scheduleSave();
  });
  document.getElementById('btn-delete-el').addEventListener('click', () => {
    if (!selectedElId) return;
    currentDoc.elements = currentDoc.elements.filter(e => e.id !== selectedElId);
    selectedElId = null;
    renderElements(); scheduleSave();
  });

  /* ---------------- properties sheet ---------------- */
  const sheetProps = document.getElementById('sheet-props');
  function buildSwatchRow(container, colors, onPick) {
    container.innerHTML = '';
    colors.forEach(c => {
      const b = document.createElement('button');
      b.className = 'color-swatch';
      b.style.background = c;
      b.addEventListener('click', () => onPick(c));
      container.appendChild(b);
    });
  }
  buildSwatchRow(document.getElementById('props-font-color-row'), FILL_COLORS, (c) => {
    const obj = getEl(selectedElId); if (!obj) return;
    obj.color = c; applyElementStyle(obj); scheduleSave();
  });
  buildSwatchRow(document.getElementById('props-fill-color-row'), FILL_COLORS, (c) => {
    const obj = getEl(selectedElId); if (!obj) return;
    obj.fill = { type: 'solid', solid: c };
    setFillTypeActive('solid');
    applyElementStyle(obj); scheduleSave();
  });
  buildSwatchRow(document.getElementById('gradient-from-row'), FILL_COLORS, (c) => {
    const obj = getEl(selectedElId); if (!obj) return;
    obj.fill.gradFrom = c; applyElementStyle(obj); scheduleSave();
  });
  buildSwatchRow(document.getElementById('gradient-to-row'), FILL_COLORS, (c) => {
    const obj = getEl(selectedElId); if (!obj) return;
    obj.fill.gradTo = c; applyElementStyle(obj); scheduleSave();
  });
  buildSwatchRow(document.getElementById('props-stroke-color-row'), FILL_COLORS, (c) => {
    const obj = getEl(selectedElId); if (!obj) return;
    obj.strokeColor = c; applyElementStyle(obj); scheduleSave();
  });

  function setFillTypeActive(type) {
    document.querySelectorAll('#fill-type-row .row-opt').forEach(b => b.classList.toggle('is-active', b.dataset.fillType === type));
    document.getElementById('gradient-controls').classList.toggle('hidden', type !== 'gradient');
  }
  document.getElementById('fill-type-row').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fill-type]');
    if (!b) return;
    const obj = getEl(selectedElId); if (!obj) return;
    const type = b.dataset.fillType;
    if (type === 'gradient') {
      obj.fill = { type: 'gradient', gradFrom: obj.fill.solid || '#FFC900', gradTo: '#5B21B6', gradAngle: obj.fill.gradAngle || 90 };
    } else if (type === 'none') {
      obj.fill = { type: 'none' };
    } else {
      obj.fill = { type: 'solid', solid: (obj.fill && (obj.fill.solid || obj.fill.gradFrom)) || '#FFC900' };
    }
    setFillTypeActive(type);
    applyElementStyle(obj); scheduleSave();
  });
  document.getElementById('gradient-angle').addEventListener('input', (e) => {
    const obj = getEl(selectedElId); if (!obj || obj.fill.type !== 'gradient') return;
    obj.fill.gradAngle = +e.target.value;
    applyElementStyle(obj);
  });
  document.getElementById('gradient-angle').addEventListener('change', scheduleSave);

  document.getElementById('props-blend-mode').addEventListener('change', (e) => {
    const obj = getEl(selectedElId); if (!obj) return;
    obj.blend = e.target.value; applyElementStyle(obj); scheduleSave();
  });
  document.getElementById('props-opacity').addEventListener('input', (e) => {
    const obj = getEl(selectedElId); if (!obj) return;
    obj.opacity = +e.target.value; applyElementStyle(obj);
  });
  document.getElementById('props-opacity').addEventListener('change', scheduleSave);
  document.getElementById('props-radius').addEventListener('input', (e) => {
    const obj = getEl(selectedElId); if (!obj) return;
    obj.radius = +e.target.value; applyElementStyle(obj);
  });
  document.getElementById('props-radius').addEventListener('change', scheduleSave);
  document.getElementById('props-stroke-width').addEventListener('input', (e) => {
    const obj = getEl(selectedElId); if (!obj) return;
    obj.strokeWidth = +e.target.value; applyElementStyle(obj);
  });
  document.getElementById('props-stroke-width').addEventListener('change', scheduleSave);
  document.getElementById('props-font-family').addEventListener('change', (e) => {
    const obj = getEl(selectedElId); if (!obj) return;
    obj.fontFamily = e.target.value; applyElementStyle(obj); scheduleSave();
  });
  document.getElementById('props-font-size').addEventListener('change', (e) => {
    const obj = getEl(selectedElId); if (!obj) return;
    obj.fontSize = +e.target.value; applyElementStyle(obj); scheduleSave();
  });
  document.getElementById('props-text-group').querySelectorAll('[data-align]').forEach(b => {
    b.addEventListener('click', () => {
      const obj = getEl(selectedElId); if (!obj) return;
      obj.align = b.dataset.align; applyElementStyle(obj); scheduleSave();
    });
  });

  document.getElementById('props-link').addEventListener('change', (e) => {
    const obj = getEl(selectedElId); if (!obj) return;
    obj.href = e.target.value.trim();
    renderElements(); selectElement(obj.id); scheduleSave();
  });

  document.getElementById('btn-open-props').addEventListener('click', () => {
    const obj = getEl(selectedElId);
    if (!obj) { toast('Tap an element on the page first'); return; }
    document.getElementById('props-title').textContent =
      obj.type === 'text' ? 'Text style' : obj.type === 'image' ? 'Image style' : 'Shape style';
    document.getElementById('props-link').value = obj.href || '';
    document.getElementById('props-text-group').classList.toggle('hidden', obj.type !== 'text');
    document.getElementById('props-shape-group').classList.toggle('hidden', obj.type === 'text');

    setFillTypeActive(obj.fill ? obj.fill.type : 'solid');
    document.getElementById('props-blend-mode').value = obj.blend || 'normal';
    document.getElementById('props-opacity').value = obj.opacity != null ? obj.opacity : 100;
    document.getElementById('props-radius').value = obj.radius || 0;
    document.getElementById('props-stroke-width').value = obj.strokeWidth || 0;
    if (obj.fill && obj.fill.type === 'gradient') {
      document.getElementById('gradient-angle').value = obj.fill.gradAngle || 90;
    }
    if (obj.type === 'text') {
      document.getElementById('props-font-family').value = obj.fontFamily;
      document.getElementById('props-font-size').value = String(obj.fontSize);
    }
    sheetProps.classList.remove('hidden');
  });

  /* ---------------- top bar: title / back / menu ---------------- */
  document.getElementById('design-title').addEventListener('input', scheduleSave);
  document.getElementById('btn-design-back').addEventListener('click', () => {
    flushSave();
    window.JotlyApp && window.JotlyApp.reloadDocs();
    window.JotlyApp && window.JotlyApp.showHome();
  });

  function setSaveStatus(text) { document.getElementById('design-save-status').textContent = text; }
  function scheduleSave() {
    setSaveStatus('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 500);
  }
  function flushSave() {
    if (!currentDoc) return;
    currentDoc.title = document.getElementById('design-title').value;
    currentDoc.updatedAt = Date.now();
    saveDocs(docsCache);
    setSaveStatus('Saved');
  }
  window.addEventListener('beforeunload', flushSave);

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 1800);
  }

  /* ---------------- menu: export / duplicate / delete ---------------- */
  document.getElementById('btn-design-menu').addEventListener('click', () => {
    document.getElementById('sheet-design-menu').classList.remove('hidden');
  });
  document.getElementById('btn-design-export-pdf').addEventListener('click', () => {
    document.getElementById('sheet-design-menu').classList.add('hidden');
    flushSave();
    const wMM = (currentDoc.page.widthPx * MM_PER_PX).toFixed(1);
    const hMM = (currentDoc.page.heightPx * MM_PER_PX).toFixed(1);
    let styleTag = document.getElementById('print-page-size');
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = 'print-page-size';
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = `@page { size: ${wMM}mm ${hMM}mm; margin: 0; }`;
    const prevZoom = currentZoom;
    setZoom(1);
    setTimeout(() => {
      window.print();
      setZoom(prevZoom);
    }, 150);
  });
  document.getElementById('btn-design-export-png').addEventListener('click', () => {
    document.getElementById('sheet-design-menu').classList.add('hidden');
    exportPng();
  });
  document.getElementById('btn-design-duplicate').addEventListener('click', () => {
    flushSave();
    const copy = JSON.parse(JSON.stringify(currentDoc));
    copy.id = uid();
    copy.title = (currentDoc.title || 'Untitled') + ' copy';
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    docsCache.push(copy);
    saveDocs(docsCache);
    document.getElementById('sheet-design-menu').classList.add('hidden');
    window.JotlyApp && window.JotlyApp.reloadDocs();
    toast('Duplicated');
    open(copy.id);
  });
  document.getElementById('btn-design-delete').addEventListener('click', () => {
    currentDoc.trashed = true;
    currentDoc.updatedAt = Date.now();
    saveDocs(docsCache);
    document.getElementById('sheet-design-menu').classList.add('hidden');
    window.JotlyApp && window.JotlyApp.reloadDocs();
    toast('Moved to trash');
    window.JotlyApp && window.JotlyApp.showHome();
  });

  function exportPng() {
    const pageW = currentDoc.page.widthPx, pageH = currentDoc.page.heightPx;
    const clone = elementsWrap.cloneNode(true);
    clone.removeAttribute('id');
    clone.querySelectorAll('.resize-handle').forEach(h => h.remove());
    clone.querySelectorAll('.design-el').forEach(el => {
      el.classList.remove('is-selected');
      el.removeAttribute('contenteditable');
    });
    const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}" height="${pageH}">` +
      `<foreignObject width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${pageW}px;height:${pageH}px;background:#fff;">` +
      clone.outerHTML +
      `</div></foreignObject></svg>`;
    const url = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = pageW; canvas.height = pageH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pageW, pageH);
      try {
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(blob => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = (currentDoc.title || 'design') + '.png';
          a.click();
        });
      } catch (err) {
        toast('PNG export isn\u2019t supported in this browser — try PDF export instead');
      }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { toast('PNG export failed — try PDF export instead'); URL.revokeObjectURL(url); };
    img.src = url;
  }

  window.JotlyDesign = { openPresetSheet, open };
})();
