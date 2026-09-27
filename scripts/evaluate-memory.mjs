// Explicit evaluation: real seed records, isolated clones, no shared conversation history.
import {readFile,mkdir,writeFile,access} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {Runtime} from '../runtime/engine.mjs';
const [rootArg,label='baseline',scenario='named',repeatArg='2']=process.argv.slice(2);
const repeats=Number(repeatArg);
if(!rootArg||!/^[-a-z0-9]+$/.test(label)||!['named','implicit'].includes(scenario)||![1,2].includes(repeats))throw new Error('Usage: node scripts/evaluate-memory.mjs ABS_SEED_ROOT LABEL [named|implicit] [1|2]');
const root=resolve(rootArg),fixture=JSON.parse(await readFile(new URL('../tests/fixtures/memory-evaluation.json',import.meta.url),'utf8'));
await access(join(root,'seed','profile','knowledge.sqlite'));
const seed=await Runtime.open(join(root,'seed','profile'));
const snapshot=await seed.store.exportProfile('local');seed.close();
if(snapshot.concepts.length<2||snapshot.concepts.some(c=>c.explanationCount<1||c.manuallyKnown))throw new Error('First obtain real automatically counted seed explanations; no manual known marks');
const jobs=[];
for(let run=1;run<=repeats;run++)for(const condition of fixture.conditions)jobs.push({condition,run,prompt:scenario==='implicit'?fixture.implicitPrompt:fixture.applicationPrompt});
if(scenario==='named')jobs.push({condition:'explicit',run:1,prompt:fixture.explicitPrompt});
for(const job of jobs){
 const path=join(root,`${label}-${job.condition}-${job.run}`);
 try{await access(path);}catch(e){if(e.code==='ENOENT')continue;throw e;}
 throw new Error('Output already exists; use a new label');
}
await writeFile(join(root,`${label}-seed-snapshot.json`),JSON.stringify(snapshot,null,2)+'\n',{flag:'wx'});
const results=[];
async function worker(){while(jobs.length){
 const job=jobs.shift(),name=`${label}-${job.condition}-${job.run}`,directory=join(root,name),profile=join(directory,'profile');
 await mkdir(directory);
 let runtime=await Runtime.open(profile);
 if(job.condition!=='empty')await runtime.store.importProfile('local',snapshot);
 runtime.config.set('global','',{autoRecord:false,progressiveDetails:false,preferArtifacts:false,panelEnabled:false,adaptiveResponse:job.condition!=='application-off'});
 const before=await runtime.store.exportProfile('local');runtime.close();
 const events=join(directory,'events.jsonl'),answer=join(directory,'answer.txt');
 const stdout=createWriteStream(events),stderr=createWriteStream(join(directory,'stderr.log'));
 const child=spawn(process.env.SHUTONG_CODEX_BIN||'codex',['exec','--ephemeral','-C',process.cwd(),'--json','-o',answer,job.prompt],{env:{...process.env,SHUTONG_DATA_DIR:profile},stdio:['ignore','pipe','pipe']});
 child.stdout.pipe(stdout);child.stderr.pipe(stderr);
 const timeout=setTimeout(()=>child.kill('SIGTERM'),8*60*1000);
 const exitCode=await new Promise((res,rej)=>{child.once('error',rej);child.once('close',res)});clearTimeout(timeout);
 await Promise.all([new Promise(res=>stdout.closed?res():stdout.once('close',res)),new Promise(res=>stderr.closed?res():stderr.once('close',res))]);
 const result={name,scenario,condition:job.condition,run:job.run,exitCode};
 if(exitCode===0){
  try{
   result.metrics=JSON.parse(execFileSync(process.execPath,['scripts/measure-run.mjs',events,answer],{encoding:'utf8'}));
   const trace=(await readFile(events,'utf8')).trim().split('\n').map(s=>JSON.parse(s));
   result.lookups=trace.filter(e=>e.type==='item.completed'&&e.item?.type==='mcp_tool_call'&&e.item.server==='shutong'&&e.item.tool==='context').map(e=>({query:e.item.arguments,response:JSON.parse(e.item.result.content[0].text)}));
   result.stagedIds=[...new Set(trace.filter(e=>e.type==='item.completed'&&e.item?.type==='mcp_tool_call'&&e.item.server==='shutong'&&e.item.tool==='stage').flatMap(e=>(e.item.arguments.concepts??[]).map(c=>c.id)))];
   result.seedCoverage=snapshot.concepts.map(c=>({id:c.conceptId,
    direct:result.lookups.some(l=>l.response.concepts?.some(x=>x.id===c.conceptId&&x.count>0)),
    candidate:result.lookups.some(l=>l.response.concepts?.some(x=>x.candidates?.some(a=>a.id===c.conceptId&&a.count>0))),
    staged:result.stagedIds.includes(c.conceptId)}));
   runtime=await Runtime.open(profile);
   const after=await runtime.store.exportProfile('local');runtime.close();
   result.profileUnchanged=JSON.stringify(before)===JSON.stringify(after);
   if(!result.profileUnchanged)result.error='Measurement changed the frozen knowledge profile';
  }catch(e){result.error='Could not validate the completed evaluation';}
 }
 await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');results.push(result);
 console.log(JSON.stringify({name,exitCode,profileUnchanged:result.profileUnchanged,error:result.error,concepts:result.lookups?.flatMap(c=>c.response.concepts)}));
}}
await Promise.all([worker(),worker()]);
await writeFile(join(root,`${label}-summary.json`),JSON.stringify(results,null,2)+'\n');
if(results.some(r=>r.exitCode!==0||r.error))process.exitCode=1;
