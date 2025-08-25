import { Schema, model, type Document } from 'mongoose';

export interface ModmailApprovalRequest {
	requestId: string; // Generated short id
	closureMessageId: string; // Links to ModmailThreadClosure.messageId
	guildId: string;
	mainContributorId?: string; // User who will receive points for this closure
	createdAt?: Date;
	expiresAt?: Date; // Optional expiration for automatic fallback handling
	resolved: boolean; // Whether handled (approved/denied/fallback)
	resolvedAt?: Date;
	resolution?: 'APPROVED' | 'DENIED' | 'FALLBACK';
	resolvedById?: string; // Moderator who resolved
	notes?: string; // Optional notes
}

export interface ModmailApprovalRequestDocument extends ModmailApprovalRequest, Document {}

const ModmailApprovalRequestSchema = new Schema<ModmailApprovalRequestDocument>(
	{
		requestId: { type: String, unique: true, required: true },
		closureMessageId: { type: String, index: true, required: true },
		guildId: { type: String, index: true, required: true },
		mainContributorId: { type: String },
		expiresAt: { type: Date, index: true },
		resolved: { type: Boolean, default: false, index: true },
		resolvedAt: { type: Date },
		resolution: { type: String, enum: ['APPROVED', 'DENIED', 'FALLBACK'] },
		resolvedById: { type: String },
		notes: { type: String }
	},
	{ timestamps: { createdAt: true, updatedAt: true } }
);

ModmailApprovalRequestSchema.index({ resolved: 1, expiresAt: 1 });

export const ModmailApprovalRequestModel = model<ModmailApprovalRequestDocument>('ModmailApprovalRequest', ModmailApprovalRequestSchema);
