import { FileText, MessagesSquare, Repeat2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import Logo from '@/components/Logo';

const STEPS = [
  { icon: FileText, title: '准备自己的材料', description: '整理简历、项目说明和目标岗位，每轮选择要练的内容。' },
  { icon: MessagesSquare, title: '把面试练完整', description: '严格模拟先独立作答，教练练习可以请求提示和讲解。' },
  { icon: Repeat2, title: '复盘后再答一次', description: '保留原始问答，学习参考答法，再对照重答找出改进点。' },
];

export default function PersonalWelcome() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-12 text-text">
      <div className="w-full max-w-3xl">
        <div className="flex items-center gap-3 text-primary">
          <Logo />
          <span className="text-sm font-medium">个人模拟面试</span>
        </div>
        <h1 className="mt-5 text-4xl font-display font-bold tracking-tight md:text-5xl">面试练习室</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-dim">把自己的简历、项目和目标岗位，变成可以反复练习的面试。练技术理解，也练如何把自己的工作讲清楚。</p>
        <Button asChild variant="gradient" size="lg" className="mt-7"><Link to="/login">进入练习室</Link></Button>
        <div className="mt-10 grid gap-3 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-2xl border border-border bg-card p-5">
              <Icon size={21} className="text-primary" aria-hidden="true" />
              <h2 className="mt-4 text-sm font-semibold">{title}</h2>
              <p className="mt-2 text-[13px] leading-6 text-dim">{description}</p>
            </div>
          ))}
        </div>
        <p className="mt-7 text-xs leading-6 text-dim">从一次具体回答开始，把不熟悉的地方练清楚。</p>
      </div>
    </main>
  );
}
