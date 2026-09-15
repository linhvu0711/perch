import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@perch/server/testing';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';

import { renderApp } from './helpers';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => {
  server.cleanup();
  cleanup();
});

async function renderEmptyResources() {
  renderApp(server, '/resources');
  await screen.findByText('No resources yet');
}

function headerButton(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

describe('resources page', () => {
  test('groups the header buttons in one wrapper', async () => {
    // Given: no Resources on the server
    await renderEmptyResources();
    // When: the header renders
    const saveTweets = headerButton('Save tweets');
    const uploadImages = headerButton('Upload images');
    const newNote = headerButton('New note');
    const wrapper = saveTweets.parentElement;
    // Then: the three buttons share one wrapper that sits inside .head
    expect(wrapper).not.toBeNull();
    expect(uploadImages.parentElement).toBe(wrapper);
    expect(newNote.parentElement).toBe(wrapper);
    expect(wrapper?.classList.contains('head')).toBe(false);
    expect(wrapper?.parentElement?.classList.contains('head')).toBe(true);
    expect(document.querySelector('.head')?.children.length).toBe(2);
    const order = Array.from(wrapper?.querySelectorAll('button') ?? []).map((button) =>
      button.getAttribute('aria-label'),
    );
    expect(order).toEqual(['Save tweets', 'Upload images', 'New note']);
  });

  test('shows the empty state', async () => {
    // Given: no Resources on the server
    await renderEmptyResources();
    // Then
    expect(screen.getByText('Save tweets or create a note with the buttons above.')).toBeDefined();
  });

  test('Save tweets goes to /resources/save-tweets', async () => {
    await renderEmptyResources();
    await act(async () => {
      fireEvent.click(headerButton('Save tweets'));
    });
    expect(screen.getByTestId('location').textContent).toBe('/resources/save-tweets');
  });

  test('New note goes to /resources/new', async () => {
    await renderEmptyResources();
    await act(async () => {
      fireEvent.click(headerButton('New note'));
    });
    expect(screen.getByTestId('location').textContent).toBe('/resources/new');
  });

  test('Upload images opens the dialog', async () => {
    await renderEmptyResources();
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      fireEvent.click(headerButton('Upload images'));
    });
    expect(screen.getByRole('dialog', { name: 'Upload images' })).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
