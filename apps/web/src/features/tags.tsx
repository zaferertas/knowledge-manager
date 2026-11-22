import { useState } from 'react';
import type { Client, Tag } from '../api/client';
import { LoadStatus, useAction } from './async';

export function TagsPanel({ client, tags, error, retry, onChange }: {
  client: Client; tags?: Tag[]; error?: string; retry: () => void; onChange: (update: (tags: Tag[]) => Tag[]) => void;
}) {
  const [editing, setEditing] = useState<string>();
  const [deleting, setDeleting] = useState<string>();
  const action = useAction();

  return <section className="panel" aria-labelledby="tags-heading">
    <h2 id="tags-heading">Manage tags</h2>
    {tags ? <>
      <TagForm label="New tag name" submit="Create tag" onSave={async (name) => {
        const created = await client.createTag(name);
        onChange((current) => [...current, created]);
      }} />
      {tags.length === 0 ? <p>No tags yet.</p> : <ul className="tag-list">
        {tags.map((tag) => <li key={tag.id}>
          {editing === tag.id ? <TagForm label="Tag name" submit="Save tag name" initial={tag.name} onCancel={() => setEditing(undefined)} onSave={async (name) => {
            const updated = await client.renameTag(tag.id, name);
            onChange((current) => current.map((item) => item.id === tag.id ? updated : item));
            setEditing(undefined);
          }} /> : <>
            <strong>{tag.name}</strong>
            {deleting === tag.id ? <>
              <p>Delete this tag and remove it from all notes?</p>
              <div className="toolbar">
                <button className="danger" disabled={action.busy} onClick={() => void action.run(async () => {
                  await client.deleteTag(tag.id);
                  onChange((current) => current.filter((item) => item.id !== tag.id));
                  setDeleting(undefined);
                })}>Confirm delete tag</button>
                <button disabled={action.busy} onClick={() => setDeleting(undefined)}>Keep tag</button>
              </div>
              {action.error && <p role="alert">{action.error}</p>}
            </> : <div className="toolbar">
              <button onClick={() => { setEditing(tag.id); setDeleting(undefined); }} aria-label={`Rename ${tag.name}`}>Rename</button>
              <button className="danger" onClick={() => { setDeleting(tag.id); setEditing(undefined); }} aria-label={`Delete ${tag.name}`}>Delete</button>
            </div>}
          </>}
        </li>)}
      </ul>}
    </> : <LoadStatus error={error} retry={retry} />}
  </section>;
}

function TagForm({ label, submit, initial = '', onSave, onCancel }: {
  label: string; submit: string; initial?: string; onSave: (name: string) => Promise<void>; onCancel?: () => void;
}) {
  const [name, setName] = useState(initial);
  const action = useAction();
  return <form onSubmit={(event) => {
    event.preventDefault();
    void action.run(async () => {
      await onSave(name);
      setName('');
    });
  }}>
    <fieldset disabled={action.busy}>
      <label>{label}<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
      <div className="toolbar">
        <button className="primary">{submit}</button>
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </fieldset>
    {action.busy && <p role="status">Saving…</p>}
    {action.error && <p role="alert">{action.error}</p>}
  </form>;
}
