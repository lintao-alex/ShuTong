// Keep operational policy on the wire, without repeating internal plan fields.
export function contextResponse(context) {
  const { threshold, config, presentationPolicy: policy } = context;
  return {
    threshold,
    concepts: context.concepts.map(({ id, name, count, mode, candidates }) => ({ id, name, count, mode, ...(candidates?.length?{candidates}:{}) })),
    config,
    presentationPolicy: { mode: policy.mode, media: policy.media, mayModifyProject: policy.mayModifyProject },
    instruction: `${context.instruction} ${context.presentationInstruction}`,
  };
}
