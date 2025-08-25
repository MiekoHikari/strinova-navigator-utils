import type { Embed } from 'discord.js';

export interface ParsedModmailClosure {
	userId: string; // The user whose modmail thread this is
	username?: string; // Username displayed in title (before the parens)
	closedByUsername?: string; // Parsed moderator username if recognized
	closedById?: string; // Parsed moderator user ID if recognized
	closedAt: Date; // When the thread was closed (embed timestamp or message timestamp)
	rawFooter?: string; // Entire raw footer text (to retain even if not parsed)
}

const TITLE_REGEX = /^(?<username>.+?)\s*\(`(?<userId>\d+)`\)$/;

export function parseModmailFooter(footerText: string) {
	const reversedText = footerText.split('').reverse().join('');
	const reversedRegex = /\)(\d+)\( (\w+)/;

	const match = reversedRegex.exec(reversedText);
	if (!match) return null;

	const id = match[1].split('').reverse().join('').trim();
	const username = match[2].split('').reverse().join('').trim();

	return { id, username };
}

export function parseModmailEmbed(embed: Embed): ParsedModmailClosure | null {
	if (!embed.title) return null;

	const titleMatch = embed.title.match(TITLE_REGEX);
	if (!titleMatch || !titleMatch.groups) return null;

	const userId = titleMatch.groups.userId;
	const username = titleMatch.groups.username?.trim();

	let closedByUsername: string | undefined;
	let closedById: string | undefined;

	const footerText = embed.footer?.text?.trim();
	if (footerText) {
		const footerMatch = parseModmailFooter(footerText);
		closedByUsername = footerMatch?.username;
		closedById = footerMatch?.id;
	}

	const closedAt = embed.timestamp ? new Date(embed.timestamp) : new Date();

	return { userId, username, closedByUsername, closedById, closedAt, rawFooter: footerText };
}
