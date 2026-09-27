/** Cross-host, per-user scope. Never derive userId from a repository path. */
export interface InformationQuery {
  readonly userId: string;
  readonly conceptIds: readonly string[];
}

export type InformationResult<T> =
  | { readonly status: 'available'; readonly value: T }
  | { readonly status: 'unavailable'; readonly reason: 'not-registered' | 'read-failed' };

export interface InformationProvider<T> {
  read(query: InformationQuery): Promise<T>;
}

/** Information types are extended by the application, not by the output engine. */
export interface InformationReader<M extends object> {
  read<K extends keyof M & string>(key: K, query: InformationQuery): Promise<InformationResult<M[K]>>;
}

export interface OutputContext extends InformationQuery {
  /** Concepts explicitly requested for explanation in the current user request. */
  readonly explainConceptIds: readonly string[];
}

/** Capabilities return guidance or data. This interface does not call an LLM. */
export interface OutputCapability<M extends object, Result> {
  readonly id: string;
  readonly requires: readonly (keyof M & string)[];
  evaluate(context: OutputContext, information: InformationReader<M>): Promise<Result>;
}

export interface ConceptRecord {
  readonly conceptId: string;
  readonly name: string;
  readonly explanationCount: number;
  readonly manuallyKnown: boolean;
}

export interface KnowledgeInformation {
  readonly threshold: number;
  readonly concepts: readonly ConceptRecord[];
}

/** Product default. Explicitly saved user thresholds must not be overwritten. */
export const DEFAULT_EXPLANATION_THRESHOLD = 1;

export interface ExplanationReceipt {
  readonly hostId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly responseId: string;
  readonly conceptId: string;
}

/** Portable snapshot; receipts preserve retry deduplication after restoration. */
export interface KnowledgeSnapshot extends KnowledgeInformation {
  readonly format: 'shutong-knowledge';
  readonly version: 1;
  readonly receipts: readonly ExplanationReceipt[];
  readonly aliases?: readonly { domain:string; alias:string; conceptId:string }[];
}

/** The first production information type; no familiarity/confidence inference. */
export interface ShuTongInformation {
  knowledge: KnowledgeInformation;
}

/** Only the final, successfully delivered answer may reach the recording port. */
export interface DeliveredExplanation {
  readonly userId: string;
  readonly hostId: string;
  readonly sessionId: string;
  /** One logical user request, stable across regeneration and delivery retries. */
  readonly requestId: string;
  readonly responseId: string;
  readonly explainedConceptIds: readonly string[];
  readonly mentionedConceptIds: readonly string[];
}

/** Write access belongs to the information module, never output capabilities. */
export interface KnowledgeWriter {
  /** Transactionally deduplicate by user/host/session/request/concept. */
  recordDelivered(event: DeliveredExplanation): Promise<void>;
  /** false resets the current counter per the proposed stage 1 default. */
  setKnown(userId: string, conceptId: string, known: boolean): Promise<void>;
  setThreshold(userId: string, threshold: number): Promise<void>;
}
