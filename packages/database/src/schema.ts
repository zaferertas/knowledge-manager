import { sql } from 'drizzle-orm';
import {
  check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp,
  unique, uuid, varchar,
} from 'drizzle-orm/pg-core';

const timestampWithZone = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable('users', {
  id: uuid().defaultRandom().primaryKey(),
  email: text().notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestampWithZone('created_at').defaultNow().notNull(),
  updatedAt: timestampWithZone('updated_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid().defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestampWithZone('created_at').defaultNow().notNull(),
  expiresAt: timestampWithZone('expires_at').notNull(),
  revokedAt: timestampWithZone('revoked_at'),
}, (table) => [
  index('sessions_user_idx').on(table.userId),
  index('sessions_expiry_idx').on(table.expiresAt),
]);

export const notes = pgTable('notes', {
  id: uuid().defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar({ length: 200 }).notNull(),
  body: varchar({ length: 5000 }).default('').notNull(),
  contentRevision: integer('content_revision').default(1).notNull(),
  indexingStatus: text('indexing_status', { enum: ['pending', 'ready', 'failed'] }).default('pending').notNull(),
  createdAt: timestampWithZone('created_at').defaultNow().notNull(),
  updatedAt: timestampWithZone('updated_at').defaultNow().notNull(),
}, (table) => [
  unique('notes_owner_id_unique').on(table.userId, table.id),
  index('notes_owner_page_idx').on(table.userId, table.updatedAt.desc(), table.id),
  check('notes_title_nonblank', sql`${table.title} ~ '[^[:space:]]'`),
  check('notes_revision_positive', sql`${table.contentRevision} > 0`),
  check('notes_indexing_status_valid', sql`${table.indexingStatus} in ('pending', 'ready', 'failed')`),
]);

export const tags = pgTable('tags', {
  id: uuid().defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  normalizedName: text('normalized_name').notNull(),
  createdAt: timestampWithZone('created_at').defaultNow().notNull(),
}, (table) => [
  unique('tags_owner_id_unique').on(table.userId, table.id),
  unique('tags_owner_name_unique').on(table.userId, table.normalizedName),
]);

export const noteTags = pgTable('note_tags', {
  userId: uuid('user_id').notNull(),
  noteId: uuid('note_id').notNull(),
  tagId: uuid('tag_id').notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.noteId, table.tagId] }),
  foreignKey({
    name: 'note_tags_owned_note_fk',
    columns: [table.userId, table.noteId],
    foreignColumns: [notes.userId, notes.id],
  }).onDelete('cascade'),
  foreignKey({
    name: 'note_tags_owned_tag_fk',
    columns: [table.userId, table.tagId],
    foreignColumns: [tags.userId, tags.id],
  }).onDelete('cascade'),
  index('note_tags_tag_idx').on(table.userId, table.tagId, table.noteId),
]);
