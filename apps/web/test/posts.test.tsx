import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestServer, type TestServer } from '@perch/server/testing';
import { cleanup, screen } from '@testing-library/react';

import { renderApp, seedPost } from './helpers';

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
});
