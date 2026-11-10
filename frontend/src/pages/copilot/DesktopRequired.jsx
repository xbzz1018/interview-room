import { MessagesSquare, Monitor } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function DesktopRequired() {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-lg rounded-3xl border border-border bg-card p-8 text-center space-y-5">
        <Monitor className="mx-auto text-primary" size={36} />
        <h1 className="text-2xl font-semibold">在桌面端使用面试 Copilot</h1>
        <p className="text-sm leading-7 text-dim">系统音频功能需要本机桌面端。请运行项目中的「启动面试练习室.cmd」，再进入此页面。</p>
        <Button asChild variant="gradient" size="lg" className="rounded-2xl"><Link to="/mock-interview?mode=live"><MessagesSquare size={16} className="mr-2" />先练一轮模拟面试</Link></Button>
        <p className="text-xs leading-5 text-dim">浏览器中也可以准备材料、模拟面试和查看复盘。</p>
      </div>
    </div>
  );
}
