(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const CSV = (ER.csv = {});

  // Parse CSV text. Handles quotes, escaped quotes, CRLF, BOM, and comma/semicolon/tab delimiters.
  CSV.parse = (text) => {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let q = false;
    for (const ch of firstLine) {
      if (ch === '"') q = !q;
      else if (!q && ch in counts) counts[ch]++;
    }
    const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];

    const rows = [];
    let row = [], cell = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
        } else cell += ch;
      } else if (ch === '"' && cell === '') inQ = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        rows.push(row); row = [];
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }

    const clean = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
    if (!clean.length) return { headers: [], rows: [] };
    const headers = clean[0].map((h) => String(h).trim());
    return { headers, rows: clean.slice(1).map((r) => r.map((c) => String(c).trim())) };
  };

  const cellOut = (v) => {
    let s = String(v ?? '');
    // stop spreadsheet apps treating text as a formula
    if (/^[=+@]/.test(s) || (/^-/.test(s) && !/^-?[\d.]+$/.test(s))) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  CSV.stringify = (rows) => rows.map((r) => r.map(cellOut).join(',')).join('\r\n');

  // Decode uploaded file bytes (UTF-8, falling back to Windows-1252 as exported by older Excel).
  CSV.decode = (buf) => {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder('windows-1252').decode(buf); }
  };
})();
