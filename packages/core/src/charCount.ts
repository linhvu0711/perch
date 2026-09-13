import twitter from 'twitter-text';

const {
  parseTweet,
  extractUrlsWithIndices,
  extractMentionsWithIndices,
  extractHashtagsWithIndices,
} = twitter;

export const PREVIEW_FOLD = 280;

export interface PreviewSegment {
  kind: 'text' | 'url' | 'mention' | 'hashtag';
  text: string;
}

/** Weighted character count as X counts it: URLs are 23, wide characters are 2. */
export function weightedLength(text: string): number {
  return parseTweet(text).weightedLength;
}

/** Text split into url, mention, hashtag, and plain-text segments for preview rendering. */
export function previewSegments(text: string): PreviewSegment[] {
  const marked: Array<PreviewSegment & { start: number; end: number }> = [
    ...extractUrlsWithIndices(text).map((entity) => ({
      kind: 'url' as const,
      text: entity.url,
      start: entity.indices[0],
      end: entity.indices[1],
    })),
    ...extractMentionsWithIndices(text).map((entity) => ({
      kind: 'mention' as const,
      text: text.slice(entity.indices[0], entity.indices[1]),
      start: entity.indices[0],
      end: entity.indices[1],
    })),
    ...extractHashtagsWithIndices(text).map((entity) => ({
      kind: 'hashtag' as const,
      text: text.slice(entity.indices[0], entity.indices[1]),
      start: entity.indices[0],
      end: entity.indices[1],
    })),
  ].sort((a, b) => a.start - b.start);

  const segments: PreviewSegment[] = [];
  let cursor = 0;
  for (const entity of marked) {
    if (entity.start < cursor) continue;
    if (entity.start > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, entity.start) });
    }
    segments.push({ kind: entity.kind, text: entity.text });
    cursor = entity.end;
  }
  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) });
  }
  return segments;
}

/** Text to show before the "Show more" fold; cuts at the last space past 60% of the cut. */
export function foldPreview(text: string): { visible: string; folded: boolean } {
  if (weightedLength(text) <= PREVIEW_FOLD) {
    return { visible: text, folded: false };
  }

  let cut = text.slice(0, parseTweet(text).validRangeEnd + 1);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > cut.length * 0.6) {
    cut = cut.slice(0, lastSpace);
  }
  return { visible: cut, folded: true };
}
