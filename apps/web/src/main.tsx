import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { queryClient } from './lib/queryClient';
import { bootstrapSession } from './lib/apiClient';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root was not found in index.html');

/**
 * Try to restore the session before the first render.
 *
 * The access token lives in memory and is gone after a reload, but the httpOnly
 * refresh cookie survives. This asks the server to mint a fresh token from it,
 * so a reload does not throw a signed-in user back to the login screen. The app
 * renders a loader until this settles.
 */
void bootstrapSession();

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
