import { Schema, model, type Document } from 'mongoose';

export interface ModeratorTierStatus {
	guildId: string;
	userId: string;
	currentTier: number; // 0-3 (3 = default full payout)
	weeksInactive: number; // consecutive weeks with zero finalized points
	lastEvaluatedYear: number; // last year/week processed
	lastEvaluatedWeek: number;
	lastUpdatedAt?: Date;
	createdAt?: Date;
	updatedAt?: Date;
}

export interface ModeratorTierStatusDocument extends ModeratorTierStatus, Document {}

const ModeratorTierStatusSchema = new Schema<ModeratorTierStatusDocument>(
	{
		guildId: { type: String, required: true, index: true },
		userId: { type: String, required: true, index: true },
		currentTier: { type: Number, required: true, default: 3 },
		weeksInactive: { type: Number, required: true, default: 0 },
		lastEvaluatedYear: { type: Number, required: true },
		lastEvaluatedWeek: { type: Number, required: true }
	},
	{ timestamps: true }
);

ModeratorTierStatusSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const ModeratorTierStatusModel = model<ModeratorTierStatusDocument>('ModeratorTierStatus', ModeratorTierStatusSchema);
