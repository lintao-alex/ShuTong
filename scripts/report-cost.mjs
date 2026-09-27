// Offline only: summarizes explicitly supplied measurements, never invokes a model.
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
export function summarize(experiment){
  if(!Array.isArray(experiment.pairs)||!experiment.pairs.length||experiment.pairs.length>1000)throw Error('Provide 1–1000 matched pairs');
  if(new Set(experiment.pairs.map(p=>p.id)).size!==experiment.pairs.length)throw Error('Duplicate pair ID');
  for(const p of experiment.pairs)for(const side of ['baseline','treatment']){
    const m=p[side];if(!m||!number(m.usage?.input_tokens)||!number(m.usage?.output_tokens))throw Error('Missing valid input/output usage');
    if(m.usage.cached_input_tokens!=null&&(!number(m.usage.cached_input_tokens)||m.usage.cached_input_tokens>m.usage.input_tokens))throw Error('Invalid cache subset');
  }
  const fields=[['输入 Token',m=>m.usage.input_tokens],['输出 Token',m=>m.usage.output_tokens],
    ['缓存输入（已含在输入中）',m=>m.usage.cached_input_tokens],['可见正文字符',m=>m.answerCharsWithoutPanelLink],
    ['ShuTong 调用',m=>m.shutongCalls],['耗时（秒）',m=>m.durationMs==null?null:m.durationMs/1000]];
  return fields.map(([label,get])=>{
    const mean=side=>{const values=experiment.pairs.map(p=>get(p[side]));return values.every(number)?values.reduce((a,b)=>a+b,0)/values.length:null;};
    const baseline=mean('baseline'),treatment=mean('treatment');
    return {label,baseline,treatment,delta:baseline===null||treatment===null?null:treatment-baseline,
      percent:baseline===null||treatment===null||baseline===0?null:(treatment/baseline-1)*100};
  });
}
export function renderReport(data){
  if(!Array.isArray(data.experiments)||!data.experiments.length)throw Error('No experiments');
  const fmt=x=>x===null?'未记录':x.toLocaleString('zh-CN',{maximumFractionDigits:2});
  const sections=data.experiments.map(e=>{
    const rows=summarize(e);
    return `<section><h2>${escape(e.title)}</h2><p>${escape(e.conditions)}</p><p>${escape(e.note)}</p><p>配对样本：${e.pairs.length}；以下为每次运行均值。</p><table><thead><tr><th>指标</th><th>${escape(e.baselineLabel)}</th><th>${escape(e.treatmentLabel)}</th><th>变化</th></tr></thead><tbody>${rows.map(r=>`<tr><th>${r.label}</th><td>${fmt(r.baseline)}</td><td>${fmt(r.treatment)}</td><td>${r.delta===null?'未记录':`${r.delta>0?'+':''}${fmt(r.delta)}${r.percent===null?'':`（${r.percent>0?'+':''}${fmt(r.percent)}%）`}`}</td></tr>`).join('')}</tbody></table><details><summary>逐次记录</summary><pre>${escape(JSON.stringify(e.pairs,null,2))}</pre></details></section>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>ShuTong 用量对比</title><style>body{font:16px/1.65 system-ui;background:#f5f7f8;color:#17212b;margin:0;padding:28px}main{max-width:1050px;margin:auto}section{background:white;border:1px solid #dce3e7;border-radius:12px;padding:24px;margin:24px 0;overflow:auto}h1{font-size:28px}h2{font-size:21px}p{color:#53616c}table{border-collapse:collapse;width:100%}th,td{padding:12px;border-bottom:1px solid #dce3e7;text-align:right;font-variant-numeric:tabular-nums}th:first-child{text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}summary{cursor:pointer;margin-top:16px}a{color:#29644c}</style><main><h1>ShuTong 用量对比</h1><p>${escape(data.summary)}</p><p>离线生成，不调用模型。正值表示增加，负值表示减少；字符数不是 Token，也不是阅读时间。缓存和推理分项不重复叠加；缺失数据保留为“未记录”。这些样本不是当前安装版收益证明，也不是订阅账单。</p>${sections}</main></html>`;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node scripts/report-cost.mjs comparisons.json report.html');
 await writeFile(output,renderReport(JSON.parse(await readFile(input,'utf8'))));console.log(`Offline report written: ${resolve(output)}`);
 }catch(e){console.error(e.message);process.exitCode=1;}
}
