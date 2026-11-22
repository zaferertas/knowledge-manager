import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import type { Client, Note, Tag } from '../api/client';
import { LoadStatus, useAction, useLoad } from './async';

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function Timestamp({ value }: { value: string }) {
  return <time dateTime={value}>{dateTime.format(new Date(value))}</time>;
}

export function NotesList({ client, tags, version, selected, onSelect, newNoteButton }: {
  client: Client; tags: Tag[]; version: number; selected?: string; onSelect: (id: string) => void;
  newNoteButton: Ref<HTMLButtonElement>;
}) {
  const [filter, setFilter] = useState('');
  const tagId = tags.some((tag) => tag.id === filter) ? filter : '';
  return <section className="panel note-list" aria-labelledby="notes-heading">
    <h2 id="notes-heading">Notes</h2>
    <div className="toolbar">
      <button className="primary" ref={newNoteButton} onClick={() => onSelect('new')}>New note</button>
      <label>Filter by tag
        <select value={tagId} onChange={(event) => setFilter(event.target.value)}>
          <option value="">All notes</option>
          {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </select>
      </label>
    </div>
    <NotePages key={`${tagId}:${version}`} {...{ client, tagId, selected, onSelect }} />
  </section>;
}

function NotePages({ client, tagId, selected, onSelect }: {
  client: Client; tagId: string; selected?: string; onSelect: (id: string) => void;
}) {
  const [offsets, setOffsets] = useState([0]);
  const offset = offsets[offsets.length - 1];
  const load = useCallback(() => client.notes(tagId, offset), [client, tagId, offset]);
  const { result, retry } = useLoad(load);
  const nextOffset = result.data?.nextOffset;
  return <>
    {result.data ? <>
      {result.data.items.length === 0
        ? <p>{tagId ? 'No notes with this tag.' : 'No notes yet.'}</p>
        : <ul className="note-links">{result.data.items.map((note) => (
          <li key={note.id}>
            <button className="note-link" aria-current={selected === note.id ? 'true' : undefined} onClick={() => onSelect(note.id)}>
              <strong>{note.title}</strong>
              <span><Timestamp value={note.updatedAt} /></span>
            </button>
          </li>
        ))}</ul>}
      <div className="toolbar" aria-label="Note pages">
        {offsets.length > 1 && <button onClick={() => setOffsets(offsets.slice(0, -1))}>Previous page</button>}
        {typeof nextOffset === 'number' && <button onClick={() => setOffsets([...offsets, nextOffset])}>Next page</button>}
      </div>
    </> : <LoadStatus error={result.error} retry={retry} />}
  </>;
}

export function NotePane({ client, id, tags, tagsAvailable, onSaved, onClose, onChanged }: {
  client: Client; id: string; tags: Tag[]; tagsAvailable: boolean; onSaved: (id: string) => void;
  onClose: () => void; onChanged: () => void;
}) {
  const [note, setNote] = useState<Note>();
  const [editing, setEditing] = useState(id === 'new');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const load = useCallback(() => id === 'new' ? Promise.resolve(null) : client.note(id), [client, id]);
  const { result, retry } = useLoad(load);
  const deletion = useAction();
  const assignment = useAction();

  useEffect(() => { heading.current?.focus(); }, [editing, confirmDelete]);

  const current = note ?? result.data;
  const title = editing ? (id === 'new' ? 'New note' : 'Edit note') : current?.title ?? 'Note details';
  return <section className="panel" aria-labelledby="note-heading">
    <h2 id="note-heading" tabIndex={-1} ref={heading}>{title}</h2>
    {editing ? <NoteEditor note={current ?? undefined} onCancel={() => id === 'new' ? onClose() : setEditing(false)} onSave={async (content) => {
      if (id === 'new') {
        onSaved((await client.createNote(content)).id);
      } else {
        setNote(await client.updateNote(id, content));
        onChanged();
        setEditing(false);
      }
    }} /> : current ? <>
      <div className="note-meta">
        <span>Created <Timestamp value={current.createdAt} /></span>
        <span>Updated <Timestamp value={current.updatedAt} /></span>
        <span>Not yet indexed</span>
      </div>
      <p className="note-body">{current.body || 'This note has no body.'}</p>
      {confirmDelete ? <div>
        <p>Delete this note permanently?</p>
        <div className="toolbar">
          <button className="danger" disabled={deletion.busy} onClick={() => void deletion.run(async () => {
            await client.deleteNote(id);
            onChanged();
            onClose();
          })}>Confirm delete note</button>
          <button disabled={deletion.busy} onClick={() => setConfirmDelete(false)}>Keep note</button>
        </div>
        {deletion.error && <p role="alert">{deletion.error}</p>}
      </div> : <div className="toolbar">
        <button className="primary" disabled={assignment.busy} onClick={() => setEditing(true)}>Edit note</button>
        <button className="danger" disabled={assignment.busy} onClick={() => setConfirmDelete(true)}>Delete note</button>
      </div>}
      {tagsAvailable && !confirmDelete && <Assignments note={current} tags={tags} action={assignment} onSave={async (tagIds) => {
        await client.assignTags(id, tagIds);
        setNote((latest) => ({ ...(latest ?? current), tagIds }));
        onChanged();
      }} />}
    </> : <LoadStatus error={result.error} retry={retry} />}
  </section>;
}

function NoteEditor({ note, onSave, onCancel }: {
  note?: Note; onSave: (content: { title: string; body: string }) => Promise<void>; onCancel: () => void;
}) {
  const action = useAction();
  return <form onSubmit={(event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void action.run(() => onSave({ title: String(fields.get('title')), body: String(fields.get('body')) }));
  }}>
    <fieldset disabled={action.busy}>
      <label>Title<input name="title" required defaultValue={note?.title} /></label>
      <label>Body<textarea name="body" rows={10} defaultValue={note?.body} /></label>
      <p className="hint">Up to 200 characters for the title and 5,000 for the body.</p>
      <div className="toolbar">
        <button className="primary">Save note</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </fieldset>
    {action.busy && <p role="status">Saving…</p>}
    {action.error && <p role="alert">{action.error}</p>}
  </form>;
}

function Assignments({ note, tags, onSave, action }: {
  note: Note; tags: Tag[]; onSave: (ids: string[]) => Promise<void>; action: ReturnType<typeof useAction>;
}) {
  const [selection, setSelection] = useState(note.tagIds);
  const [saved, setSaved] = useState(false);
  const visibleIds = tags.filter((tag) => selection.includes(tag.id)).map((tag) => tag.id);
  const changed = tags.some((tag) => selection.includes(tag.id) !== note.tagIds.includes(tag.id));
  if (tags.length === 0) return <p className="hint">Create a tag to organize this note.</p>;
  return <form className="assignments" onSubmit={(event) => {
    event.preventDefault();
    void action.run(async () => {
      await onSave(visibleIds);
      setSaved(true);
    });
  }}>
    <fieldset disabled={action.busy}>
      <legend>Note tags</legend>
      <div className="tag-options">
        {tags.map((tag) => <label key={tag.id}>
          <input type="checkbox" checked={selection.includes(tag.id)} onChange={(event) => {
            setSaved(false);
            setSelection(event.target.checked ? [...selection, tag.id] : selection.filter((id) => id !== tag.id));
          }} />{tag.name}
        </label>)}
      </div>
      <button disabled={!changed}>Save tag assignments</button>
    </fieldset>
    {saved && <p role="status">Tag assignments saved.</p>}
    {action.error && <p role="alert">{action.error}</p>}
  </form>;
}
