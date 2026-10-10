import fs from 'node:fs/promises';
import { documentDefaults } from '../lib/crm/documents.mjs';
export function siteOrders(leads) {
  if (!Array.isArray(leads) || leads.length > 10000) throw Error('Неверный ответ сайта.');
  const groups = new Map();
  for (const lead of leads) {
    if (!lead.id) throw Error('Заявка без номера.');
    const key = lead.order_group || lead.request_id || lead.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lead);
  }
  return [...groups.values()].map(positions => {
    const lead = positions[0];
    return { id: `site:${lead.order_group || lead.request_id || lead.id}`, source: 'site', stage: lead.stage,
      createdAt: lead.created_at || '', updatedAt: lead.updated_at || lead.created_at || '', document: documentDefaults(lead, positions) };
  });
}
export async function syncSite(siteSession, cacheFile, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw Error('Эта сборка не настроена для заказов сайта. Установите последнюю версию приложения.');
  const response = await siteSession.fetch('https://facade-kazahstan.vercel.app/api/desktop/orders', { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: 'Bearer ' + token } });
  if (response.status === 403 || response.status === 401) throw Error('Доступ этой версии приложения обновлён. Установите последнюю сборку.');
  if (!response.ok) throw Error('Сайт временно недоступен. Сохранённые заказы остаются доступны.');
  const data = await response.json();
  const orders = siteOrders(data.orders);
  await fs.writeFile(cacheFile + '.tmp', JSON.stringify(orders), 'utf8');
  await fs.rename(cacheFile + '.tmp', cacheFile);
  return orders;
}
export function connectedSite(siteSession, cacheFile, token) {
  let pending;
  return { sync() {
    if (pending) return pending;
    pending = syncSite(siteSession, cacheFile, token).finally(() => { pending = null; });
    return pending;
  } };
}
