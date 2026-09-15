import type { AppType } from '@perch/server';
import { hc } from 'hono/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';
import { ApiProvider } from './lib/api';
import { applyTheme, readTheme } from './lib/theme';

applyTheme(readTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApiProvider client={hc<AppType>('/', { init: { credentials: 'same-origin' } })}>
      <App />
    </ApiProvider>
  </StrictMode>,
);
