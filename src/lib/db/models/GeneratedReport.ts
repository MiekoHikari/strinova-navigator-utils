import { Schema, model, type Document } from 'mongoose';

export type GeneratedReportType = 'WEEKLY' | 'MONTHLY';

export interface GeneratedReport {
	guildId: string;
	type: GeneratedReportType;
	year: number; // ISO year for weekly, calendar year for monthly
	week?: number; // present when type = WEEKLY
	month?: number; // 1-12 when type = MONTHLY (calendar month)
	channelId: string;
	messageId: string; // message containing the report
	createdAt?: Date;
	updatedAt?: Date;
}

export interface GeneratedReportDocument extends GeneratedReport, Document {}

const GeneratedReportSchema = new Schema<GeneratedReportDocument>(
	{
		guildId: { type: String, required: true, index: true },
		type: { type: String, enum: ['WEEKLY', 'MONTHLY'], required: true, index: true },
		year: { type: Number, required: true, index: true },
		week: { type: Number, required: false, index: true },
		month: { type: Number, required: false, index: true },
		channelId: { type: String, required: true },
		messageId: { type: String, required: true }
	},
	{ timestamps: true }
);

GeneratedReportSchema.index({ guildId: 1, type: 1, year: 1, week: 1 }, { unique: true, partialFilterExpression: { type: 'WEEKLY' } });
GeneratedReportSchema.index({ guildId: 1, type: 1, year: 1, month: 1 }, { unique: true, partialFilterExpression: { type: 'MONTHLY' } });

export const GeneratedReportModel = model<GeneratedReportDocument>('GeneratedReport', GeneratedReportSchema);
