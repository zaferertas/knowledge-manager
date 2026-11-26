import { expect, test } from '@playwright/test';

test('asks indexed notes, opens a citation, and recovers from model unavailability', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill('ask-web@example.test');
  await page.getByLabel('Password', { exact: true }).fill('synthetic password fixture');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByLabel('Title').fill('Field station');
  await page.getByLabel('Body').fill('The field station uses a yellow radio.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('heading', { name: 'Field station' })).toBeVisible();
  await expect(async () => {
    const refresh = page.getByRole('button', { name: 'Refresh indexing status' });
    if (await refresh.isEnabled({ timeout: 300 }).catch(() => false)) await refresh.click();
    await expect(page.getByText('Indexed', { exact: true })).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Reindex note' })).toBeVisible();

  await page.getByRole('button', { name: 'Ask Your Notes' }).click();
  await expect(page.getByRole('heading', { name: 'Ask Your Notes' })).toBeFocused();
  const question = page.getByRole('textbox', { name: 'Question' });
  const submit = page.getByRole('button', { name: 'Ask', exact: true });
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('Enter a question');
  await question.fill('What is the wind speed?');
  await submit.click();
  await expect(page.getByRole('status')).toContainText("couldn't find enough information");
  await question.fill('Is the model offline?');
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('AI service is unavailable');
  await expect(question).toHaveValue('Is the model offline?');
  await expect(submit).toBeEnabled();

  await page.route('**/api/v1/ask', async (route) => {
    await expect(page.getByRole('status')).toContainText('Looking for an answer');
    await expect(submit).toBeDisabled();
    await route.continue();
  }, { times: 1 });
  await question.fill('What color is the radio?');
  await submit.click();
  await expect(page.getByRole('status')).toContainText('The field station uses a yellow radio.');
  const source = page.getByRole('link', { name: 'Field station' });
  await source.click();
  await expect(page.getByRole('heading', { name: 'Field station' })).toBeVisible();
  await expect(page.getByText('The field station uses a yellow radio.')).toBeVisible();
});
