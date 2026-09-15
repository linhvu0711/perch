import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { createTestServer, type TestServer } from '@perch/server/testing';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

import { attachImage, getPost, renderApp, seedPost } from './helpers';

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

  test('shows a missing Media file red and warns on Publish now', async () => {
    // Given: a Post with one attached image whose file is deleted
    await seedPost(server, { text: 'Hello' });
    await attachImage(server, 1);
    const dir = path.join(server.dir, 'uploads', '1', 'posts', '1');
    for (const file of fs.readdirSync(dir)) {
      fs.unlinkSync(path.join(dir, file));
    }
    renderApp(server, '/posts/1');
    await screen.findByDisplayValue('Hello');
    await screen.findByText('Media 1 file is missing');

    // When: reading the row, then clicking Publish now
    const row = screen.getByText('Media 1 file is missing').closest('li');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Publish now' }));
    });

    // Then
    expect(row?.className).toBe('bad');
    expect(screen.queryByText('1 of 4 images')).toBeNull();
    await waitFor(
      () => expect(document.querySelector('.toast')?.textContent).toBe('Media 1 file is missing'),
      { timeout: 2000 },
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test('keeps the patch and shows a toast when a save fails', async () => {
    // Given: a Post, and the next PATCH fails
    await seedPost(server, { text: 'Hello world' });
    let failNext = true;
    renderApp(server, '/posts/1', (_input, init) => {
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

  test('shows the server message when an edit is refused as in flight', async () => {
    // Given: a Post, and the next PATCH is refused as in flight
    await seedPost(server, { text: 'Hello world' });
    let refused = true;
    renderApp(server, '/posts/1', (_input, init) => {
      if (refused && init?.method === 'PATCH') {
        refused = false;
        return Promise.resolve(
          new Response(JSON.stringify({ code: 'in_flight', message: 'Post 1 is being sent' }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return null;
    });
    await screen.findByDisplayValue('Hello world');
    // When: a save is refused
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello world!' } });
    });
    // Then: the toast shows the server message and the row kept its text
    await waitFor(
      () => expect(document.querySelector('.toast')?.textContent).toBe('Post 1 is being sent'),
      { timeout: 2000 },
    );
    expect((await getPost(server, 1)).text).toBe('Hello world');
  });

  test('shows the server message when a delete is refused as in flight', async () => {
    // Given: a Post whose delete answers an in_flight per-id result
    await seedPost(server, { text: 'Hello world' });
    renderApp(server, '/posts/1', (_input, init) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              results: [
                {
                  id: 1,
                  ok: false,
                  error: { code: 'in_flight', message: 'Post 1 is being sent' },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return null;
    });
    await screen.findByDisplayValue('Hello world');
    // When: the delete is confirmed
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete post' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });
    // Then: the toast shows the server message and the modal stays open
    await waitFor(
      () => expect(document.querySelector('.toast')?.textContent).toBe('Post 1 is being sent'),
      { timeout: 2000 },
    );
    expect(screen.getByTestId('location').textContent).toBe('/posts/1');
  });
});
