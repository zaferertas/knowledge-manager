export function validText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && !value.includes('\0') && !/[\uD800-\uDFFF]/u.test(value) && [...value].length <= maxLength;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}
