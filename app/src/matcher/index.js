import { applyHeuristics } from './heuristics';
import { llmMatch } from './llmClient';

export async function matchFieldsToProfile(fields, profile, useLlmFallback = true) {
  const { mapping, unmatched } = applyHeuristics(fields);

  if (!useLlmFallback || unmatched.length === 0) {
    return mapping;
  }

  try {
    const llmMapping = await llmMatch(unmatched, profile);
    return { ...mapping, ...llmMapping };
  } catch {
    return mapping;
  }
}
