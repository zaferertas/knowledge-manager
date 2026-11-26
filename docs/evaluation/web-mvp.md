# Web MVP RAG evaluation

The evaluation runner in `apps/api/test/ask-live.mjs` uses four synthetic notes and 20 questions. Sixteen questions have an expected source. Four are unsupported and include related topics that the notes do not answer. The runner reports Recall@3, validated expected-source citations, abstention, retrieval time, generation time and excerpts for manual relevance review.

```sh
GENERATION_TIMEOUT_MS=120000 RUN_LIVE_ASK=1 pnpm --filter @knowledge-hub/api test:integration
```

## Recorded live results

These measurements come from the [Milestone 6 evaluation](../IMPLEMENTATION_PLAN.md) using `nomic-embed-text` and `qwen2.5:3b` on CPU with a 120-second generation timeout.

| Measure | Recorded result at 0.50 |
| --- | --- |
| Expected source retrieved | 16 of 16 |
| Expected source cited with a validated excerpt | 8 of 16 |
| Abstention on unsupported questions | 4 of 4 |
| Generation latency | 8.6–79.6 seconds per generated question |

The recorded similarity scores retain all 16 expected notes at the shipped 0.67 cutoff and screen out all four unsupported questions before generation. That result is a retrospective threshold calculation. The recorded generation coverage and latency are from 0.50. The historical summary did not retain the retrieval timing range, model digests, CPU model or memory. The runner measures both stages independently for future runs.

The backend verifies that cited IDs belong to the authorized context and that excerpts appear verbatim. A valid excerpt can still be irrelevant or incomplete. The small synthetic set and the observed 8-of-16 citation coverage limit claims about answer quality beyond this fixture. Local models require disk space and memory in addition to PostgreSQL and Node. CPU inference can exceed the default timeout, and actual latency depends on model build, runtime, available memory and acceleration.
