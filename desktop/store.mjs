import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanDocument, documentDefaults } from '../lib/crm/documents.mjs';

export function blankDocument() {
  return documentDefaults({ id: String(Date.now()).slice(-7), product: '', name: '', quantity: '', amount: 0 });
}
export function createStore(directory) {
  const file = path.join(directory, 'orders.json');
  let queue = Promise.resolve();
  async function read() {
    await fs.mkdir(directory, { recursive: true });
    try {
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      if (value.version !== 1 || !Array.isArray(value.orders)) throw Error('Неверный формат базы заказов.');
      return value;
    } catch (e) {
      if (e.code === 'ENOENT') return { version: 1, orders: [] };
      throw Error('Не удалось прочитать заказы. Исходный файл сохранён. Восстановите резервную копию или обратитесь за помощью.');
    }
  }
  async function write(db) {
    const temp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(db, null, 2), 'utf8');
    try { await fs.copyFile(file, `${file}.bak`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await fs.rename(temp, file);
  }
  const mutate = fn => {
    const job = queue.then(async () => { const db = await read(); const result = await fn(db); await write(db); return result; });
    queue = job.catch(() => {}); return job;
  };
  return {
    file,
    async list() { await queue; return (await read()).orders.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    save(input) {
      return mutate(db => {
        const doc = cleanDocument(input.document);
        let saved = input.id ? db.orders.find(o => o.id === input.id) : null;
        if (input.id && !saved) throw Error('Заказ не найден. Создайте новый заказ.');
        if (db.orders.length >= 10000 && !saved) throw Error('Слишком много заказов в базе.');
        if (!saved) { saved = { id: randomUUID(), createdAt: new Date().toISOString() }; db.orders.push(saved); }
        if (typeof input.sourceId === 'string' && input.sourceId.startsWith('site:') && input.sourceId.length < 150) saved.sourceId = input.sourceId;
        Object.assign(saved, { document: doc, updatedAt: new Date().toISOString() });
        return saved;
      });
    },
    async backup() { await queue; return await read(); },
    importBackup(input) {
      // Validate all entries before writing. Import adds copies, preserving current orders.
      if (input?.version !== 1 || !Array.isArray(input.orders) || input.orders.length > 10000) throw Error('Выберите резервную копию Facade Документы.');
      const documents = input.orders.map(o => cleanDocument(o.document));
      return mutate(db => {
        if (db.orders.length + documents.length > 10000) throw Error('Слишком много заказов для импорта.');
        for (const doc of documents) db.orders.push({ id: randomUUID(), document: doc, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        return documents.length;
      });
    },
  };
}
