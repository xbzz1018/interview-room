import { spawn } from 'node:child_process';
import { mkdir, writeFile, cp } from 'node:fs/promises';
import { textPdf } from '../tests-ts/fixtures/text-pdf.ts';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';

const root = process.cwd();
const responsesMode = process.argv.includes('--responses');
const workflowsMode = process.argv.includes('--workflows');
const testModel = responsesMode ? 'gpt-6.1-sol' : 'test-model';
const qaDir = join(root, 'local_tools', `ui-qa-${Date.now()}`);
await mkdir(qaDir, { recursive: true });
const localModelCache = join(root, 'local_tools', 'personal-data', 'models');
if (existsSync(localModelCache)) await cp(localModelCache, join(qaDir, 'models'), { recursive: true });
const gatewayRequests = [];
const gateway = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body || '{}');
  gatewayRequests.push({ path: request.url, model: payload.model, ...(responsesMode ? { effort: payload.reasoning?.effort, stream: payload.stream, store: payload.store, actorHeader: request.headers['x-openai-actor-authorization'] } : {}) });
  if (responsesMode) {
    let text = JSON.stringify({ questions: [
      { id: 1, question: 'Explain a closure.', difficulty: 3, focus_area: 'scope' },
      { id: 2, question: 'Explain the event loop.', difficulty: 3, focus_area: 'async' },
    ] });
    if (workflowsMode && payload.instructions?.includes('岗位推断引擎')) text = 'Java 后端开发';
    else if (workflowsMode && payload.instructions?.includes('你是面试分析引擎')) text = JSON.stringify({ session_summary: '合成资料验收', weak_points: [], strong_points: [], behavior_signals: [], topic_mastery: {} });
    else if (workflowsMode && payload.instructions?.includes('你是个人面试训练教练')) text = JSON.stringify({ comparison: '重答增加了验证顺序，但还需要补充证据。', technical_gaps: [{ point: '缺少并发验证', evidence: '尚未压测', exercise: '写一个并发重复请求用例' }], expression_gaps: [] });
    else if (workflowsMode && payload.instructions?.includes('正在帮候选人复盘')) text = '# 面试复盘\n这是一轮使用合成资料进行的界面验收。请结合原理、取舍和验证说明项目。';
    else if (workflowsMode && payload.instructions?.includes('你是技术面试教练')) text = '## 考察意图\n确认本人职责与技术判断。\n## 回答框架\n先说事实，再说验证。\n## 口述示例\n这是界面验收的合成示例，个人职责待补充。\n## 后续追问\n你如何验证并发写入？';
    else if (workflowsMode && !payload.instructions?.includes('专项训练出题引擎')) {
      text = (payload.input || []).some(item => item.content?.includes('面试开始'))
        ? '你好，欢迎参加 Java 后端开发面试。请先做一个简短的自我介绍。'
        : '谢谢你的介绍。请说明如何用事务和唯一约束防止重复写入。<!--EVAL:{"score":7,"should_advance":false,"brief":"验收回复"}-->';
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const event of [
      { type: 'response.output_text.delta', delta: text },
      { type: 'response.completed', response: { id: 'resp_local_qa', status: 'completed', output: [], usage: { input_tokens: 20, output_tokens: 30, input_tokens_details: { cached_tokens: 0 } } } },
    ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
    response.end('data: [DONE]\n\n');
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    id: 'local-qa', object: 'chat.completion', created: 0, model: payload.model,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ questions: [
      { id: 1, question: 'Explain a closure.', difficulty: 3, focus_area: 'scope' },
      { id: 2, question: 'Explain the event loop.', difficulty: 3, focus_area: 'async' },
    ] }) } }], usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
  }));
});
await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
const gatewayBase = `http://127.0.0.1:${gateway.address().port}/v1`;
const interviewBuild = join(root, 'dist', 'desktop-interview-room-themes', 'win-unpacked', 'TechSpar Personal.exe');
const executable = resolve(process.env.TECHSPAR_SMOKE_DESKTOP || (existsSync(interviewBuild) ? interviewBuild : join(root, 'dist', 'desktop-personal', 'win-unpacked', 'TechSpar Personal.exe')));
const env = { ...process.env, TECHSPAR_DESKTOP_USER_DATA_DIR: qaDir, ALLOW_REGISTRATION: 'false' };
for (const key of Object.keys(env)) {
  if (['TECHSPAR_EXTENSIONS', 'TECHSPAR_RENDERER_URL', 'ELECTRON_RUN_AS_NODE', 'DEFAULT_EMAIL', 'DEFAULT_PASSWORD', 'JWT_SECRET', 'VOICEPRINT_ENCRYPTION_KEY'].includes(key) || key.startsWith('PLATFORM_') || key.startsWith('COPILOT_')) delete env[key];
}
const child = spawn(executable, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'], {
  cwd: resolve(executable, '..'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', data => { stderr += data.toString(); });
child.stdout.on('data', () => {});
let socket;
let nextId = 0;
const pending = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30_000);
    pending.set(id, { resolve(value) { clearTimeout(timeout); resolve(value); }, reject(error) { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
try {
  let targets;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Desktop exited ${child.exitCode}: ${stderr.slice(-4000)}`);
    const port = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1];
    if (port) {
      try {
        targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        if (targets.some(target => target.type === 'page' && /^http:\/\/127\.0\.0\.1:/.test(target.url))) break;
      } catch {}
    }
    await sleep(250);
  }
  const target = targets?.find(target => target.type === 'page' && /^http:\/\/127\.0\.0\.1:/.test(target.url));
  if (!target) throw new Error(`Local renderer not ready: ${stderr.slice(-4000)}`);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result); }
  };
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  let view;
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await cdp('Runtime.evaluate', { expression: 'JSON.stringify({url:location.href,title:document.title,text:document.body?.innerText ?? ""})', returnByValue: true });
    view = JSON.parse(response.result.value);
    if (view.text.includes('先配置你的模型服务') && view.text.includes('API Base URL')) break;
    await sleep(250);
  }
  if (!view.text.includes('先配置你的模型服务')) throw new Error(`Automatic desktop login did not reach setup: ${view.text.slice(0, 500)}`);
  console.log(JSON.stringify({ stage: 'renderer-ready', url: view.url, title: view.title }));
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(qaDir, 'onboarding.png'), Buffer.from(screenshot.data, 'base64'));
  await cdp('Runtime.evaluate', { expression: `(() => {
    const values = ${JSON.stringify([gatewayBase, testModel, 'synthetic-local-qa-key'])};
    const inputs = [...document.querySelectorAll('input')];
    if (inputs.length !== 3) throw new Error('Expected three LLM configuration inputs');
    inputs.forEach((input, index) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, values[index]);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  })()` });
  if (responsesMode) {
    await cdp('Runtime.evaluate', { expression: `(() => {
      const select = document.querySelector('select:not(#llm-reasoning-effort)');
      select.value = 'responses'; select.dispatchEvent(new Event('change', { bubbles: true }));
    })()` });
    await sleep(100);
    await cdp('Runtime.evaluate', { expression: `(() => {
      const effort = document.querySelector('#llm-reasoning-effort');
      effort.value = 'xhigh'; effort.dispatchEvent(new Event('change', { bubbles: true }));
      const headers = document.querySelector('#llm-http-headers');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(headers, '{"x-openai-actor-authorization":"local-image-extension"}');
      headers.dispatchEvent(new Event('input', { bubbles: true }));
    })()` });
  }
  await sleep(100);
  await cdp('Runtime.evaluate', { expression: "[...document.querySelectorAll('button')].find(button => button.innerText.trim() === '下一步').click()" });
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await cdp('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
    if (response.result.value.includes('使用本地向量，开始使用')) break;
    if (attempt === 59) throw new Error(`Local gateway probe failed: ${response.result.value}`);
    await sleep(100);
  }
  const embeddingScreenshot = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(qaDir, 'embedding.png'), Buffer.from(embeddingScreenshot.data, 'base64'));
  await cdp('Runtime.evaluate', { expression: "[...document.querySelectorAll('button')].find(button => button.innerText.trim() === '使用本地向量，开始使用').click()" });
  let settings;
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await cdp('Runtime.evaluate', { expression: `fetch('/api/settings', {headers:{Authorization:'Bearer '+JSON.parse(localStorage.getItem('techspar-session')).token}}).then(r=>r.json()).then(s=>JSON.stringify({configured:s.configured,backend:s.embedding.backend,model:s.llm.model,source:s.source,text:document.body.innerText}))`, awaitPromise: true, returnByValue: true });
    settings = JSON.parse(response.result.value);
    if (settings.configured.llm && settings.backend === 'local' && !settings.text.includes('先配置你的模型服务')) break;
    if (attempt === 59) throw new Error('Saved local settings did not enter the application');
    await sleep(100);
  }
  const result = { localOrigin: target.url, title: view.title, text: view.text.slice(0, 2500), screenshot: join(qaDir, 'onboarding.png'), embeddingScreenshot: join(qaDir, 'embedding.png'), checks: { automaticLogin: true, configured: settings.configured, embeddingBackend: settings.backend, model: settings.model, source: settings.source, gatewayRequests }, stderr: stderr.slice(-1500) };
  await writeFile(join(qaDir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await writeFile(join(root, 'local_tools', 'desktop-validation.json'), JSON.stringify(result, null, 2));
  if (gatewayRequests.length !== 1 || gatewayRequests[0].path !== (responsesMode ? '/v1/responses' : '/v1/chat/completions')) throw new Error('Unexpected gateway traffic.');
  if (responsesMode && (gatewayRequests[0].model !== 'gpt-6.1-sol' || gatewayRequests[0].effort !== 'xhigh' || gatewayRequests[0].store !== false || gatewayRequests[0].actorHeader !== 'local-image-extension')) throw new Error('Responses configuration did not reach the gateway.');
  if (workflowsMode) {
    async function evaluate(expression) {
      const value = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
      return value.result.value;
    }
    async function until(expression) {
      for (let attempt = 0; attempt < 150; attempt++) {
        try { if (await evaluate(`Boolean(${expression})`)) return; }
        catch (error) {
          if (!/Execution context was destroyed|Cannot find context/.test(error.message)) throw error;
        }
        await sleep(200);
      }
      throw new Error(`UI wait failed: ${expression}`);
    }
    async function chooseTheme(theme) {
      await evaluate(`document.querySelector('.personal-topbar button[aria-label="切换界面配色"]').click()`);
      await until(`document.querySelector('input[type="radio"][value="${theme}"]')`);
      await evaluate(`document.querySelector('input[type="radio"][value="${theme}"]').click()`);
      await until(`document.documentElement.dataset.appearance === '${theme}'`);
      await evaluate(`(async()=>{if(await window.techsparDesktop.getAppearanceTheme()!=='${theme}')throw new Error('Desktop did not persist theme');})()`);
      await cdp('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await cdp('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await until(`!document.querySelector('[data-radix-popper-content-wrapper]')`);
      await sleep(400);
    }
    await until(`location.pathname === '/mock-interview' && document.body?.innerText.includes('开始一轮面试')`);
    if (await evaluate('document.title') !== '面试练习室') throw new Error('Personal product title was not packaged');
    await evaluate(`location.href='/'`);
    await until(`location.pathname === '/mock-interview' && location.search === '?mode=live' && document.querySelector('nav[aria-label="主要导航"] button[aria-label="更多工具"]')`);
    await evaluate(`document.querySelector('nav[aria-label="主要导航"] button[aria-label="更多工具"]').click()`);
    await until(`document.getElementById('desktop-more-tools') && !document.getElementById('desktop-more-tools').hidden`);
    await evaluate(`document.querySelector('nav[aria-label="主要导航"] a[href="/knowledge"]').click()`);
    await until(`location.pathname === '/knowledge' && document.body?.innerText.includes('核心知识库')`);
    if (await evaluate(`document.querySelector('nav[aria-label="主要导航"] a[href="/knowledge"]').getAttribute('aria-current')`) !== 'page') throw new Error('Secondary navigation lost its active page');
    await evaluate(`document.querySelector('nav[aria-label="主要导航"] a[href="/history"]').click()`);
    await until(`location.pathname === '/history' && document.body?.innerText.includes('开始第一轮面试')`);
    await evaluate(`document.querySelector('button[aria-label="收起侧栏"]').click()`);
    await until(`localStorage.getItem('sidebar-collapsed') === 'true' && document.querySelector('nav[aria-label="主要导航"] a[aria-label="开始面试"]')`);
    await evaluate(`document.querySelector('button[aria-label="展开侧栏"]').click()`);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.querySelector('button[aria-label="打开导航"]').click()`);
    await until(`document.querySelector('[role="dialog"] nav[aria-label="移动导航"]')`);
    await writeFile(join(qaDir,'mobile-navigation.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate(`document.querySelector('[role="dialog"] a[href="/personal-agent"]').click()`);
    await until(`location.pathname === '/personal-agent' && !document.querySelector('[role="dialog"]') && document.body?.innerText.includes('资料与学习')`);
    await evaluate(`document.querySelector('button[aria-label="打开导航"]').click()`);
    await until(`document.querySelector('[role="dialog"]')`);
    await cdp('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await cdp('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await until(`!document.querySelector('[role="dialog"]')`);
    await cdp('Emulation.clearDeviceMetricsOverride');
    // Use the cached Chinese model in the isolated QA account. Onboarding's
    // default bge-m3 is deliberately preserved for new real accounts.
    await evaluate(`(async () => {
      const token=JSON.parse(localStorage.getItem('techspar-session')).token;
      const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
      const settings=await (await fetch('/api/settings',{headers})).json();
      settings.embedding={...settings.embedding,backend:'local',local_model:'Xenova/bge-small-zh-v1.5',local_path:''};
      const response=await fetch('/api/settings',{method:'PUT',headers,body:JSON.stringify(settings)});
      if(!response.ok)throw new Error('Isolated embedding configuration failed '+response.status);
    })()`);
    const base64 = Buffer.from(textPdf()).toString('base64');
    await evaluate(`(async () => {
      const token = JSON.parse(localStorage.getItem('techspar-session')).token;
      const form = new FormData(); form.append('file', new File([Uint8Array.from(atob(${JSON.stringify(base64)}), c=>c.charCodeAt(0))], 'ui-synthetic.pdf', {type:'application/pdf'}));
      const response = await fetch('/api/resume/upload', {method:'POST',headers:{Authorization:'Bearer '+token},body:form});
      if(!response.ok) throw new Error('UI resume upload failed '+response.status);
      location.href='/mock-interview?mode=live';
    })()`);
    await until(`[...document.querySelectorAll('button')].some(button => button.innerText.includes('开始实时模拟') && !button.disabled)`);
    await cdp('Emulation.setDeviceMetricsOverride', { width:1440, height:1024, deviceScaleFactor:1, mobile:false });
    for (const theme of ['navy', 'teal', 'wine']) {
      await chooseTheme(theme);
      const colors = await evaluate(`JSON.stringify({background:getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),primary:getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),width:document.documentElement.scrollWidth,viewport:innerWidth})`);
      const actual = JSON.parse(colors);
      if(actual.background!==({navy:'#f3f5f8',teal:'#131a20',wine:'#f7f4ed'})[theme] || actual.width>actual.viewport) throw new Error('Theme colors or layout incorrect: '+theme+' '+colors);
      await writeFile(join(qaDir,`theme-${theme}-setup.png`),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
    }
    await chooseTheme('teal');
    await evaluate('location.reload()');
    await until(`document.documentElement?.dataset.appearance==='teal' && [...document.querySelectorAll('button')].some(button=>button.innerText.includes('开始实时模拟')&&!button.disabled)`);
    await writeFile(join(qaDir, 'resume-setup.png'), Buffer.from((await cdp('Page.captureScreenshot', {format:'png'})).data, 'base64'));
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.innerText.includes('开始实时模拟')).click()`);
    await until(`location.pathname.startsWith('/interview/') && document.body?.innerText.includes('请先做一个简短的自我介绍') && document.querySelector('textarea')`);
    if (await evaluate(`document.querySelector('nav[aria-label="主要导航"] a[href="/mock-interview"]').getAttribute('aria-current')`) !== 'page') throw new Error('Interview lost its navigation context');
    const sessionPath = await evaluate('location.pathname');
    await evaluate(`(() => {
      const input=document.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'这是桌面验收用的虚构经历，我用 Java 和 Spring 开发了数据库接口。');
      input.dispatchEvent(new Event('input',{bubbles:true})); input.focus();
    })()`);
    await sleep(100);
    await chooseTheme('wine');
    if(await evaluate(`document.querySelector('textarea').value`) !== '这是桌面验收用的虚构经历，我用 Java 和 Spring 开发了数据库接口。') throw new Error('Theme switching cleared the answer draft');
    await evaluate(`document.querySelector('textarea').focus()`);
    await cdp('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await cdp('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await until(`document.body?.innerText.includes('请说明如何用事务')`);
    await writeFile(join(qaDir, 'resume-chat.png'), Buffer.from((await cdp('Page.captureScreenshot', {format:'png'})).data, 'base64'));
    await evaluate('location.reload()');
    await until(`document.body?.innerText.includes('请说明如何用事务') && document.querySelector('textarea')`);
    await writeFile(join(qaDir, 'resume-restored.png'), Buffer.from((await cdp('Page.captureScreenshot', {format:'png'})).data, 'base64'));
    await evaluate(`location.href='/history'`);
    await until(`document.querySelector('[title="'+${JSON.stringify(sessionPath.split('/').pop())}+'"]')`);
    await writeFile(join(qaDir, 'history.png'), Buffer.from((await cdp('Page.captureScreenshot', {format:'png'})).data, 'base64'));
    await evaluate(`document.querySelector('[title="'+${JSON.stringify(sessionPath.split('/').pop())}+'"]')?.closest('[role="button"]').click()`);
    await until(`document.body?.innerText.includes('请说明如何用事务')`);
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.innerText.trim() === '结束面试').click()`);
    await until(`location.pathname.startsWith('/review/') && document.body?.innerText.includes('逐题参考答法')`);
    if (await evaluate(`document.documentElement.dataset.appearance`) !== 'wine') throw new Error('Review lost appearance selection');
    if (await evaluate(`document.querySelector('nav[aria-label="主要导航"] a[href="/history"]').getAttribute('aria-current')`) !== 'page') throw new Error('Review lost its navigation context');
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.innerText.trim() === '生成参考答法').click()`);
    await until(`document.body?.innerText.includes('个人职责待补充')`);
    await writeFile(join(qaDir, 'resume-reference.png'), Buffer.from((await cdp('Page.captureScreenshot', {format:'png'})).data, 'base64'));
    const requestsBeforeReviewReload = gatewayRequests.length;
    await evaluate('location.reload()');
    await until(`document.body?.innerText.includes('个人职责待补充')`);
    if (gatewayRequests.length !== requestsBeforeReviewReload) throw new Error('Reload generated a cached reference answer again.');
    await evaluate(`(() => { const input=document.querySelector('textarea[aria-label="再次作答"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'事务与唯一约束保证写入一致，尚未压测'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await sleep(100);
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.innerText.trim()==='保存并对比').click()`);
    await until(`document.body?.innerText.includes('重答增加了验证顺序') && document.body?.innerText.includes('缺少并发验证')`);
    await evaluate(`document.querySelector('[aria-label="再次作答与对比"]').scrollIntoView({block:'center'})`);
    await writeFile(join(qaDir,'retry-comparison.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
    const beforeRetryReload = gatewayRequests.length;
    await evaluate('location.reload()');
    await until(`document.body?.innerText.includes('重答增加了验证顺序')`);
    if(gatewayRequests.length!==beforeRetryReload) throw new Error('Reload regenerated a saved comparison');
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.innerText.trim()==='选择资料再练一轮').click()`);
    await until(`document.body?.innerText.includes('技术与表达练习记录') && document.body?.innerText.includes('自我介绍')`);
    await evaluate(`location.href='/personal-agent'`);
    await until(`document.body?.innerText.includes('我的资料库')`);
    if (await evaluate(`document.documentElement.dataset.appearance`) !== 'wine') throw new Error('Materials lost appearance selection');
    await evaluate(`(async()=>{const token=JSON.parse(localStorage.getItem('techspar-session')).token;const form=new FormData();form.append('file',new File(['旧版项目证据'],'project.md'));const response=await fetch('/api/personal-agent/documents',{method:'POST',headers:{Authorization:'Bearer '+token},body:form});if(!response.ok)throw new Error(await response.text());location.reload();})()`);
    await until(`document.body?.innerText.includes('project.md')`);
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.innerText.trim()==='预览 / 编辑 / 替换').click()`);
    await until(`document.querySelector('textarea[aria-label="资料内容"]')`);
    await evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="资料内容"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'新版项目证据：唯一约束与事务');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await sleep(100);
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.innerText.trim()==='保存资料').click()`);
    await until(`!document.querySelector('textarea[aria-label="资料内容"]')`);
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.innerText.trim()==='预览 / 编辑 / 替换').click()`);
    await until(`document.querySelector('textarea[aria-label="资料内容"]')?.value.includes('新版项目证据')`);
    await writeFile(join(qaDir,'document-editor.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.innerText.trim()==='关闭').click()`);
    await evaluate(`location.href='/mock-interview?mode=live'`);
    await until(`document.body?.innerText.includes('project.md') && document.querySelector('select[aria-label="训练模式"]')`);
    await evaluate(`(()=>{const select=document.querySelector('select[aria-label="训练模式"]');select.value='coach';select.dispatchEvent(new Event('change',{bubbles:true}));const label=[...document.querySelectorAll('label')].find(item=>item.innerText.trim()==='project.md');label.querySelector('input').click();})()`);
    await sleep(100);
    await writeFile(join(qaDir,'training-setup.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.innerText.includes('开始实时模拟')).click()`);
    await until(`location.pathname.startsWith('/interview/') && document.body?.innerText.includes('教练练习')`);
    await evaluate(`(async()=>{const token=JSON.parse(localStorage.getItem('techspar-session')).token;const id=location.pathname.split('/').pop();const session=await (await fetch('/api/interview/session/'+id+'/resume',{headers:{Authorization:'Bearer '+token}})).json();if(session.meta.training_mode!=='coach'||session.meta.selected_materials?.[0]?.filename!=='project.md')throw new Error('Materials or coaching mode not frozen');})()`);
    for (const [route, text] of [['/knowledge','核心知识库'],['/personal-agent','更新自己的资料'],['/settings','配置 LLM 服务和训练参数']]) {
      await evaluate(`location.href=${JSON.stringify(route)}`);
      await until(`location.pathname === ${JSON.stringify(route)} && document.body?.innerText.includes(${JSON.stringify(text)})`);
      const errors = await evaluate(`document.body.innerText.includes('Something went wrong') || document.body.innerText.includes('出了点问题')`);
      if(errors) throw new Error(`Renderer error on ${route}`);
      await writeFile(join(qaDir, `${route.slice(1)}.png`), Buffer.from((await cdp('Page.captureScreenshot', {format:'png'})).data, 'base64'));
    }
    if (await evaluate(`/套餐|赞助|充值|平台额度|基于 TechSpar/.test(document.body.innerText)`)) throw new Error('Commercial or promotional UI remains in settings');
    if (await evaluate(`Boolean(document.querySelector('aside a[href*="AnnaSuSu"]'))`)) throw new Error('Promotional link remains in sidebar');
    for (const theme of ['navy', 'teal', 'wine']) {
      await evaluate(`document.querySelector('[data-tab-id="appearance"] input[value="${theme}"]').click()`);
      await until(`document.documentElement.dataset.appearance==='${theme}' && [...document.querySelectorAll('button[aria-label="切换界面配色"]')].every(button=>button.title.includes(${JSON.stringify({navy:'雾白',teal:'深灰',wine:'米白'})}[${JSON.stringify(theme)}]))`);
      await evaluate(`(async()=>{if(await window.techsparDesktop.getAppearanceTheme()!=='${theme}')throw new Error('Settings did not persist theme');})()`);
      await evaluate(`document.querySelector('main').scrollTop=0`);
      await sleep(400);
      await writeFile(join(qaDir,`theme-${theme}-settings.png`),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
    }
    await evaluate(`window.techsparDesktop.setAppearanceTheme('invalid').then(()=>{throw new Error('Invalid theme was accepted')},()=>{})`);
    await evaluate(`[...document.querySelectorAll('details summary')].find(summary=>summary.innerText.trim()==='开源来源与许可').click()`);
    await until(`[...document.querySelectorAll('details')].some(details=>details.open && details.innerText.includes('GNU AGPL v3') && details.innerText.includes('TechSpar'))`);
    await evaluate(`[...document.querySelectorAll('[data-tab-id="llm"] button')].find(button=>button.innerText.trim()==='测试连接').click()`);
    await until(`document.querySelector('[data-tab-id="llm"]').innerText.includes('连接正常')`);
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.innerText.trim()==='保存').click()`);
    await until(`[...document.querySelectorAll('button')].some(button=>button.innerText.trim()==='已保存')`);
    await evaluate(`(async()=>{
      const token=JSON.parse(localStorage.getItem('techspar-session')).token;
      const saved=await(await fetch('/api/settings',{headers:{Authorization:'Bearer '+token}})).json();
      if(saved.source!=='user'||saved.llm.model!==${JSON.stringify(testModel)}||saved.llm.compatibility!=='responses'||saved.llm.reasoning_effort!=='xhigh'||saved.llm.http_headers?.['x-openai-actor-authorization']!=='local-image-extension') throw new Error('Personal API settings changed while saving');
    })()`);
    await writeFile(join(qaDir,'personal-settings.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate(`localStorage.removeItem('techspar-session');location.href='/'`);
    await until(`location.pathname === '/' && document.body?.innerText.includes('进入练习室')`);
    if (await evaluate(`/TechSpar|个人改造|套餐|赞助/.test(document.body.innerText)`)) throw new Error('Promotional UI remains on welcome page');
    await writeFile(join(qaDir,'personal-welcome.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate(`document.querySelector('a[href="/login"]').click()`);
    await until(`location.pathname === '/mock-interview' && document.body?.innerText.includes('开始一轮面试')`);
    const final = { ...result, workflowChecks: {personalHome:true,personalWelcome:true,contextualNavigation:true,secondaryNavigation:true,collapsedNavigation:true,mobileNavigation:true,pdfResumePage:true,startButton:true,streamingChat:true,reloadTranscript:true,history:true,resumeReview:true,resumeReferenceAnswer:true,cachedReferenceAfterReload:true,knowledgePage:true,personalAgentPage:true,settingsPage:true,documentEditing:true,selectedMaterials:true,coachingMode:true,retryComparison:true,cachedComparisonAfterReload:true,practiceProgress:true,restartMaterialSelection:true,personalApiTestAndSave:true,commercialUiRemoved:true,sourceNoticePreserved:true,threeThemes:true,themePersistence:true,themeDraftPreserved:true,themeAcrossRoutes:true,settingsThemePicker:true,themeIpcValidation:true}, gatewayRequests, qaDir };
    await writeFile(join(qaDir,'result.json'),JSON.stringify(final,null,2));
    await writeFile(join(root,'local_tools','desktop-validation.json'),JSON.stringify(final,null,2));
    console.log(JSON.stringify({stage:'workflow-ui-passed',checks:final.workflowChecks,qaDir}));
  }
} catch (error) {
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      await writeFile(join(qaDir, 'failure.png'), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      const view = await cdp('Runtime.evaluate', { expression: 'JSON.stringify({url:location.href,text:document.body.innerText})', returnByValue: true });
      await writeFile(join(qaDir, 'failure.json'), JSON.stringify({ error: error.message, view: JSON.parse(view.result.value), gatewayRequests }, null, 2));
    } catch {}
  }
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await cdp('Browser.close'); } catch {}
    socket.close();
  }
  for (let attempt = 0; attempt < 15 && child.exitCode === null; attempt++) await sleep(200);
  if (child.exitCode === null) child.kill();
  gateway.closeAllConnections();
  await new Promise(resolve => gateway.close(resolve));
}
