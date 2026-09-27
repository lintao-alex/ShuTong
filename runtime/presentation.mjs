import { z } from 'zod';

export const conceptSchema = z.object({
  id: z.string().min(1).max(160), name: z.string().min(1).max(160), evidence: z.string().max(1000),
});
export const presentationSchema = z.object({
  trunk: z.string().min(1).max(5000).optional(),
  reviewTrunk: z.boolean().optional(),
  criticalPoints: z.array(z.string().min(1).max(800)).max(12).default([]),
  details: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), title: z.string().min(1).max(120),
    parentId: z.string().max(64).optional(), body: z.string().min(1).max(8000),
    requiredInTrunk: z.array(z.string().trim().min(1).max(800)).max(12).optional()
      .describe('Concise decision-changing conditions from this detail, copied verbatim into trunk; [] when none. Not routine steps.'),
    concepts: z.array(conceptSchema).max(12).default([]),
  })).max(12).default([]),
});
export const normalizeText = text => text.normalize('NFKC').replace(/\s+/g, ' ').trim();

// Declarations are model-authored; this checks delivery, not semantic completeness.
function essentialPoints(presentation) {
  const points = [...(presentation.criticalPoints ?? []),
    ...(presentation.details ?? []).flatMap(node => node.requiredInTrunk ?? [])];
  return [...new Map(points.map(point => [normalizeText(point), point])).values()];
}
function missingPoints(presentation, trunk) {
  const visible = normalizeText(trunk ?? '');
  return essentialPoints(presentation).filter(point => !visible.includes(normalizeText(point)));
}

export function stripAnswerFooter(answer) {
  return answer
    .replace(/\s*\[(?:展开细节与知识点|本次知识点)\]\(http:\/\/127\.0\.0\.1:\d+\/\?[^\s)]*\)[。.!！]?\s*$/u, '')
    .replace(/(?:^|\n)[ \t]*(?:可展开|Details|Optional details)[：:][^\n]*\s*$/u, '').trim();
}

function readingText(text) {
  return text.normalize('NFKC')
    .replace(/!?\[([^\]]*)\]\([^\s)]+\)/gu, '$1')
    .replace(/^[ \t]*#{1,6}\s+/gmu, '')
    .replace(/[*_`]/gu, '');
}

export function reviewMain(presentation) {
  if (!presentation.reviewTrunk) return null;
  const points = essentialPoints(presentation);
  const source = `${presentation.trunk ?? ''}${points.join('')}`;
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(source);
  const count = text => cjk
    ? [...readingText(text).replace(/\s/gu, '')].length
    : (readingText(text).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
  const criticalUnits = count(points.join('\n'));
  const limit = Math.max(cjk ? 420 : 180, criticalUnits + (cjk ? 96 : 48));
  const actual = presentation.trunk ? count(presentation.trunk) : null;
  const missingCriticalPoints = missingPoints(presentation, presentation.trunk);
  return { status: actual === null || actual === 0 ? 'missing-trunk'
      : missingCriticalPoints.length ? 'missing-critical-points' : actual <= limit ? 'accepted' : 'revise',
    unit: cjk ? 'characters' : 'words', actual, limit, criticalUnits,
    ...(missingCriticalPoints.length ? {missingCriticalPoints} : {}),
    overBy: actual === null ? null : Math.max(0, actual - limit) };
}

export function validatePresentation(value) {
  if (value === undefined || value === null) return null;
  const data = presentationSchema.parse(value);
  if (!data.trunk && !essentialPoints(data).length) throw new Error('Provide at least one criticalPoint from the planned visible answer when omitting trunk');
  if (JSON.stringify(data).length > 32000) throw new Error('Presentation exceeds the 32000 character budget');
  const ids = new Set(data.details.map(node => node.id));
  if (ids.size !== data.details.length) throw new Error('Duplicate detail node ID');
  // Reviewed drafts return actionable omissions and share the bounded revision loop.
  // Legacy callers retain their validation error instead of silently hiding a condition.
  if (!data.reviewTrunk && data.trunk && missingPoints(data, data.trunk).length)
    throw new Error('Critical information must appear in the trunk, not only in hidden details');
  const nodes = new Map(data.details.map(node => [node.id, node]));
  for (const node of data.details) {
    const seen = new Set([node.id]);
    let current = node;
    while (current.parentId) {
      if (!nodes.has(current.parentId)) throw new Error('Missing detail parent');
      if (seen.has(current.parentId)) throw new Error('Cyclic detail path');
      seen.add(current.parentId);
      if (seen.size > 4) throw new Error('Detail path exceeds four levels');
      current = nodes.get(current.parentId);
    }
  }
  return data;
}

// Capture only the delivered answer, never a transcript or a proposed answer.
// Legacy callers may still supply a trunk; their exact-match check is preserved.
export function confirmPresentation(presentation, answer) {
  if (!presentation || typeof answer !== 'string' || !answer.trim()) return null;
  const actual = normalizeText(answer);
  if (presentation.trunk) {
    if (missingPoints(presentation, presentation.trunk).length) return null;
    const matches = presentation.reviewTrunk
      ? normalizeText(stripAnswerFooter(answer)) === normalizeText(presentation.trunk)
      : actual.includes(normalizeText(presentation.trunk));
    return matches ? presentation : null;
  }
  const trunk = stripAnswerFooter(answer);
  if (!trunk || trunk.length > 5000 || !essentialPoints(presentation).length) return null;
  if (missingPoints(presentation, trunk).length) return null;
  if (JSON.stringify({...presentation,trunk}).length > 32000) return null;
  return {...presentation,trunk};
}

export function detailPath(presentation, id) {
  const nodes = new Map(presentation.details.map(node => [node.id, node]));
  const selected = nodes.get(id);
  if (!selected) throw new Error('Unknown detail node');
  const ancestors = [];
  let node = selected;
  while (node.parentId) { node = nodes.get(node.parentId); ancestors.unshift({ id: node.id, title: node.title, body: node.body }); }
  return { trunk: presentation.trunk, ancestors, node: { id: selected.id, title: selected.title, body: selected.body } };
}

export const progressiveInstructions = `For multi-part answers show a compact main answer with conclusion, relationships, decisions and all material risks/conditions (usually 3–7 compact points, 150–400 Chinese characters or 100–250 English words; longer only for essential conditions). Move implementation steps and full comparison tables to details, not the main answer. Put useful secondary explanations in concise named details; simple answers need no structure. Stage a short trunk with reviewTrunk:true, criticalPoints (exact sentences in it) and details. Before staging, inspect each detail for conditions whose omission could change feasibility, permissions, data loss or rollback. Put concise summaries in that node's requiredInTrunk and copy them verbatim into trunk; use [] for ordinary steps or background. Check the actual proposal, not a generic safety checklist; never erase a condition just to meet the length budget. Aim below 360 Chinese characters or 150 English words; the server allows 420 characters/180 words and expands the budget for essential criticalPoints. Treat trunk as a decision summary, not a miniature full report: one conclusion, one relationship/next step, concise necessary conditions. If prepared:false revise once, retaining risks. After acceptance copy the approved trunk exactly; no extra explanations. The extra short draft transmission is intentional to stabilize the first layer. Use 2–4 focused details, usually 100–250 Chinese characters or 80–150 English words each; expand only when substance requires it, not to fill a quota. Deliver the main answer once, optional "可展开：A / B" on its own line, then [展开细节与知识点](panelUrl) alone on the final line; never repeat detail bodies. If tools/UI fail, provide text with optional follow-up topics. Explicit whole-answer full/inline/no-fold requests bypass folding; requesting implementation details alone does not. Respect requested media and no-edit scope; comparisons/tables, relationships/diagrams, data/charts, authorized implementation/artifacts. Never hide conditions that change the decision. Knowledge evidence must be exact visible explanation, not quoted instructions or mere mentions; hidden details count only on display.`;
