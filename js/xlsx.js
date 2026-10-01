// Minimal .xlsx reader (no libraries, works offline). An .xlsx file is a ZIP of XML files; we read the ZIP's
// directory, inflate the parts we need with the browser's built-in DecompressionStream, and turn a worksheet into
// the same { headers, rows } shape that the CSV parser returns. It reads values only (no formulas are run;
// Excel's saved results are used) and handles shared strings, inline strings, numbers and booleans.
(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const X = (ER.xlsx = {});
  const td = new TextDecoder('utf-8');

  const MAX_FILE = 25 * 1024 * 1024;       // reject absurdly large workbooks
  const MAX_PART = 120 * 1024 * 1024;      // and zip entries that would inflate hugely

  X.supported = typeof DecompressionStream === 'function';

  // 'xlsx' | 'xls' | 'csv'  (decided from the first bytes, not just the file name)
  X.sniff = (buf, name = '') => {
    const b = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
    if (b[0] === 0x50 && b[1] === 0x4b) return 'xlsx';                                          // "PK" zip
    if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'xls';         // old binary Excel
    if (/\.xlsx?m?$|\.xlsb$/i.test(name)) return /\.xls$/i.test(name) ? 'xls' : 'xlsx';
    return 'csv';
  };

  // ---------- ZIP ----------
  function readZip(buf) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This does not look like a valid .xlsx file.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = new Map();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The .xlsx file is damaged.');
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const offset = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
      entries.set(name, { method, csize, usize, offset });
      p += 46 + nlen + elen + clen;
    }
    return { dv, u8, entries };
  }

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
  }

  async function readPart(zip, name) {
    const e = zip.entries.get(name);
    if (!e) return null;
    if (e.usize > MAX_PART) throw new Error('That workbook is too large to read.');
    const { dv, u8 } = zip;
    if (dv.getUint32(e.offset, true) !== 0x04034b50) throw new Error('The .xlsx file is damaged.');
    const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
    const raw = u8.subarray(start, start + e.csize);
    if (e.method === 0) return td.decode(raw);
    if (e.method === 8) return td.decode(await inflateRaw(raw));
    throw new Error('Unsupported compression in the .xlsx file.');
  }

  // ---------- XML helpers ----------
  const parseXml = (text) => {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('The .xlsx file contains unreadable data.');
    return doc;
  };
  const all = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
  const first = (node, name) => node.getElementsByTagNameNS('*', name)[0] || null;
  const colIndex = (ref) => {
    const m = /^([A-Za-z]+)/.exec(ref || '');
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  const rowIndex = (ref) => { const m = /(\d+)$/.exec(ref || ''); return m ? Number(m[1]) - 1 : -1; };

  // text of a <si> / <is> element, ignoring phonetic hints
  const richText = (el) => all(el, 't').filter((t) => !t.parentNode || t.parentNode.localName !== 'rPh').map((t) => t.textContent).join('');

  // ---------- public API ----------
  // open(arrayBuffer) -> { names:[...], read(index) -> { headers, rows } }
  X.open = async (buf) => {
    if (!X.supported) throw new Error('This browser cannot open .xlsx files. Please use Edge or Chrome, or save the sheet as CSV.');
    if (buf.byteLength > MAX_FILE) throw new Error('That workbook is too large (limit 25 MB). Try saving just the sheet you need.');
    const zip = readZip(buf);

    const wbText = await readPart(zip, 'xl/workbook.xml');
    if (!wbText) throw new Error('This does not look like an Excel workbook.');
    const wb = parseXml(wbText);
    const relsText = await readPart(zip, 'xl/_rels/workbook.xml.rels');
    const targets = new Map();
    if (relsText) for (const r of all(parseXml(relsText), 'Relationship')) targets.set(r.getAttribute('Id'), r.getAttribute('Target'));

    const sheets = all(wb, 'sheet').map((s, i) => {
      const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
        || s.getAttribute('r:id');
      let t = targets.get(rid) || `worksheets/sheet${i + 1}.xml`;
      t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
      return { name: s.getAttribute('name') || `Sheet ${i + 1}`, path: t, hidden: s.getAttribute('state') && s.getAttribute('state') !== 'visible' };
    }).filter((s) => !s.hidden);
    if (!sheets.length) throw new Error('That workbook has no visible sheets.');

    let shared = null;
    const sharedStrings = async () => {
      if (shared) return shared;
      shared = [];
      const txt = await readPart(zip, 'xl/sharedStrings.xml');
      if (txt) for (const si of all(parseXml(txt), 'si')) shared.push(richText(si));
      return shared;
    };

    const read = async (index) => {
      const sh = sheets[index];
      const txt = await readPart(zip, sh.path);
      if (!txt) throw new Error(`Could not find the data for sheet "${sh.name}".`);
      const strings = await sharedStrings();
      const doc = parseXml(txt);
      const grid = new Map();
      let maxCol = 0, nextRow = 0;
      for (const row of all(doc, 'row')) {
        let r = rowIndex(row.getAttribute('r'));
        if (r < 0) r = nextRow;
        nextRow = r + 1;
        let nextCol = 0;
        const cells = [];
        for (const c of all(row, 'c')) {
          let ci = colIndex(c.getAttribute('r'));
          if (ci < 0) ci = nextCol;
          nextCol = ci + 1;
          const t = c.getAttribute('t');
          let val = '';
          if (t === 'inlineStr') { const is = first(c, 'is'); val = is ? richText(is) : ''; }
          else {
            const v = first(c, 'v');
            const raw = v ? v.textContent : '';
            if (t === 's') val = strings[Number(raw)] ?? '';
            else if (t === 'b') val = raw === '1' ? 'TRUE' : 'FALSE';
            else if (t === 'e') val = '';
            else val = raw;
          }
          val = String(val).trim();
          if (val !== '') { cells[ci] = val; if (ci + 1 > maxCol) maxCol = ci + 1; }
        }
        if (cells.length) grid.set(r, cells);
      }
      const rowNums = [...grid.keys()].sort((a, b) => a - b);
      const lines = rowNums.map((n) => { const cells = grid.get(n); return Array.from({ length: maxCol }, (_, i) => cells[i] ?? ''); });
      if (!lines.length) return { headers: [], rows: [] };
      return { headers: lines[0], rows: lines.slice(1) };
    };

    return { names: sheets.map((s) => s.name), read };
  };
})();
