import { join } from 'path';
import { ActivityWeightClass } from './db/models/ModeratorWeeklyPoints';

export const rootDir = join(__dirname, '..', '..');
export const srcDir = join(rootDir, 'src');

export const RandomLoadingMessage = ['Computing...', 'Thinking...', 'Cooking some food', 'Give me a moment', 'Loading...'];

// Weight class budgets (fractions of max possible)
export const WEIGHT_BUDGETS: Record<ActivityWeightClass, number> = {
	HIGH: 0.6, // up to 60%
	MEDIUM: 0.25, // up to 25%
	LOW: 0.15 // up to 15%
};

export const CATEGORY_CONFIG = {
	modChatMessages: { weightClass: 'MEDIUM' as ActivityWeightClass, pointsPerUnit: 1 },
	publicChatMessages: { weightClass: 'LOW' as ActivityWeightClass, pointsPerUnit: 0.5 },
	voiceChatMinutes: { weightClass: 'LOW' as ActivityWeightClass, pointsPerUnit: 0.25 },
	modActionsTaken: { weightClass: 'HIGH' as ActivityWeightClass, pointsPerUnit: 10 },
	casesHandled: { weightClass: 'HIGH' as ActivityWeightClass, pointsPerUnit: 20 }
};

// Tier payout mapping (public facing) - index by tier
export const TIER_PAYOUT = {
	0: 0,
	1: 600,
	2: 1200,
	3: 1800
} as const;
