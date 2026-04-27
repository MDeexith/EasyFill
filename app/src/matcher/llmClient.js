import { matchFields } from '../api/backend';

export async function llmMatch(fields, profile) {
  return matchFields(fields, profile);
}
