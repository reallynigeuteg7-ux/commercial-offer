import { totals, cleanDocument, escapeXml } from '../../lib/crm/documents.mjs';

const $ = selector => document.querySelector(selector);
const api = window.documents;
const fields = ['title','number','date','recipient','phone','supplier','requisites','deadline','delivery','payment','validity','notes','pricing','vat','packagePrice'];
const formatMoney = n => n === null ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n);
let orders = [], current = null, blank, sidingRows, dirty = false, timer, saving = Promise.resolve(), lastExport;
let siteOrders = [], currentSource = null;
const allOrders = () => [...siteOrders, ...orders];
let busy = false;
const form = $('#editor');
const notice = message => { $('#notice').textContent = message; $('#notice').hidden = !message; };

function readDocument() {
  const result = Object.fromEntries(fields.map(name => [name, form.elements.namedItem(name).value]));
  result.items = [...$('#items').children].map(tr => Object.fromEntries([...tr.querySelectorAll('[data-field]')].map(el => [el.dataset.field, el.value])));
  return result;
}
function renderList() {
  const search = $('#search').value.trim().toLocaleLowerCase('ru');
  $('#count').textContent = allOrders().length;
  $('#orders').replaceChildren();
  for (const order of allOrders().filter(o => `${o.document.title} ${o.document.recipient} ${o.document.number}`.toLocaleLowerCase('ru').includes(search))) {
    const button = document.createElement('button');
    button.className = order.id === current ? 'active' : '';
    const title = document.createElement('strong'); title.textContent = order.document.title || 'Без названия';
    const info = document.createElement('small'); info.textContent = `${order.source === 'site' ? 'Сайт · ' : ''}${order.document.number} · ${order.document.recipient || order.document.date.split('-').reverse().join('.')}`;
    button.append(title, info);
    button.addEventListener('click', () => run(async () => { await saveCurrent(); const local = order.source === 'site' ? orders.find(o => o.sourceId === order.id) : order; load(local?.document || order.document, local?.id || null); currentSource = order.source === 'site' ? order.id : order.sourceId || null; }));
    $('#orders').append(button);
  }
  if (!$('#orders').children.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = search ? 'Заказы не найдены.' : 'Создайте первый заказ. Он появится здесь и останется доступен после закрытия программы.'; $('#orders').append(p); }
}
function itemRow(item, index) {
  const row = document.createElement('tr');
  row.innerHTML = `<td><input data-field="name" maxlength="600" aria-label="Наименование ${index+1}" placeholder="Название товара или работы" value="${escapeXml(item.name)}"><textarea data-field="description" maxlength="600" rows="2" aria-label="Размеры и примечания ${index+1}" placeholder="Размеры, материал, цвет и другие детали">${escapeXml(item.description)}</textarea></td><td><input data-field="unit" list="units" maxlength="30" aria-label="Единица ${index+1}" value="${escapeXml(item.unit)}"></td><td><input data-field="quantity" inputmode="decimal" aria-label="Количество ${index+1}" placeholder="0" value="${escapeXml(item.quantity)}"></td><td><input data-field="price" inputmode="decimal" aria-label="Цена ${index+1}" placeholder="0,00" value="${escapeXml(item.price)}"></td><td class="amount">—</td><td><button type="button" class="remove" aria-label="Убрать позицию ${index+1}">×</button></td>`;
  row.querySelector('.remove').addEventListener('click', () => {
    if ($('#items').children.length === 1) { notice('В заказе должна быть хотя бы одна позиция.'); return; }
    row.remove(); changed();
  });
  return row;
}
function load(doc, id = null) {
  clearTimeout(timer); current = id; currentSource = null; dirty = false;
  for (const name of fields) form.elements.namedItem(name).value = doc[name] ?? '';
  $('#items').replaceChildren(...doc.items.map(itemRow));
  $('#preset').value = ''; $('#exported').hidden = true;
  $('#save-status').textContent = id ? 'Сохранено на компьютере' : 'Готов к заполнению';
  notice(''); renderList(); recalculate();
}
function recalculate() {
  const doc = readDocument();
  $('#page-title').textContent = doc.title || 'Новый заказ';
  $('#package-field').hidden = doc.pricing !== 'package';
  for (const input of document.querySelectorAll('[data-field="price"]')) input.disabled = doc.pricing === 'package';
  let summary;
  try { summary = totals(doc); } catch { summary = { total: null, amounts: [] }; }
  [...$('#items').children].forEach((tr, i) => { tr.querySelector('.amount').textContent = doc.pricing === 'package' ? '—' : formatMoney(summary.amounts[i] ?? null); });
  $('#total').textContent = formatMoney(summary.total);
  $('#total-label').textContent = `Итого${doc.vat === 'included' ? ' с НДС' : doc.vat === 'without' ? ' без НДС' : ''}`;
  $('#item-count').textContent = `Позиций: ${doc.items.length}`;
}
function changed() {
  dirty = true; recalculate(); clearTimeout(timer);
  $('#save-status').textContent = 'Сохранение…';
  timer = setTimeout(() => saveCurrent().catch(() => { $('#save-status').textContent = 'Проверьте введённые данные'; }), 800);
}
async function saveCurrent() {
  clearTimeout(timer);
  const work = async () => {
    if (!dirty) return;
    const doc = readDocument();
    const snapshot = JSON.stringify(doc);
    const saved = await api.save({ id: current, sourceId: currentSource, document: doc });
    current = saved.id;
    orders = [saved, ...orders.filter(o => o.id !== saved.id)].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
    dirty = JSON.stringify(readDocument()) !== snapshot;
    $('#save-status').textContent = dirty ? 'Сохранение…' : 'Сохранено на компьютере';
    renderList();
  };
  saving = saving.then(work, work);
  await saving;
}
async function run(action) {
  if (busy) return;
  busy = true; notice('');
  try { await action(); } catch(e) { notice(e.message); }
  finally { busy = false; }
}
async function newOrder(preset) {
  await saveCurrent();
  const doc = structuredClone(blank);
  doc.number = String(Date.now()).slice(-7);
  doc.date = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
  if (preset === 'bench') {
    doc.title = 'Скамейка + урна';
    doc.items = ['Скамейка','Урна'].map(name => ({name, description:'',unit:'шт',quantity:'',price:''}));
  }
  if (preset === 'siding') {
    doc.title = 'Сайдинг'; doc.pricing = 'package';
    doc.items = sidingRows.map(([name,description,unit]) => ({ name,description,unit,quantity:'',price:'' }));
  }
  load(doc);
  if (preset) { dirty = true; await saveCurrent(); }
  form.elements.title.focus();
}
form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('input', event => { if (event.target.id !== 'preset') changed(); });
form.addEventListener('change', event => { if (event.target.id !== 'preset') changed(); });
$('#new').addEventListener('click', () => run(() => newOrder()));
$('#preset').addEventListener('change', event => { const choice = event.target.value; if (choice) void run(() => newOrder(choice)); });
$('#add').addEventListener('click', () => { if ($('#items').children.length >= 100) return notice('Максимум 100 позиций в одном заказе.'); $('#items').append(itemRow({name:'',description:'',unit:'шт',quantity:'',price:''}, $('#items').children.length)); changed(); });
$('#search').addEventListener('input', renderList);
$('#save').addEventListener('click', () => run(async () => { dirty = true; await saveCurrent(); }));
$('#duplicate').addEventListener('click', () => run(async () => { await saveCurrent(); const doc = readDocument(); doc.number = String(Date.now()).slice(-7); doc.title = `${doc.title || 'Заказ'} (копия)`; load(doc); dirty = true; await saveCurrent(); }));
for (const kind of ['kp','pp']) $('#'+kind).addEventListener('click', () => run(async () => {
  cleanDocument(readDocument(), true);
  dirty = true; await saveCurrent();
  const result = await api.export({ document: readDocument(), kind });
  if (result) { lastExport = result.path; $('#export-name').textContent = result.name; $('#exported').hidden = false; }
}));
$('#open-export').addEventListener('click', () => run(() => api.openExport(lastExport)));
$('#dismiss-export').addEventListener('click', () => { $('#exported').hidden = true; });
$('#backup').addEventListener('click', () => run(async () => { await saveCurrent(); const result = await api.backup(); if (result) $('#save-status').textContent = 'Резервная копия сохранена'; }));
$('#import').addEventListener('click', () => run(async () => { await saveCurrent(); const count = await api.import(); if (count !== null) { orders = await api.list(); renderList(); $('#save-status').textContent = `Добавлено заказов: ${count}`; } }));
$('#folder').addEventListener('click', () => run(() => api.folder()));
api.onBeforeClose(() => run(async () => { await saveCurrent(); await api.close(); }));
document.addEventListener('keydown', event => { if (event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); void run(async () => { dirty = true; await saveCurrent(); }); } });
void run(async () => { const data = await api.init(); ({orders,blank,sidingRows} = data); load(blank); siteOrders = await api.siteCache(); renderList(); try { await refreshSite(); } catch { /* Local and cached orders remain available. */ } });

async function refreshSite() {
  $('#site-status').textContent = 'Загрузка заказов…';
  try { siteOrders = await api.siteSync(); renderList(); $('#site-status').textContent = 'Подключено · Заказов сайта: ' + siteOrders.length; }
  catch(e) { $('#site-status').textContent = e.message; throw e; }
}
$('#sync').addEventListener('click', () => run(() => refreshSite()));
setInterval(() => { if (!busy) void refreshSite().catch(() => {}); }, 60000);
window.addEventListener('online', () => { void refreshSite().catch(() => {}); });
