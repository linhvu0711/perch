import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@perch/server/testing';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

import { getPost, renderApp, seedPost } from './helpers';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => {
  server.cleanup();
  cleanup();
});

describe('posts page', () => {
  test('lists a seeded Post', async () => {
    // Given: one Post on the server
    await seedPost(server, { title: 'Hi', text: 'Hello world' });
    renderApp(server, '/posts');
    // When: the page loads its list through the provided client
    // Then
    await screen.findByText('Hi');
    expect(screen.getByText('Hello world')).toBeDefined();
    expect(screen.getByText('#1')).toBeDefined();
    expect(screen.queryByText('No posts yet')).toBeNull();
  });

  test('typing in a new Post creates it and closing flushes first', async () => {
    // Given: the new-Post modal
    renderApp(server, '/posts/new');
    await screen.findByLabelText('Text');
    // When: text is typed, then more text and an immediate close
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello' } });
    });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/posts/1'), {
      timeout: 2000,
    });
    await waitFor(async () => expect((await getPost(server, 1)).text).toBe('Hello'), {
      timeout: 2000,
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello world' } });
      fireEvent.click(screen.getByRole('button', { name: 'Close (Esc)' }));
    });
    // Then
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 2000 });
    expect((await getPost(server, 1)).text).toBe('Hello world');
    expect(document.querySelector('.toast')?.textContent).toBe('Saved');
    expect(screen.getByTestId('location').textContent).toBe('/posts');
  });

  test('keeps the patch and shows a toast when a save fails', async () => {
    // Given: a Post, and the next PATCH fails
    await seedPost(server, { text: 'Hello world' });
    let failNext = true;
    renderApp(server, '/posts/1', (input, init) => {
      if (failNext && init?.method === 'PATCH') {
        failNext = false;
        return Promise.resolve(
          new Response(JSON.stringify({ code: 'internal', message: 'Save failed on purpose' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return null;
    });
    await screen.findByDisplayValue('Hello world');
    // When: a save fails, then the modal is closed with no further typing
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello world!' } });
    });
    await waitFor(
      () => expect(document.querySelector('.toast')?.textContent).toBe('Save failed on purpose'),
      { timeout: 2000 },
    );
    expect((await getPost(server, 1)).text).toBe('Hello world');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close (Esc)' }));
    });
    // Then
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 2000 });
    expect((await getPost(server, 1)).text).toBe('Hello world!');
    expect(document.querySelector('.toast')?.textContent).toBe('Saved');
  });
});
