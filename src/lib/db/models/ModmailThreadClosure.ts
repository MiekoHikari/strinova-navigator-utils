import { Schema, model, type Document } from 'mongoose';

export interface ModmailThreadClosure {
	guildId: string;
	channelId: string;
	messageId: string; // Discord message id
	userId: string; // Target user id for modmail thread
	username?: string; // Username captured from title
	closedByUsername?: string; // Moderator username from footer (parsed)
	closedByUserId?: string; // Moderator user id parsed from footer
	closedByFooterRaw?: string; // Raw footer text (even if parser failed)
	closedAt: Date; // When thread closed (embed timestamp or message timestamp)
	messageLink: string; // Convenience link to the message
	rawEmbed?: unknown; // Raw embed json
	approved: boolean; // Whether closure has been manually approved for points
	approvedById?: string; // Moderator who approved awarding points
	approvedAt?: Date; // Timestamp of approval
	pointsAwardedToId?: string; // The moderator id who ultimately received points (may be main contributor fallback)
	createdAt?: Date;
	updatedAt?: Date;
}

export interface ModmailThreadClosureDocument extends ModmailThreadClosure, Document {}

const ModmailThreadClosureSchema = new Schema<ModmailThreadClosureDocument>(
	{
		guildId: { type: String, index: true, required: true },
		channelId: { type: String, index: true, required: true },
		messageId: { type: String, unique: true, required: true },
		userId: { type: String, index: true, required: true },
		username: { type: String },
		closedByUsername: { type: String },
		closedByUserId: { type: String },
		closedByFooterRaw: { type: String },
		closedAt: { type: Date, index: true, required: true },
		messageLink: { type: String, required: true },
		rawEmbed: { type: Schema.Types.Mixed },
		approved: { type: Boolean, default: false, index: true },
		approvedById: { type: String },
		approvedAt: { type: Date },
		pointsAwardedToId: { type: String }
	},
	{ timestamps: true }
);

ModmailThreadClosureSchema.index({ guildId: 1, userId: 1, closedAt: -1 });

export const ModmailThreadClosureModel = model<ModmailThreadClosureDocument>('ModmailThreadClosure', ModmailThreadClosureSchema);
