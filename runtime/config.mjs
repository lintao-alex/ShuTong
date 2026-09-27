import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export const defaults = Object.freeze({ enabled: true, profileEnabled: true, autoRecord: true, adaptiveResponse: true,
  suppressKnownConcepts: true, progressiveDetails: true, preferArtifacts: true, panelEnabled: true });
export const configPatchSchema = z.object(Object.fromEntries(Object.keys(defaults).map(key => [key,z.boolean().optional()]))).strict();
export const scopeSchema = z.enum(['global','domain','session']);
export const overridesSchema = z.object({
  ...configPatchSchema.shape,
  verbosity: z.enum(['auto','detailed','conclusion-only']).optional(),
  excludedModalities: z.array(z.enum(['diagram','table','chart','code','artifact'])).max(5).optional(),
  discussionOnly: z.boolean().optional(),
}).strict();

export class ConfigStore {
  constructor(filename) {
    this.db=new DatabaseSync(filename);
    this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS settings(scope TEXT NOT NULL, selector TEXT NOT NULL, patch TEXT NOT NULL, PRIMARY KEY(scope,selector)) STRICT');
  }
  close(){this.db.close();}
  list(){return this.db.prepare('SELECT scope,selector,patch FROM settings ORDER BY scope,selector').all().map(row=>({...row,patch:JSON.parse(row.patch)}));}
  set(scope,selector,patch){
    scopeSchema.parse(scope);configPatchSchema.parse(patch);
    if(typeof selector!=='string'||selector.length>200||(scope!=='global'&&!selector.trim()))throw new Error('A selector is required');
    if(scope==='global')selector='';
    this.db.exec('BEGIN IMMEDIATE');
    try{const existing=this.db.prepare('SELECT patch FROM settings WHERE scope=? AND selector=?').get(scope,selector);
      const merged={...(existing?JSON.parse(existing.patch):{}),...patch};
      this.db.prepare('INSERT INTO settings VALUES(?,?,?) ON CONFLICT(scope,selector) DO UPDATE SET patch=excluded.patch').run(scope,selector,JSON.stringify(merged));
      this.db.exec('COMMIT');return merged;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  clear(scope,selector){scopeSchema.parse(scope);if(typeof selector!=='string')throw new Error('Selector required');this.db.prepare('DELETE FROM settings WHERE scope=? AND selector=?').run(scope,scope==='global'?'':selector);}
  resolve({domain='',sessionId='',overrides={}}={}){
    overridesSchema.parse(overrides);
    const result={...defaults,verbosity:'auto',excludedModalities:[],discussionOnly:false};
    for(const [scope,selector]of [['global',''],['domain',domain],['session',sessionId]]){
      if(scope!=='global'&&!selector)continue;
      const row=this.db.prepare('SELECT patch FROM settings WHERE scope=? AND selector=?').get(scope,selector);
      if(row)Object.assign(result,JSON.parse(row.patch));
    }
    Object.assign(result,overrides);
    return result;
  }
}

export function presentationPolicy(config){
  const progressive=config.enabled&&config.progressiveDetails&&config.verbosity!=='detailed';
  return {mode:config.verbosity==='detailed'?'full':config.verbosity==='conclusion-only'?'conclusion-first':progressive?'trunk-and-details':'normal',
    preserveCriticalInformation:true,
    media:config.preferArtifacts?{comparison:'table',relationships:'diagram',data:'chart',implementation:'real-project-artifact'}:{default:'text'},
    excludedModalities:config.excludedModalities,
    mayModifyProject:!config.discussionOnly&&!config.excludedModalities.includes('code'),
    instruction:'Choose the smallest useful representation. User-requested output format and no-edit constraints take precedence. Do not modify files merely to illustrate an answer when discussion-only is requested.'};
}
