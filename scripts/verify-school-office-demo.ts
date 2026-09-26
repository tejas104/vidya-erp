import { chromium, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseURL = 'http://localhost:3125';
const pdf = resolve('docs/demo/fixtures/fictional-student-record.pdf');
const browser = await chromium.launch({ headless: true });
const results: string[] = [];
async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('.login-submit').click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}
try {
  await mkdir('test-results/school-demo', { recursive: true });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signIn(page, 'school-demo-admin', 'school-demo-admin-pass-2026');
  await page.goto('/manage/users');
  await page.getByRole('heading', { name: 'Sign-ins & access' }).waitFor();
  await page.getByRole('button', { name: /Accountants/ }).click();
  await page.getByText('school-demo-accountant').waitFor();
  results.push('Admin user categories: accountant found');
  await page.goto('/manage/analytics');
  await page.getByRole('heading', { name: 'Analytics', exact: true }).waitFor();
  await page.getByRole('region', { name: 'School terms' }).waitFor();
  await page.getByRole('region', { name: 'Attendance trend' }).waitFor();
  await page.getByLabel('Distribution class').waitFor();
  await page.getByRole('region', { name: 'Student distributions' }).waitFor();
  const pieCount = await page.getByRole('img', { name: /distribution:/ }).count();
  if (pieCount < 1) throw new Error('No class distribution pie is visible');
  results.push(`Analytics class pies visible: ${pieCount}`);
  await page.screenshot({ path: 'test-results/school-demo/analytics-current.png', fullPage: true });
  results.push('Analytics: academic terms and attendance chart visible');
  await page.goto('/manage/import/students');
  await page.getByLabel('Upload CSV file').setInputFiles(pdf);
  await page.getByRole('alert').getByText(/accepts CSV only/).waitFor();
  results.push('PDF bulk import: rejected with explicit CSV-only guidance');
  const colleges = await (await page.request.get('/api/v1/people/colleges')).json() as { colleges: { id: string }[] };
  const tree = await (await page.request.get(`/api/v1/people/colleges/${colleges.colleges[0]!.id}/tree`)).json() as { departments: { classes: { code: string; sections: { id: string; name: string }[] }[] }[] };
  const sectionId = tree.departments.flatMap((d) => d.classes).find((c) => c.code === 'STD8')!.sections.find((s) => s.name === 'A')!.id;
  const roster = await (await page.request.get(`/api/v1/people/sections/${sectionId}/roster`)).json() as { students: { id: string; fullName: string }[] };
  const meera = roster.students.find((student) => student.fullName === 'Meera Das')!;
  await page.goto('/manage/students');
  await page.getByRole('heading', { name: 'Student records' }).waitFor();
  await page.getByRole('link', { name: 'Open record' }).first().waitFor();
  if (await page.getByRole('dialog', { name: /student/i }).count()) throw new Error('Cramped student drawer unexpectedly open');
  await page.goto(`/students/${meera.id}`);
  await page.getByRole('heading', { name: 'Meera Das', level: 1 }).waitFor();
  await page.getByRole('tab', { name: 'Documents' }).click();
  const docs = await (await page.request.get(`/api/v1/people/students/${meera.id}/documents`)).json() as { documents: { id: string; filename: string }[] };
  if (!docs.documents.some((doc) => doc.filename === 'fictional-student-record.pdf')) {
    await page.getByLabel('Attach student document').setInputFiles(pdf);
    await page.getByText('fictional-student-record.pdf').waitFor();
  }
  const after = await (await page.request.get(`/api/v1/people/students/${meera.id}/documents`)).json() as { documents: { id: string; filename: string }[] };
  const attached = after.documents.find((doc) => doc.filename === 'fictional-student-record.pdf');
  if (!attached) throw new Error('PDF attachment missing from API');
  const download = await page.request.get(`/api/v1/people/documents/${attached.id}/download`);
  if (!download.ok() || (await download.body()).length < 1000) throw new Error('PDF download failed');
  results.push('PDF attachment: uploaded, listed and downloaded from Meera Das record');
  await page.screenshot({ path: 'test-results/school-demo/student-record-full-page.png', fullPage: true });
  if (errors.length) throw new Error(`Admin page errors: ${errors.join('; ')}`);
  await context.close();

  const accountantContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const accountantPage = await accountantContext.newPage();
  await signIn(accountantPage, 'school-demo-accountant', 'school-demo-accountant-pass-2026');
  await accountantPage.waitForURL(/\/manage\/accounting/);
  await accountantPage.getByRole('heading', { name: 'Accounting desk' }).waitFor();
  await accountantPage.getByRole('region', { name: 'Collections by payment mode' }).waitFor();
  await accountantPage.getByRole('region', { name: 'Outstanding invoices' }).waitFor();
  if (await accountantPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Accounting page overflows phone width');
  await accountantPage.screenshot({ path: 'test-results/school-demo/accounting-phone.png', fullPage: true });
  await accountantPage.getByRole('link', { name: 'Open fee counter' }).click();
  await accountantPage.getByRole('heading', { name: 'Fee counter' }).waitFor();
  results.push('Accountant phone: sign-in, accounting overview and fee counter visible');
  await accountantContext.close();
  console.log(results.join('\n'));
} finally {
  await browser.close();
}
