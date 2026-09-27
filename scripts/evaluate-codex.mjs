// Explicit developer evaluation only. Each run uses an empty profile and a new CLI task.
import {readFile,mkdir,writeFile,access} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const [outArg,label,repeatsArg='2',acceptance]=process.argv.slice(2);
const repeats=Number(repeatsArg);
if(!outArg||!label||!/^[-a-z0-9]+$/.test(label)||![1,2,3].includes(repeats)||(acceptance&&acceptance!=='--reviewed'))throw new Error('Usage: node scripts/evaluate-codex.mjs ABS_OUTPUT_DIR LABEL [1|2|3] [--reviewed]');
const output=resolve(outArg);await mkdir(output,{recursive:true});
const cases=JSON.parse(await readFile(new URL('../tests/fixtures/model-evaluation.json',import.meta.url),'utf8'));
const jobs=cases.flatMap(c=>Array.from({length:repeats},(_,i)=>({...c,run:i+1})));
for (const c of jobs) {
 const directory=join(output,`${label}-${c.id}-${c.run}`);
 try { await access(directory); }
 catch(error) { if(error.code==='ENOENT')continue;throw error; }
 throw new Error('Run output already exists; use a new label to preserve independent profiles');
}
const results=[];
async function worker(){
 while(jobs.length){
  const c=jobs.shift(),name=`${label}-${c.id}-${c.run}`,directory=join(output,name);await mkdir(directory);
  const events=join(directory,'events.jsonl'),answer=join(directory,'answer.txt');
  const stdout=createWriteStream(events),stderr=createWriteStream(join(directory,'stderr.log'));
  const started=Date.now();
  const child=spawn(process.env.SHUTONG_CODEX_BIN||'codex',['exec','--ephemeral','-C',process.cwd(),'--json','-o',answer,c.prompt],{
   env:{...process.env,SHUTONG_DATA_DIR:join(directory,'profile')},stdio:['ignore','pipe','pipe']
  });
  child.stdout.pipe(stdout);child.stderr.pipe(stderr);
  const timeout=setTimeout(()=>child.kill('SIGTERM'),8*60*1000);
  const code=await new Promise((res,rej)=>{child.once('error',rej);child.once('close',res)});clearTimeout(timeout);
  await Promise.all([new Promise(res=>stdout.closed?res():stdout.once('close',res)),new Promise(res=>stderr.closed?res():stderr.once('close',res))]);
  const result={name,caseId:c.id,run:c.run,exitCode:code,durationMs:Date.now()-started};
  if(code===0){
   try{result.metrics=JSON.parse(execFileSync(process.execPath,['scripts/measure-run.mjs',events,answer],{encoding:'utf8'}));}
   catch{result.error='Completed process did not produce one valid turn';}
   if(acceptance==='--reviewed' && result.metrics && (result.metrics.stageReview?.status!=='accepted'||result.metrics.reviewedDeliveryMatches!==true||result.metrics.stageCalls>2)) {
    result.error='Expected an accepted review and matching delivery within two stage calls';
   }
  }
  results.push(result);console.log(JSON.stringify(result));
 }
}
await Promise.all([worker(),worker()]);
await writeFile(join(output,`${label}-summary.json`),JSON.stringify(results,null,2)+'\n');
if(results.some(r=>r.exitCode!==0||r.error))process.exitCode=1;
