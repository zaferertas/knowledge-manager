import { useEffect, useRef, useState } from 'react';
import type { AskResult, Client } from '../api/client';
import { useAction } from './async';

export function AskPanel({ client }: { client: Client }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const action = useAction();
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AskResult>();
  const [validation, setValidation] = useState('');

  useEffect(() => { heading.current?.focus(); }, []);

  return <section className="panel" aria-labelledby="ask-heading">
    <h2 id="ask-heading" tabIndex={-1} ref={heading}>Ask Your Notes</h2>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (action.busy) return;
      setResult(undefined);
      if (!question.trim() || [...question].length > 500) {
        setValidation('Enter a question of up to 500 characters.');
        return;
      }
      setValidation('');
      void action.run(async () => setResult(await client.ask(question.trim())));
    }}>
      <label>Question
        <textarea rows={3} value={question} aria-describedby="question-hint"
          aria-invalid={!!validation} onChange={(event) => setQuestion(event.target.value)}
          readOnly={action.busy} />
      </label>
      <p className="hint" id="question-hint">Up to 500 characters. Answers use indexed notes.</p>
      <button className="primary" disabled={action.busy}>Ask</button>
    </form>
    {validation ? <p role="alert">{validation}</p> : action.error && <p role="alert">{action.error}</p>}
    {action.busy && <p role="status">Looking for an answer in your notes…</p>}
    {result?.status === 'insufficient_evidence' && <p role="status">
      I couldn't find enough information in your notes to answer that.
    </p>}
    {result?.status === 'answered' && <>
      <div role="status">
        <h3>Answer</h3>
        <p className="note-body">{result.answer}</p>
      </div>
      <h3>Sources</h3>
      <ul className="ask-sources">
        {result.sources.map((source) => <li key={source.noteId}>
          <a href={`#note/${source.noteId}`}>{source.title}</a>
        </li>)}
      </ul>
    </>}
  </section>;
}
