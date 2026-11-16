import { spawn } from 'node:child_process';
const processes = [
  spawn(process.execPath, ['--watch', 'src/server.ts'], { stdio: 'inherit', env: { ...process.env, INTERVIEW_DEV: '1' } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];
let exiting = false;
function stop(code = 0) { if (exiting) return; exiting = true; for (const child of processes) child.kill(); process.exitCode = code; }
for (const child of processes) { child.on('error', () => stop(1)); child.on('exit', code => stop(code ?? 0)); }
process.once('SIGINT', () => stop()); process.once('SIGTERM', () => stop());
