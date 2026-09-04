import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { Sidebar } from '@/components/Sidebar';
import { Toaster } from '@/components/Toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useMe } from '@/lib/queries';
import { useSidebarCollapsed } from '@/lib/sidebar';
import { cn } from '@/lib/utils';
import { Calendar } from '@/pages/Calendar';
import { Dashboard } from '@/pages/Dashboard';
import { Login } from '@/pages/Login';
import { Posts } from '@/pages/Posts';
import { Resources } from '@/pages/Resources';
import { Settings } from '@/pages/Settings';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function AuthGate() {
  const me = useMe();
  const [collapsed] = useSidebarCollapsed();
  if (me.isPending) return <div className="login" />;
  if (me.data == null) return <Login />;
  return (
    <div className={cn('app', collapsed && 'collapsed')}>
      <Sidebar />
      <main><div className="wrap"><Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/posts" element={<Posts />} />
        <Route path="/resources" element={<Resources />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></div></main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={350} skipDelayDuration={0}>
        <BrowserRouter><AuthGate /><Toaster /></BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
