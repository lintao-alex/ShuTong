import {z} from 'zod';
import {mkdir,writeFile} from 'node:fs/promises';
import {configPatchSchema,overridesSchema} from '../runtime/config.mjs';
import {presentationSchema} from '../runtime/presentation.mjs';
const short=z.string().min(1).max(4096),count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const knowledge=z.object({format:z.literal('shutong-knowledge'),version:z.literal(1),threshold:count.min(1),
 concepts:z.array(z.object({conceptId:short,name:short,explanationCount:count,manuallyKnown:z.boolean()})),
 receipts:z.array(z.object({hostId:short,sessionId:short,requestId:short,responseId:short,conceptId:short})),
 aliases:z.array(z.object({domain:short,alias:short,conceptId:short})).optional()});
await mkdir('schemas',{recursive:true});
for(const [name,schema]of Object.entries({'knowledge-v1':knowledge,'config-patch-v1':configPatchSchema,'answer-overrides-v1':overridesSchema,'presentation-v1':presentationSchema}))
 await writeFile(`schemas/${name}.json`,JSON.stringify({...z.toJSONSchema(schema),$id:`urn:shutong:${name}`},null,2)+'\n');
console.log('Exported versioned data and presentation schemas.');
