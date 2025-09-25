import { Schema, model, type Document } from 'mongoose';

// Report categories supported by the flow (user free-form input will be validated against these)
export const PLAYER_REPORT_CATEGORIES = [
  'WIN_TRADING',
  'BOOSTING',
  'SABOTAGE',
  'DISRUPTIVE_BEHAVIOR',
  'HACKING',
  'INAPPROPRIATE_MESSAGES'
] as const;

export type PlayerReportCategory = (typeof PLAYER_REPORT_CATEGORIES)[number];

export type PlayerReportStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'CANCELLED' | 'EXPIRED';

export interface PlayerReport {
  guildId: string; // Discord guild where report originated
  reporterId: string; // Discord user ID of the reporter
  // At least one of the below two should eventually be provided before submission
  reportedPlayerId?: string; // In-game player identifier (numeric / string)
  reportedNickname?: string; // In-game nickname / display name
  categories?: PlayerReportCategory[]; // Present once details modal submitted
  matchId?: string; // Optional match identifier (required only for certain categories)
  summary?: string; // Free-form summary / context provided by reporter
  forumChannelId?: string; // Parent forum channel where the evidence thread was created
  threadId?: string; // Created thread ID (set on finalization)
  initialThreadMessageId?: string; // First message ID inside the created thread
  status: PlayerReportStatus; // Lifecycle state
  expiresAt?: Date; // TTL target for in-progress sessions (removed if submitted/cancelled)
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PlayerReportDocument extends PlayerReport, Document {}

const PlayerReportSchema = new Schema<PlayerReportDocument>(
  {
    guildId: { type: String, required: true, index: true },
    reporterId: { type: String, required: true, index: true },
    reportedPlayerId: { type: String, required: false, index: true },
    reportedNickname: { type: String, required: false, index: true },
    categories: {
      type: [String],
      enum: PLAYER_REPORT_CATEGORIES,
      required: false,
      default: undefined
    },
    matchId: { type: String, required: false },
    summary: { type: String, required: false },
    forumChannelId: { type: String, required: false },
    threadId: { type: String, required: false, index: true },
    initialThreadMessageId: { type: String, required: false },
    status: { type: String, enum: ['IN_PROGRESS', 'SUBMITTED', 'CANCELLED', 'EXPIRED'], required: true, index: true },
    expiresAt: { type: Date, required: false }
  },
  { timestamps: true }
);

// One active (non-expired) in-progress session per reporter per guild.
PlayerReportSchema.index(
  { guildId: 1, reporterId: 1 },
  { unique: true, partialFilterExpression: { status: 'IN_PROGRESS' } }
);

// Fast lookup for previously submitted reports by reported player ID.
PlayerReportSchema.index(
  { guildId: 1, reportedPlayerId: 1, status: 1 },
  { partialFilterExpression: { status: 'SUBMITTED' } }
);

// Fast lookup for previously submitted reports by nickname (fallback when no player ID).
PlayerReportSchema.index(
  { guildId: 1, reportedNickname: 1, status: 1 },
  { partialFilterExpression: { status: 'SUBMITTED' } }
);

// TTL index for expiring abandoned sessions (only documents that have expiresAt set get removed).
// We only set expiresAt while status === 'IN_PROGRESS'; once finalized we unset it so they persist.
PlayerReportSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PlayerReportModel = model<PlayerReportDocument>('PlayerReport', PlayerReportSchema);
