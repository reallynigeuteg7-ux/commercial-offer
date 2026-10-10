import CFB from 'cfb';
import template from '../lib/crm/document-xls-template.json' with { type: 'json' };
import { cleanDocument, totals, vatLabels, documentHeading, extraLines } from '../lib/crm/documents.mjs';

const record = (code, data) => {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(code);
  header.writeUInt16LE(data.length, 2);
  return Buffer.concat([header, data]);
};
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const cellHead = (row, col, style) => Buffer.concat([u16(row), u16(col), u16(style)]);
const rowHeight = (values, widths) => Math.min(8190, Math.max(660, ...values.map((v, i) => String(v).split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / widths[i])), 0) * 300 + 200)));

// Reuse the verified BIFF8 template, including its embedded logo and print layout.
// New line items and formulas are real Excel cells, not HTML renamed to .xls.
export function quoteXls(input, kind) {
  if (!['kp', 'pp'].includes(kind)) throw Error('Неизвестный вид документа.');
  const doc = cleanDocument(input, true);
  const { amounts, total } = totals(doc);
  const vat = vatLabels[doc.vat];
  const replacements = {
    __HEADING__: documentHeading(kind), __TITLE__: doc.title,
    __META__: `№ ${kind.toUpperCase()}-${doc.number} от ${doc.date.split('-').reverse().join('.')} · Валюта: тенге`,
    __CLIENT__: [doc.recipient && `Клиент: ${doc.recipient}`, doc.phone && `Телефон: ${doc.phone}`].filter(Boolean).join(' · '),
    'Сумма с НДС': `Сумма ${vat}`.trim(),
  };
  const strings = template.strings.map(s => replacements[s] ?? s);
  const indexes = new Map(strings.map((s, i) => [s, i]));
  const intern = s => { if (!indexes.has(s)) { indexes.set(s, strings.length); strings.push(s); } return indexes.get(s); };
  const text = (row, col, value, style = 20) => {
    const index = Buffer.alloc(4); index.writeUInt32LE(intern(String(value)));
    return record(0xfd, Buffer.concat([cellHead(row, col, style), index]));
  };
  const number = (row, col, value, style = 22) => {
    if (value === null) return record(0x201, cellHead(row, col, style));
    const bytes = Buffer.alloc(8); bytes.writeDoubleLE(value);
    return record(0x203, Buffer.concat([cellHead(row, col, style), bytes]));
  };
  const formula = (row, col, value, tokens, style = 23) => {
    const data = Buffer.alloc(22 + tokens.length);
    cellHead(row, col, style).copy(data);
    data.writeDoubleLE(value, 6);
    data.writeUInt16LE(tokens.length, 20); tokens.copy(data, 22);
    return record(6, data);
  };
  const ref = (row, col) => Buffer.concat([Buffer.from([0x44]), u16(row), u16(col)]);
  const row = (r, height) => {
    const data = Buffer.from(template.sheet.find(s => s.code === 0x208 && Buffer.from(s.data, 'base64').readUInt16LE() === 9).data, 'base64');
    data.writeUInt16LE(r); data.writeUInt16LE(height, 6);
    return record(0x208, data);
  };
  const merges = [[1, 3, 3, 6], [5, 5, 1, 6], [6, 6, 1, 6], [7, 7, 1, 6]];
  const cells = [];
  doc.items.forEach((item, index) => {
    const r = 9 + index;
    cells.push(row(r, rowHeight([item.name, item.description], [27, 32])), text(r, 1, item.name), text(r, 2, item.description), text(r, 3, item.unit), number(r, 4, Number(item.quantity), 21));
    if (doc.pricing === 'package') {
      cells.push(number(r, 5, null), number(r, 6, index === 0 ? total : null, 23));
    } else {
      // ROUND(E[row]*F[row], 2), with cached values available in all XLS readers.
      const tokens = Buffer.concat([ref(r, 4), ref(r, 5), Buffer.from([0x05, 0x1e, 2, 0, 0x41, 27, 0])]);
      cells.push(number(r, 5, Number(item.price)), formula(r, 6, amounts[index], tokens));
    }
  });
  const last = 8 + doc.items.length;
  if (doc.pricing === 'package' && doc.items.length > 1) merges.push([9, last, 6, 6]);
  let r = last + 1;
  const area = Buffer.concat([Buffer.from([0x45]), u16(9), u16(last), u16(6), u16(6), Buffer.from([0x42, 1, 4, 0])]);
  cells.push(row(r, 560), text(r, 1, `Итого ${vat}`.trim(), 24));
  for (let c = 2; c <= 5; c++) cells.push(number(r, c, null, 24));
  cells.push(formula(r, 6, total, area, 24));
  merges.push([r, r, 1, 5]);
  r += 2;
  const terms = [
    ...(doc.pricing === 'package' ? [['Расчёт', 'Общая цена за комплект.']] : []),
    ...extraLines(doc, kind),
    ['Поставщик', doc.supplier],
  ];
  for (const [label, value] of terms) {
    const content = `${label}: ${value}`;
    cells.push(row(r, rowHeight([content], [108])), text(r, 1, content, 18));
    merges.push([r, r, 1, 6]); r++;
  }
  const mergeData = Buffer.concat([u16(merges.length), ...merges.map(m => Buffer.concat(m.map(u16)))]);
  const cellCodes = new Set([0x208, 0xfd, 0xbe, 0xbd, 0x203, 0x201, 6]);
  const sheet = [];
  let inserted = false;
  for (const original of template.sheet) {
    const data = Buffer.from(original.data, 'base64');
    if (cellCodes.has(original.code) && data.readUInt16LE() >= 9) {
      if (!inserted) { sheet.push(...cells); inserted = true; }
      continue;
    }
    if (original.code === 0xe5) { sheet.push(record(0xe5, mergeData)); continue; }
    if (original.code === 0x200) data.writeUInt32LE(r + 1, 4);
    if (original.code === 0xa1) data.writeUInt16LE(0, 8); // Multiple pages vertically, one page wide.
    if (original.code === 0x208) {
      const ri = data.readUInt16LE();
      if (ri === 5 || ri === 7) data.writeUInt16LE(rowHeight([ri === 5 ? doc.title : replacements.__CLIENT__], [100]), 6);
    }
    sheet.push(record(original.code, data));
  }
  const head = Buffer.alloc(8);
  head.writeUInt32LE(sheet.filter(b => b.readUInt16LE() === 0xfd).length); head.writeUInt32LE(strings.length, 4);
  const sst = []; let parts = [head], size = 8, code = 0xfc;
  for (const s of strings) {
    const payload = Buffer.concat([u16(s.length), Buffer.from([1]), Buffer.from(s, 'utf16le')]);
    if (size + payload.length > 8224) { sst.push(record(code, Buffer.concat(parts))); parts = []; size = 0; code = 0x3c; }
    parts.push(payload); size += payload.length;
  }
  sst.push(record(code, Buffer.concat(parts)));
  const globals = template.globals.flatMap(original => original.code === 0xfc ? sst : [record(original.code, Buffer.from(original.data, 'base64'))]);
  globals.find(b => b.readUInt16LE() === 0x85).writeUInt32LE(globals.reduce((n, b) => n + b.length, 0), 4);
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, '/Workbook', Buffer.concat([...globals, ...sheet]));
  return CFB.write(cfb, { type: 'buffer' });
}
