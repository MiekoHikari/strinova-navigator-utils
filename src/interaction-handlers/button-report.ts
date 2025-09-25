import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import type { ButtonInteraction } from 'discord.js';

@ApplyOptions<InteractionHandler.Options>({
	interactionHandlerType: InteractionHandlerTypes.Button
})
export class ButtonHandler extends InteractionHandler {
	public async run(interaction: ButtonInteraction, { action, args }: { action: string; args: string[] }) {
		console.log(`Button pressed with action: ${action} and args: ${args.join(', ')}`);

		return interaction.deferUpdate();
	}

	public override parse(interaction: ButtonInteraction) {
		const [command, action, ...args] = interaction.customId.split(':');
		if (command !== 'report') return this.none();

		return this.some({action, args});
	}
}
