import type { LucideIcon } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface IconLinkProps {
  label: string;
  icon: LucideIcon;
  href: string;
  variant?: 'default' | 'primary' | 'ghost';
  size?: 'md' | 'sm';
  className?: string;
}

export function IconLink({
  label,
  icon: Icon,
  href,
  variant = 'default',
  size = 'md',
  className,
}: IconLinkProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          className={cn(
            'btn icon',
            variant === 'primary' && 'primary',
            variant === 'ghost' && 'ghost',
            size === 'sm' && 'sm',
            className,
          )}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
        >
          <Icon size={16} strokeWidth={1.75} />
        </a>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
