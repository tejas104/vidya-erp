import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

export interface ObjectStorageOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
}

/**
 * S3-compatible client (MinIO on-prem, any S3 API in general). No feature
 * module stores objects yet; this exists so modules receive a ready client
 * through their factory dependencies instead of constructing their own.
 */
export function createObjectStorage(options: ObjectStorageOptions): S3Client {
  return new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    forcePathStyle: options.forcePathStyle,
  });
}

/** Optional deep health probe; not wired into /ready (see docs/runbook.md). */
export async function pingObjectStorage(client: S3Client, bucket: string): Promise<void> {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
}
