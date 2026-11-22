import { expect, test } from '@playwright/test';

const email = 'web@example.test';
const password = 'synthetic password fixture';

async function enterCredentials(page) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
}

test('browser CRUD works against PostgreSQL with no Ollama service', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await enterCredentials(page);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByText('No notes yet.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  const newNote = page.getByRole('button', { name: 'New note' });
  await newNote.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'New note' })).toBeFocused();
  await page.getByLabel('Title').fill('   ');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('alert')).toContainText('nonblank title');
  await page.getByLabel('Title').fill('Garden log');
  await page.getByLabel('Body').fill('Watered the seedlings.\nChecked the soil.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('heading', { name: 'Garden log' })).toBeVisible();
  await expect(page.getByText('Not yet indexed')).toBeVisible();
  await expect(page.locator('.note-meta time')).toHaveCount(2);

  await page.reload();
  await page.getByRole('button', { name: /Garden log/ }).click();
  await expect(page.getByText('Watered the seedlings. Checked the soil.')).toBeVisible();
  await page.getByRole('button', { name: 'Edit note' }).click();
  await page.getByLabel('Title').fill('Seedling log');
  await page.getByLabel('Body').fill('Transplanted two seedlings.');
  await page.route('**/api/v1/notes/*', (route) => route.abort(), { times: 1 });
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not reach the server');
  await expect(page.getByLabel('Body')).toHaveValue('Transplanted two seedlings.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByText('Transplanted two seedlings.')).toBeVisible();

  const manageTags = page.getByRole('button', { name: 'Manage tags' });
  await manageTags.click();
  await expect(page.getByText('No tags yet.')).toBeVisible();
  await page.getByLabel('New tag name').fill('Garden');
  await page.getByRole('button', { name: 'Create tag' }).click();
  await page.getByRole('button', { name: 'Rename Garden' }).click();
  await page.getByLabel('Tag name', { exact: true }).fill('Seedlings');
  await page.getByRole('button', { name: 'Save tag name' }).click();
  await expect(page.getByRole('button', { name: 'Rename Seedlings' })).toBeVisible();

  const filter = page.getByLabel('Filter by tag');
  await filter.selectOption({ label: 'Seedlings' });
  await expect(page.getByText('No notes with this tag.')).toBeVisible();
  await filter.selectOption({ label: 'All notes' });
  const note = page.getByRole('button', { name: /Seedling log/ });
  await note.click();
  const assignment = page.getByRole('checkbox', { name: 'Seedlings' });
  const saveAssignments = page.getByRole('button', { name: 'Save tag assignments' });
  await assignment.check();
  await saveAssignments.click();
  await expect(page.getByText('Tag assignments saved.')).toBeVisible();
  await filter.selectOption({ label: 'Seedlings' });
  await expect(note).toBeVisible();
  await assignment.uncheck();
  await saveAssignments.click();
  await expect(page.getByText('No notes with this tag.')).toBeVisible();
  await assignment.check();
  await saveAssignments.click();
  await expect(note).toBeVisible();

  await manageTags.click();
  await page.getByRole('button', { name: 'Delete Seedlings' }).click();
  await page.getByRole('button', { name: 'Confirm delete tag' }).click();
  await expect(filter.locator('option')).toHaveCount(1);
  await note.click();
  await expect(page.getByText('Transplanted two seedlings.')).toBeVisible();

  await page.getByRole('button', { name: 'Delete note' }).click();
  await page.getByRole('button', { name: 'Confirm delete note' }).click();
  await expect(page.getByText('No notes yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect((await context.request.get('/api/v1/auth/me')).status()).toBe(401);

  await enterCredentials(page);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('No notes yet.')).toBeVisible();
  await context.clearCookies();
  await newNote.click();
  await page.getByLabel('Title').fill('Expired session draft');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('status')).toContainText('Your session has ended');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
