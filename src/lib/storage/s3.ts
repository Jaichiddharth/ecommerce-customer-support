import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { AppError } from "@/lib/errors";

/**
 * S3 file storage. Bucket from AWS_S3_BUCKET; region and credentials from the standard
 * AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, which the SDK reads itself.
 * The bucket stays private: files are read back by the server only, never linked to.
 */

let client: S3Client | null = null;

function bucket(): string {
  const name = process.env.AWS_S3_BUCKET;
  if (!name) throw new AppError("MEDIA_STORAGE_NOT_CONFIGURED", { message: "AWS_S3_BUCKET is not set." });
  return name;
}

function s3(): S3Client {
  client ??= new S3Client({});
  return client;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const Bucket = bucket();
  try {
    await s3().send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
  } catch (err) {
    throw AppError.wrap(err, "MEDIA_STORAGE_FAILED", { details: { stage: "put", key } });
  }
}

export async function getObject(key: string): Promise<Buffer> {
  const Bucket = bucket();
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket, Key: key }));
    if (!res.Body) throw new Error("Empty response body");
    return Buffer.from(await res.Body.transformToByteArray());
  } catch (err) {
    if (err instanceof NoSuchKey) {
      throw new AppError("MEDIA_NOT_FOUND", { message: "The attached file is no longer in storage. Attach it again.", details: { key }, expected: true });
    }
    throw AppError.wrap(err, "MEDIA_STORAGE_FAILED", { details: { stage: "get", key } });
  }
}
