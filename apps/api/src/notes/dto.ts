import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { authError } from '../auth/browser.js';
import { isUuid, validText } from '../common/input.js';

const maxTitle = 200;
const maxBody = 5000;
export const defaultLimit = 20;
export const maxLimit = 100;
export const maxOffset = 2_147_483_647 - maxLimit;

export class CreateNote {
  @ApiProperty({ minLength: 1, maxLength: maxTitle, description: 'Must contain a non-whitespace character.' })
  title!: string;

  @ApiPropertyOptional({ maxLength: maxBody, default: '' })
  body?: string;
}

export class UpdateNote extends PartialType(CreateNote) {}

export class Note extends CreateNote {
  @ApiProperty({ maxLength: maxBody })
  declare body: string;

  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: 'array', items: { type: 'string', format: 'uuid' } })
  tagIds!: string[];

  @ApiProperty({ type: 'integer', minimum: 1 })
  contentRevision!: number;

  @ApiProperty({ enum: ['pending', 'ready', 'failed'], description: 'Pending means not yet indexed. This API does not queue indexing.' })
  indexingStatus!: 'pending' | 'ready' | 'failed';

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: Date;
}

export class NotePage {
  @ApiProperty({ type: [Note] })
  items!: Note[];

  @ApiProperty({ type: 'integer', minimum: 0, nullable: true })
  nextOffset!: number | null;
}

function invalid() {
  return authError(422, 'INVALID_NOTE_INPUT', 'Provide a nonblank title of at most 200 characters and an optional body of at most 5000 characters.');
}

export function noteInput(value: unknown, partial: false): CreateNote;
export function noteInput(value: unknown, partial: true): UpdateNote;
export function noteInput(value: unknown, partial: boolean): UpdateNote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const { title, body } = value as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'title' && key !== 'body') ||
    (!partial && title === undefined) || (title === undefined && body === undefined) ||
    (title !== undefined && (!validText(title, maxTitle) || !title.trim())) ||
    (body !== undefined && !validText(body, maxBody))) {
    throw invalid();
  }
  return { title, body };
}

export function noteId(value: string) {
  if (!isUuid(value)) {
    throw authError(422, 'INVALID_NOTE_ID', 'Provide a UUID note identifier.');
  }
  return value;
}

export function pageNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const number = Number(value);
    if (number >= minimum && number <= maximum) return number;
  }
  throw authError(422, 'INVALID_PAGINATION', 'Provide a limit from 1 to 100 and a nonnegative offset within the supported range.');
}
