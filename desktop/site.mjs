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
  if (response.status === 403 || response.status === 401) throw Object.assign(Error('Введите пароль администратора для первого входа.'), { code: 'AUTH_REQUIRED' });
  if (!response.ok) throw Error('Сайт временно недоступен. Сохранённые заказы остаются доступны.');
  const data = await response.json();
  const orders = siteOrders(data.crm_leads);
  await fs.writeFile(cacheFile, JSON.stringify(orders), 'utf8');
  return orders;
}

export function connectedSite(siteSession, cacheFile, credentialFile, storage) {
  const origin = 'https://facade-kazahstan.vercel.app';
  let pending, authBlocked = false;
  async function authenticate(password, remember) {
    if (typeof password !== 'string' || !password || password.length > 256) throw Error('Введите пароль администратора сайта.');
    if (remember && !storage.isEncryptionAvailable()) throw Error('Windows не может защитить данные входа.');
    const response = await siteSession.fetch(origin + '/api/auth/login', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ password }) });
    if (!response.ok) {
      const data = await response.json();
      if ([401, 429].includes(response.status)) authBlocked = true;
      throw Object.assign(Error(data.error || 'Не удалось войти.'), { code: [401, 429].includes(response.status) ? 'AUTH_REQUIRED' : 'NETWORK' });
    }
    if (remember) {
      await fs.writeFile(credentialFile + '.tmp', storage.encryptString(password));
      await fs.rename(credentialFile + '.tmp', credentialFile);
    }
    authBlocked = false;
    await siteSession.cookies.flushStore();
  }
  return {
    async login(password) {
      if (pending) await pending.catch(() => {});
      await authenticate(password, true);
      return syncSite(siteSession, cacheFile);
    },
    sync() {
      if (pending) return pending;
      pending = (async () => {
        try { return await syncSite(siteSession, cacheFile); }
        catch (e) {
          if (e.code !== 'AUTH_REQUIRED') throw e;
          if (authBlocked) throw e;
          let password;
          try {
            if (!storage.isEncryptionAvailable()) throw Error();
            password = storage.decryptString(await fs.readFile(credentialFile));
          } catch { throw e; }
          await authenticate(password, false);
          return syncSite(siteSession, cacheFile);
        }
      })().finally(() => { pending = null; });
      return pending;
    },
  };
}
