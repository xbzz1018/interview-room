import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Palette } from 'lucide-react';
import { AppearancePicker } from './AppearancePicker';
import { APPEARANCE_THEMES } from '@/lib/appearance';
import useAppearance from '@/hooks/useAppearance';
import { cn } from '@/lib/utils';

export function AppearanceMenu({ collapsed = false }: { collapsed?: boolean }) {
  const { theme } = useAppearance();
  const current = APPEARANCE_THEMES.find(option => option.id === theme)!;
  return <Popover.Root>
    <Popover.Trigger asChild><button type="button" aria-label="切换界面配色" title={'当前配色：' + current.name} className={cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-dim transition-colors hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', collapsed && 'w-full justify-center px-0')}>
      <Palette size={18} aria-hidden="true" />{!collapsed && <><span>{current.name}</span><ChevronDown size={13} aria-hidden="true" /></>}
    </button></Popover.Trigger>
    <Popover.Portal><Popover.Content sideOffset={8} collisionPadding={12} align="end" className="z-[70] w-[280px] max-w-[calc(100vw-24px)] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none">
      <h2 className="mb-1 text-sm font-semibold">选择界面配色</h2><p className="mb-4 text-xs leading-5 text-dim">即时生效，自动记住你的选择。</p><AppearancePicker compact />
      <Popover.Arrow className="fill-popover" />
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
