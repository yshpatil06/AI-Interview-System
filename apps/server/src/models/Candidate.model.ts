import mongoose, { Schema, Document, Model } from 'mongoose';
import type { ICandidate, IChunk } from '../../../packages/shared-types';

// ── Candidate Model ──────────────────────────────────
export type CandidateDocument = ICandidate & Document;

const CandidateSchema = new Schema<CandidateDocument>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    resumeUrl: { type: String, default: '' },
    linkedinUrl: { type: String, default: '' },
    interviews: [{ type: Schema.Types.ObjectId, ref: 'AiInterview' }],
  },
  { timestamps: true }
);

CandidateSchema.index({ email: 1 });

export const Candidate: Model<CandidateDocument> =
  mongoose.models.Candidate ||
  mongoose.model<CandidateDocument>('Candidate', CandidateSchema);

// ── Chunk Model ──────────────────────────────────────
export type ChunkDocument = IChunk & Document;

const ChunkSchema = new Schema<ChunkDocument>(
  {
    interviewId: { type: Schema.Types.ObjectId, ref: 'AiInterview', required: true },
    questionId: { type: String, required: true },
    chunkIndex: { type: Number, required: true },
    s3Key: { type: String, required: true, unique: true },
    size: { type: Number, default: 0 },
    checksum: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now },
    isCorrupted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ChunkSchema.index({ interviewId: 1, questionId: 1, chunkIndex: 1 });
ChunkSchema.index({ s3Key: 1 }, { unique: true });

export const Chunk: Model<ChunkDocument> =
  mongoose.models.Chunk ||
  mongoose.model<ChunkDocument>('Chunk', ChunkSchema);
