import assert from 'node:assert/strict';
import { ollamaEmbeddingProvider } from '../dist/indexing/embedding.js';
import { ollamaAnswerGenerator } from '../dist/ai/answer.js';
import { NoteRetrieval, relevanceThreshold } from '../dist/retrieval/service.js';
import { validatedEvidence } from '../dist/qa/evidence.js';
import { insertIndexed } from './ask-cases.mjs';

const fixtures = [
  ['Trail maintenance', 'The Birch trail has a red bridge across Alder Creek.', [
    'Which trail crosses Alder Creek on a red bridge?', 'Where is the red bridge?',
    'What color is the bridge on the Birch trail?', 'Which creek does the Birch trail cross?',
  ]],
  ['Observatory hours', 'The observatory opens at 8 p.m. on Fridays.', [
    'When does the observatory open on Fridays?', 'What time can I visit the observatory?',
    'On which day does the observatory open at 8 p.m.?', 'What are the Friday stargazing hours?',
  ]],
  ['Greenhouse log', 'Cilantro seeds go in the north greenhouse in April.', [
    'Where should I plant cilantro?', 'In what month are cilantro seeds planted?',
    'What is planted in the north greenhouse in April?', 'Which greenhouse has the cilantro seeds?',
  ]],
  ['Library returns', 'After closing, return library books through the slot beside the east entrance.', [
    'Where do I return books after closing?', 'Which library entrance has the returns slot?',
    'Can I return books after the library closes?', 'How do after-hours library returns work?',
  ]],
];
const unsupported = [
  'How do I replace a bicycle chain?', 'Which greenhouse grows tomatoes?',
  'How much does an observatory ticket cost?', 'What material is the red bridge made of?',
];

export async function evaluateLiveAsk(t, db, userId) {
  t.after(() => db.query('DELETE FROM users WHERE id = $1', [userId]));
  const embeddings = ollamaEmbeddingProvider();
  const generator = ollamaAnswerGenerator();
  const retrieval = new NoteRetrieval(db, embeddings, -1);
  const cutoffs = [...new Set([0.35, 0.45, 0.50, 0.55, 0.65, relevanceThreshold, 0.75])].sort((a, b) => a - b);
  const cases = [];
  for (const [title, body, questions] of fixtures) {
    const vector = await embeddings.embedDocument(`${title}\n\n${body}`);
    const noteId = await insertIndexed(db, userId, { title, body, model: embeddings.modelId, vector });
    for (const question of questions) cases.push({ question, noteId });
  }
  for (const question of unsupported) cases.push({ question, noteId: null });

  const results = [];
  for (const { question, noteId } of cases) {
    const started = performance.now();
    const notes = await retrieval.retrieve(userId, question);
    const retrievalMs = Math.round(performance.now() - started);
    const sources = notes.filter(({ similarity }) => similarity >= relevanceThreshold)
      .map(({ noteId, title, body }) => ({ noteId, title, content: body }));
    const generationStarted = performance.now();
    const output = sources.length ? await generator.generateAnswer({ question, sources }) : undefined;
    const generationMs = output === undefined ? 0 : Math.round(performance.now() - generationStarted);
    const evidence = output === undefined ? [] : validatedEvidence(output, sources);
    results.push({
      question, retrievalMs, generationMs,
      expectedSourceRetrieved: noteId && sources.some((source) => source.noteId === noteId),
      expectedSourceCited: noteId && evidence.some((source) => source.noteId === noteId),
      excerpts: evidence.map(({ excerpt }) => excerpt),
      expectedSourceScore: notes.find((note) => note.noteId === noteId)?.similarity,
      bestScore: notes[0]?.similarity,
    });
  }
  const relevant = results.slice(0, -unsupported.length);
  const unrelated = results.slice(-unsupported.length);
  t.diagnostic(JSON.stringify({
    embeddingModel: embeddings.modelId, generationModel: generator.modelId,
    recallAtK: relevant.filter(({ expectedSourceRetrieved }) => expectedSourceRetrieved).length / relevant.length,
    correctSourceCitationRate: relevant.filter(({ expectedSourceCited }) => expectedSourceCited).length / relevant.length,
    unsupportedAbstentionRate: unrelated.filter(({ excerpts }) => excerpts.length === 0).length / unrelated.length,
    thresholdSweep: cutoffs.map((cutoff) => ({
      cutoff,
      recallAtK: relevant.filter(({ expectedSourceScore }) => expectedSourceScore >= cutoff).length / relevant.length,
      unsupportedPassingRetrieval: unrelated.filter(({ bestScore }) => bestScore >= cutoff).length / unrelated.length,
    })),
    results,
  }));
  assert.equal(results.length, 20);
}
