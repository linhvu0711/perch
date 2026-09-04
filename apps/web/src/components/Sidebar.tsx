import type { MouseEvent, ReactNode } from 'react';
import {
  Calendar,
  Feather,
  Folder,
  LayoutDashboard,
  PanelLeft,
  PenLine,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { NavLink } from 'react-router';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCounts } from '@/lib/queries';
import { useSidebarCollapsed } from '@/lib/sidebar';

function CollapsedTip({ collapsed, label, children }: { collapsed: boolean; label: string; children: ReactNode }) {
  if (!collapsed) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
    </Tooltip>
  );
}

function NavigationItem({
  to,
  label,
  icon: Icon,
  collapsed,
  count,
  end,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  collapsed: boolean;
  count?: number;
  end?: boolean;
}) {
  const link = (
    <NavLink to={to} end={end} className="nav">
      <Icon size={16} strokeWidth={1.75} />
      <span>{label}</span>
      {count !== undefined && <span className="count">{count}</span>}
    </NavLink>
  );
  return <CollapsedTip collapsed={collapsed} label={label}>{link}</CollapsedTip>;
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const counts = useCounts();

  function expandFromSidebar(event: MouseEvent<HTMLElement>): void {
    const target = event.target;
    if (collapsed && target instanceof Element && !target.closest('.nav')) {
      setCollapsed(false);
    }
  }

  return (
    <aside className="side" onClick={expandFromSidebar}>
      <div className="brand">
        <span className="logo"><Feather size={16} strokeWidth={1.75} /></span>
        <span className="name">Perch</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="collapse"
              type="button"
              aria-label="Collapse sidebar"
              onClick={(event) => {
                event.stopPropagation();
                setCollapsed(true);
              }}
            >
              <PanelLeft size={16} strokeWidth={1.75} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Collapse sidebar</TooltipContent>
        </Tooltip>
      </div>

      <NavigationItem to="/" end label="Dashboard" icon={LayoutDashboard} collapsed={collapsed} />
      <NavigationItem to="/posts" label="Posts" icon={PenLine} count={counts.posts} collapsed={collapsed} />
      <NavigationItem to="/resources" label="Resources" icon={Folder} count={counts.resources} collapsed={collapsed} />
      <NavigationItem to="/calendar" label="Calendar" icon={Calendar} collapsed={collapsed} />
      <NavigationItem to="/settings" label="Settings" icon={Settings} collapsed={collapsed} />

      <div className="spacer" />
      <div className="acct">
        <span className="avatar none" />
        <div className="who">No X account<small>Connect in Settings</small></div>
      </div>
    </aside>
  );
}
