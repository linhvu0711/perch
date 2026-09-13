export interface R2Client {
  put(key: string, bytes: Uint8Array): Promise<void>;
  list(prefix: string): Promise<string[]>;
  get(key: string): Promise<Uint8Array>;
}

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function createR2Client(config: R2Config): R2Client {
  const client = new Bun.S3Client({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
  });
  return {
    async put(key, bytes) {
      await client.write(key, bytes);
    },
    async list(prefix) {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      do {
        const page = await client.list({ prefix, continuationToken });
        for (const object of page.contents ?? []) keys.push(object.key);
        continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
      } while (continuationToken !== undefined);
      return keys;
    },
    async get(key) {
      return client.file(key).bytes();
    },
  };
}
