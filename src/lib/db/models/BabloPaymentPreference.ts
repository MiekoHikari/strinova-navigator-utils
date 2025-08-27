import { Schema, model, type Document } from 'mongoose';

export interface BabloPaymentPreference {
	guildId: string;
	userId: string;
	targetUid: string; // External UID for bablo payments
	optedIn: boolean; // true = include in payout runs
	optedInAt?: Date;
	optedOutAt?: Date;
	createdAt?: Date;
	updatedAt?: Date;
}

export interface BabloPaymentPreferenceDocument extends BabloPaymentPreference, Document {}

const BabloPaymentPreferenceSchema = new Schema<BabloPaymentPreferenceDocument>(
	{
		guildId: { type: String, required: true, index: true },
		userId: { type: String, required: true, index: true },
		targetUid: { type: String, required: true },
		optedIn: { type: Boolean, required: true, default: true },
		optedInAt: { type: Date },
		optedOutAt: { type: Date }
	},
	{ timestamps: true }
);

BabloPaymentPreferenceSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const BabloPaymentPreferenceModel = model<BabloPaymentPreferenceDocument>('BabloPaymentPreference', BabloPaymentPreferenceSchema);
