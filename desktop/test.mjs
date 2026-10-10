import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quoteXls } from './document-xls.mjs';
import { blankDocument, createStore } from './store.mjs';
import { totals, sidingRows } from '../lib/crm/documents.mjs';
import CFB from 'cfb';

const output = process.env.FACADE_TEST_OUTPUT || await fs.mkdtemp(path.join(os.tmpdir(),'facade-documents-test-'));
await fs.mkdir(output,{recursive:true});
const bench = {...blankDocument(),title:'Скамейка + урна',number:'ТЕСТ-001',recipient:'Пример клиента',phone:'+7 000 000 00 00',deadline:'15 рабочих дней',payment:'Предоплата 50%',delivery:'Кызылорда',notes:'Размеры согласуются с заказчиком.',items:[{name:'Скамейка Этно',description:'1800 × 850 × 620 мм; белый металл и дерево',unit:'шт',quantity:'15',price:'65000'},{name:'Урна',description:'500 × 700 мм; порошковая покраска',unit:'шт',quantity:'15',price:'40000'}]};
const siding = {...bench,title:'Сайдинг',number:'ТЕСТ-002',pricing:'package',packagePrice:'50440000',items:sidingRows.map(([name,description,unit],index)=>({name,description,unit,quantity:String([5200,8100,7000,93.75,1,8100,21400,87,10000,2600,5200,5200][index]),price:''}))};
assert.equal(totals(bench).total,1575000);
const records = bytes => {
  const raw = CFB.find(CFB.read(bytes,{type:'buffer'}),'Workbook').content;
  const result=[];
  for(let p=0;p+4<=raw.length;) {const code=raw.readUInt16LE(p), length=raw.readUInt16LE(p+2);if(code===0&&length===0)break;result.push({code,data:raw.subarray(p+4,p+4+length)});p+=length+4;}
  return result;
};
for (const [name,doc,kind] of [['bench-kp',bench,'kp'],['bench-pp',bench,'pp'],['siding-pp',siding,'pp'],['decimal-kp',{...bench,vat:'without',items:[{name:'=HYPERLINK("bad")',description:'Текст',unit:'м²',quantity:'0.1',price:'0.15'}]},'kp'],['long-kp',{...bench,notes:'А'.repeat(3000),items:Array.from({length:100},(_,i)=>({...bench.items[0],name:`Позиция ${i+1}`,description:'Описание '.repeat(55)}))},'kp']]) {
  const bytes=quoteXls(doc,kind);assert.equal(bytes.subarray(0,8).toString('hex'),'d0cf11e0a1b11ae1');
  const rr=records(bytes);const formulas=rr.filter(r=>r.code===6);assert.equal(formulas.length,doc.pricing==='package'?1:doc.items.length+1);assert.equal(formulas.at(-1).data.readDoubleLE(6),totals(doc).total);
  assert.ok(rr.some(r=>r.code===0x7f));
  assert.equal(typeof name, 'string');
  if (typeof name !== 'string') throw Error('Invalid fixture name');
  await fs.writeFile(path.join(output,`${name}.xls`),bytes);
}
assert.throws(()=>quoteXls({...bench,items:[{...bench.items[0],price:''}]},'kp'));
assert.throws(()=>quoteXls({...bench,items:[{...bench.items[0],quantity:'0'}]},'kp'));
assert.throws(()=>quoteXls({...bench,date:'2026-02-30'},'pp'));
assert.throws(()=>quoteXls(bench,'bad'));
const storeDirectory = await fs.mkdtemp(path.join(output,'store-'));
const store = createStore(storeDirectory);
const saved=await store.save({document:bench});
await store.save({id:saved.id,document:{...bench,title:'Изменённый заказ'}});
assert.equal((await createStore(storeDirectory).list())[0].document.title,'Изменённый заказ');
await Promise.all([store.save({document:siding}),store.save({document:bench})]);
assert.equal((await store.list()).length,3);
const backup=await store.backup();await store.importBackup(backup);assert.equal((await store.list()).length,6);
assert.throws(()=>store.importBackup({version:1,orders:[{document:{}}]}));
assert.equal((await store.list()).length,6);
await fs.writeFile(path.join(output,'test-bench.json'),JSON.stringify({version:1,orders:[{document:bench}]},null,2));
console.log('PASS: native XLS, 1/2/12/100 items, package price, live formulas/cache, embedded logo, decimals, validation, persistence, concurrent writes and backup import.');
console.log(output);
