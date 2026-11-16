import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { PracticeService } from '../src/service.ts';
import { createApplication } from '../src/server.ts';
import { defaultSettings as emptySettings } from '../src/model.ts';
import type { Material, ModelProfile } from '../src/model.ts';

const defaultSettings = { ...emptySettings, baseUrl: 'https://api.example.com/v1', model: 'gpt-6.1-sol', effort: 'xhigh' };

const directory = mkdtempSync(join(tmpdir(), 'interview-room-ui-'));
const store = new Store(join(directory, 'test.db')); store.setSettings({ ...defaultSettings, apiKey: 'synthetic-only' });
const service = new PracticeService(store, async (_, messages, signal, onText) => {
  const task = messages.at(-1)!.content;
  const output = task.includes('参考答法 Markdown') ? '## 考点\n材料快照与版本隔离。\n## 口述示例\n我在合成项目中实现了材料快照 [M3]。\n## 需要本人补充\n实际并发量待补充。'
    : task.includes('比较同一道题') ? '## 已经改进\n重答明确提到了“旧会话不变”。\n## 仍需补充\n可以解释事务失败的处理。'
    : task.includes('生成复盘 Markdown') ? '## 总体观察\n能说明项目职责。\n## 技术缺口\n需要解释版本冲突。\n## 后续练习\n复习事务、重试与故障恢复。'
    : task.includes('生成备面分析 Markdown') ? '## 岗位重点\n岗位要求事务、幂等和故障恢复 [M2]。\n## 材料缺口\n还需要补充测试证据。'
    : task.includes('补充核心知识') || task.includes('补充高频题库') ? '## 合成学习补充\n检查条件、失败窗口与验证方法。'
    : '你在项目中如何保证资料更新后，旧会话仍然使用当时的材料？';
  onText(output.slice(0, 15));
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 350); signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('cancelled')); }, { once: true }); });
  onText(output); return output;
});
const material = service.material({ title: '合成项目 · 材料快照', kind: 'project', text: '我实现了不可变材料快照，更新资料后，旧会话不变。业务数据均为测试样例。' });
const resume = service.material({ title: '合成简历', kind: 'resume', text: '候选人负责后端接口与材料版本管理。' });
const jd = service.material({ title: '合成岗位 JD', kind: 'jd', text: '后端实习生，要求理解事务、幂等和故障恢复。' });
const app = createApplication(store, service);
await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
const address = app.server.address(); assert.ok(address && typeof address === 'object');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
const checks: string[] = [];
async function check(name: string, action: () => Promise<void>) { await action(); checks.push(name); console.log('PASS', name); }
const expectText = async (text: string) => { await page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor(); };
async function capture(name: string) {
  const dismiss = page.locator('.banner.success button'); if (await dismiss.count()) await dismiss.click();
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.evaluate(() => { document.querySelector('.content')?.scrollTo(0, 0); }); await page.mouse.move(1400, 50);
  await page.waitForTimeout(200); // Capture the selected state after the CSS color transition settles.
  await page.screenshot({ path: `local_tools/ui/${name}.png`, fullPage: false });
}
try {
  await page.goto(`http://127.0.0.1:${address.port}`);
  await check('new workspace and real material selection', async () => { await expectText('开始一轮面试');
    assert.equal(await page.getByLabel('目标岗位', { exact: true }).inputValue(), '');
    assert.equal(await page.getByRole('button', { name: /创建本轮练习/ }).isEnabled(), false);
    await page.getByLabel('目标岗位', { exact: true }).fill('后端开发工程师'); await page.getByRole('checkbox').check();
    await page.getByLabel('本轮简历', { exact: true }).selectOption(resume.id); await page.getByLabel('本轮岗位 JD', { exact: true }).selectOption(jd.id); });
  mkdirSync('local_tools/ui', { recursive: true });
  await check('resume and knowledge entries isolate their categories and new drafts', async () => {
    await page.getByRole('button', { name: /我的简历/ }).click();
    await expectText('让每段经历，经得起追问。');
    assert.equal(await page.locator('.material-card').count(), 1);
    await expectText('合成简历');
    await page.getByRole('button', { name: /添加简历/ }).click();
    assert.equal(await page.getByLabel('类型', { exact: true }).inputValue(), 'resume');
    await page.getByLabel('标题', { exact: true }).fill('尚未保存的简历草稿');
    await page.getByLabel('资料正文', { exact: true }).fill('保留我的简历草稿。');
    await page.getByRole('button', { name: /备面知识库/ }).click();
    await page.getByRole('heading', { name: '备面知识库', exact: true }).waitFor();
    assert.equal(await page.locator('.domain-entry').count(), 13);
    await page.getByRole('button', { name: '新增文件', exact: true }).click();
    assert.equal(await page.getByLabel('类型', { exact: true }).inputValue(), 'notes');
    assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '');
    await page.getByLabel('标题', { exact: true }).fill('知识笔记草稿');
    await page.getByRole('button', { name: /我的简历/ }).click();
    await page.getByRole('button', { name: /添加简历/ }).click();
    assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '尚未保存的简历草稿');
    await page.getByRole('button', { name: /开始面试/ }).click();
  });
  await check('topic preparation keeps its own focus and does not overwrite interview setup', async () => {
    await page.getByRole('button', { name: /专项练习/ }).click();
    await page.getByRole('heading', { name: '选择训练领域', exact: true }).waitFor();
    assert.equal(await page.locator('.topic-choice').count(), 12);
    assert.equal(await page.getByRole('button', { name: /创建本轮练习/ }).count(), 0);
    await capture('topic');
    await page.locator('.topic-choice').filter({ hasText: /^SQL/ }).click();
    await page.getByLabel('目标岗位', { exact: true }).fill('后端开发工程师');
    await page.getByLabel('本轮专项重点（可选）', { exact: true }).fill('数据库事务与重试');
    await page.getByLabel('练习名称', { exact: true }).fill('事务专项');
    await page.getByRole('button', { name: /开始面试/ }).click();
    assert.equal(await page.getByLabel('练习名称', { exact: true }).inputValue(), '我的面试练习');
    assert.equal(await page.getByLabel('本轮简历', { exact: true }).inputValue(), resume.id);
  });
  await check('desktop preparation stays readable with the create action visible', async () => {
    const bounds = await page.getByRole('button', { name: /创建本轮练习/ }).boundingBox();
    assert.ok(bounds && bounds.y + bounds.height <= 1000, 'Creation action should fit the normal laptop viewport with one short project');
    assert.ok(await page.locator('label').evaluateAll(labels => labels.every(label => parseFloat(getComputedStyle(label).fontSize) >= 13)));
  });
  await check('short laptop workspace keeps create action and local field scrolling', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const layout = await page.evaluate(() => {
      const fields = document.querySelector('.setup-fields')!;
      return { height: document.documentElement.scrollHeight, viewport: innerHeight, font: parseFloat(getComputedStyle(document.querySelector('label')!).fontSize), fields: fields.scrollHeight > fields.clientHeight };
    });
    assert.ok(layout.height <= layout.viewport + 1); assert.ok(layout.font >= 15); assert.ok(layout.fields);
    const bounds = await page.getByRole('button', { name: /创建本轮练习/ }).boundingBox();
    assert.ok(bounds && bounds.y + bounds.height <= 800);
    await capture('workspace-laptop');
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await capture('workspace-ink');
  await check('two themes persist after reload', async () => {
    assert.equal(await page.locator('.swatch').count(), 2);
    for (const [name, theme] of [['深灰青绿', 'forest'], ['雾白墨蓝', 'ink']]) {
      await page.getByRole('button', { name, exact: true }).click();
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await page.waitForTimeout(200); // Let the 150 ms color transition settle before visual capture.
      await capture(`workspace-${theme}`);
      await page.reload(); await expectText('开始一轮面试');
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      assert.equal(await page.getByLabel('本轮简历', { exact: true }).inputValue(), resume.id);
      assert.equal(await page.getByLabel('本轮岗位 JD', { exact: true }).inputValue(), jd.id);
    }
    await page.getByRole('checkbox').check();
    await page.getByLabel('本轮简历', { exact: true }).selectOption(resume.id); await page.getByLabel('本轮岗位 JD', { exact: true }).selectOption(jd.id);
  });
  await page.getByRole('button', { name: /创建本轮练习/ }).click();
  await check('resume and JD preparation analysis before answering', async () => {
    await page.getByRole('button', { name: '备面分析', exact: true }).click();
    await page.getByRole('button', { name: '生成备面分析', exact: true }).click(); await expectText('岗位重点');
    await page.getByRole('button', { name: '面试与重答', exact: true }).click();
  });
  await check('create session and generate question', async () => {
    assert.deepEqual(store.list<{ materials: {kind: string}[] }>('sessions')[0].materials.map(item => item.kind), ['resume', 'jd', 'project']);
    await page.getByRole('button', { name: '生成第一题', exact: true }).click();
    await page.getByRole('heading', { name: '你在项目中如何保证资料更新后，旧会话仍然使用当时的材料？', exact: true }).waitFor();
  });
  await check('draft survives leaving page and browser reload', async () => {
    await page.getByRole('textbox', { name: '你的回答', exact: true }).fill('我实现了材料快照，旧会话不变。');
    await page.getByRole('button', { name: /资料与学习/ }).click(); await expectText('好的追问，从真实材料开始。');
    await page.getByRole('button', { name: /开始面试/ }).click();
    await page.waitForFunction(() => (document.querySelector('.answer-editor textarea') as HTMLTextAreaElement)?.value.includes('旧会话不变'));
    await page.reload();
    await page.waitForFunction(() => (document.querySelector('.answer-editor textarea') as HTMLTextAreaElement)?.value.includes('旧会话不变'));
  });
  await check('strict mode blocks reference while original answer saved', async () => {
    await page.getByRole('button', { name: '提交回答', exact: true }).click(); await page.getByRole('status').filter({ hasText: '回答已保存' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '生成参考答法', exact: true }).count(), 0);
    await page.getByRole('button', { name: '结束本轮面试', exact: true }).click();
    await page.getByRole('button', { name: '生成参考答法', exact: true }).waitFor();
  });
  await check('reference generation and answer comparison persist', async () => {
    await page.getByRole('button', { name: '生成参考答法', exact: true }).click();
    const retry = page.getByRole('textbox', { name: '再次作答', exact: true }); await retry.waitFor();
    await page.getByRole('button', { name: '查看材料 M3', exact: true }).click();
    assert.equal(await page.locator('details[data-citation="M3"]').getAttribute('open'), '');
    await retry.fill('我使用版本标识冻结内容，更新资料后旧会话不变。');
    await page.getByRole('button', { name: '保存并比较', exact: true }).click();
    await page.getByText(/^重答 1 ·/).waitFor();
    await page.reload(); await page.getByText(/^重答 1 ·/).waitFor();
    await page.screenshot({ path: 'local_tools/ui/answer-review.png', fullPage: true });
  });
  await check('review generated and persists on reload', async () => {
    await page.getByRole('button', { name: '本轮复盘', exact: true }).click(); await page.getByRole('button', { name: '生成复盘', exact: true }).click();
    await expectText('总体观察'); await page.reload();
    await page.getByRole('button', { name: '本轮复盘', exact: true }).click(); await expectText('总体观察');
  });
  await check('material edit draft survives navigation and saved revision increments', async () => {
    await page.getByRole('button', { name: /资料与学习/ }).click(); await page.locator('.material-card').filter({ hasText: material.title }).getByRole('button', { name: '编辑资料', exact: true }).click();
    await page.getByRole('textbox', { name: '资料正文', exact: true }).fill('编辑草稿，旧会话不变，新增了事务回滚说明。');
    await capture('material-editor');
    await page.getByRole('button', { name: /复盘与重练/ }).click(); await page.getByRole('button', { name: /资料与学习/ }).click();
    await page.locator('.material-card').filter({ hasText: material.title }).getByRole('button', { name: '编辑资料', exact: true }).click(); assert.match(await page.getByRole('textbox', { name: '资料正文', exact: true }).inputValue(), /事务回滚/);
    await page.getByRole('button', { name: '保存资料', exact: true }).click(); await expectText('v2');
    assert.equal(store.require<{revision: number}>('materials', material.id).revision, 2);
  });
  await check('corrupt browser material draft does not crash the editor', async () => {
    await page.evaluate(key => localStorage.setItem(key, JSON.stringify('{broken')), `ir-material-${material.id}`);
    await page.locator('.material-card').filter({ hasText: material.title }).getByRole('button', { name: '编辑资料', exact: true }).click();
    await page.getByText(/浏览器草稿格式损坏/).waitFor();
    assert.match(await page.getByRole('textbox', { name: '资料正文', exact: true }).inputValue(), /事务回滚/);
    await page.getByRole('button', { name: '收起', exact: true }).click();
  });
  await check('mobile layout has no horizontal overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: /开始面试/ }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const navButtons = page.getByRole('navigation', { name: '主导航' }).getByRole('button');
    assert.equal(await navButtons.count(), 7);
    for (const button of await navButtons.all()) {
      const bounds = await button.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391);
    }
    await page.screenshot({ path: 'local_tools/ui/mobile.png', fullPage: true });
  });
  await check('backup preview and explicit import append a knowledge note', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: /模型与设置/ }).click();
    await page.getByRole('tab', { name: '备份与迁移', exact: true }).click();
    const backup = { format: 'interview-room-backup', version: 2, materials: [{ id: 'synthetic-note', title: '合成知识题卡', kind: 'notes', text: '事务与故障恢复练习' }], sessions: [] };
    await page.locator('input[type=file]').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    const before = store.list('materials').length;
    await expectText('导入预览'); assert.equal(store.list('materials').length, before);
    await page.getByRole('button', { name: '确认追加导入', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '历史记录已追加导入' }).waitFor();
    assert.equal(store.list('materials').length, before + 1);
    await page.getByRole('button', { name: /资料与学习/ }).click();
    await page.getByLabel('资料分类', { exact: true }).selectOption('notes'); await expectText('合成知识题卡');
  });
  await check('knowledge entry searches and edits imported notes', async () => {
    await page.getByRole('button', { name: /备面知识库/ }).click();
    await page.getByRole('button', { name: /^未分类笔记/ }).click(); await expectText('合成知识题卡');
    assert.equal(await page.locator('.knowledge-file').count(), 1);
    await page.getByLabel('搜索知识', { exact: true }).fill('不存在的词'); await expectText('没有找到匹配的知识');
    await page.getByLabel('搜索知识', { exact: true }).fill('事务'); await expectText('合成知识题卡');
    await page.getByRole('button', { name: '编辑文件', exact: true }).click();
    assert.equal(await page.getByLabel('类型', { exact: true }).inputValue(), 'notes');
    await page.getByRole('button', { name: '收起', exact: true }).click();
    await page.locator('.domain-entry').filter({ hasText: /^Python/ }).click();
    await page.getByRole('tab', { name: /核心知识库/ }).click();
    await page.getByRole('heading', { name: /对象与参数$/ }).waitFor();
    assert.equal(await page.getByLabel('阅读文件', { exact: true }).count(), 0);
    await page.getByRole('heading', { name: '追问方向', exact: true }).waitFor();
    const titleBounds = await page.getByRole('heading', { name: '备面知识库', exact: true }).boundingBox();
    await page.locator('.knowledge-files').evaluate(element => { element.scrollTop = element.scrollHeight; });
    assert.deepEqual(await page.getByRole('heading', { name: '备面知识库', exact: true }).boundingBox(), titleBounds);
    assert.ok(await page.locator('.prose').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 17));
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1));
    await page.locator('.knowledge-files').evaluate(element => { element.scrollTop = 0; });
    assert.ok(await page.locator('input[hidden]').evaluateAll(inputs => inputs.every(input => getComputedStyle(input).display === 'none')), 'Hidden upload inputs must not appear as a second native file control');
    await page.getByRole('button', { name: '深灰青绿', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'forest');
    await capture('knowledge-forest');
    await page.getByRole('button', { name: '雾白墨蓝', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'ink');
    await capture('knowledge');
    await capture('knowledge-outline');
    await page.getByRole('tab', { name: /高频题库/ }).click(); await expectText('参考答题要点');
    await capture('knowledge-questions');
  });
  await check('ability records match saved answers, retries and reviews and open the original', async () => {
    await page.getByRole('button', { name: /^06.*能力记录$/ }).click(); await page.getByRole('heading', { name: '能力记录', exact: true }).waitFor();
    assert.deepEqual(await page.locator('.metric-card>strong').allTextContents(), ['1', '1', '1', '1']);
    assert.equal(await page.locator('.progress-recent details').count(), 2);
    const comparison = page.locator('.progress-recent details').filter({ hasText: '重答比较' });
    await comparison.locator('summary').click(); await expectText('已经改进');
    await comparison.locator('summary').click();
    await capture('progress');
    await comparison.locator('summary').click();
    await page.getByRole('button', { name: '回看原始问答', exact: true }).click(); await page.getByText(/^重答 1 ·/).waitFor();
  });
  await check('all seven entries and settings remain reachable in a short desktop window', async () => {
    await page.setViewportSize({ width: 1280, height: 600 });
    for (const name of ['开始面试', '复盘与重练', '资料与学习', '我的简历', '专项练习', '能力记录', '备面知识库', '模型与设置']) {
      const button = page.getByRole('button', { name: new RegExp(name) }).first(); await button.click();
      const bounds = await button.boundingBox(); assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 601);
      assert.equal(await button.getAttribute('aria-current'), 'page');
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check('focused practice creates a real session with the saved focus and selected knowledge', async () => {
    await page.getByRole('button', { name: /^05.*专项练习$/ }).click();
    assert.equal(await page.getByLabel('本轮专项重点（可选）', { exact: true }).inputValue(), '数据库事务与重试');
    await page.getByRole('checkbox', { name: /合成知识题卡/ }).check();
    await page.screenshot({ path: 'local_tools/ui/topic-selected.png', fullPage: false });
    await page.getByRole('button', { name: /创建本轮练习/ }).click();
    await page.getByRole('heading', { name: '事务专项', exact: true }).waitFor();
    const focused = store.list<{focus: string; topicName: string; materials: {kind: string; topicId?: string}[]}>('sessions').find(item => item.focus === '数据库事务与重试');
    assert.ok(focused); assert.equal(focused.topicName, 'SQL'); assert.ok(focused.materials.some(item => item.topicId === 'topic-sql'));
  });
  await check('knowledge domain CRUD, two categories, draft recovery and multi-file import work together', async () => {
    await page.getByRole('button', { name: /^07.*备面知识库$/ }).click();
    await page.getByRole('button', { name: '新建领域', exact: true }).click();
    await page.getByLabel('领域名称', { exact: true }).fill('合成验证领域');
    await page.getByLabel('领域说明', { exact: true }).fill('通用测试资料，不属于任何候选人项目');
    await page.getByRole('button', { name: '保存领域', exact: true }).click(); await expectText('当前分类还没有文件');
    await page.getByRole('button', { name: '新增文件', exact: true }).click();
    await page.getByLabel('标题', { exact: true }).fill('可恢复的知识草稿');
    await page.getByLabel('资料正文', { exact: true }).fill('记录事务边界与失败恢复。');
    await page.getByRole('button', { name: /^02.*复盘与重练/ }).click();
    await page.getByRole('button', { name: /^07.*备面知识库$/ }).click();
    await page.getByRole('button', { name: '新增文件', exact: true }).click();
    assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '可恢复的知识草稿');
    await page.getByRole('button', { name: '保存资料', exact: true }).click(); await expectText('可恢复的知识草稿');
    const topic = store.list<{id: string; name: string}>('topics').find(item => item.name === '合成验证领域')!;
    await page.getByRole('tab', { name: /高频题库/ }).click();
    await page.locator('.knowledge-tools input[type=file]').setInputFiles([
      { name: 'A01.md', mimeType: 'text/markdown', buffer: Buffer.from('# 问题\n如何确定事务边界？\n参考要点：业务一致性。') },
      { name: 'A02.txt', mimeType: 'text/plain', buffer: Buffer.from('如何处理失败？先区分临时和永久失败。') },
    ]);
    await page.getByRole('status').filter({ hasText: '已导入 2 份文件' }).waitFor();
    assert.equal(store.list<Material>('materials').filter(item => item.topicId === topic.id && item.knowledgeSection === 'questions').length, 2);
    await page.getByLabel('阅读文件', { exact: true }).selectOption({ label: 'A01' });
    await expectText('如何确定事务边界？');
    await page.getByLabel('阅读文件', { exact: true }).selectOption({ label: 'A02' });
    await expectText('如何处理失败？先区分临时和永久失败。');
    await page.getByRole('button', { name: '编辑领域', exact: true }).click();
    await page.getByLabel('领域名称', { exact: true }).fill('合成验证领域改名');
    await page.getByRole('button', { name: '保存领域', exact: true }).click();
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '删除领域', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '领域已删除' }).waitFor();
    assert.equal(store.list<Material>('materials').filter(item => item.title === '可恢复的知识草稿')[0].topicId, undefined);
  });
  await check('AI knowledge supplement creates a file without replacing the original knowledge', async () => {
    await page.locator('.domain-entry').filter({ has: page.getByText('Java', { exact: true }) }).click();
    await page.getByRole('tab', { name: /核心知识库/ }).click();
    const original = store.require<Material>('materials', 'starter-java-core');
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'AI 补充知识', exact: true }).click();
    await expectText('Java · AI 核心知识补充');
    assert.deepEqual(store.require('materials', original.id), original);
  });
  await check('multiple model profiles save, retain separate keys and activate without changing the original choice', async () => {
    await page.getByRole('button', { name: /模型与设置/ }).click(); await expectText('我的模型配置');
    await page.getByRole('button', { name: '新增模型配置', exact: true }).click();
    await page.getByLabel('服务商模板', { exact: true }).selectOption('deepseek');
    assert.equal(await page.getByLabel('请求协议', { exact: true }).inputValue(), 'chat');
    assert.equal(await page.getByLabel('推理强度', { exact: true }).inputValue(), '');
    await page.getByLabel('配置名称', { exact: true }).fill('合成 DeepSeek 配置');
    await page.getByLabel('模型 ID', { exact: true }).fill('synthetic-deepseek');
    await page.getByLabel('API Key', { exact: true }).fill('synthetic-second-key');
    await page.getByRole('button', { name: '保存模型设置', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '模型配置已保存' }).waitFor();
    assert.equal(await page.getByLabel('API Key', { exact: true }).inputValue(), '');
    const extra = store.list<ModelProfile>('profiles').find(item => item.name === '合成 DeepSeek 配置')!;
    assert.equal(store.settings().model, 'gpt-6.1-sol');
    await page.getByLabel('配置名称', { exact: true }).fill('合成 DeepSeek 改名');
    await page.getByRole('button', { name: '保存模型设置', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '模型配置已保存' }).waitFor();
    assert.equal(store.require<ModelProfile>('profiles', extra.id).connection.apiKey, 'synthetic-second-key');
    await page.getByRole('button', { name: '启用这份模型', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已切换后续任务' }).waitFor();
    assert.equal(store.settings().model, 'synthetic-deepseek');
    await page.locator('.profile-choice').filter({ hasText: '原有模型配置' }).click();
    await page.getByRole('button', { name: '启用这份模型', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已切换后续任务' }).waitFor();
    assert.equal(store.settings().model, 'gpt-6.1-sol'); assert.equal(store.settings().effort, 'xhigh'); assert.equal(store.settings().apiKey, 'synthetic-only');
    await page.locator('.profile-choice').filter({ hasText: '合成 DeepSeek 改名' }).click();
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '删除配置', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '模型配置已删除' }).waitFor();
  });
  await check('blank model settings example contains no credentials or personal gateway', async () => {
    const before = store.settings(), profilesBefore = store.list('profiles');
    // Only this isolated browser receives an empty form. Do not save a demonstration over real settings.
    const { apiKey: _key, ...publicDefaults } = defaultSettings;
    await page.route('**/api/settings', route => {
      assert.equal(route.request().method(), 'GET', 'A screenshot must never save the empty form');
      return route.fulfill({ json: { ...publicDefaults, baseUrl: '', model: '', headers: {}, hasApiKey: false } });
    });
    await page.route('**/api/profiles', route => {
      assert.equal(route.request().method(), 'GET', 'An empty model screenshot must never mutate profiles');
      return route.fulfill({ json: { activeId: '', profiles: [] } });
    });
    await page.reload(); await page.getByRole('button', { name: /模型与设置/ }).click();
    await page.getByRole('heading', { name: '模型连接', exact: true }).waitFor();
    for (const name of ['API 基础地址', '模型 ID', 'API Key']) assert.equal(await page.getByLabel(name, { exact: true }).inputValue(), '');
    assert.equal(await page.getByLabel('API 基础地址', { exact: true }).getAttribute('placeholder'), 'https://api.example.com/v1');
    await page.getByLabel('请求协议', { exact: true }).selectOption('chat');
    await page.getByLabel('请求协议', { exact: true }).selectOption('responses');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('.model-advanced>summary').click();
    await page.getByLabel('请求超时（秒）', { exact: true }).fill('300');
    let save = await page.getByRole('button', { name: '保存模型设置', exact: true }).boundingBox();
    assert.ok(save && save.y + save.height <= 800);
    await capture('models-laptop');
    await page.locator('.model-advanced>summary').click();
    await page.getByRole('tab', { name: '关于', exact: true }).click();
    assert.equal(await page.getByLabel('API Key', { exact: true }).isVisible(), false);
    await page.getByRole('tab', { name: '模型连接', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await capture('model-settings-empty');
    const connection = page.locator('.settings-panel').first(); await connection.screenshot({ path: 'local_tools/ui/model-settings-form-empty.png' });
    assert.deepEqual(store.settings(), before); assert.deepEqual(store.list('profiles'), profilesBefore);
    assert.doesNotMatch(await connection.innerText(), /synthetic-only|x-interview-client|synthetic-test/);
    await page.unroute('**/api/settings');
    await page.unroute('**/api/profiles');
  });
  await check('domain, knowledge and model pages remain usable without horizontal overflow on mobile', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
    for (const name of ['专项练习', '备面知识库', '模型与设置']) {
      await page.getByRole('button', { name: new RegExp(name) }).first().click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} should fit mobile`);
      await page.screenshot({ path: `local_tools/ui/mobile-${name}.png`, fullPage: false });
    }
  });
  assert.deepEqual(errors, []);
  writeFileSync('local_tools/ui/results.json', JSON.stringify({ checks, browserErrors: errors }, null, 2));
  console.log(`UI smoke passed: ${checks.length} workflows`);
} catch (error) {
  console.log('UI FAILURE', await page.locator('body').innerText());
  await page.screenshot({ path: 'local_tools/ui/failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close(); await service.close(); await new Promise<void>(resolve => app.server.close(() => resolve())); store.close(); rmSync(directory, { recursive: true, force: true });
}
