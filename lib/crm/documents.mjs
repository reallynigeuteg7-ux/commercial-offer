export const vatLabels = {
  included: 'с НДС',
  without: 'без НДС',
  unspecified: '',
};
const str = (v, max = 600) => {
  if (
    typeof v !== 'string' ||
    v.length > max ||
    v.split('').some(
      (c) => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)),
    )
  )
    throw Error('Проверьте текстовые поля документа.');
  return v.trim();
};
export function decimal(value, places, max, label) {
  if (value === '') return null;
  const raw = String(value).replace(/\s/g, '').replace(',', '.');
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(raw))
    throw Error('Проверьте ' + label + '.');
  const n = Number(raw);
  if (!Number.isFinite(n) || n > max)
    throw Error('Слишком большое значение: ' + label + '.');
  return n;
}
export function lineAmount(item) {
  const q = decimal(item.quantity, 4, 1e7, 'количество');
  const p = decimal(item.price, 2, 1e9, 'цену');
  if (q === null || p === null) return null;
  const cents =
    (BigInt(Math.round(q * 1e4)) * BigInt(Math.round(p * 100)) + 5000n) /
    10000n;
  if (cents > 100000000000000n)
    throw Error('Сумма позиции превышает допустимое значение.');
  return Number(cents) / 100;
}
export function totals(doc) {
  const amounts = doc.items.map(lineAmount);
  const total =
    doc.pricing === 'package'
      ? decimal(doc.packagePrice, 2, 1e12, 'цену комплекта')
      : amounts.some((v) => v === null)
        ? null
        : amounts.reduce((s, v) => s + Math.round(v * 100), 0) / 100;
  if (total !== null && total > 1e12)
    throw Error('Общая сумма слишком велика.');
  return { amounts, total };
}
export function cleanDocument(input, complete = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('Неверные данные документа.');
  const doc = {};
  for (const key of [
    'title',
    'number',
    'date',
    'recipient',
    'phone',
    'supplier',
    'requisites',
    'deadline',
    'delivery',
    'payment',
    'validity',
    'notes',
  ])
    doc[key] = str(
      input[key] ?? '',
      key === 'requisites' || key === 'notes' ? 3000 : 600,
    );
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(doc.date) ||
    !Number.isFinite(Date.parse(doc.date)) ||
    new Date(doc.date).toISOString().slice(0, 10) !== doc.date
  )
    throw Error('Проверьте дату документа.');
  if (
    !['lines', 'package'].includes(input.pricing) ||
    !Object.hasOwn(vatLabels, input.vat)
  )
    throw Error('Проверьте способ расчёта и НДС.');
  doc.pricing = input.pricing;
  doc.vat = input.vat;
  doc.packagePrice =
    input.packagePrice === ''
      ? ''
      : String(decimal(input.packagePrice, 2, 1e12, 'цену комплекта'));
  if (
    !Array.isArray(input.items) ||
    !input.items.length ||
    input.items.length > 100
  )
    throw Error('Добавьте от 1 до 100 позиций.');
  doc.items = input.items.map((i) => {
    if (!i || typeof i !== 'object') throw Error('Неверная позиция.');
    const item = {
      name: str(i.name),
      description: str(i.description),
      unit: str(i.unit, 30),
      quantity:
        i.quantity === ''
          ? ''
          : String(decimal(i.quantity, 4, 1e7, 'количество')),
      price: i.price === '' ? '' : String(decimal(i.price, 2, 1e9, 'цену')),
    };
    if (
      complete &&
      (!item.name ||
        !item.unit ||
        item.quantity === '' ||
        Number(item.quantity) <= 0 ||
        (doc.pricing === 'lines' && item.price === ''))
    )
      throw Error(
        'Заполните наименование, единицу, количество и цену каждой позиции.',
      );
    return item;
  });
  const { total } = totals(doc);
  if (
    complete &&
    (!doc.title || !doc.supplier || !doc.number || total === null)
  )
    throw Error('Заполните тему, поставщика, номер и цену комплекта.');
  return doc;
}
export function documentDefaults(lead, positions = [lead]) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Qyzylorda',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return {
    title: positions.map((p) => p.product).join(' / '),
    number: String(lead.id).slice(0, 8).toUpperCase(),
    date,
    recipient: lead.name || '',
    phone: lead.phone || '',
    supplier: 'Facade Kazakhstan',
    requisites: '',
    deadline: lead.deadline || '',
    delivery: lead.city || '',
    payment: '',
    validity: '',
    notes: '',
    vat: 'included',
    pricing: 'lines',
    packagePrice: '',
    items: positions.map((p) => {
      const match = String(p.quantity || '')
        .trim()
        .match(
          /^(\d+(?:[.,]\d{1,4})?)\s*(шт\.?|м[²2]|м|пог\.?\s*м|компл\.?)?$/i,
        );
      const quantity = match ? match[1].replace(',', '.') : '';
      return {
        name: p.product || '',
        description: [p.size, p.finish].filter(Boolean).join('; '),
        unit: match?.[2] || 'шт',
        quantity,
        price:
          p.amount > 0 && Number(quantity) > 0
            ? (p.amount / Number(quantity)).toFixed(2)
            : '',
      };
    }),
  };
}
export const sidingRows = [
  ['Сайдинг «Эльбрус»', 'Crystal, 0,40, RAL 7024 графит', 'м²'],
  ['Кронштейн ККУ', '80×150 (оцинк., 1,20)', 'шт'],
  ['Профиль Г-образный', '60×44 (оцинк., 1,20)', 'пог.м'],
  ['Лист плоский 1250 мм', 'Crystal, 0,40, RAL 7024 графит', 'м²'],
  ['Упаковка для сайдинга «Эльбрус» на поддон, большая', '', 'упаковка'],
  ['Анкер клиновой', '10×100, цинк', 'шт'],
  ['Зонтик-дюбель', '100 мм', 'шт'],
  ['Изоспан', '', 'рулон'],
  ['Шуруп', '4,2×19', 'шт'],
  ['J-профиль', 'Серый матовый 7024', 'м'],
  ['Минеральная плита', 'П75 1000×600×50', 'м²'],
  ['Монтажная работа', 'Под ключ', 'м²'],
];
export const money = (n) =>
  n === null
    ? '—'
    : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n);
export const escapeXml = (v) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c],
  );
export function documentHeading(kind) {
  return kind === 'kp' ? 'Коммерческое предложение' : 'Ценовое предложение';
}
export function extraLines(doc, kind) {
  if (kind !== 'kp') return doc.notes ? [['Примечание', doc.notes]] : [];
  return [
    ['Срок изготовления', doc.deadline],
    ['Доставка', doc.delivery],
    ['Условия оплаты', doc.payment],
    ['Срок действия предложения', doc.validity],
    ['Реквизиты поставщика', doc.requisites],
    ['Примечание', doc.notes],
  ].filter(([, v]) => v);
}
export function documentHtml(doc, kind) {
  const { amounts, total } = totals(doc),
    vat = vatLabels[doc.vat],
    e = escapeXml;
  const rows = doc.items
    .map(
      (i, k) =>
        `<tr><td>${e(i.name)}</td><td>${e(i.description)}</td><td>${e(i.unit)}</td><td class="n">${money(Number(i.quantity))}</td><td class="n">${doc.pricing === 'package' ? '—' : money(Number(i.price))}</td>${doc.pricing === 'package' ? (k === 0 ? `<td class="n" rowspan="${doc.items.length}">${money(total)}</td>` : '') : `<td class="n">${money(amounts[k])}</td>`}</tr>`,
    )
    .join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(documentHeading(kind))} ${e(doc.number)}</title><style>body{font:14px Arial;color:#151515;background:#eee;margin:0}.paper{max-width:1040px;margin:24px auto;background:white;padding:36px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #aaa;padding-bottom:18px}header img{width:120px;height:70px;object-fit:contain}h1{font-size:26px;margin:26px 0 10px}h2{font-size:18px;font-weight:normal}table{border-collapse:collapse;width:100%;margin:24px 0;table-layout:fixed}th,td{border:1px solid #999;padding:12px 9px;vertical-align:middle;overflow-wrap:anywhere}th{background:#e8ebe4;font-size:12px}th:nth-child(1){width:22%}th:nth-child(2){width:28%}th:nth-child(3){width:7%}th:nth-child(4){width:10%}.n{text-align:right}tfoot{font-weight:bold}.terms{white-space:pre-line}button{padding:12px 18px;cursor:pointer}.tools{max-width:1112px;margin:16px auto}@page{size:A4 landscape;margin:12mm}@media print{body{background:white}.paper{max-width:none;margin:0;padding:0}.tools{display:none}thead{display:table-header-group}tr{break-inside:avoid}h1{font-size:22px}td{padding:8px}header img{width:100px;height:54px}}@media(max-width:600px){.paper{padding:16px;min-width:760px}.tools{padding:0 16px}}</style></head><body><div class="tools"><button onclick="window.print()">Печать / Сохранить PDF</button></div><main class="paper"><header><strong>${e(doc.supplier)}</strong><img src="/facade-logo-black.svg" alt="Facade Kazakhstan"></header><h1>${documentHeading(kind)}</h1><p>№ ${kind.toUpperCase()}-${e(doc.number)} от ${e(doc.date.split('-').reverse().join('.'))}</p><h2>${e(doc.title)}</h2>${kind === 'kp' ? `<p>Клиент: ${e(doc.recipient)}${doc.phone ? ` · ${e(doc.phone)}` : ''}</p>` : ''}<p>${doc.vat === 'included' ? 'Цены включают НДС.' : doc.vat === 'without' ? 'Цены указаны без НДС.' : 'Налоговый режим не указан.'}${doc.pricing === 'package' ? ' Общая цена за комплект.' : ''}</p><table><thead><tr><th>Наименование</th><th>Примечание</th><th>Ед. изм.</th><th>Количество</th><th>Цена за ед., ₸</th><th>Сумма ${vat}, ₸</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="5">Итого ${vat}:</td><td class="n">${money(total)} ₸</td></tr></tfoot></table>${extraLines(
    doc,
    kind,
  )
    .map(
      ([label, value]) =>
        `<p class="terms"><strong>${label}:</strong> ${e(value)}</p>`,
    )
    .join('')}</main></body></html>`;
}
