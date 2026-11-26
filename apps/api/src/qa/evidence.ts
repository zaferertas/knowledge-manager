import type { AnswerSource } from '../ai/answer.js';
import { validText } from '../common/input.js';

export interface SourceReference {
  noteId: string;
  title: string;
  excerpt: string;
}

export function validatedEvidence(output: string, sources: AnswerSource[]): SourceReference[] {
  if (output.length > 8192) return [];
  let decoded: unknown;
  try {
    decoded = JSON.parse(output);
  } catch {
    return [];
  }
  if (!decoded || typeof decoded !== 'object' || Object.keys(decoded).length !== 1 ||
    !('evidence' in decoded) || !Array.isArray(decoded.evidence) ||
    decoded.evidence.length > sources.length) return [];

  const references: SourceReference[] = [];
  for (const item of decoded.evidence) {
    if (!item || typeof item !== 'object' || Object.keys(item).length !== 2 ||
      !validText(item.excerpt, 400) || !item.excerpt.trim()) return [];
    const source = sources.find(({ noteId }) => noteId === item.noteId);
    if (!source || references.some(({ noteId }) => noteId === source.noteId) ||
      !(source.title.includes(item.excerpt) || source.content.includes(item.excerpt))) return [];
    references.push({ noteId: source.noteId, title: source.title, excerpt: item.excerpt });
  }
  return references;
}
