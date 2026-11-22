export type Credentials = { email: string; password: string };
export type Session = { user: { id: string; email: string }; csrfToken: string };
export type NoteContent = { title: string; body: string };
export type Note = NoteContent & {
  id: string;
  tagIds: string[];
  contentRevision: number;
  indexingStatus: 'pending' | 'ready' | 'failed';
  createdAt: string;
  updatedAt: string;
};
export type Tag = { id: string; name: string; createdAt: string };
type NotePage = { items: Note[]; nextOffset: number | null };
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Could not reach the server. Please try again.';
}

export function createClient(session?: Session, onExpired?: () => void) {
  async function request<T>(path: string, method: Method = 'GET', body?: object): Promise<T> {
    const headers = new Headers();
    if (body) headers.set('Content-Type', 'application/json');
    if (session && method !== 'GET') headers.set('X-CSRF-Token', session.csrfToken);
    const response = await fetch(`/api/v1${path}`, {
      method, headers, credentials: 'include', cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      if (response.status === 401) onExpired?.();
      const error = await response.json().catch(() => null);
      throw new ApiError(response.status, typeof error?.message === 'string'
        ? error.message
        : 'The server could not complete the request. Please try again.');
    }
    return response.status === 204 ? undefined as T : response.json();
  }

  return {
    me: () => request<Session>('/auth/me'),
    authenticate: (mode: 'login' | 'register', credentials: Credentials) =>
      request<Session>(`/auth/${mode}`, 'POST', credentials),
    logout: () => request<void>('/auth/logout', 'POST'),
    notes: (tagId: string, offset: number) => {
      const query = new URLSearchParams({ offset: String(offset) });
      if (tagId) query.set('tagId', tagId);
      return request<NotePage>(`/notes?${query}`);
    },
    note: (id: string) => request<Note>(`/notes/${id}`),
    createNote: (content: NoteContent) => request<Note>('/notes', 'POST', content),
    updateNote: (id: string, content: NoteContent) => request<Note>(`/notes/${id}`, 'PATCH', content),
    deleteNote: (id: string) => request<void>(`/notes/${id}`, 'DELETE'),
    assignTags: (id: string, tagIds: string[]) => request<void>(`/notes/${id}/tags`, 'PUT', { tagIds }),
    tags: () => request<Tag[]>('/tags'),
    createTag: (name: string) => request<Tag>('/tags', 'POST', { name }),
    renameTag: (id: string, name: string) => request<Tag>(`/tags/${id}`, 'PATCH', { name }),
    deleteTag: (id: string) => request<void>(`/tags/${id}`, 'DELETE'),
  };
}

export type Client = ReturnType<typeof createClient>;
