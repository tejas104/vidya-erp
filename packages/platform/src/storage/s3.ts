import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/** Re-exported so modules receive a typed client without an aws-sdk dependency. */
export type ObjectStorageClient = S3Client;

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

/** Creates the bucket when absent (idempotent — "already owned" is success). */
export async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (error) {
      const name = (error as { name?: string }).name ?? "";
      if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
        throw error;
      }
    }
  }
}

export async function putObjectText(
  client: S3Client,
  bucket: string,
  key: string,
  body: string,
  contentType = "text/plain; charset=utf-8",
): Promise<void> {
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getObjectText(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<string> {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (result.Body === undefined) {
    throw new Error(`object ${bucket}/${key} has no body`);
  }
  return result.Body.transformToString("utf8");
}
