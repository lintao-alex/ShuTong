// Summarize one ephemeral CLI run without printing its prompts, responses or local tokens.
import {readFile} from 'node:fs/promises';
import {stripAnswerFooter,reviewMain,confirmPresentation} from '../runtime/presentation.mjs';
try {
  const [eventsPath,answerPath]=process.argv.slice(2);
  if(!eventsPath||!answerPath)throw new Error('Usage: node scripts/measure-run.mjs events.jsonl final-answer.txt');
  const events=(await readFile(eventsPath,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const completed=events.filter(event=>event.type==='turn.completed');
  if(completed.length!==1||events.some(event=>event.type==='turn.failed'))throw new Error('Expected exactly one successfully completed turn');
  const calls=events.filter(event=>event.type==='item.completed'&&event.item?.type==='mcp_tool_call').map(event=>event.item).filter(item=>item.server==='shutong');
  const stages=calls.filter(item=>item.tool==='stage');
  const contexts=calls.filter(item=>item.tool==='context');
  const answer=await readFile(answerPath,'utf8');
  const lastStage=stages.at(-1);
  let lastResult={};
  try { lastResult=JSON.parse(lastStage?.result?.content?.find(item=>item.type==='text')?.text??'{}'); } catch { /* Keep transport failures visible below. */ }
  const presentation=lastStage?.arguments?.presentation;
  const mainReview=presentation ? reviewMain({...presentation,criticalPoints:presentation.criticalPoints??[],trunk:stripAnswerFooter(answer),reviewTrunk:true}) : null;
  const withoutLink=answer.replace(/\s*\[(?:展开细节与知识点|本次知识点)\]\(http:\/\/127\.0\.0\.1:\d+\/\?[^\s)]*\)[。.!！]?\s*$/u,'').trim();
  const sum=(items,select)=>items.reduce((total,item)=>total+JSON.stringify(select(item)??null).length,0);
  console.log(JSON.stringify({
    answerCharsWithoutPanelLink:withoutLink.length,
    usage:completed[0].usage,
    shutongCalls:calls.length,
    commandExecutions:events.filter(event=>event.type==='item.completed'&&event.item?.type==='command_execution').length,
    failedShutongCalls:calls.filter(item=>item.error||item.status==='failed'||item.result?.isError).length,
    stageCalls:stages.length,
    mainReview,
    stageReview:lastResult.review??null,
    reviewedDeliveryMatches:presentation?.reviewTrunk ? !!confirmPresentation(presentation,answer) : null,
    stageArgumentChars:sum(stages,item=>item.arguments),
    contextResultChars:sum(contexts,item=>item.result),
    stageResultChars:sum(stages,item=>item.result),
    suppliedTrunk:stages.some(item=>typeof item.arguments?.presentation?.trunk==='string'),
    detailNodes:stages.reduce((n,item)=>n+(item.arguments?.presentation?.details?.length??0),0),
    detailBodyChars:stages.reduce((n,item)=>n+(item.arguments?.presentation?.details??[]).reduce((count,node)=>count+(node.body?.length??0),0),0),
  },null,2));
} catch(error) {console.error(error.message);process.exitCode=1;}
