import { useId } from 'react';
import { Check, Palette } from 'lucide-react';
import { APPEARANCE_THEMES, setAppearanceTheme } from '@/lib/appearance';
import useAppearance from '@/hooks/useAppearance';
import { cn } from '@/lib/utils';

export function AppearancePicker({ compact = false }: { compact?: boolean }) {
  const { theme, error } = useAppearance();
  const groupId = useId();
  return <div className="min-w-0">
    <fieldset className={cn('grid min-w-0 gap-3', !compact && 'sm:grid-cols-3')}>
      <legend className="sr-only">界面配色</legend>
      {APPEARANCE_THEMES.map(option => <label key={option.id} className="relative block min-w-0 cursor-pointer">
        <input type="radio" name={groupId} value={option.id} checked={theme === option.id} onChange={() => { void setAppearanceTheme(option.id); }} className="peer sr-only" aria-label={option.name} />
        <span className={cn('flex h-full items-center gap-3 rounded-lg border border-border p-3 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background', theme === option.id ? 'border-primary bg-primary/7' : 'hover:bg-hover', !compact && 'flex-col items-start gap-4 p-4')}>
          <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded-md border" style={{ background: option.background, borderColor: option.accent + '40' }} aria-hidden="true"><Palette size={19} style={{ color: option.accent }} /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{option.name}</span>{!compact && <span className="mt-1 block text-xs leading-5 text-dim">{option.description}</span>}</span>
          {theme === option.id && <Check size={16} className={cn('shrink-0 text-primary', !compact && 'absolute right-4 top-5')} aria-hidden="true" />}
        </span>
      </label>)}
    </fieldset>
    {error && <p role="status" className="mt-3 text-xs leading-5 text-red">{error}</p>}
  </div>;
}
