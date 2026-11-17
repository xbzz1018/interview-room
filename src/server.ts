import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from './store.ts';
import { KnowledgeLibrary } from './knowledge.ts';
import { ModelProfiles } from './model-profiles.ts';
import { PracticeService } from './service.ts';
import { InputError, object, settingsFrom } from './model.ts';
import type { Job, Material, Session } from './model.ts';
import { commitImport, previewImport } from './migration.ts';
import { extractPdf, extractImage } from './extract.ts';
import { acquireInstance } from './instance.ts';
import { generate } from './gateway.ts';
import { extractDocx } from './docx.ts';

export function createApplication(store: Store, service = new PracticeService(store), options: { port?: number; allowDev?: boolean; staticRoot?: string; workspaceId?: string } = {}) {
  const library = new KnowledgeLibrary(store); library.initialize();
  const profiles = new ModelProfiles(store); profiles.initialize();
  const token = randomBytes(32).toString('hex');
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    const json = (body: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    try {
      const address = server.address(); const port = address && typeof address === 'object' ? address.port : options.port ?? 4318;
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!req.headers.host || !allowedHosts.includes(req.headers.host)) throw new InputError('非法访问主机', 403);
      const origins = allowedHosts.map(host => `http://${host}`);
      if (options.allowDev) origins.push('http://127.0.0.1:5178', 'http://localhost:5178');
      if (req.headers.origin && !origins.includes(req.headers.origin)) throw new InputError('不允许跨站访问', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new InputError('不允许跨站访问', 403);
      const path = new URL(req.url ?? '/', `http://${req.headers.host}`).pathname;
      const method = req.method ?? 'GET';
      if (path === '/api/bootstrap' && method === 'GET') { json({ token, version: '0.1.0', app: 'interview-room-v2', workspaceId: options.workspaceId }); return; }
      if (!path.startsWith('/api/')) {
        if (method !== 'GET') throw new InputError('接口不存在', 404);
        const root = resolve(options.staticRoot ?? 'dist'), target = resolve(root, `.${decodeURIComponent(path)}`);
        if (target !== root && !target.startsWith(root + sep)) throw new InputError('路径无效', 400);
        const file = (await stat(target).catch(() => undefined))?.isFile() ? target : resolve(root, 'index.html');
        const bytes = await readFile(file).catch(() => { throw new InputError('界面尚未构建。请运行 npm run build，或使用 npm run dev', 503); });
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'");
        res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' } as Record<string, string>)[extname(file)] ?? 'application/octet-stream' }); res.end(bytes); return;
      }
      const provided = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const providedBytes = Buffer.from(provided), tokenBytes = Buffer.from(token);
      if (providedBytes.length !== tokenBytes.length || !timingSafeEqual(providedBytes, tokenBytes)) throw new InputError('请刷新页面重新连接本机服务', 401);
      const body = async (): Promise<Record<string, unknown>> => {
        if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new InputError('需要 JSON 请求', 415);
        let total = 0; const chunks: Buffer[] = [];
        for await (const chunk of req) { total += chunk.length; if (total > 12000000) throw new InputError('请求超过 12 MB', 413); chunks.push(chunk); }
        try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (error) { if (error instanceof InputError) throw error; throw new InputError('JSON 格式错误'); }
      };
      if (path === '/api/settings' && method === 'GET') {
        const { apiKey, ...settings } = store.settings(); json({ ...settings, hasApiKey: Boolean(apiKey) }); return;
      }
      if (path === '/api/settings' && method === 'PUT') {
        const value = settingsFrom(await body(), store.settings()); store.setSettings(value);
        const { apiKey, ...settings } = value; json({ ...settings, hasApiKey: Boolean(apiKey) }); return;
      }
      if (path === '/api/theme' && method === 'PUT') {
        const input = await body();
        if (!['ink', 'forest'].includes(String(input.theme))) throw new InputError('不支持的主题');
        store.setTheme(input.theme as import('./model.ts').Settings['theme']); json({ ok: true }); return;
      }
      if (path === '/api/profiles' && method === 'GET') { json(profiles.list()); return; }
      if (path === '/api/profiles' && method === 'POST') { json(profiles.save(await body()), 201); return; }
      const profileMatch = path.match(/^\/api\/profiles\/([\w-]+)(?:\/(activate|test))?$/);
      if (profileMatch) {
        const [, id, action] = profileMatch;
        if (!action && method === 'PUT') { json(profiles.save(await body(), id)); return; }
        if (!action && method === 'DELETE') { profiles.remove(id); json({ ok: true }); return; }
        if (action === 'activate' && method === 'POST') { await body(); profiles.activate(id); json(profiles.list()); return; }
      }
      if ((path === '/api/model-test' || profileMatch?.[2] === 'test') && method === 'POST') {
        await body();
        const settings = profileMatch ? { ...store.require<import('./model.ts').ModelProfile>('profiles', profileMatch[1]).connection, theme: store.settings().theme } : store.settings(), controller = new AbortController(), started = performance.now();
        res.on('close', () => controller.abort());
        try {
          await generate(settings, [{ role: 'user', content: '这是模型连接测试。仅回复“连接成功”，不包含其他内容。' }], controller.signal, () => undefined);
          json({ ok: true, elapsedMs: Math.round(performance.now() - started), model: settings.model, effort: settings.effort });
        } catch (error) {
          let message = error instanceof Error ? error.message : '模型测试未完成';
          if (settings.apiKey) message = message.replaceAll(settings.apiKey, '[已隐藏]');
          if (/timeout|timed out/i.test(message)) message = '模型测试超时，请检查网关连接和推理强度';
          throw new InputError(message.slice(0, 600), 502);
        }
        return;
      }
      if (path === '/api/topics' && method === 'GET') { json(library.list()); return; }
      if (path === '/api/topics' && method === 'POST') { json(library.topic(await body()), 201); return; }
      const topicMatch = path.match(/^\/api\/topics\/([\w-]+)(?:\/(jobs))?$/);
      if (topicMatch) {
        const [, id, action] = topicMatch;
        if (!action && method === 'PUT') { json(library.topic(await body(), id)); return; }
        if (!action && method === 'DELETE') { library.remove(id); json({ ok: true }); return; }
        if (action === 'jobs' && method === 'GET') { store.require('topics', id); json(store.list<Job>('jobs').filter(job => job.sessionId === `knowledge:${id}`).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); return; }
        if (action === 'jobs' && method === 'POST') { json(service.knowledgeJob(id, await body()), 202); return; }
      }
      if (path === '/api/materials' && method === 'GET') { json(store.list<Material>('materials')); return; }
      if (path === '/api/materials' && method === 'POST') { json(service.material(await body()), 201); return; }
      if (path === '/api/extract' && method === 'POST') {
        const input = await body();
        if (input.type === 'pdf') { json({ text: await extractPdf(input.base64), mode: 'local' }); return; }
        if (input.type === 'docx') { json({ text: extractDocx(input.base64), mode: 'local' }); return; }
        if (input.type === 'image' && input.confirmed === true) {
          const controller = new AbortController(); res.on('close', () => controller.abort());
          json({ text: await extractImage(store.settings(), input.base64, input.mime, controller.signal), mode: 'model' }); return;
        }
        throw new InputError('图片识别需要确认将图片发送给所配置的模型接口');
      }
      const materialMatch = path.match(/^\/api\/materials\/([\w-]+)$/);
      if (materialMatch && method === 'PUT') { json(service.material(await body(), materialMatch[1])); return; }
      if (materialMatch && method === 'DELETE') { store.require('materials', materialMatch[1]); store.delete('materials', materialMatch[1]); json({ ok: true }); return; }
      if (path === '/api/sessions' && method === 'GET') { json(store.list<Session>('sessions')); return; }
      if (path === '/api/sessions' && method === 'POST') { json(service.create(await body()), 201); return; }
      const sessionMatch = path.match(/^\/api\/sessions\/([\w-]+)(?:\/(answer|complete|jobs))?$/);
      if (sessionMatch) {
        const [, id, action] = sessionMatch;
        if (!action && method === 'GET') { json(store.require<Session>('sessions', id)); return; }
        if (!action && method === 'DELETE') {
          if (store.running(id)) throw new InputError('请先取消正在运行的任务', 409);
          store.delete('sessions', id);
          for (const job of store.list<Job>('jobs')) if (job.sessionId === id) store.delete('jobs', job.id);
          json({ ok: true }); return;
        }
        if (action === 'answer' && method === 'POST') { json(service.answer(id, await body())); return; }
        if (action === 'complete' && method === 'POST') { json(service.complete(id)); return; }
        if (action === 'jobs' && method === 'POST') { json(service.job(id, await body()), 202); return; }
        if (action === 'jobs' && method === 'GET') { json(store.list<Job>('jobs').filter(job => job.sessionId === id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); return; }
      }
      const cancel = path.match(/^\/api\/jobs\/([\w-]+)\/cancel$/);
      if (cancel && method === 'POST') { json(service.cancel(cancel[1])); return; }
      if (path === '/api/export' && method === 'GET') { res.setHeader('Content-Disposition', 'attachment; filename=interview-room-backup.json'); json(store.export()); return; }
      if (path === '/api/import/preview' && method === 'POST') { json(previewImport((await body()).backup, store)); return; }
      if (path === '/api/import/commit' && method === 'POST') { const input = await body(); json(commitImport(input.backup, input.fingerprint, store)); return; }
      throw new InputError('接口不存在', 404);
    } catch (error) {
      if (!res.headersSent) json({ error: error instanceof InputError ? error.message : '操作未完成，请重试；原数据保留' }, error instanceof InputError ? error.status : 500);
      else res.end();
    }
  });
  return { server, service, store };
}
export function workspaceId(dataRoot: string): string {
  let canonical = resolve(dataRoot);
  try { canonical = realpathSync.native(canonical); } catch { /* A new workspace may not exist yet. */ }
  return createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex');
}
export async function startWorkspace({ port, dataRoot, staticRoot }: { port: number; dataRoot: string; staticRoot?: string }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('本机端口需要是 1024–65535 的整数');
  const release = acquireInstance(dataRoot);
  let store: Store | undefined;
  try {
    store = new Store(resolve(dataRoot, 'interview-room.db'));
    const app = createApplication(store, undefined, { port, staticRoot, workspaceId: workspaceId(dataRoot), allowDev: process.env.INTERVIEW_DEV === '1' });
    await new Promise<void>((resolve, reject) => { app.server.once('error', reject); app.server.listen(port, '127.0.0.1', () => { app.server.removeListener('error', reject); resolve(); }); });
    let closing: Promise<void> | undefined;
    return { ...app, close: () => closing ??= (async () => {
      try { await app.service.close(); }
      finally { await new Promise<void>(resolve => app.server.close(() => resolve())); try { store!.close(); } finally { release(); } }
    })() };
  } catch (error) { store?.close(); release(); throw error; }
}
if (process.argv[1] && existsSync(resolve(process.argv[1])) && import.meta.url === pathToFileURL(realpathSync.native(resolve(process.argv[1]))).href) {
  const workspace = await startWorkspace({ port: Number(process.env.INTERVIEW_PORT ?? 4318), dataRoot: resolve(process.env.INTERVIEW_DATA_DIR ?? 'data') });
  console.log(`面试练习室 v2：http://127.0.0.1:${(workspace.server.address() as { port: number }).port}`);
  const stop = () => { void workspace.close().then(() => process.exit()); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
