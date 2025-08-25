import { envParseString } from '@skyra/env-utilities';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	EmbedBuilder,
	type ColorResolvable,
	type Message,
	type MessageActionRowComponentBuilder
} from 'discord.js';
import { ModmailApprovalRequestModel } from './db/models/ModmailApprovalRequest';
import { getGuild } from './utils';

/**
 * Creates (or reuses) an approval request for a modmail closure message and posts interactive controls.
 * idempotent: if a request already exists for this closureMessageId, no duplicate DB record is made and no second message is sent.
 */
export async function seekApproval(message: Message, mainContributorId?: string) {
	const guild = await getGuild(envParseString('MainServer_ID'));
	if (!guild) throw new Error('Guild not found');

	const approvalChannelId = envParseString('MainServer_ApprovalChannelID');
	const approvalChannel = await guild.channels.fetch(approvalChannelId);
	if (!approvalChannel || approvalChannel.type !== ChannelType.GuildText) {
		throw new Error(`Approval channel ${approvalChannelId} not found or is not a text channel.`);
	}

	// Check for existing request
	const existing = await ModmailApprovalRequestModel.findOne({ closureMessageId: message.id }).lean();
	if (existing) return; // Already have an approval request; do not spam channel

	const requestId = Math.random().toString(36).slice(2, 10);
	await ModmailApprovalRequestModel.create({ requestId, closureMessageId: message.id, guildId: guild.id, mainContributorId });

	const messageUrl = `https://discord.com/channels/${message.guild?.id ?? '@me'}/${message.channel.id}/${message.id}`;
	const embed = generateRequestEmbed(requestId, messageUrl, `<@${mainContributorId}>`, mainContributorId ?? 'Unknown', mainContributorId);

	const buttons = generateRequestButtons(requestId, messageUrl);
	const actionRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().setComponents(buttons);

	await approvalChannel.send({ embeds: [embed], components: [actionRow] });
}

export function generateRequestButtons(requestId: string, messageUrl: string, disabled = false) {
	const approveButton = new ButtonBuilder()
		.setCustomId(`modmail:approve:${requestId}`)
		.setLabel('Approve')
		.setStyle(ButtonStyle.Success)
		.setDisabled(disabled);
	const denyButton = new ButtonBuilder()
		.setCustomId(`modmail:deny:${requestId}`)
		.setLabel('Deny')
		.setStyle(ButtonStyle.Danger)
		.setDisabled(disabled);
	const changeButton = new ButtonBuilder()
		.setCustomId(`modmail:change:${requestId}`)
		.setLabel('Change Contributor')
		.setStyle(ButtonStyle.Secondary)
		.setDisabled(disabled);
	const viewButton = new ButtonBuilder().setLabel('View Message').setStyle(ButtonStyle.Link).setURL(messageUrl);

	return [approveButton, denyButton, changeButton, viewButton];
}

export function generateRequestEmbed(
	requestId: string,
	messageUrl: string,
	closedByTag: string,
	closedById: string,
	mainContributorId?: string,
	message: string = 'Use the buttons below to approve or deny this closure.',
	color: ColorResolvable = '#1c1c1c'
) {
	const contributorLine = mainContributorId ? `\n**Main Contributor:** <@${mainContributorId}> (${mainContributorId})` : '';

	return new EmbedBuilder()
		.setTitle('Modmail Closure Approval Needed')
		.setDescription(
			`**Request ID:** ${requestId}\n**Closure Message:** [Link](${messageUrl})\n**Closed By (Message Author):** ${closedByTag} (${closedById})${contributorLine}`
		)
		.setFooter({ text: message })
		.setColor(color)
		.setTimestamp();
}
