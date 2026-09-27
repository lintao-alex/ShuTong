import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SqliteKnowledgeStore} from '../packages/user-information/dist/index.js';
import {servePanel} from '../runtime/panel.mjs';

async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'shutong-sources-'));const store=new SqliteKnowledgeStore(join(directory,'knowledge.sqlite'));
 t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
 return {directory,store};
}
const delivery=(requestId,extra={})=>({userId:'local',hostId:'codex',sessionId:'source-session',requestId,responseId:'answer-hash',explainedConceptIds:['software/cache'],mentionedConceptIds:[],...extra});

test('source lookup is read-only, user/concept scoped and omits answer hashes and text',async t=>{
 const {store}=await fixture(t);await store.recordDelivered(delivery('one'));await store.recordDelivered(delivery('one'));
 await store.recordDelivered(delivery('other-user',{userId:'other'}));await store.recordDelivered(delivery('other-concept',{explainedConceptIds:['software/hash']}));
 const before=await store.exportProfile('local'),audit=await store.auditLog('local');
 const source=await store.sources('local','software/cache');
 assert.equal(source.totalReceipts,1);assert.deepEqual(source.receipts,[{hostId:'codex',sessionId:'source-session',requestId:'one'}]);
 assert.equal(source.hasMore,false);assert.doesNotMatch(JSON.stringify(source),/answer-hash|other-user|other-concept/);
 assert.deepEqual(await store.exportProfile('local'),before);assert.deepEqual(await store.auditLog('local'),audit);
 await assert.rejects(store.sources('unknown','software/cache'),/Unknown/);
});
test('manual resets and undo preserve provenance while the current count changes',async t=>{
 const {store}=await fixture(t);await store.recordDelivered(delivery('one'));const audit=await store.auditLog('local');
 await store.undo('local',audit[0].id);let source=await store.sources('local','software/cache');
 assert.equal(source.concept.explanationCount,0);assert.equal(source.totalReceipts,1);
 await store.recordDelivered(delivery('one'));assert.equal((await store.sources('local','software/cache')).totalReceipts,1);
 await store.setExplanationCount('local','software/cache',7);source=await store.sources('local','software/cache');
 assert.equal(source.concept.explanationCount,7);assert.equal(source.totalReceipts,1);
 await store.setKnown('local','software/cache',false);assert.equal((await store.sources('local','software/cache')).totalReceipts,1);
});
test('source display is bounded and export/import preserves identifiers without invented dates',async t=>{
 const {store}=await fixture(t);for(let i=0;i<24;i++)await store.recordDelivered(delivery(String(i)));
 const source=await store.sources('local','software/cache');assert.equal(source.totalReceipts,24);assert.equal(source.receipts.length,20);assert.equal(source.hasMore,true);
 assert.equal(source.receipts[0].requestId,'23');assert.equal(source.receipts.at(-1).requestId,'4');
 const snapshot=await store.exportProfile('local');await store.importProfile('copy',snapshot);
 const copy=await store.sources('copy','software/cache');assert.equal(copy.totalReceipts,24);assert.equal(copy.receipts.length,20);
 assert.ok(copy.receipts.every(r=>Object.keys(r).length===3));
 await store.setName('local','manual','手动记录');assert.equal((await store.sources('local','manual')).totalReceipts,0);
 await store.clearProfile('local');await assert.rejects(store.sources('local','software/cache'),/Unknown/);
});
test('HTTP sources require the panel token and bind to local records',async t=>{
 const {store,directory}=await fixture(t);await store.recordDelivered(delivery('local-round'));await store.recordDelivered(delivery('private-round',{userId:'other'}));
 const panel=await servePanel(directory);t.after(()=>new Promise(resolve=>panel.server.close(resolve)));
 const url=`${panel.url}/sources?id=software%2Fcache`;
 assert.equal((await fetch(url)).status,403);
 const response=await fetch(`${url}&token=${panel.token}&user=other`);assert.equal(response.status,200);
 assert.deepEqual((await response.json()).receipts.map(r=>r.requestId),['local-round']);
 assert.equal((await fetch(`${panel.url}/sources?token=${panel.token}`)).status,400);
});
