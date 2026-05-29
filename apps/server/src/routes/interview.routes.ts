import { Router, Request, Response } from 'express';
import { AiInterview } from '../models/AiInterview.model';
import { Candidate } from '../models/Candidate.model';
import OpenAI from 'openai';
import { uploadChunk, finalizeQuestion } from '../services/chunk.service';
import multer from 'multer';

const router = Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── POST /api/interview/create ────────────────────────────────
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { candidateId, recruiterId, jobId, questions } = req.body;

    // Pre-generate TTS audio for each question
    const questionsWithAudio = await Promise.all(
      questions.map(async (q: { text: string; order: number; maxDuration?: number }, i: number) => {
        const questionId = `q_${Date.now()}_${i}`;
        let audioUrl = '';

        try {
          const ttsRes = await openai.audio.speech.create({
            model: 'tts-1',
            voice: 'nova',
            input: q.text,
            response_format: 'mp3',
          });
          const buffer = Buffer.from(await ttsRes.arrayBuffer());
          // Upload TTS to S3
          const { uploadChunk: _u, ...rest } = await import('../services/chunk.service');
          // Store in S3 under tts/ prefix
          const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
          const s3 = new S3Client({ region: process.env.AWS_REGION });
          const key = `tts/${questionId}.mp3`;
          await s3.send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME!,
            Key: key,
            Body: buffer,
            ContentType: 'audio/mpeg',
          }));
          audioUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
        } catch (err) {
          console.warn(`[Interview] TTS failed for Q${i}:`, err);
        }

        return { questionId, text: q.text, audioUrl, order: q.order ?? i, maxDuration: q.maxDuration ?? 180 };
      })
    );

    const interview = await AiInterview.create({
      candidateId,
      recruiterId,
      jobId,
      status: 'pending',
      questions: questionsWithAudio,
      responses: questionsWithAudio.map((q) => ({
        questionId: q.questionId,
        chunkKeys: [],
        mergedKey: '',
        transcript: '',
        aiScore: 0,
        aiFeedback: '',
        processingStatus: 'pending',
      })),
    });

    await Candidate.findByIdAndUpdate(candidateId, {
      $push: { interviews: interview._id },
    });

    res.status(201).json({ success: true, interviewId: interview._id, questions: questionsWithAudio });
  } catch (err: any) {
    console.error('[Interview] create error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/interview/:id ─────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const interview = await AiInterview.findById(req.params.id)
      .populate('candidateId', 'name email resumeUrl')
      .lean();
    if (!interview) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, interview });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/interview/:id/start ─────────────────────────────
router.post('/:id/start', async (req: Request, res: Response) => {
  try {
    const interview = await AiInterview.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          status: 'in_progress',
          'session_data.startedAt': new Date(),
          'session_data.lastActiveAt': new Date(),
        },
      },
      { new: true }
    );
    if (!interview) return res.status(404).json({ success: false });
    res.json({ success: true, status: interview.status });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/interview/:id/complete ──────────────────────────
router.post('/:id/complete', async (req: Request, res: Response) => {
  try {
    const interview = await AiInterview.findByIdAndUpdate(
      req.params.id,
      { $set: { status: 'processing' } },
      { new: true }
    );
    if (!interview) return res.status(404).json({ success: false });

    // Finalize any un-finalized questions
    for (const response of interview.responses) {
      if (response.processingStatus === 'pending' && response.chunkKeys.length > 0) {
        await finalizeQuestion({ interviewId: req.params.id, questionId: response.questionId });
      }
    }

    res.json({ success: true, message: 'Processing started' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/chunk/upload ────────────────────────────────────
router.post('/chunk/upload', upload.single('audioBlob'), async (req: Request, res: Response) => {
  try {
    const { interviewId, questionId, chunkIndex } = req.body;
    const buffer = req.file?.buffer;

    if (!buffer) return res.status(400).json({ success: false, message: 'No audio data' });
    if (!interviewId || !questionId || chunkIndex === undefined) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    const result = await uploadChunk({
      interviewId,
      questionId,
      chunkIndex: parseInt(chunkIndex),
      buffer,
      mimeType: req.file?.mimetype,
    });

    res.json(result);
  } catch (err: any) {
    console.error('[Chunk] upload error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/chunk/finalize ──────────────────────────────────
router.post('/chunk/finalize', async (req: Request, res: Response) => {
  try {
    const { interviewId, questionId } = req.body;
    await finalizeQuestion({ interviewId, questionId });
    res.json({ success: true, message: 'Merge job queued' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/recruiter/interviews ─────────────────────────────
router.get('/recruiter/interviews', async (req: Request, res: Response) => {
  try {
    const { status, minScore, maxScore, recommendation, page = '1', limit = '20' } = req.query;
    const filter: Record<string, any> = {};
    if (status) filter.status = status;
    if (recommendation) filter['evaluation.recommendation'] = recommendation;
    if (minScore || maxScore) {
      filter['evaluation.overallScore'] = {};
      if (minScore) filter['evaluation.overallScore'].$gte = parseInt(minScore as string);
      if (maxScore) filter['evaluation.overallScore'].$lte = parseInt(maxScore as string);
    }

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const [interviews, total] = await Promise.all([
      AiInterview.find(filter)
        .populate('candidateId', 'name email resumeUrl')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit as string))
        .lean(),
      AiInterview.countDocuments(filter),
    ]);

    res.json({ success: true, interviews, total, page: parseInt(page as string), pages: Math.ceil(total / parseInt(limit as string)) });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/recruiter/interview/:id ─────────────────────────
router.get('/recruiter/interview/:id', async (req: Request, res: Response) => {
  try {
    const interview = await AiInterview.findById(req.params.id)
      .populate('candidateId', 'name email resumeUrl linkedinUrl')
      .populate('jobId', 'title description')
      .lean();
    if (!interview) return res.status(404).json({ success: false });

    // Generate signed S3 URLs for video playback
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({ region: process.env.AWS_REGION });

    const responsesWithUrls = await Promise.all(
      interview.responses.map(async (r) => {
        let signedUrl = '';
        if (r.mergedKey) {
          try {
            signedUrl = await getSignedUrl(
              s3,
              new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME!, Key: r.mergedKey }),
              { expiresIn: 3600 }
            );
          } catch {}
        }
        return { ...r, signedUrl };
      })
    );

    res.json({ success: true, interview: { ...interview, responses: responsesWithUrls } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
