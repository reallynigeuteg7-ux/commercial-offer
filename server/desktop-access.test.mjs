import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {validDesktopAccess} from './lib/crm/desktop-access.mjs';
const key='a'.repeat(64),hash=createHash('sha256').update(key).digest('hex');
assert.equal(validDesktopAccess('Bearer '+key,hash),true);
for(const header of [null,'','Bearer '+'b'.repeat(64),'Basic '+key,'Bearer '+key+' '])assert.equal(validDesktopAccess(header,hash),false);
assert.equal(validDesktopAccess('Bearer '+key,undefined),false);
console.log('PASS: read-only feed authentication fails closed without the configured key.');
