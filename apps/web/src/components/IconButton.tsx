import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: LucideIcon;
  variant?: 'default' | 'primary' | 'ghost';
  size?: 'md' | 'sm';
  pressed?: boolean;
}

export function IconButton({
  label,
  icon: Icon,
  variant = 'default',
  size = 'md',
  pressed,
  className,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={cn(
            'btn icon',
            variant === 'primary' && 'primary',
            variant === 'ghost' && 'ghost',
            size === 'sm' && 'sm',
            className,
          )}
          aria-label={label}
          aria-pressed={pressed}
          {...props}
        >
          <Icon size={16} strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
