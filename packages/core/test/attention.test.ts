import { describe, expect, test } from 'bun:test';

import { attentionReason, dismissAction, dueSoonDraft, needsAttention } from '../src/attention';

const NOW = new Date('2026-09-04T10:00:00Z');

describe('dueSoonDraft', () => {
  test('dueSoonDraft holds at now and at now + 3 days, not beyond', () => {
    // Given: now 2026-09-04T10:00:00Z
    // When: a draft at the window's edges
    // Then
    expect(dueSoonDraft({ status: 'draft', scheduled_at: '2026-09-04T10:00:00.000Z' }, NOW)).toBe(
      true,
    );
    expect(dueSoonDraft({ status: 'draft', scheduled_at: '2026-09-07T10:00:00.000Z' }, NOW)).toBe(
      true,
    );
    expect(dueSoonDraft({ status: 'draft', scheduled_at: '2026-09-07T10:00:00.001Z' }, NOW)).toBe(
      false,
    );
    expect(dueSoonDraft({ status: 'draft', scheduled_at: '2026-09-04T09:59:59.999Z' }, NOW)).toBe(
      false,
    );
  });

  test('dueSoonDraft is false for official, published, failed, and untimed', () => {
    // Given: now 2026-09-04T10:00:00Z
    // When
    // Then
    expect(
      dueSoonDraft({ status: 'official', scheduled_at: '2026-09-05T09:00:00.000Z' }, NOW),
    ).toBe(false);
    expect(
      dueSoonDraft({ status: 'published', scheduled_at: '2026-09-05T09:00:00.000Z' }, NOW),
    ).toBe(false);
    expect(dueSoonDraft({ status: 'failed', scheduled_at: '2026-09-05T09:00:00.000Z' }, NOW)).toBe(
      false,
    );
    expect(dueSoonDraft({ status: 'draft', scheduled_at: null }, NOW)).toBe(false);
  });
});

describe('needsAttention', () => {
  test('needsAttention takes missed and failed; a due-soon draft is not an Issue', () => {
    // Given: plain literals, no clock
    // When
    // Then
    expect(needsAttention({ status: 'draft', missed: true })).toBe(true);
    expect(needsAttention({ status: 'failed', missed: false })).toBe(true);
    expect(needsAttention({ status: 'draft', missed: false })).toBe(false);
    expect(needsAttention({ status: 'official', missed: false })).toBe(false);
    expect(needsAttention({ status: 'published', missed: false })).toBe(false);
  });
});

describe('attentionReason', () => {
  test('attentionReason names the reason in plain words', () => {
    // Given: now 2026-09-04T10:00:00Z
    // When
    // Then
    expect(
      attentionReason(
        {
          status: 'failed',
          scheduled_at: null,
          missed: false,
          last_error: 'Service Unavailable',
        },
        NOW,
      ),
    ).toBe('publish failed: Service Unavailable');
    expect(
      attentionReason(
        { status: 'failed', scheduled_at: null, missed: false, last_error: null },
        NOW,
      ),
    ).toBe('publish failed');
    expect(
      attentionReason(
        {
          status: 'draft',
          scheduled_at: '2026-09-02T09:00:00.000Z',
          missed: true,
          last_error: null,
        },
        NOW,
      ),
    ).toBe('time passed, still a draft');
    expect(
      attentionReason(
        {
          status: 'official',
          scheduled_at: '2026-09-02T09:00:00.000Z',
          missed: true,
          last_error: null,
        },
        NOW,
      ),
    ).toBe('time passed, no X account');
    expect(
      attentionReason(
        {
          status: 'draft',
          scheduled_at: '2026-09-05T09:00:00.000Z',
          missed: false,
          last_error: null,
        },
        NOW,
      ),
    ).toBe('still a draft');
    expect(
      attentionReason(
        {
          status: 'official',
          scheduled_at: '2026-09-05T09:00:00.000Z',
          missed: false,
          last_error: null,
        },
        NOW,
      ),
    ).toBeNull();
  });
});

describe('dismissAction', () => {
  test('dismissAction demotes failed and unschedules the rest', () => {
    // Given: nothing
    // When
    // Then
    expect(dismissAction('failed')).toBe('demote');
    expect(dismissAction('draft')).toBe('unschedule');
    expect(dismissAction('official')).toBe('unschedule');
  });
});
