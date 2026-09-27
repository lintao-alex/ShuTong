import { DatabaseSync } from 'node:sqlite';
import type {
  ConceptRecord, DeliveredExplanation, ExplanationReceipt, InformationProvider,
  InformationQuery, KnowledgeInformation, KnowledgeSnapshot, KnowledgeWriter,
} from '@shutong/contracts';
import { DEFAULT_EXPLANATION_THRESHOLD } from '@shutong/contracts';
import { boolean, delivered, identifiers, integer, object, snapshot, text } from './validation.js';

const APPLICATION_ID = 0x5354554e;
const SCHEMA_VERSION = 2;
const CONCEPT_COLUMNS = 'concept_id AS conceptId, name, explanation_count AS explanationCount, manually_known AS manuallyKnown';

function conceptFromRow(row: Record<string, unknown>): ConceptRecord {
  return {
    conceptId: text(row.conceptId, 'stored conceptId'), name: text(row.name, 'stored name'),
    explanationCount: integer(row.explanationCount, 'stored explanationCount'),
    manuallyKnown: row.manuallyKnown === 1,
  };
}

/** Small local store. All transaction bodies are synchronous and never await. */
export class SqliteKnowledgeStore implements InformationProvider<KnowledgeInformation>, KnowledgeWriter {
  private readonly db: DatabaseSync;
  private closed = false;

  /** Parent directory must already exist; no implicit writes to home or project paths. */
  constructor(filename: string) {
    text(filename, 'filename');
    this.db = new DatabaseSync(filename, { enableForeignKeyConstraints: true });
    try {
      this.db.exec('PRAGMA busy_timeout = 5000');
      this.transaction(() => {
        const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
        const appId = this.db.prepare('PRAGMA application_id').get()?.application_id;
        if ((version === 1 || version === SCHEMA_VERSION) && appId === APPLICATION_ID) {
          this.initializeManagement();return;
        }
        const existing = this.db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get();
        if (version !== 0 || appId !== 0 || existing) throw new Error('Unsupported or non-ShuTong database; refusing to modify it');
        this.db.exec(`
          CREATE TABLE profiles (
            user_id TEXT PRIMARY KEY,
            threshold INTEGER NOT NULL CHECK(threshold BETWEEN 1 AND 9007199254740991)
          ) STRICT;
          CREATE TABLE concepts (
            user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
            concept_id TEXT NOT NULL,
            name TEXT NOT NULL,
            explanation_count INTEGER NOT NULL DEFAULT 0 CHECK(explanation_count BETWEEN 0 AND 9007199254740991),
            manually_known INTEGER NOT NULL DEFAULT 0 CHECK(manually_known IN (0, 1)),
            PRIMARY KEY(user_id, concept_id)
          ) STRICT;
          CREATE TABLE explanation_receipts (
            user_id TEXT NOT NULL,
            host_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            response_id TEXT NOT NULL,
            concept_id TEXT NOT NULL,
            PRIMARY KEY(user_id, host_id, session_id, request_id, concept_id),
            FOREIGN KEY(user_id, concept_id) REFERENCES concepts(user_id, concept_id) ON DELETE CASCADE
          ) STRICT;
          PRAGMA application_id = ${APPLICATION_ID};
          PRAGMA user_version = ${SCHEMA_VERSION};
        `);
        this.initializeManagement();
      });
    } catch (error) {
      this.db.close();
      this.closed = true;
      throw error;
    }
  }

  private initializeManagement(): void {
    this.db.exec(`CREATE INDEX IF NOT EXISTS receipts_by_concept ON explanation_receipts(user_id,concept_id);
      CREATE TABLE IF NOT EXISTS aliases (
      user_id TEXT NOT NULL, domain TEXT NOT NULL, alias TEXT NOT NULL, concept_id TEXT NOT NULL,
      PRIMARY KEY(user_id,domain,alias), FOREIGN KEY(user_id,concept_id) REFERENCES concepts(user_id,concept_id) ON DELETE CASCADE) STRICT;
      CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      kind TEXT NOT NULL, concept_id TEXT, before_json TEXT NOT NULL, after_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, undone INTEGER NOT NULL DEFAULT 0) STRICT;
      PRAGMA user_version = ${SCHEMA_VERSION};`);
  }

  private conceptState(userId:string, conceptId:string): ConceptRecord {
    return conceptFromRow(this.db.prepare(`SELECT ${CONCEPT_COLUMNS} FROM concepts WHERE user_id=? AND concept_id=?`).get(userId,conceptId)!);
  }
  private auditChange(userId:string,kind:string,id:string|null,before:unknown,after:unknown):void {
    if(JSON.stringify(before)===JSON.stringify(after))return;
    this.db.prepare('INSERT INTO audit(user_id,kind,concept_id,before_json,after_json) VALUES(?,?,?,?,?)')
      .run(userId,kind,id,JSON.stringify(before),JSON.stringify(after));
  }
  async auditLog(userId:string) {
    text(userId,'userId');return this.transaction(()=>this.db.prepare('SELECT id,kind,concept_id AS conceptId,created_at AS createdAt,undone,before_json,after_json FROM audit WHERE user_id=? ORDER BY id DESC LIMIT 100').all(userId).map(r=>({
      id:r.id,kind:r.kind,conceptId:r.conceptId,createdAt:r.createdAt,undone:r.undone===1,before:JSON.parse(String(r.before_json)),after:JSON.parse(String(r.after_json)),
    })),false);
  }
  async undo(userId:string,auditId:number):Promise<void> {
    text(userId,'userId');integer(auditId,'auditId',1);
    this.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM audit WHERE user_id=? AND id=? AND undone=0').get(userId,auditId);
      if(!row)throw new Error('Audit event unavailable or already undone');
      const latest=this.db.prepare('SELECT id FROM audit WHERE user_id=? AND concept_id IS ? AND undone=0 ORDER BY id DESC LIMIT 1').get(userId,row.concept_id!);
      if(latest?.id!==row.id)throw new Error('Later changes exist; undo the latest change first');
      const before=JSON.parse(String(row.before_json)),after=JSON.parse(String(row.after_json));
      if(row.concept_id){
        const id=String(row.concept_id),current=this.conceptState(userId,id);
        if(JSON.stringify(current)!==JSON.stringify(after))throw new Error('Later changes exist; undo the latest change first');
        this.db.prepare('UPDATE concepts SET name=?,explanation_count=?,manually_known=? WHERE user_id=? AND concept_id=?')
          .run(before.name,before.explanationCount,Number(before.manuallyKnown),userId,id);
      }else{
        if(this.threshold(userId)!==after)throw new Error('Later threshold changes exist');
        this.db.prepare('UPDATE profiles SET threshold=? WHERE user_id=?').run(before,userId);
      }
      this.db.prepare('UPDATE audit SET undone=1 WHERE id=?').run(auditId);
    });
  }
  async setAlias(userId:string,domain:string,alias:string,conceptId:string):Promise<void> {
    text(userId,'userId');text(domain,'domain');text(alias,'alias');text(conceptId,'conceptId');
    const normalized=alias.normalize('NFKC').toLowerCase().trim();
    this.transaction(()=>{
      if(!this.db.prepare('SELECT 1 FROM concepts WHERE user_id=? AND concept_id=?').get(userId,conceptId))throw new Error('Unknown concept');
      const existing=this.db.prepare('SELECT concept_id FROM aliases WHERE user_id=? AND domain=? AND alias=?').get(userId,domain,normalized);
      if(existing&&existing.concept_id!==conceptId)throw new Error('Alias already belongs to another concept');
      this.db.prepare('INSERT INTO aliases VALUES(?,?,?,?) ON CONFLICT DO NOTHING').run(userId,domain,normalized,conceptId);
    });
  }
  async resolveNames(userId:string,concepts:readonly {id:string;name:string}[],domain='') {
    text(userId,'userId');
    return this.transaction(()=>concepts.map(concept=>{
      text(concept.id,'conceptId');text(concept.name,'name');
      const exact=this.db.prepare('SELECT concept_id FROM concepts WHERE user_id=? AND concept_id=?').get(userId,concept.id);
      if(exact)return {...concept,id:String(exact.concept_id)};
      const scope=domain||concept.id.split(/[/.]/).slice(0,-1).join('/');
      const alias=this.db.prepare('SELECT concept_id FROM aliases WHERE user_id=? AND domain=? AND alias=?').get(userId,scope,concept.name.normalize('NFKC').toLowerCase().trim());
      if(alias)return {...concept,id:String(alias.concept_id)};
      const named=this.db.prepare('SELECT concept_id FROM concepts WHERE user_id=? AND name=?').all(userId,concept.name)
        .filter(row=>!scope||String(row.concept_id).split(/[/.]/).slice(0,-1).join('/')===scope);
      return named.length===1?{...concept,id:String(named[0]!.concept_id)}:concept;
    }),false);
  }

  /** Lexical candidates only: callers must disambiguate; never merge or change counts here. */
  async findNameCandidates(userId:string, name:string, excludeId:string):Promise<readonly ConceptRecord[]> {
    text(userId,'userId');text(name,'name');text(excludeId,'conceptId');
    const query=name.normalize('NFKC').toLowerCase().trim();
    if([...query].length<2)return [];
    return this.transaction(()=>this.db.prepare(`SELECT ${CONCEPT_COLUMNS} FROM concepts
      WHERE user_id=? AND concept_id<>? AND length(trim(name))>=2
      AND (instr(lower(name),?)>0 OR instr(?,lower(name))>0)
      ORDER BY CASE WHEN lower(name)=? THEN 0 ELSE 1 END,concept_id LIMIT 3`)
      .all(userId,excludeId,query,query,query).map(conceptFromRow),false);
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  private transaction<T>(operation: () => T, write = true): T {
    if (this.closed) throw new Error('Knowledge store is closed');
    this.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* Preserve the original transaction error. */ }
      throw error;
    }
  }

  private ensureProfile(userId: string): void {
    this.db.prepare('INSERT INTO profiles(user_id, threshold) VALUES (?, ?) ON CONFLICT DO NOTHING')
      .run(userId, DEFAULT_EXPLANATION_THRESHOLD);
  }

  private ensureConcept(userId: string, conceptId: string): void {
    this.db.prepare('INSERT INTO concepts(user_id, concept_id, name) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
      .run(userId, conceptId, conceptId);
  }

  private threshold(userId: string): number {
    const row = this.db.prepare('SELECT threshold FROM profiles WHERE user_id = ?').get(userId);
    return row ? integer(row.threshold, 'stored threshold', 1) : DEFAULT_EXPLANATION_THRESHOLD;
  }

  async read(query: InformationQuery): Promise<KnowledgeInformation> {
    const input = object(query, 'query');
    const userId = text(input.userId, 'userId');
    const ids = identifiers(input.conceptIds, 'conceptIds');
    return this.transaction(() => {
      const select = this.db.prepare(`SELECT ${CONCEPT_COLUMNS} FROM concepts WHERE user_id = ? AND concept_id = ?`);
      const concepts: ConceptRecord[] = [];
      for (const id of ids) {
        const row = select.get(userId, id);
        if (row) concepts.push(conceptFromRow(row));
      }
      return { threshold: this.threshold(userId), concepts };
    }, false);
  }

  async list(userId: string): Promise<KnowledgeInformation> {
    text(userId, 'userId');
    return this.transaction(() => this.listInsideTransaction(userId), false);
  }

  /** Receipts are retained for deduplication even after a manual count correction. */
  async sources(userId: string, conceptId: string) {
    text(userId,'userId');text(conceptId,'conceptId');
    return this.transaction(()=>{
      const row=this.db.prepare(`SELECT ${CONCEPT_COLUMNS} FROM concepts WHERE user_id=? AND concept_id=?`).get(userId,conceptId);
      if(!row)throw new Error('Unknown concept');
      const total=integer(this.db.prepare('SELECT count(*) AS total FROM explanation_receipts WHERE user_id=? AND concept_id=?').get(userId,conceptId)!.total,'receipt total');
      const receipts=this.db.prepare(`SELECT host_id AS hostId,session_id AS sessionId,request_id AS requestId
        FROM explanation_receipts WHERE user_id=? AND concept_id=? ORDER BY rowid DESC LIMIT 20`).all(userId,conceptId)
        .map(item=>({hostId:String(item.hostId),sessionId:String(item.sessionId),requestId:String(item.requestId)}));
      return {concept:conceptFromRow(row),totalReceipts:total,receipts,hasMore:total>receipts.length};
    },false);
  }

  private listInsideTransaction(userId: string): KnowledgeInformation {
    const rows = this.db.prepare(`SELECT ${CONCEPT_COLUMNS} FROM concepts WHERE user_id = ? ORDER BY concept_id`).all(userId);
    return { threshold: this.threshold(userId), concepts: rows.map(conceptFromRow) };
  }

  async recordDelivered(value: DeliveredExplanation): Promise<void> {
    const event = delivered(value);
    const ids = new Set([...event.mentionedConceptIds, ...event.explainedConceptIds]);
    this.transaction(() => {
      this.ensureProfile(event.userId);
      for (const id of ids) this.ensureConcept(event.userId, id);
      const insert = this.db.prepare(`INSERT INTO explanation_receipts
        (user_id, host_id, session_id, request_id, response_id, concept_id)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`);
      const increment = this.db.prepare('UPDATE concepts SET explanation_count = explanation_count + 1 WHERE user_id = ? AND concept_id = ?');
      for (const id of event.explainedConceptIds) {
        const result = insert.run(event.userId, event.hostId, event.sessionId, event.requestId, event.responseId, id);
        if (result.changes === 1) { const before=this.conceptState(event.userId,id);increment.run(event.userId, id);
          this.auditChange(event.userId,'auto-count',id,before,this.conceptState(event.userId,id)); }
      }
    });
  }

  async setKnown(userId: string, conceptId: string, known: boolean): Promise<void> {
    text(userId, 'userId'); text(conceptId, 'conceptId'); boolean(known, 'known');
    this.transaction(() => {
      this.ensureProfile(userId);
      this.ensureConcept(userId, conceptId);
      const before=this.conceptState(userId,conceptId);
      this.db.prepare(`UPDATE concepts SET manually_known = ?,
        explanation_count = CASE WHEN ? = 0 THEN 0 ELSE explanation_count END
        WHERE user_id = ? AND concept_id = ?`).run(Number(known), Number(known), userId, conceptId);
      this.auditChange(userId,'manual-known',conceptId,before,this.conceptState(userId,conceptId));
      // Deliberately retain receipts: an old retry must not undo a manual reset.
    });
  }

  async setThreshold(userId: string, threshold: number): Promise<void> {
    text(userId, 'userId'); integer(threshold, 'threshold', 1);
    this.transaction(() => {
      const before=this.threshold(userId);
      this.db.prepare(`INSERT INTO profiles(user_id, threshold) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET threshold = excluded.threshold`).run(userId, threshold);
      this.auditChange(userId,'threshold',null,before,threshold);
    });
  }

  async setName(userId: string, conceptId: string, name: string): Promise<void> {
    text(userId, 'userId'); text(conceptId, 'conceptId'); text(name, 'name');
    this.transaction(() => {
      this.ensureProfile(userId);
      this.ensureConcept(userId, conceptId);
      const before=this.conceptState(userId,conceptId);
      this.db.prepare('UPDATE concepts SET name = ? WHERE user_id = ? AND concept_id = ?').run(name, userId, conceptId);
      this.auditChange(userId,'name',conceptId,before,this.conceptState(userId,conceptId));
    });
  }

  async setExplanationCount(userId: string, conceptId: string, count: number): Promise<void> {
    text(userId, 'userId'); text(conceptId, 'conceptId'); integer(count, 'count');
    this.transaction(() => {
      this.ensureProfile(userId);
      this.ensureConcept(userId, conceptId);
      const before=this.conceptState(userId,conceptId);
      this.db.prepare('UPDATE concepts SET explanation_count = ? WHERE user_id = ? AND concept_id = ?').run(count, userId, conceptId);
      this.auditChange(userId,'manual-count',conceptId,before,this.conceptState(userId,conceptId));
    });
  }

  /** Atomic panel correction; reject a stale editor instead of overwriting new deliveries. */
  async editConcept(userId: string, conceptId: string, value: {
    name: string; explanationCount: number;
    expected: { name: string; explanationCount: number; manuallyKnown: boolean };
  }): Promise<void> {
    text(userId, 'userId'); text(conceptId, 'conceptId');
    const input=object(value,'edit'), expected=object(input.expected,'expected');
    const name=text(input.name,'name').trim(), count=integer(input.explanationCount,'explanationCount');
    const oldName=text(expected.name,'expected name'),oldCount=integer(expected.explanationCount,'expected count');
    const oldKnown=boolean(expected.manuallyKnown,'expected known');
    this.transaction(()=>{
      const row=this.db.prepare(`SELECT ${CONCEPT_COLUMNS} FROM concepts WHERE user_id=? AND concept_id=?`).get(userId,conceptId);
      if(!row)throw new Error('Concept changed; reload before editing');
      const before=conceptFromRow(row);
      if(before.name!==oldName||before.explanationCount!==oldCount||before.manuallyKnown!==oldKnown)
        throw new Error('Concept changed; reload before editing');
      this.db.prepare('UPDATE concepts SET name=?,explanation_count=? WHERE user_id=? AND concept_id=?')
        .run(name,count,userId,conceptId);
      this.auditChange(userId,'manual-edit',conceptId,before,this.conceptState(userId,conceptId));
    });
  }

  async exportProfile(userId: string): Promise<KnowledgeSnapshot> {
    text(userId, 'userId');
    return this.transaction(() => {
      const receipts: ExplanationReceipt[] = this.db.prepare(`SELECT host_id AS hostId, session_id AS sessionId,
        request_id AS requestId, response_id AS responseId, concept_id AS conceptId
        FROM explanation_receipts WHERE user_id = ? ORDER BY host_id, session_id, request_id, concept_id`).all(userId)
        .map(row => ({
          hostId: text(row.hostId, 'hostId'), sessionId: text(row.sessionId, 'sessionId'),
          requestId: text(row.requestId, 'requestId'), responseId: text(row.responseId, 'responseId'),
          conceptId: text(row.conceptId, 'conceptId'),
        }));
      const aliases=this.db.prepare('SELECT domain,alias,concept_id AS conceptId FROM aliases WHERE user_id=? ORDER BY domain,alias').all(userId)
        .map(row=>({domain:String(row.domain),alias:String(row.alias),conceptId:String(row.conceptId)}));
      return { format: 'shutong-knowledge', version: 1, ...this.listInsideTransaction(userId), receipts,...(aliases.length?{aliases}:{}) };
    }, false);
  }

  async importProfile(userId: string, value: unknown, replace = false): Promise<void> {
    text(userId, 'userId'); boolean(replace, 'replace');
    const data = snapshot(value); // Fully validate before touching an existing profile.
    this.transaction(() => {
      const exists = this.db.prepare('SELECT 1 FROM profiles WHERE user_id = ?').get(userId);
      if (exists && !replace) throw new Error('Profile already exists; replacement must be explicit');
      this.db.prepare('DELETE FROM profiles WHERE user_id = ?').run(userId);
      this.db.prepare('INSERT INTO profiles(user_id, threshold) VALUES (?, ?)').run(userId, data.threshold);
      const concept = this.db.prepare('INSERT INTO concepts(user_id, concept_id, name, explanation_count, manually_known) VALUES (?, ?, ?, ?, ?)');
      for (const item of data.concepts) concept.run(userId, item.conceptId, item.name, item.explanationCount, Number(item.manuallyKnown));
      const receipt = this.db.prepare('INSERT INTO explanation_receipts(user_id, host_id, session_id, request_id, response_id, concept_id) VALUES (?, ?, ?, ?, ?, ?)');
      for (const item of data.receipts) receipt.run(userId, item.hostId, item.sessionId, item.requestId, item.responseId, item.conceptId);
      for (const alias of data.aliases??[])this.db.prepare('INSERT INTO aliases VALUES(?,?,?,?)').run(userId,alias.domain,alias.alias,alias.conceptId);
    });
  }

  /** Removes this user's profile AND retry receipts. Subsequent events start fresh. */
  async clearProfile(userId: string): Promise<void> {
    text(userId, 'userId');
    this.transaction(() => { this.db.prepare('DELETE FROM profiles WHERE user_id = ?').run(userId); });
  }
}
