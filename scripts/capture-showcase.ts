import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { PracticeService } from '../src/service.ts';
import { createApplication } from '../src/server.ts';
import { defaultSettings } from '../src/model.ts';
import type { Job, Session } from '../src/model.ts';

// All materials and responses below are synthetic. This tool never opens the personal workspace.
const directory = mkdtempSync(join(tmpdir(), 'interview-showcase-'));
const store = new Store(join(directory, 'demo.db'));
store.setSettings({ ...defaultSettings, baseUrl: 'http://127.0.0.1:12345/v1', model: 'demo-model', apiKey: 'synthetic-demo-key' });
const question = '资料更新后，怎样保证旧面试仍使用创建时的内容？';
const original = '我在创建面试时保存材料快照，旧会话不再读取资料库。';
const retry = '创建会话时，我复制选定材料的正文和版本号。后续修改只更新资料库，历史引用从会话快照读取；我用修改前后的内容对比来验证隔离。';
const reference = '## 考点\n材料版本隔离与可追溯性。\n## 口述示例\n创建会话时复制材料正文与版本，后续编辑只改资料库；旧会话按快照读取 [M3]。\n## 可以进一步说明\n结合测试介绍删除资料、编辑冲突时的行为。\n## 可追问点\n为什么只保存资料 ID 不够？';
const comparison = '## 已经改进\n原答只提到“保存材料快照”；重答用“复制选定材料的正文和版本号”说明了保存内容，也补上验证方式。\n## 仍需补充\n技术上可继续说明编辑冲突；表达上可把验证结果接在实现之后。\n## 下一次怎么练\n用一个材料更新前后的例子解释版本隔离。';
const service = new PracticeService(store, async (_settings, messages, _signal, onText) => {
  const task = messages.at(-1)!.content;
  const output = task.includes('参考答法 Markdown') ? reference : task.includes('比较同一道题') ? comparison : question;
  onText(output); return output;
});
const resume = service.material({ title: '后端开发简历（示例）', kind: 'resume', text: '合成候选人：负责资料管理接口与会话版本隔离，用于展示面试练习流程。' });
const jd = service.material({ title: '后端开发岗位 JD（示例）', kind: 'jd', text: '要求理解事务、并发冲突与故障恢复，能解释方案取舍和验证方法。' });
const project = service.material({ title: '材料版本管理（示例）', kind: 'project', text: '本示例在创建会话时复制材料正文和版本；后续编辑或删除资料不改历史快照。测试通过更新资料后对比新旧会话验证隔离，无真实业务性能指标。' });
const application = createApplication(store, service);
await new Promise<void>(resolve => application.server.listen(0, '127.0.0.1', resolve));
const address = application.server.address(); assert.ok(address && typeof address === 'object');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(12000);
const errors: string[] = [], staged = new Map<string, string>();
page.on('pageerror', error => errors.push(error.message));
async function capture(name: string, target: Page = page) {
  await target.waitForFunction(() => !document.querySelector('.job-status, .floating-job'));
  const dismiss = target.locator('.banner.success button');
  if (await dismiss.count()) await dismiss.click();
  await target.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await target.mouse.move(1430, 10);
  await target.waitForTimeout(200);
  assert.equal(await target.locator('[role="alert"], .banner.error, .job-error').count(), 0, `${name}: unexpected failure content`);
  assert.ok(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: horizontal overflow`);
  const path = join(directory, name + '.png');
  await target.screenshot({ path, fullPage: false }); staged.set(name, path);
}
try {
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.getByRole('heading', { name: '开始一轮面试', exact: true }).waitFor();
  await page.getByLabel('练习名称', { exact: true }).fill('项目表达练习（示例）');
  await page.getByLabel('目标岗位', { exact: true }).fill('后端开发工程师');
  await page.getByLabel('本轮简历', { exact: true }).selectOption(resume.id);
  await page.getByLabel('本轮岗位 JD', { exact: true }).selectOption(jd.id);
  await page.getByRole('checkbox').check();
  assert.ok(await page.getByRole('button', { name: /创建本轮练习/ }).isEnabled());
  await capture('workspace');

  await page.getByRole('button', { name: /创建本轮练习/ }).click();
  await page.getByRole('button', { name: '生成第一题', exact: true }).click();
  await page.getByRole('heading', { name: question, exact: true }).waitFor();
  await page.getByRole('textbox', { name: '你的回答', exact: true }).fill(original);
  await page.getByRole('button', { name: '提交回答', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '回答已保存' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '生成参考答法', exact: true }).count(), 0);
  await page.getByRole('button', { name: '结束本轮面试', exact: true }).click();
  await page.getByRole('button', { name: '生成参考答法', exact: true }).click();
  await page.getByRole('heading', { name: '口述示例', exact: true }).waitFor();
  await page.getByRole('button', { name: '查看材料 M3', exact: true }).click();
  assert.equal(await page.locator('details[data-citation="M3"]').getAttribute('open'), '');
  await page.getByRole('textbox', { name: '再次作答', exact: true }).fill(retry);
  await page.getByRole('button', { name: '保存并比较', exact: true }).click();
  await page.getByText(/^重答 1 ·/).waitFor();
  await page.locator('.generation-meta').filter({ hasText: '重答比较' }).waitFor();
  const current = store.list<Session>('sessions')[0];
  assert.equal(current.status, 'completed'); assert.equal(current.materials.length, 3);
  assert.equal(current.turns.length, 1); assert.equal(current.turns[0].answer, original);
  assert.equal(current.turns[0].reference, reference); assert.equal(current.turns[0].attempts.length, 1);
  assert.equal(current.turns[0].attempts[0].text, retry);
  assert.equal(current.turns[0].attempts[0].comparison, comparison);
  assert.equal(await page.locator('.saved-answer').count(), 1);
  // Return to the question and original answer; the comparison has already been verified above.
  await page.getByRole('textbox', { name: '再次作答', exact: true }).fill('');
  await page.locator('.practice-main').evaluate(element => { element.scrollTop = 0; });
  await capture('answer-retry');

  await page.getByRole('button', { name: /备面知识库/ }).click();
  await page.locator('.domain-entry').filter({ hasText: /^Python/ }).click();
  await page.getByRole('heading', { name: 'Python · 快速提纲', exact: true }).waitFor();
  assert.equal(await page.locator('.knowledge-file').count(), 1);
  assert.equal(await page.getByLabel('阅读文件', { exact: true }).count(), 0);
  assert.ok(!(await page.locator('.knowledge-file').innerText()).includes('性质：内置学习提纲'));
  await page.getByRole('tab', { name: /高频题库/ }).click();
  const answerNotes = page.locator('.knowledge-file strong').filter({ hasText: /^参考答题要点$/ });
  await answerNotes.first().waitFor(); assert.equal(await answerNotes.count(), 4);
  await page.getByRole('tab', { name: /核心知识库/ }).click();
  await page.getByRole('button', { name: '深灰青绿', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'forest');
  await capture('knowledge');

  // A second page demonstrates a genuinely new empty workspace, not a redacted personal form.
  const blank = new Store(':memory:'), emptyApp = createApplication(blank);
  await new Promise<void>(resolve => emptyApp.server.listen(0, '127.0.0.1', resolve));
  const emptyAddress = emptyApp.server.address(); assert.ok(emptyAddress && typeof emptyAddress === 'object');
  const emptyPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  emptyPage.on('pageerror', error => errors.push(error.message));
  try {
    await emptyPage.goto(`http://127.0.0.1:${emptyAddress.port}`);
    await emptyPage.getByRole('button', { name: /模型与设置/ }).click();
    await emptyPage.getByRole('button', { name: '新增模型配置', exact: true }).click();
    for (const label of ['API 基础地址', '模型 ID', 'API Key']) assert.equal(await emptyPage.getByLabel(label, { exact: true }).inputValue(), '');
    assert.deepEqual(blank.settings(), defaultSettings);
    assert.equal(await emptyPage.getByRole('button', { name: '保存模型设置', exact: true }).isEnabled(), false);
    await capture('model-settings-empty', emptyPage);
    assert.deepEqual(blank.settings(), defaultSettings);
  } finally { await emptyPage.close(); await emptyApp.service.close(); await new Promise<void>(resolve => emptyApp.server.close(() => resolve())); blank.close(); }

  assert.deepEqual(errors, []);
  assert.ok(store.list<Job>('jobs').every(job => job.status === 'succeeded'));
  const hashes = [...staged.values()].map(path => createHash('sha256').update(readFileSync(path)).digest('hex'));
  assert.equal(new Set(hashes).size, 4, 'Showcase images must represent four different states');
  mkdirSync('images', { recursive: true }); mkdirSync('local_tools/ui', { recursive: true });
  for (const [name, path] of staged) copyFileSync(path, `images/${name}.png`);
  writeFileSync('local_tools/ui/showcase-results.json', JSON.stringify({ files: [...staged.keys()], viewport: '1440x1000', data: 'synthetic', model: 'mock', errors, completedJobs: store.list<Job>('jobs').length, comparisonSaved: true, credentialsInSettingsExample: false }, null, 2));
  console.log('Showcase passed: four distinct screenshots; saved answer, reference, comparison and citation verified; no page errors.');
} finally {
  await browser.close(); await service.close();
  await new Promise<void>(resolve => application.server.close(() => resolve())); store.close();
  rmSync(directory, { recursive: true, force: true });
}
