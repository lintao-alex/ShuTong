import type { ConceptRecord, DeliveredExplanation, ExplanationReceipt, KnowledgeSnapshot } from '@shutong/contracts';

export function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || value.includes('\0')) {
    throw new TypeError(`${label} must be a nonempty string of at most 4096 characters without NUL`);
  }
  return value;
}

export function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

export function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

export function identifiers(value: unknown, label: string): string[] {
  return [...new Set(array(value, label).map(item => text(item, label)))];
}

export function delivered(value: unknown): DeliveredExplanation {
  const input = object(value, 'event');
  return {
    userId: text(input.userId, 'userId'), hostId: text(input.hostId, 'hostId'),
    sessionId: text(input.sessionId, 'sessionId'), requestId: text(input.requestId, 'requestId'),
    responseId: text(input.responseId, 'responseId'),
    explainedConceptIds: identifiers(input.explainedConceptIds, 'explainedConceptIds'),
    mentionedConceptIds: identifiers(input.mentionedConceptIds, 'mentionedConceptIds'),
  };
}

function concept(value: unknown): ConceptRecord {
  const input = object(value, 'concept');
  return {
    conceptId: text(input.conceptId, 'conceptId'), name: text(input.name, 'name'),
    explanationCount: integer(input.explanationCount, 'explanationCount'),
    manuallyKnown: boolean(input.manuallyKnown, 'manuallyKnown'),
  };
}

function receipt(value: unknown): ExplanationReceipt {
  const input = object(value, 'receipt');
  return {
    hostId: text(input.hostId, 'hostId'), sessionId: text(input.sessionId, 'sessionId'),
    requestId: text(input.requestId, 'requestId'), responseId: text(input.responseId, 'responseId'),
    conceptId: text(input.conceptId, 'conceptId'),
  };
}

export function snapshot(value: unknown): KnowledgeSnapshot {
  const input = object(value, 'snapshot');
  if (input.format !== 'shutong-knowledge' || input.version !== 1) throw new TypeError('Unsupported snapshot format or version');
  const concepts = array(input.concepts, 'concepts').map(concept);
  const ids = new Set(concepts.map(item => item.conceptId));
  if (ids.size !== concepts.length) throw new TypeError('Duplicate conceptId in snapshot');
  const receipts = array(input.receipts, 'receipts').map(receipt);
  const receiptKeys = new Set<string>();
  for (const item of receipts) {
    if (!ids.has(item.conceptId)) throw new TypeError('Receipt references a missing concept');
    const key = JSON.stringify([item.hostId, item.sessionId, item.requestId, item.conceptId]);
    if (receiptKeys.has(key)) throw new TypeError('Duplicate receipt in snapshot');
    receiptKeys.add(key);
  }
  return { format: 'shutong-knowledge', version: 1, threshold: integer(input.threshold, 'threshold', 1), concepts, receipts };
}
