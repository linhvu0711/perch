import type { Post, PostCreate } from '@perch/core';
import type { AppType } from '@perch/server';
import type { TestServer } from '@perch/server/testing';
import { PNG_3X2 } from '@perch/server/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { hc } from 'hono/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

import { PostModal } from '@/components/PostModal';
import { Toaster } from '@/components/Toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiProvider } from '@/lib/api';
import { Posts } from '@/pages/Posts';
import { Resources } from '@/pages/Resources';

// happy-dom's File lacks Bun's `.bytes()`; the server reads uploads through it.
if (typeof (File.prototype as { bytes?: unknown }).bytes !== 'function') {
  (File.prototype as File & { bytes?: () => Promise<Uint8Array> }).bytes = async function (
    this: File,
  ) {
    return new Uint8Array(await this.arrayBuffer());
  };
}

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

export function renderApp(
  server: TestServer,
  path: string,
  fetchOverride?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | null,
) {
  const client = hc<AppType>('http://localhost', {
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetchOverride?.(input, init) ?? server.app.request(input, init),
    headers: { Authorization: `Bearer ${server.token}` },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ApiProvider client={client}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={350} skipDelayDuration={0}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/posts" element={<Posts />}>
                <Route path=":id" element={<PostModal />} />
              </Route>
              <Route path="/resources" element={<Resources />} />
            </Routes>
            <LocationProbe />
          </MemoryRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ApiProvider>,
  );
}

export async function seedPost(server: TestServer, input: PostCreate): Promise<Post> {
  const response = await server.app.request('/api/posts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${server.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (response.status !== 201) throw new Error(`seedPost got ${response.status}`);
  return (await response.json()) as Post;
}

export async function attachImage(server: TestServer, postId: number): Promise<void> {
  const form = new FormData();
  const file = new File([PNG_3X2.slice().buffer as ArrayBuffer], 'a.png', {
    type: 'image/png',
  });
  form.append('files', file);
  const upload = await server.app.request('/api/resources/images', {
    method: 'POST',
    headers: { Authorization: `Bearer ${server.token}` },
    body: form,
  });
  const uploadBody = (await upload.json()) as {
    results: Array<{ ok: boolean; resource?: { id: number } }>;
  };
  const resourceId = uploadBody.results[0]?.resource?.id;
  if (resourceId === undefined) throw new Error('upload failed');
  const attach = await server.app.request(`/api/posts/${postId}/media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${server.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ resource_ids: [resourceId] }),
  });
  if (attach.status !== 200) throw new Error(`attachImage got ${attach.status}`);
}

export async function getPost(server: TestServer, id: number): Promise<Post> {
  const response = await server.app.request(`/api/posts/${id}`, {
    headers: { Authorization: `Bearer ${server.token}` },
  });
  return (await response.json()) as Post;
}
