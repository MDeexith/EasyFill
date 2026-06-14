import { matchFields } from '../backend.js';

export async function llmMatch(fields, profile) {
  return matchFields(fields, profile);
}
