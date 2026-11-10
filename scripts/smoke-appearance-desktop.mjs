import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const prior = JSON.parse(await readFile(join(root, 'local_tools/desktop-validation.json'), 'utf8'));
const qaDir = resolve(prior.qaDir || '');
if (!/^ui-qa-\d+$/.test(relative(join(root, 'local_tools'), qaDir)) || !prior.workflowChecks?.threeThemes) throw new Error('Run the isolated personal desktop workflow first.');
const executable = join(root, 'dist/desktop-interview-room/win-unpacked/TechSpar Personal.exe');
const env = { ...process.env, TECHSPAR_DESKTOP_USER_DATA_DIR:qaDir, ALLOW_REGISTRATION:'false' };
for (const key of Object.keys(env)) {
  if (['TECHSPAR_EXTENSIONS', 'TECHSPAR_RENDERER_URL', 'ELECTRON_RUN_AS_NODE', 'DEFAULT_EMAIL', 'DEFAULT_PASSWORD', 'JWT_SECRET', 'VOICEPRINT_ENCRYPTION_KEY'].includes(key) || key.startsWith('PLATFORM_') || key.startsWith('COPILOT_')) delete env[key];
}
const child = spawn(executable, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'], { cwd:dirname(executable), env, windowsHide:true, stdio:['ignore','pipe','pipe'] });
let stderr = '';
child.stderr.on('data', data => { stderr += data; });
child.stdout.on('data', () => {});
let socket;
let serial = 0;
const pending = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function cdp(method, params = {}) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: '+method)); }, 10_000);
    pending.set(id, { resolve:r=>{clearTimeout(timer);resolve(r);}, reject:e=>{clearTimeout(timer);reject(e);} });
    socket.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression) {
  const value = await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
  return value.result.value;
}
async function until(expression) {
  for (let i=0;i<120;i++) {
    try { if(await evaluate(`Boolean(${expression})`)) return; }
    catch(error) { if(!/context|Cannot find/.test(error.message))throw error; }
    await sleep(150);
  }
  throw new Error('UI wait failed: '+expression);
}
async function screenshot(name) { await sleep(450); await writeFile(join(qaDir,name+'.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64')); }
async function assertFitsViewport(label) {
  const layout = await evaluate(`({viewport:innerWidth,root:document.documentElement.scrollWidth,main:document.querySelector('main')?.clientWidth,mainScroll:document.querySelector('main')?.scrollWidth,overflowing:[...document.querySelectorAll('main *')].filter(el=>el.getBoundingClientRect().width>innerWidth).slice(0,6).map(el=>({tag:el.tagName,class:el.className,width:el.getBoundingClientRect().width}))})`);
  if (layout.root > layout.viewport || layout.mainScroll > layout.main + 1) throw new Error(label+' overflows: '+JSON.stringify(layout));
}
const checks = [];
try {
  let target;
  for(let i=0;i<100;i++) {
    if(child.exitCode!==null)throw new Error('Desktop exited: '+stderr.slice(-1200));
    const port = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1];
    if(port) {
      target = (await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(t=>t.type==='page' && /^http:\/\/127\.0\.0\.1:/.test(t.url));
      if(target)break;
    }
    await sleep(150);
  }
  if(!target)throw new Error('No desktop renderer');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{const message=JSON.parse(event.data);const request=pending.get(message.id);if(request){pending.delete(message.id);if(message.error)request.reject(new Error(JSON.stringify(message.error)));else request.resolve(message.result);}};
  await until(`document.documentElement?.dataset.appearance==='wine' && document.querySelector('.personal-topbar')`);
  const origin = await evaluate('location.origin');
  if(origin===new URL(prior.localOrigin).origin)throw new Error('Restart must use a different origin to verify durable appearance');
  if(await evaluate('window.techsparDesktop.getAppearanceTheme()')!=='wine')throw new Error('Lost saved preference after restart');
  checks.push('saved theme restored after a real process restart on a different port');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1024,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('nav[aria-label="主要导航"] a[href="/settings"]').click()`);
  await until(`document.querySelector('[data-tab-id="appearance"]')`);
  const samples=[];
  for(const theme of ['navy','teal','wine']) {
    await evaluate(`document.querySelector('[data-tab-id="appearance"] input[value="${theme}"]').click()`);
    await until(`document.documentElement.dataset.appearance==='${theme}'`);
    await evaluate(`document.querySelector('main').scrollTop=0`);
    await screenshot(`theme-${theme}-settings-final`);
    const sample=JSON.parse(await evaluate(`JSON.stringify({theme:document.documentElement.dataset.appearance,background:getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),sidebar:getComputedStyle(document.querySelector('aside')).backgroundColor,primary:getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),primaryForeground:getComputedStyle(document.documentElement).getPropertyValue('--primary-foreground').trim(),overflow:document.documentElement.scrollWidth>innerWidth})`));
    await assertFitsViewport('Desktop settings '+theme);
    samples.push(sample);
    checks.push(theme+': settings colors and layout');
    await evaluate(`document.querySelector('nav[aria-label="主要导航"] a[href="/mock-interview"]').click()`);
    await until(`document.querySelector('.personal-preparation-sheet') && document.body.innerText.includes('ui-synthetic.pdf')`);
    await screenshot(`theme-${theme}-setup-final`);
    await evaluate(`document.querySelector('nav[aria-label="主要导航"] a[href="/settings"]').click()`);
    await until(`document.querySelector('[data-tab-id="appearance"]')`);
  }
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await assertFitsViewport('Mobile settings');
  await evaluate(`[...document.querySelectorAll('button[aria-label="切换界面配色"]')].find(button=>button.getBoundingClientRect().width>0).click()`);
  await until(`document.querySelector('[data-radix-popper-content-wrapper]')`);
  await evaluate(`document.querySelector('[data-radix-popper-content-wrapper] input[value="teal"]').click()`);
  await until(`document.documentElement.dataset.appearance==='teal'`);
  await screenshot('theme-mobile-picker');
  if(await evaluate(`document.documentElement.scrollWidth>innerWidth || document.querySelector('[data-radix-popper-content-wrapper]').getBoundingClientRect().right>innerWidth`))throw new Error('Mobile theme menu overflows');
  checks.push('mobile theme menu switches theme and fits the viewport');
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await until(`!document.querySelector('[data-radix-popper-content-wrapper]')`);
  checks.push('mobile theme menu closes with Escape');
  await screenshot('theme-mobile-settings');
  checks.push('mobile settings content fits the main scroll container');
  await evaluate(`document.querySelector('button[aria-label="打开导航"]').click()`);
  await until(`document.querySelector('nav[aria-label="移动导航"] a[href="/mock-interview"]')`);
  await evaluate(`document.querySelector('nav[aria-label="移动导航"] a[href="/mock-interview"]').click()`);
  await until(`document.querySelector('.personal-preparation-sheet')`);
  await assertFitsViewport('Mobile interview preparation');
  await screenshot('theme-mobile-setup');
  checks.push('mobile interview preparation fits the main scroll container');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1024,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('nav[aria-label="主要导航"] a[href="/settings"]').click()`);
  await until(`document.querySelector('[data-tab-id="appearance"]')`);
  await evaluate(`document.querySelector('[data-tab-id="appearance"] input[value="wine"]').click()`);
  await evaluate(`(async()=>{const token=JSON.parse(localStorage.getItem('techspar-session')).token;const settings=await(await fetch('/api/settings',{headers:{Authorization:'Bearer '+token}})).json();if(settings.llm.model!=='gpt-6.1-sol'||settings.llm.reasoning_effort!=='xhigh'||settings.llm.compatibility!=='responses')throw new Error('Appearance changed model preferences');})()`);
  checks.push('model and reasoning preferences unchanged');
  const result={qaDir,checks,samples,portChanged:true,previousOrigin:new URL(prior.localOrigin).origin,currentOrigin:origin,scope:'Isolated synthetic test account only; no real model calls'};
  await writeFile(join(qaDir,'appearance-restart-result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} catch(error) {
  if(socket?.readyState===WebSocket.OPEN)await screenshot('appearance-restart-failure').catch(()=>{});
  throw error;
} finally {
  if(socket?.readyState===WebSocket.OPEN) {
    const exited=new Promise(resolve=>child.once('exit',resolve));
    void cdp('Browser.close').catch(()=>{});
    await Promise.race([exited,sleep(5000)]);
    socket.close();
  }
  if(child.exitCode===null)child.kill();
}
