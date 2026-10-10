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
export async function syncSite(siteSession, cacheFile) {
  const response = await siteSession.fetch('https://facade-kazahstan.vercel.app/api/crm?export=backup', { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (response.status === 403 || response.status === 401) throw Error('Войдите на сайт через кнопку «Подключить сайт».');
  if (!response.ok) throw Error('Сайт временно недоступен. Сохранённые заказы остаются доступны.');
  const data = await response.json();
  const orders = siteOrders(data.crm_leads);
  await fs.writeFile(cacheFile, JSON.stringify(orders), 'utf8');
  return orders;
}
