export interface XTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

export interface XMe {
  id: string;
  username: string;
  name: string;
  subscriptionType: string;
}

export interface XTweet {
  id: string;
  text: string;
  authorUsername: string;
  hasMedia: boolean;
  isArticle: boolean;
  noteText: string | null;
  referencedTweets: Array<{ type: string; id: string }>;
}

export interface XClient {
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<XTokens>;
  refreshToken(refreshToken: string): Promise<XTokens>;
  revokeToken(token: string): Promise<void>;
  getMe(accessToken: string): Promise<XMe>;
  getTweet(accessToken: string, id: string): Promise<XTweet>;
  uploadMedia(
    accessToken: string,
    input: { bytes: Uint8Array; mediaType: string },
  ): Promise<{ mediaId: string }>;
  createPost(
    accessToken: string,
    input: { text: string; mediaIds?: string[] },
  ): Promise<{ id: string }>;
}

export class XError extends Error {
  constructor(
    public kind: 'invalid_grant' | 'http' | 'network',
    public status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'XError';
  }
}
