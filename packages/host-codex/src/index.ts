/** A Stop callback is a candidate, not proof of final delivery or comprehension. */
export interface AnswerCandidate {
  readonly kind: 'answer-candidate';
  readonly sessionId: string;
  readonly turnId: string;
  readonly text: string;
  readonly continuedByStopHook: boolean;
  readonly delivery: 'unverified';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Normalize documented Stop fields only. No transcript access, writes or inference. */
export function parseStopCandidate(input: unknown): AnswerCandidate | null {
  if (!isObject(input) || input.hook_event_name !== 'Stop') return null;
  if (!isNonEmpty(input.session_id) || !isNonEmpty(input.turn_id)) return null;
  if (!isNonEmpty(input.last_assistant_message) || typeof input.stop_hook_active !== 'boolean') return null;
  return {
    kind: 'answer-candidate',
    sessionId: input.session_id,
    turnId: input.turn_id,
    text: input.last_assistant_message,
    continuedByStopHook: input.stop_hook_active,
    delivery: 'unverified',
  };
}
