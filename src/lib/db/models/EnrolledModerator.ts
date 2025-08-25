import { Schema, model, type Document } from 'mongoose';

export interface EnrolledModerator {
	guildId: string;
	userId: string;
	enrolledAt: Date;
	enrolledById: string;
	active: boolean;
	deactivatedAt?: Date;
	deactivatedById?: string;
	createdAt?: Date;
	updatedAt?: Date;
}

export interface EnrolledModeratorDocument extends EnrolledModerator, Document {}

const EnrolledModeratorSchema = new Schema<EnrolledModeratorDocument>(
	{
		guildId: { type: String, required: true, index: true },
		userId: { type: String, required: true, index: true },
		enrolledAt: { type: Date, required: true },
		enrolledById: { type: String, required: true },
		active: { type: Boolean, required: true, default: true },
		deactivatedAt: { type: Date },
		deactivatedById: { type: String }
	},
	{ timestamps: true }
);

EnrolledModeratorSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const EnrolledModeratorModel = model<EnrolledModeratorDocument>('EnrolledModerator', EnrolledModeratorSchema);
