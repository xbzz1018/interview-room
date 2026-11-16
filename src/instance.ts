import { mkdirSync, openSync, readFileSync, writeFileSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
export function acquireInstance(directory: string): () => void {
  mkdirSync(directory, { recursive: true });
  const lock = join(directory, 'instance.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = openSync(lock, 'wx');
      try { writeFileSync(handle, String(process.pid)); } finally { closeSync(handle); }
      return () => { try { if (readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock); } catch {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const pid = Number(readFileSync(lock, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('启动锁文件无效，请确认应用已退出后保留副本并移走 instance.lock');
      try { process.kill(pid, 0); }
      catch (probe) { if ((probe as NodeJS.ErrnoException).code === 'ESRCH') { unlinkSync(lock); continue; } throw probe; }
      throw new Error('这个数据目录已被面试练习室使用，请打开已有窗口');
    }
  }
  throw new Error('未获得本机数据目录的使用锁');
}
