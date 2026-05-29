import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import crypto from 'crypto';
import { Chunk } from '../models/Candidate.model';
import { AiInterview } from '../models/AiInterview.model';
import type { MergeJobPayload } from '../../../packages/shared-types';

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const sqs = new SQSClient({ region: process.env.AWS_REGION || 'ap-south-1' });

const BUCKET = process.env.S3_BUCKET_NAME!;
const MERGE_QUEUE = process.env.SQS_AUDIO_MERGE_QUEUE_URL!;

// Validate WAV header bytes [52 49 46 46] = "RIFF"
function isValidWav(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  const riff = buffer.slice(0, 4).toString('ascii');
  return riff === 'RIFF';
}

// Validate WebM/Opus header
function isValidWebm(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  // WebM starts with 0x1A 0x45 0xDF 0xA3 (EBML header)
  return buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
}

export async function uploadChunk(params: {
  interviewId: string;
  questionId: string;
  chunkIndex: number;
  buffer: Buffer;
  mimeType?: string;
}): Promise<{ success: boolean; s3Key: string; skipped?: boolean }> {
  const { interviewId, questionId, chunkIndex, buffer, mimeType } = params;

  // Guard: minimum size check
  if (buffer.length < 1000) {
    console.warn(`[ChunkService] Chunk too small (${buffer.length}B), skipping`);
    return { success: false, s3Key: '', skipped: true };
  }

  // Guard: validate media header
  const isWebm = isValidWebm(buffer);
  const isWav = isValidWav(buffer);
  if (!isWebm && !isWav) {
    console.warn(`[ChunkService] Invalid media header for chunk ${chunkIndex}`);
    // Mark corrupted but don't block — log and continue
  }

  const ext = mimeType?.includes('webm') ? 'webm' : 'wav';
  const paddedIndex = String(chunkIndex).padStart(3, '0');
  const s3Key = `interviews/${interviewId}/${questionId}/chunk_${paddedIndex}.${ext}`;

  // Idempotency: skip if already uploaded
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: s3Key }));
    console.log(`[ChunkService] Chunk already exists: ${s3Key}, skipping`);
    return { success: true, s3Key, skipped: true };
  } catch {
    // Not found — proceed with upload
  }

  const checksum = crypto.createHash('md5').update(buffer).digest('hex');

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      Body: buffer,
      ContentType: mimeType || 'audio/webm',
      Metadata: {
        interviewId,
        questionId,
        chunkIndex: String(chunkIndex),
        checksum,
      },
    })
  );

  // Persist to DB
  await Chunk.findOneAndUpdate(
    { s3Key },
    {
      interviewId,
      questionId,
      chunkIndex,
      s3Key,
      size: buffer.length,
      checksum,
      uploadedAt: new Date(),
      isCorrupted: !isWebm && !isWav,
    },
    { upsert: true, new: true }
  );

  // Push chunkKey into response
  await AiInterview.updateOne(
    { _id: interviewId, 'responses.questionId': questionId },
    { $addToSet: { 'responses.$.chunkKeys': s3Key } }
  );

  return { success: true, s3Key };
}

export async function finalizeQuestion(params: {
  interviewId: string;
  questionId: string;
}): Promise<void> {
  const { interviewId, questionId } = params;

  const chunks = await Chunk.find({ interviewId, questionId }).sort({ chunkIndex: 1 });
  const totalChunks = chunks.length;

  if (totalChunks === 0) {
    console.error(`[ChunkService] No chunks found for ${interviewId}/${questionId}`);
    return;
  }

  // Update processing status
  await AiInterview.updateOne(
    { _id: interviewId, 'responses.questionId': questionId },
    { $set: { 'responses.$.processingStatus': 'merging' } }
  );

  // Push to SQS merge queue
  const payload: MergeJobPayload = { interviewId, questionId, totalChunks };
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: MERGE_QUEUE,
      MessageBody: JSON.stringify(payload),
      MessageGroupId: interviewId, // FIFO queue grouping
      MessageDeduplicationId: `${interviewId}-${questionId}-merge`,
    })
  );

  console.log(`[ChunkService] Pushed merge job: ${interviewId}/${questionId} (${totalChunks} chunks)`);
}
