import type { Embed } from 'discord.js';
import type { ModerationActionType } from '../db/models/ModerationCaseAction';

export interface ParsedCaseAction {
	caseId: string;
	action: ModerationActionType;
	performedByUsername?: string;
	performedAt: Date;
}

const TITLE_REGEX = /^(?<actionWord>Case|Ban|Unban|Warn|Mute|Kick)\s+`(?<caseId>[A-Za-z0-9]+)`(?:\s+updated)?$/i;

export function parseModerationEmbed(embed: Embed): ParsedCaseAction | null {
	if (!embed.title) return null;
	const match = embed.title.match(TITLE_REGEX);
	if (!match || !match.groups) return null;

	const rawAction = match.groups.actionWord.toLowerCase();
	let action: ModerationActionType;
	switch (rawAction) {
		case 'ban':
			action = 'BAN';
			break;
		case 'unban':
			action = 'UNBAN';
			break;
		case 'warn':
			action = 'WARN';
			break;
		case 'mute':
			action = 'MUTE';
			break;
		case 'kick':
			action = 'KICK';
			break;
		case 'case':
		default:
			action = 'UPDATE';
			break;
	}

	const caseId = match.groups.caseId;

	// Attempt to derive username from footer text (best-effort)
	// Common footer might just contain the username; store full footer text if unsure.
	const footerText = embed.footer?.text?.trim();
	let performedByUsername: string | undefined = footerText || undefined;
	if (footerText) {
		// If footer text has formats like "by Username" or "Username • ...", attempt simple extraction.
		const byMatch = footerText.match(/by\s+(.+)/i);
		if (byMatch) performedByUsername = byMatch[1].trim();
	}

	const performedAt = embed.timestamp ? new Date(embed.timestamp) : new Date();

	return { caseId, action, performedByUsername, performedAt };
}
