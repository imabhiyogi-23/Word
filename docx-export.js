/*
 * docx-export.js
 * Zero-dependency .docx (OOXML) exporter.
 * Builds a minimal but valid ZIP archive (stored, uncompressed) containing
 * the parts Word needs, and converts the editor's contenteditable HTML
 * into basic Word XML (paragraphs, runs, bold/italic/underline, headings,
 * lists, tables, colors, alignment).
 * No external libraries — works fully offline.
 */

/* ---------- Minimal ZIP (stored / no compression) ---------- */
const JotlyZip = (() => {
  function strToBytes(str) {
    return new TextEncoder().encode(str);
  }

  function crc32(bytes) {
    let table = crc32.table;
    if (!table) {
      table = crc32.table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
      }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime() {
    // Fixed timestamp is fine for generated documents.
    return { time: 0, date: 0x21 }; // 1980-01-01
  }

  function writeUint32LE(view, offset, value) { view.setUint32(offset, value, true); }
  function writeUint16LE(view, offset, value) { view.setUint16(offset, value, true); }

  function build(files) {
    // files: [{ name, data: Uint8Array }]
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const { time, date } = dosDateTime();

    files.forEach(f => {
      const nameBytes = strToBytes(f.name);
      const data = f.data;
      const crc = crc32(data);

      const localHeader = new ArrayBuffer(30);
      const lv = new DataView(localHeader);
      writeUint32LE(lv, 0, 0x04034b50);
      writeUint16LE(lv, 4, 20);
      writeUint16LE(lv, 6, 0);
      writeUint16LE(lv, 8, 0); // stored, no compression
      writeUint16LE(lv, 10, time);
      writeUint16LE(lv, 12, date);
      writeUint32LE(lv, 14, crc);
      writeUint32LE(lv, 18, data.length);
      writeUint32LE(lv, 22, data.length);
      writeUint16LE(lv, 26, nameBytes.length);
      writeUint16LE(lv, 28, 0);

      const localChunk = new Uint8Array(30 + nameBytes.length + data.length);
      localChunk.set(new Uint8Array(localHeader), 0);
      localChunk.set(nameBytes, 30);
      localChunk.set(data, 30 + nameBytes.length);
      localParts.push(localChunk);

      const centralHeader = new ArrayBuffer(46);
      const cv = new DataView(centralHeader);
      writeUint32LE(cv, 0, 0x02014b50);
      writeUint16LE(cv, 4, 20);
      writeUint16LE(cv, 6, 20);
      writeUint16LE(cv, 8, 0);
      writeUint16LE(cv, 10, 0);
      writeUint16LE(cv, 12, time);
      writeUint16LE(cv, 14, date);
      writeUint32LE(cv, 16, crc);
      writeUint32LE(cv, 20, data.length);
      writeUint32LE(cv, 24, data.length);
      writeUint16LE(cv, 28, nameBytes.length);
      writeUint16LE(cv, 30, 0);
      writeUint16LE(cv, 32, 0);
      writeUint16LE(cv, 34, 0);
      writeUint16LE(cv, 36, 0);
      writeUint32LE(cv, 38, 0);
      writeUint32LE(cv, 42, offset);

      const centralChunk = new Uint8Array(46 + nameBytes.length);
      centralChunk.set(new Uint8Array(centralHeader), 0);
      centralChunk.set(nameBytes, 46);
      centralParts.push(centralChunk);

      offset += localChunk.length;
    });

    const centralSize = centralParts.reduce((a, c) => a + c.length, 0);
    const centralOffset = offset;

    const end = new ArrayBuffer(22);
    const ev = new DataView(end);
    writeUint32LE(ev, 0, 0x06054b50);
    writeUint16LE(ev, 4, 0);
    writeUint16LE(ev, 6, 0);
    writeUint16LE(ev, 8, files.length);
    writeUint16LE(ev, 10, files.length);
    writeUint32LE(ev, 12, centralSize);
    writeUint32LE(ev, 16, centralOffset);
    writeUint16LE(ev, 20, 0);

    const totalSize = offset + centralSize + 22;
    const out = new Uint8Array(totalSize);
    let p = 0;
    localParts.forEach(c => { out.set(c, p); p += c.length; });
    centralParts.forEach(c => { out.set(c, p); p += c.length; });
    out.set(new Uint8Array(end), p);
    return out;
  }

  return { build };
})();

/* ---------- HTML -> OOXML body conversion ---------- */
const JotlyDocx = (() => {
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function colorToHex(c) {
    if (!c) return null;
    if (c.startsWith('#')) return c.replace('#', '').toUpperCase();
    const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return null;
    return [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  // Walk inline nodes, producing an array of run objects {text, bold, italic, underline, strike, color, highlight}
  function collectRuns(node, ctx, runs) {
    ctx = Object.assign({}, ctx);
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue;
      if (text) runs.push(Object.assign({ text }, ctx));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (tag === 'B' || tag === 'STRONG') ctx.bold = true;
    if (tag === 'I' || tag === 'EM') ctx.italic = true;
    if (tag === 'U') ctx.underline = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') ctx.strike = true;
    if (tag === 'BR') { runs.push({ text: '\n', brk: true }); return; }
    const style = node.getAttribute ? node.getAttribute('style') || '' : '';
    const colorMatch = style.match(/(?:^|;)\s*color:\s*([^;]+)/);
    if (colorMatch) ctx.color = colorToHex(colorMatch[1].trim());
    const bgMatch = style.match(/background-color:\s*([^;]+)/);
    if (bgMatch) ctx.highlight = colorToHex(bgMatch[1].trim());
    node.childNodes.forEach(child => collectRuns(child, ctx, runs));
  }

  function runsToXml(runs) {
    return runs.map(r => {
      if (r.brk) return '<w:r><w:br/></w:r>';
      const props = [];
      if (r.bold) props.push('<w:b/>');
      if (r.italic) props.push('<w:i/>');
      if (r.underline) props.push('<w:u w:val="single"/>');
      if (r.strike) props.push('<w:strike/>');
      if (r.color) props.push(`<w:color w:val="${r.color}"/>`);
      if (r.highlight) props.push(`<w:shd w:val="clear" w:fill="${r.highlight}"/>`);
      const rpr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
      return `<w:r>${rpr}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
    }).join('');
  }

  function paraXml(runsXmlOrText, opts) {
    opts = opts || {};
    const pPr = [];
    if (opts.style) pPr.push(`<w:pStyle w:val="${opts.style}"/>`);
    if (opts.align) pPr.push(`<w:jc w:val="${opts.align}"/>`);
    if (opts.indent) pPr.push(`<w:ind w:left="${opts.indent}"/>`);
    if (opts.numId) {
      pPr.push(`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${opts.numId}"/></w:numPr>`);
    }
    const pPrXml = pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : '';
    return `<w:p>${pPrXml}${runsXmlOrText}</w:p>`;
  }

  const BLOCK_STYLE = {
    H1: 'Heading1', H2: 'Heading2', H3: 'Heading3', BLOCKQUOTE: 'Quote'
  };

  function alignFromStyle(el) {
    const style = el.getAttribute ? (el.getAttribute('style') || '') : '';
    if (/text-align:\s*center/.test(style)) return 'center';
    if (/text-align:\s*right/.test(style)) return 'right';
    if (/text-align:\s*justify/.test(style)) return 'both';
    return null;
  }

  function blockToXml(el, listCtx) {
    const tag = el.tagName;

    if (tag === 'UL' || tag === 'OL') {
      const numId = tag === 'OL' ? 2 : 1;
      let xml = '';
      el.querySelectorAll(':scope > li').forEach(li => {
        const runs = [];
        li.childNodes.forEach(c => collectRuns(c, {}, runs));
        xml += paraXml(runsToXml(runs) || `<w:r><w:t></w:t></w:r>`, { numId });
      });
      return xml;
    }

    if (tag === 'TABLE') {
      let rows = '';
      el.querySelectorAll('tr').forEach(tr => {
        let cells = '';
        tr.querySelectorAll('td,th').forEach(td => {
          const runs = [];
          td.childNodes.forEach(c => collectRuns(c, {}, runs));
          const cellPara = paraXml(runsToXml(runs) || '<w:r><w:t></w:t></w:r>');
          cells += `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${cellPara}</w:tc>`;
        });
        rows += `<w:tr>${cells}</w:tr>`;
      });
      return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>` +
        `<w:top w:val="single" w:sz="4" w:color="EAE3D3"/><w:left w:val="single" w:sz="4" w:color="EAE3D3"/>` +
        `<w:bottom w:val="single" w:sz="4" w:color="EAE3D3"/><w:right w:val="single" w:sz="4" w:color="EAE3D3"/>` +
        `<w:insideH w:val="single" w:sz="4" w:color="EAE3D3"/><w:insideV w:val="single" w:sz="4" w:color="EAE3D3"/>` +
        `</w:tblBorders></w:tblPr>${rows}</w:tbl>`;
    }

    if (tag === 'HR' || (el.classList && el.classList.contains('page-break'))) {
      return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    }

    if (tag === 'PRE') {
      const text = el.textContent || '';
      return text.split('\n').map(line =>
        paraXml(`<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`)
      ).join('');
    }

    // Default: paragraph-like block (P, H1-H3, BLOCKQUOTE, DIV)
    const runs = [];
    el.childNodes.forEach(c => collectRuns(c, {}, runs));
    if (!runs.length) return paraXml('<w:r><w:t></w:t></w:r>');
    return paraXml(runsToXml(runs), {
      style: BLOCK_STYLE[tag] || null,
      align: alignFromStyle(el)
    });
  }

  function htmlToBodyXml(rootEl) {
    let xml = '';
    rootEl.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.nodeValue.trim()) xml += paraXml(`<w:r><w:t xml:space="preserve">${esc(node.nodeValue)}</w:t></w:r>`);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      xml += blockToXml(node);
    });
    return xml || paraXml('<w:r><w:t></w:t></w:r>');
  }

  function buildDocxBytes(title, html) {
    const container = document.createElement('div');
    container.innerHTML = html;
    const bodyXml = htmlToBodyXml(container);

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${bodyXml}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body>
</w:document>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

    const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>${esc(title || 'Untitled document')}</dc:title>
<dc:creator>Jotly</dc:creator>
</cp:coreProperties>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="746C60"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>
</w:styles>`;

    const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>`;

    const files = [
      { name: '[Content_Types].xml', data: new TextEncoder().encode(contentTypes) },
      { name: '_rels/.rels', data: new TextEncoder().encode(rootRels) },
      { name: 'docProps/core.xml', data: new TextEncoder().encode(coreXml) },
      { name: 'word/_rels/document.xml.rels', data: new TextEncoder().encode(docRels) },
      { name: 'word/document.xml', data: new TextEncoder().encode(documentXml) },
      { name: 'word/styles.xml', data: new TextEncoder().encode(stylesXml) },
      { name: 'word/numbering.xml', data: new TextEncoder().encode(numberingXml) },
    ];

    return JotlyZip.build(files);
  }

  function exportDocx(title, html) {
    const bytes = buildDocxBytes(title, html);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (title || 'Untitled document').replace(/[\\/:*?"<>|]/g, '') + '.docx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  return { exportDocx };
})();
