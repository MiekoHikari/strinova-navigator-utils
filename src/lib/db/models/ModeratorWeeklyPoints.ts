import { Schema, model, type Document } from 'mongoose';

export type ActivityWeightClass = 'HIGH' | 'MEDIUM' | 'LOW';

export interface CategoryPointsDetail {
	category: string; // e.g. modChatMessages
	weightClass: ActivityWeightClass;
	rawAmount: number; // raw units (messages, minutes, actions, cases)
	rawPoints: number; // raw points before bracket scaling
	appliedPoints: number; // points after bracket scaling + caps that count toward final
	wastedPoints: number; // rawPoints - appliedPointsEquivalent (see compute logic)
	bracketBudget: number; // budget available for the weight class
}

export interface ModeratorWeeklyPoints {
	guildId: string;
	userId: string;
	week: number; // ISO-like week number (1-53) using util getWeekRange
	year: number;
	maxPossiblePoints: number; // dynamic: sum of rawPoints across all categories for the week
	totalRawPoints: number; // sum rawPoints across categories
	totalFinalizedPoints: number; // sum appliedPoints across categories (capped + scaled)
	totalWastedPoints: number; // sum wastedPoints across categories
	details: CategoryPointsDetail[]; // per category breakdown
	tierAfterWeek: number; // tier (0-3) after applying this week's update
	// --- Override / Manual adjustment fields ---
	overrideActive?: boolean; // when true, stardust award should use overrideFinalizedPoints instead of computed totalFinalizedPoints
	overrideFinalizedPoints?: number; // manually set finalized points (stardusts) for the week
	overrideRawPoints?: number; // optional manual raw points value (if staff wishes to display different baseline)
	overrideDetails?: CategoryPointsDetail[]; // optional manual breakdown
	overrideReason?: string; // free-form reason text
	overrideAppliedById?: string; // moderator who applied override
	overrideAppliedAt?: Date; // timestamp override applied
	createdAt?: Date;
	updatedAt?: Date;
}

export interface ModeratorWeeklyPointsDocument extends ModeratorWeeklyPoints, Document {}

const CategoryPointsDetailSchema = new Schema<CategoryPointsDetail>(
	{
		category: { type: String, required: true },
		weightClass: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW'], required: true },
		rawAmount: { type: Number, required: true },
		rawPoints: { type: Number, required: true },
		appliedPoints: { type: Number, required: true },
		wastedPoints: { type: Number, required: true },
		bracketBudget: { type: Number, required: true }
	},
	{ _id: false }
);

const ModeratorWeeklyPointsSchema = new Schema<ModeratorWeeklyPointsDocument>(
	{
		guildId: { type: String, index: true, required: true },
		userId: { type: String, index: true, required: true },
		week: { type: Number, index: true, required: true },
		year: { type: Number, index: true, required: true },
		maxPossiblePoints: { type: Number, required: true },
		totalRawPoints: { type: Number, required: true },
		totalFinalizedPoints: { type: Number, required: true },
		totalWastedPoints: { type: Number, required: true },
		details: { type: [CategoryPointsDetailSchema], required: true },
		tierAfterWeek: { type: Number, required: true },
		// Override fields (all optional)
		overrideActive: { type: Boolean, default: false },
		overrideFinalizedPoints: { type: Number },
		overrideRawPoints: { type: Number },
		overrideDetails: { type: [CategoryPointsDetailSchema] },
		overrideReason: { type: String },
		overrideAppliedById: { type: String },
		overrideAppliedAt: { type: Date }
	},
	{ timestamps: true }
);

ModeratorWeeklyPointsSchema.index({ guildId: 1, userId: 1, year: 1, week: 1 }, { unique: true });

export const ModeratorWeeklyPointsModel = model<ModeratorWeeklyPointsDocument>('ModeratorWeeklyPoints', ModeratorWeeklyPointsSchema);
