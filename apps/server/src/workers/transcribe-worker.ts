import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { createClient } from '@deepgram/sdk';
import OpenAI from 'openai';
import { Readable } from 'stream';
import { AiInterview } from '../models/AiInterview.model';
import type { TranscribeJobPayload, EvaluateJobPayload } from '../../../packages/shared-types';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const sqs = new SQSClient({ region: process.env.AWS_REGION });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY!);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const BUCKET = process.env.S3_BUCKET_NAME!;
const EVAL_QUEUE = process.env.SQS_EVALUATION_QUEUE_URL!;

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// ── WORKER 2: Transcription ─────────────────────────────────────
export async function processTranscribeJob(
  payload: TranscribeJobPayload,
  receiptHandle: string
): Promise<void> {
  const { interviewId, questionId, mergedKey } = payload;
  console.log(`[TranscribeWorker] Starting: ${interviewId}/${questionId}`);

  try {
    // 1. Download merged file
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: mergedKey }));
    const buffer = await streamToBuffer(obj.Body as Readable);

    // 2. Send to Deepgram Nova-2
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(buffer, {
      model: 'nova-2',
      smart_format: true,
      diarize: false,
      punctuate: true,
      language: 'en-IN',
    });

    if (error) throw new Error(`Deepgram error: ${error.message}`);

    const transcript =
      result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';

    console.log(`[TranscribeWorker] Transcript (${transcript.length} chars): ${transcript.slice(0, 80)}...`);

    // 3. Save transcript
    await AiInterview.updateOne(
      { _id: interviewId, 'responses.questionId': questionId },
      {
        $set: {
          'responses.$.transcript': transcript,
          'responses.$.processingStatus': 'evaluating',
        },
      }
    );

    // 4. Fetch question text + job description for evaluation
    const interview = await AiInterview.findById(interviewId).populate('jobId').lean();
    const question = interview?.questions.find((q) => q.questionId === questionId);
    const jobDescription = (interview?.jobId as any)?.description || 'Software Engineer';

    // 5. Push to evaluation queue
    const evalPayload: EvaluateJobPayload = {
      interviewId,
      questionId,
      transcript,
      questionText: question?.text || '',
      jobDescription,
    };
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: EVAL_QUEUE,
        MessageBody: JSON.stringify(evalPayload),
        MessageGroupId: interviewId,
        MessageDeduplicationId: `${interviewId}-${questionId}-evaluate`,
      })
    );

    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: process.env.SQS_TRANSCRIPTION_QUEUE_URL!,
        ReceiptHandle: receiptHandle,
      })
    );

    console.log(`[TranscribeWorker] ✅ Done: ${interviewId}/${questionId}`);
  } catch (err) {
    console.error(`[TranscribeWorker] ❌ Failed:`, err);
    await AiInterview.updateOne(
      { _id: interviewId, 'responses.questionId': questionId },
      { $set: { 'responses.$.processingStatus': 'failed' } }
    );
    throw err;
  }
}

// ── WORKER 3: GPT-4o Evaluation ────────────────────────────────
export async function processEvaluateJob(
  payload: EvaluateJobPayload,
  receiptHandle: string
): Promise<void> {
  const { interviewId, questionId, transcript, questionText, jobDescription } = payload;
  console.log(`[EvaluateWorker] Evaluating: ${interviewId}/${questionId}`);

  try {
    const prompt = `You are an expert technical interviewer evaluating a candidate's interview response.

JOB DESCRIPTION: ${jobDescription}

QUESTION ASKED: ${questionText}

CANDIDATE TRANSCRIPT: ${transcript}

Evaluate the response and return ONLY a JSON object (no markdown) with:
{
  "technicalScore": <0-100>,
  "communicationScore": <0-100>,
  "feedback": "<2-3 sentence feedback>",
  "keyStrengths": ["<strength1>", "<strength2>"],
  "improvementAreas": ["<area1>", "<area2>"]
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 500,
    });

    const raw = completion.choices[0].message.content || '{}';
    const result = JSON.parse(raw);
    const aiScore = Math.round((result.technicalScore + result.communicationScore) / 2);

    await AiInterview.updateOne(
      { _id: interviewId, 'responses.questionId': questionId },
      {
        $set: {
          'responses.$.aiScore': aiScore,
          'responses.$.aiFeedback': result.feedback || '',
          'responses.$.processingStatus': 'done',
        },
      }
    );

    // Check if ALL questions are done → generate overall evaluation
    const interview = await AiInterview.findById(interviewId);
    if (!interview) throw new Error('Interview not found');

    const allDone = interview.responses.every((r) => r.processingStatus === 'done');

    if (allDone) {
      await generateOverallEvaluation(interviewId);
    }

    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: process.env.SQS_EVALUATION_QUEUE_URL!,
        ReceiptHandle: receiptHandle,
      })
    );

    console.log(`[EvaluateWorker] ✅ Score: ${aiScore} for ${interviewId}/${questionId}`);
  } catch (err) {
    console.error(`[EvaluateWorker] ❌ Failed:`, err);
    throw err;
  }
}

async function generateOverallEvaluation(interviewId: string): Promise<void> {
  const interview = await AiInterview.findById(interviewId);
  if (!interview) return;

  const scores = interview.responses.map((r) => r.aiScore);
  const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  const transcripts = interview.responses
    .map((r, i) => `Q${i + 1}: ${interview.questions[i]?.text}\nA: ${r.transcript}`)
    .join('\n\n');

  const summaryPrompt = `Based on these interview responses, provide an overall evaluation:

${transcripts}

Return ONLY JSON:
{
  "overallScore": ${overallScore},
  "technicalScore": <0-100>,
  "communicationScore": <0-100>,
  "summary": "<3-4 sentence overall summary>",
  "recommendation": "<strong_yes|yes|maybe|no>"
}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: summaryPrompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 400,
  });

  const result = JSON.parse(completion.choices[0].message.content || '{}');

  await AiInterview.findByIdAndUpdate(interviewId, {
    $set: {
      status: 'completed',
      evaluation: {
        overallScore: result.overallScore || overallScore,
        technicalScore: result.technicalScore || 0,
        communicationScore: result.communicationScore || 0,
        summary: result.summary || '',
        recommendation: result.recommendation || 'maybe',
      },
    },
  });

  console.log(`[EvaluateWorker] ✅ Overall evaluation complete: ${interviewId}, score: ${overallScore}`);
}
