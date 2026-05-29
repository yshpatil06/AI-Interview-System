import mongoose, { Schema, Document, Model } from 'mongoose';
import type { IAiInterview } from '../../../packages/shared-types';

export type AiInterviewDocument = IAiInterview & Document;

const QuestionSchema = new Schema({
  questionId: { type: String, required: true },
  text: { type: String, required: true },
  audioUrl: { type: String, default: '' },
  order: { type: Number, required: true },
  maxDuration: { type: Number, default: 180 },
}, { _id: false });

const ResponseSchema = new Schema({
  questionId: { type: String, required: true },
  chunkKeys: [{ type: String }],
  mergedKey: { type: String, default: '' },
  transcript: { type: String, default: '' },
  aiScore: { type: Number, default: 0 },
  aiFeedback: { type: String, default: '' },
  processingStatus: {
    type: String,
    enum: ['pending', 'merging', 'transcribing', 'evaluating', 'done', 'failed'],
    default: 'pending',
  },
}, { _id: false });

const FaceAbsenceSchema = new Schema({
  timestamp: { type: Date, required: true },
  duration: { type: Number, required: true },
}, { _id: false });

const ProctoringSchema = new Schema({
  tabSwitchCount: { type: Number, default: 0 },
  faceAbsenceEvents: [FaceAbsenceSchema],
  suspiciousScore: { type: Number, default: 0 },
  flags: [{ type: String }],
}, { _id: false });

const EvaluationSchema = new Schema({
  overallScore: { type: Number, default: 0 },
  technicalScore: { type: Number, default: 0 },
  communicationScore: { type: Number, default: 0 },
  summary: { type: String, default: '' },
  recommendation: {
    type: String,
    enum: ['strong_yes', 'yes', 'maybe', 'no'],
    default: 'maybe',
  },
}, { _id: false });

const SessionDataSchema = new Schema({
  currentQuestionIndex: { type: Number, default: 0 },
  startedAt: { type: Date },
  lastActiveAt: { type: Date },
  reconnectCount: { type: Number, default: 0 },
  timePerQuestion: [{ type: Number }],
}, { _id: false });

const AiInterviewSchema = new Schema<AiInterviewDocument>(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true },
    recruiterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending', 'hardware_check', 'in_progress', 'processing', 'completed', 'failed'],
      default: 'pending',
    },
    session_data: { type: SessionDataSchema, default: () => ({}) },
    questions: [QuestionSchema],
    responses: [ResponseSchema],
    proctoring: { type: ProctoringSchema, default: () => ({}) },
    evaluation: { type: EvaluationSchema, default: () => ({}) },
  },
  { timestamps: true }
);

// Auto-calculate suspiciousScore on save
AiInterviewSchema.pre('save', function (next) {
  const p = this.proctoring;
  if (p) {
    const tabScore = Math.min(p.tabSwitchCount * 15, 40);
    const faceScore = Math.min(p.faceAbsenceEvents.length * 10, 40);
    const flagScore = Math.min(p.flags.length * 5, 20);
    p.suspiciousScore = tabScore + faceScore + flagScore;
  }
  next();
});

AiInterviewSchema.index({ recruiterId: 1, createdAt: -1 });
AiInterviewSchema.index({ candidateId: 1 });
AiInterviewSchema.index({ status: 1 });

export const AiInterview: Model<AiInterviewDocument> =
  mongoose.models.AiInterview ||
  mongoose.model<AiInterviewDocument>('AiInterview', AiInterviewSchema);
