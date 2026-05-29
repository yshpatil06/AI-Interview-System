import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Readable } from 'stream';
import { AiInterview } from '../models/AiInterview.model';
import { Chunk } from '../models/Candidate.model';
import type { MergeJobPayload, TranscribeJobPayload } from '../../../packages/shared-types';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const sqs = new SQSClient({ region: process.env.AWS_REGION });

const BUCKET = process.env.S3_BUCKET_NAME!;
const TRANSCRIBE_QUEUE = process.env.SQS_TRANSCRIPTION_QUEUE_URL!;

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export async function processMergeJob(payload: MergeJobPayload, receiptHandle: string): Promise<void> {
  const { interviewId, questionId, totalChunks } = payload;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `merge-${interviewId}-`));

  console.log(`[MergeWorker] Starting merge: ${interviewId}/${questionId}, ${totalChunks} chunks`);

  try {
    // 1. Fetch all chunks from DB sorted by index
    const chunks = await Chunk.find({ interviewId, questionId })
      .sort({ chunkIndex: 1 })
      .lean();

    if (chunks.length === 0) throw new Error('No chunks found in DB');

    const downloadedPaths: string[] = [];

    // 2. Download each chunk from S3
    for (const chunk of chunks) {
      if (chunk.isCorrupted) {
        console.warn(`[MergeWorker] Skipping corrupted chunk: ${chunk.s3Key}`);
        continue;
      }

      try {
        const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: chunk.s3Key }));
        const buffer = await streamToBuffer(obj.Body as Readable);

        // Re-validate min size
        if (buffer.length < 100) {
          console.warn(`[MergeWorker] Chunk too small, skipping: ${chunk.s3Key}`);
          continue;
        }

        const localPath = path.join(tmpDir, `chunk_${String(chunk.chunkIndex).padStart(3, '0')}.webm`);
        fs.writeFileSync(localPath, buffer);
        downloadedPaths.push(localPath);
      } catch (err) {
        console.warn(`[MergeWorker] Failed to download chunk ${chunk.s3Key}:`, err);
        // Continue — partial merge is better than total failure
      }
    }

    if (downloadedPaths.length === 0) throw new Error('All chunks failed to download');

    // 3. Build FFmpeg filelist.txt
    const filelistPath = path.join(tmpDir, 'filelist.txt');
    const filelistContent = downloadedPaths
      .map((p) => `file '${p}'`)
      .join('\n');
    fs.writeFileSync(filelistPath, filelistContent);

    // 4. Run FFmpeg concat
    const outputPath = path.join(tmpDir, 'merged.webm');
    const cmd = `ffmpeg -f concat -safe 0 -i "${filelistPath}" -c copy "${outputPath}" -y 2>&1`;
    console.log(`[MergeWorker] Running FFmpeg: ${cmd}`);
    execSync(cmd, { timeout: 120_000 });

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 100) {
      throw new Error('FFmpeg produced empty output');
    }

    // 5. Upload merged file to S3
    const mergedKey = `interviews/${interviewId}/${questionId}/merged.webm`;
    const mergedBuffer = fs.readFileSync(outputPath);

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: mergedKey,
        Body: mergedBuffer,
        ContentType: 'audio/webm',
      })
    );

    // 6. Update DB — set mergedKey + status
    await AiInterview.updateOne(
      { _id: interviewId, 'responses.questionId': questionId },
      {
        $set: {
          'responses.$.mergedKey': mergedKey,
          'responses.$.processingStatus': 'transcribing',
        },
      }
    );

    // 7. Push to transcription queue
    const transcribePayload: TranscribeJobPayload = { interviewId, questionId, mergedKey };
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: TRANSCRIBE_QUEUE,
        MessageBody: JSON.stringify(transcribePayload),
        MessageGroupId: interviewId,
        MessageDeduplicationId: `${interviewId}-${questionId}-transcribe`,
      })
    );

    // 8. Delete from merge queue
    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: process.env.SQS_AUDIO_MERGE_QUEUE_URL!,
        ReceiptHandle: receiptHandle,
      })
    );

    console.log(`[MergeWorker] ✅ Done: ${mergedKey}`);
  } catch (err) {
    console.error(`[MergeWorker] ❌ Failed:`, err);
    // Mark as failed in DB
    await AiInterview.updateOne(
      { _id: interviewId, 'responses.questionId': questionId },
      { $set: { 'responses.$.processingStatus': 'failed' } }
    );
    throw err; // Let SQS retry (up to 3x before DLQ)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
