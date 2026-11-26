import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, type Session, type Tag } from './api/client';
import { AskPanel } from './features/ask';
import { useAction, useLoad } from './features/async';
import { SessionGate } from './features/auth';
import { NotePane, NotesList } from './features/notes';
import { TagsPanel } from './features/tags';

function linkedNote() {
  return /^#note\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i.exec(window.location.hash)?.[1];
}

function Workspace({ session, onEnd }: { session: Session; onEnd: (expired: boolean) => void }) {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const client = useMemo(() => createClient(session, () => {
    if (active.current) onEnd(true);
  }), [session, onEnd]);
  const loadedTags = useLoad(client.tags);
  const [editedTags, setEditedTags] = useState<Tag[]>();
  const tags = editedTags ?? loadedTags.result.data;
  const [selected, setSelected] = useState(linkedNote);
  const [pane, setPane] = useState<'note' | 'tags' | 'ask'>('note');
  useEffect(() => {
    const openLinkedNote = () => {
      setSelected(linkedNote());
      setPane('note');
    };
    window.addEventListener('hashchange', openLinkedNote);
    return () => window.removeEventListener('hashchange', openLinkedNote);
  }, []);
  function openPane(next: typeof pane) {
    if (linkedNote()) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setPane(next);
  }
  const [version, setVersion] = useState(0);
  const logout = useAction();
  const refreshNotes = () => setVersion((value) => value + 1);
  const newNoteButton = useRef<HTMLButtonElement>(null);

  return <>
    <header className="topbar">
      <div className="topbar-content">
        <h1>Personal Knowledge Hub</h1>
        <div className="account">
          <span>{session.user.email}</span>
          <button disabled={logout.busy} onClick={() => void logout.run(async () => {
            await client.logout();
            openPane('note');
            onEnd(false);
          })}>Sign out</button>
        </div>
      </div>
      {logout.error && <p role="alert">{logout.error}</p>}
    </header>
    <main className="workspace">
      <aside aria-label="Notes navigation">
        <NotesList client={client} tags={tags ?? []} version={version} newNoteButton={newNoteButton} selected={pane === 'note' ? selected : undefined} onSelect={(id) => {
          openPane('note');
          setSelected(id);
        }} />
        <button className="manage" aria-expanded={pane === 'tags'} onClick={() => openPane(pane === 'tags' ? 'note' : 'tags')}>Manage tags</button>
        <button className="manage" aria-expanded={pane === 'ask'} onClick={() => openPane(pane === 'ask' ? 'note' : 'ask')}>Ask Your Notes</button>
      </aside>
      <div className="work-area">
        {pane === 'ask' ? <AskPanel client={client} /> : pane === 'tags' ? <TagsPanel client={client} tags={tags} error={loadedTags.result.error} retry={loadedTags.retry} onChange={(update) => {
          setEditedTags((current) => update(current ?? tags ?? []).sort((first, second) => first.name.localeCompare(second.name)));
          refreshNotes();
        }} /> : selected ? <NotePane key={selected} client={client} id={selected} tags={tags ?? []}
          tagsAvailable={tags !== undefined}
          onChanged={refreshNotes}
          onClose={() => {
            setSelected((id) => id === selected ? undefined : id);
            if (linkedNote() === selected) openPane('note');
            newNoteButton.current?.focus();
          }}
          onSaved={(id) => { setSelected((current) => current === selected ? id : current); refreshNotes(); }} />
          : <section className="panel"><h2>Note details</h2><p>Choose a note or create one to get started.</p></section>}
      </div>
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(
  <SessionGate renderWorkspace={(session, onEnd) => <Workspace key={session.csrfToken} session={session} onEnd={onEnd} />} />,
);
