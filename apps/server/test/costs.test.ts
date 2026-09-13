import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { CostHistory, CostSummary, Status } from '@perch/core';

import {
  createTestServer,
  insertTestApiCall,
  type TestServer,
} from '../src/testing';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => {
  server.cleanup();
});

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${server.token}`);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  return server.app.request(path, { ...init, headers });
}

async function getSummary(query = ''): Promise<CostSummary> {
  const response = await request(`/api/costs${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as CostSummary;
}

async function getHistory(query = ''): Promise<CostHistory> {
  const response = await request(`/api/costs/months${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as CostHistory;
}

describe('GET /api/costs', () => {
  test('summarizes a chosen month', async () => {
    // Given: calls across kinds in September and one in August
    insertTestApiCall(server, {
      endpoint: 'POST /2/tweets',
      costUsd: 0.015,
      createdAt: '2026-09-02T10:00:00Z',
    });
    insertTestApiCall(server, {
      endpoint: 'POST /2/media/upload',
      costUsd: 0,
      createdAt: '2026-09-02T10:00:01Z',
    });
    insertTestApiCall(server, {
      endpoint: 'GET /2/tweets/:id',
      costUsd: 0.015,
      createdAt: '2026-09-03T10:00:00Z',
    });
    insertTestApiCall(server, {
      endpoint: 'GET /2/users/me',
      costUsd: 0.01,
      createdAt: '2026-08-15T10:00:00Z',
    });

    // When
    const summary = await getSummary('?month=2026-09');

    // Then
    expect(summary.month).toBe('2026-09');
    expect(summary.calls).toBe(3);
    expect(summary.publish_usd).toBe(0.015);
    expect(summary.save_tweet_usd).toBe(0.015);
    expect(summary.connect_usd).toBe(0);
    expect(summary.total_usd).toBe(0.03);
    expect(summary.all_time_usd).toBe(0.04);
  });

  test('defaults to the current month', async () => {
    // Given: a call in August and a call in September; the clock sits in September
    insertTestApiCall(server, {
      endpoint: 'GET /2/users/me',
      costUsd: 0.01,
      createdAt: '2026-08-15T10:00:00Z',
    });
    insertTestApiCall(server, {
      endpoint: 'POST /2/tweets',
      costUsd: 0.2,
      createdAt: '2026-09-01T10:00:00Z',
    });

    // When
    const summary = await getSummary();

    // Then
    expect(summary.month).toBe('2026-09');
    expect(summary.total_usd).toBe(0.2);
    expect(summary.all_time_usd).toBe(0.21);
  });

  test('rejects a malformed month', async () => {
    // Given: nothing
    // When
    const badDay = await request('/api/costs?month=2026-13');
    const badShape = await request('/api/costs?month=Sep');

    // Then
    expect(badDay.status).toBe(400);
    expect(badShape.status).toBe(400);
  });

  test('shows zeros when there are no calls', async () => {
    // Given: nothing
    // When
    const summary = await getSummary('?month=2026-09');

    // Then
    expect(summary).toEqual({
      month: '2026-09',
      calls: 0,
      publish_usd: 0,
      save_tweet_usd: 0,
      connect_usd: 0,
      total_usd: 0,
      all_time_usd: 0,
    });
  });

  test('a call on the last instant of a month stays in that month', async () => {
    // Given: calls straddling the September UTC boundary
    insertTestApiCall(server, {
      endpoint: 'POST /2/tweets',
      costUsd: 0.015,
      createdAt: '2026-08-31T23:59:59.999Z',
    });
    insertTestApiCall(server, {
      endpoint: 'POST /2/tweets',
      costUsd: 0.015,
      createdAt: '2026-09-01T00:00:00Z',
    });
    insertTestApiCall(server, {
      endpoint: 'POST /2/tweets',
      costUsd: 0.015,
      createdAt: '2026-09-30T23:59:59.999Z',
    });
    insertTestApiCall(server, {
      endpoint: 'POST /2/tweets',
      costUsd: 0.015,
      createdAt: '2026-10-01T00:00:00Z',
    });

    // When
    const summary = await getSummary('?month=2026-09');

    // Then
    expect(summary.calls).toBe(2);
    expect(summary.total_usd).toBe(0.03);
  });

  test('the same month differs across zones', async () => {
    // Given: a call at 02:00Z Sep 1 — Aug 31 in Honolulu, Sep 1 in Tokyo
    insertTestApiCall(server, {
      endpoint: 'POST /2/tweets',
      costUsd: 0.015,
      createdAt: '2026-09-01T02:00:00Z',
    });

    // When: the zone is Honolulu
    let patched = await request('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ timezone: 'Pacific/Honolulu' }),
    });
    expect(patched.status).toBe(200);
    const honolulu = await getSummary('?month=2026-08');
    const honoluluSep = await getSummary('?month=2026-09');

    // Then
    expect(honolulu.calls).toBe(1);
    expect(honoluluSep.calls).toBe(0);

    // When: the zone is Tokyo
    patched = await request('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ timezone: 'Asia/Tokyo' }),
    });
    expect(patched.status).toBe(200);
    const tokyo = await getSummary('?month=2026-09');

    // Then
    expect(tokyo.calls).toBe(1);
  });

  test('unknown endpoint names are ignored', async () => {
    // Given: one known call and one unknown in the same month
    insertTestApiCall(server, {
      endpoint: 'POST /2/tweets',
      costUsd: 0.015,
      createdAt: '2026-09-02T10:00:00Z',
    });
    insertTestApiCall(server, {
      endpoint: 'GET /2/nope',
      costUsd: 5,
      createdAt: '2026-09-02T10:00:00Z',
    });

    // When
    const summary = await getSummary('?month=2026-09');

    // Then
    expect(summary.calls).toBe(1);
    expect(summary.total_usd).toBe(0.015);
    expect(summary.all_time_usd).toBe(0.015);
  });
});

describe('GET /api/costs/months', () => {
  test('lists months newest first and pages by cursor', async () => {
    // Given: calls across three months
    for (const createdAt of [
      '2026-07-10T10:00:00Z',
      '2026-08-10T10:00:00Z',
      '2026-09-02T10:00:00Z',
    ]) {
      insertTestApiCall(server, {
        endpoint: 'POST /2/tweets',
        costUsd: 0.015,
        createdAt,
      });
    }

    // When
    const page1 = await getHistory('?limit=2');

    // Then
    expect(page1.items.map((row) => row.month)).toEqual(['2026-09', '2026-08']);
    expect(page1.total).toBe(3);
    expect(page1.next_cursor).not.toBeNull();

    // When: following the cursor
    const page2 = await getHistory(`?limit=2&cursor=${page1.next_cursor}`);

    // Then
    expect(page2.items.map((row) => row.month)).toEqual(['2026-07']);
    expect(page2.next_cursor).toBeNull();
  });

  test('limit defaults to six and rejects bad values', async () => {
    // Given: calls across eight months
    for (const createdAt of [
      '2026-01-10T10:00:00Z',
      '2026-02-10T10:00:00Z',
      '2026-03-10T10:00:00Z',
      '2026-04-10T10:00:00Z',
      '2026-05-10T10:00:00Z',
      '2026-06-10T10:00:00Z',
      '2026-07-10T10:00:00Z',
      '2026-08-10T10:00:00Z',
    ]) {
      insertTestApiCall(server, {
        endpoint: 'POST /2/tweets',
        costUsd: 0.015,
        createdAt,
      });
    }

    // When
    const page = await getHistory();
    const zero = await request('/api/costs/months?limit=0');
    const word = await request('/api/costs/months?limit=lots');
    const over = await request('/api/costs/months?limit=101');

    // Then
    expect(page.items.length).toBe(6);
    expect(page.total).toBe(8);
    expect(zero.status).toBe(400);
    expect(word.status).toBe(400);
    expect(over.status).toBe(400);
  });

  test('rejects a bad cursor', async () => {
    // Given: nothing
    // When
    const response = await request('/api/costs/months?cursor=not a cursor!');

    // Then
    expect(response.status).toBe(400);
  });
});

describe('status month cost', () => {
  test('status shows the current month total', async () => {
    // Given: calls in August and September; the clock sits in September
    insertTestApiCall(server, {
      endpoint: 'GET /2/users/me',
      costUsd: 0.01,
      createdAt: '2026-08-15T10:00:00Z',
    });
    insertTestApiCall(server, {
      endpoint: 'POST /2/tweets',
      costUsd: 0.2,
      createdAt: '2026-09-01T10:00:00Z',
    });

    // When
    const response = await request('/api/status');
    expect(response.status).toBe(200);
    const status = (await response.json()) as Status;

    // Then
    expect(status.month_cost_usd).toBe(0.2);
  });
});
