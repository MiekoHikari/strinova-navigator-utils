import { Schema, model, type Document } from 'mongoose';

export type ModerationActionType = 'BAN' | 'UNBAN' | 'WARN' | 'MUTE' | 'KICK' | 'UPDATE';

export interface ModerationCaseAction {
	guildId: string;
	channelId: string;
	messageId: string; // Discord message id
	caseId: string; // The alphanumeric case identifier inside backticks
	action: ModerationActionType;
	performedByUsername?: string; // Username string captured from footer (best-effort)
	performedAt: Date; // When action occurred (embed timestamp or message timestamp)
	rawEmbed?: unknown; // Raw embed object for reference/debug
	createdAt?: Date;
	updatedAt?: Date;
}

export interface ModerationCaseActionDocument extends ModerationCaseAction, Document {}

const ModerationCaseActionSchema = new Schema<ModerationCaseActionDocument>(
	{
		guildId: { type: String, index: true, required: true },
		channelId: { type: String, index: true, required: true },
		messageId: { type: String, unique: true, required: true },
		caseId: { type: String, index: true, required: true },
		action: { type: String, enum: ['BAN', 'UNBAN', 'WARN', 'MUTE', 'KICK', 'UPDATE'], required: true },
		performedByUsername: { type: String },
		performedAt: { type: Date, index: true, required: true },
		rawEmbed: { type: Schema.Types.Mixed }
	},
	{ timestamps: true }
);

ModerationCaseActionSchema.index({ guildId: 1, caseId: 1, performedAt: -1 });

export const ModerationCaseActionModel = model<ModerationCaseActionDocument>('ModerationCaseAction', ModerationCaseActionSchema);
