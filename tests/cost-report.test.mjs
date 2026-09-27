import test from 'node:test';import assert from 'node:assert/strict';
import {summarize,renderReport} from '../scripts/report-cost.mjs';
const metrics={usage:{input_tokens:100,output_tokens:20,cached_input_tokens:80,reasoning_output_tokens:10},answerCharsWithoutPanelLink:50,shutongCalls:2};
const sample={title:'sample',conditions:'same model',note:'historical',baselineLabel:'off',treatmentLabel:'on',pairs:[{id:'one',baseline:metrics,treatment:{...metrics,usage:{...metrics.usage,input_tokens:120}}}]};
test('paired averages keep cache separate, preserve missing time and calculate deltas',()=>{
 const rows=summarize(sample);assert.equal(rows[0].baseline,100);assert.equal(rows[0].delta,20);assert.ok(Math.abs(rows[0].percent-20)<1e-9);assert.equal(rows[1].baseline,20);assert.equal(rows[2].baseline,80);assert.equal(rows[5].baseline,null);
});
test('incomplete and invalid pairs are rejected rather than treated as zero',()=>{
 assert.throws(()=>summarize({...sample,pairs:[]}));assert.throws(()=>summarize({...sample,pairs:[...sample.pairs,...sample.pairs]}));
 assert.throws(()=>summarize({...sample,pairs:[{id:'x',baseline:{},treatment:metrics}]}));
 assert.throws(()=>summarize({...sample,pairs:[{id:'x',baseline:{usage:{input_tokens:1,output_tokens:1,cached_input_tokens:2}},treatment:metrics}]}));
});
test('report escapes user-supplied labels and includes sample boundaries',()=>{
 const html=renderReport({summary:'<script>x</script>',experiments:[sample]});assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/不是订阅账单/);assert.match(html,/配对样本：1/);
});
