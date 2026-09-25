import { DatabaseSync } from 'node:sqlite';
import type {
  ConceptRecord, DeliveredExplanation, ExplanationReceipt, InformationProvider,
  InformationQuery, KnowledgeInformation, KnowledgeSnapshot, KnowledgeWriter,
} from '@shutong/contracts';
import { DEFAULT_EXPLANATION_THRESHOLD } from '@shutong/contracts';
import { boolean, delivered, identifiers, integer, object, snapshot, text } from './validation.js';

const APPLICATION_ID = 0x5354554e;
const SCHEMA_VERSION = 1;
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
        if (version === SCHEMA_VERSION && appId === APPLICATION_ID) return;
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
      });
    } catch (error) {
      this.db.close();
      this.closed = true;
      throw error;
    }
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
        if (result.changes === 1) increment.run(event.userId, id);
      }
    });
  }

  async setKnown(userId: string, conceptId: string, known: boolean): Promise<void> {
    text(userId, 'userId'); text(conceptId, 'conceptId'); boolean(known, 'known');
    this.transaction(() => {
      this.ensureProfile(userId);
      this.ensureConcept(userId, conceptId);
      this.db.prepare(`UPDATE concepts SET manually_known = ?,
        explanation_count = CASE WHEN ? = 0 THEN 0 ELSE explanation_count END
        WHERE user_id = ? AND concept_id = ?`).run(Number(known), Number(known), userId, conceptId);
      // Deliberately retain receipts: an old retry must not undo a manual reset.
    });
  }

  async setThreshold(userId: string, threshold: number): Promise<void> {
    text(userId, 'userId'); integer(threshold, 'threshold', 1);
    this.transaction(() => {
      this.db.prepare(`INSERT INTO profiles(user_id, threshold) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET threshold = excluded.threshold`).run(userId, threshold);
    });
  }

  async setName(userId: string, conceptId: string, name: string): Promise<void> {
    text(userId, 'userId'); text(conceptId, 'conceptId'); text(name, 'name');
    this.transaction(() => {
      this.ensureProfile(userId);
      this.ensureConcept(userId, conceptId);
      this.db.prepare('UPDATE concepts SET name = ? WHERE user_id = ? AND concept_id = ?').run(name, userId, conceptId);
    });
  }

  async setExplanationCount(userId: string, conceptId: string, count: number): Promise<void> {
    text(userId, 'userId'); text(conceptId, 'conceptId'); integer(count, 'count');
    this.transaction(() => {
      this.ensureProfile(userId);
      this.ensureConcept(userId, conceptId);
      this.db.prepare('UPDATE concepts SET explanation_count = ? WHERE user_id = ? AND concept_id = ?').run(count, userId, conceptId);
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
      return { format: 'shutong-knowledge', version: 1, ...this.listInsideTransaction(userId), receipts };
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
    });
  }

  /** Removes this user's profile AND retry receipts. Subsequent events start fresh. */
  async clearProfile(userId: string): Promise<void> {
    text(userId, 'userId');
    this.transaction(() => { this.db.prepare('DELETE FROM profiles WHERE user_id = ?').run(userId); });
  }
}
