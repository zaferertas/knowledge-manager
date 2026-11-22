import { ApiProperty } from '@nestjs/swagger';
import { authError } from '../auth/browser.js';
import { isUuid, validText } from '../common/input.js';

const maxName = 100;

export class TagInput {
  @ApiProperty({ minLength: 1, maxLength: maxName, description: 'Trimmed and checked for case-insensitive uniqueness after NFC normalization.' })
  name!: string;
}

export class Tag extends TagInput {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: Date;
}

export class ReplaceTags {
  @ApiProperty({ type: 'array', items: { type: 'string', format: 'uuid' }, uniqueItems: true,
    description: 'The full set of tag IDs. An empty array clears all assignments.' })
  tagIds!: string[];
}

export function tagName(value: unknown) {
  if (value && typeof value === 'object' && Object.keys(value).length === 1 && 'name' in value &&
    validText(value.name, maxName) && value.name.trim()) {
    const name = value.name.trim();
    return { name, normalizedName: name.normalize('NFC').toLowerCase().normalize('NFC') };
  }
  throw authError(422, 'INVALID_TAG_INPUT', 'Provide a nonblank tag name of at most 100 characters.');
}

export function tagId(value: unknown) {
  if (!isUuid(value)) throw authError(422, 'INVALID_TAG_ID', 'Provide a UUID tag identifier.');
  return value;
}

export function replacementTagIds(value: unknown) {
  if (value && typeof value === 'object' && Object.keys(value).length === 1 && 'tagIds' in value &&
    Array.isArray(value.tagIds) && value.tagIds.every(isUuid)) {
    const ids = value.tagIds.map((id: string) => id.toLowerCase());
    if (new Set(ids).size === ids.length) return ids;
  }
  throw authError(422, 'INVALID_TAG_ASSIGNMENT', 'Provide an array of distinct UUID tag identifiers.');
}
