import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { readdirSync } from 'fs';
import path from 'path';
import { pluginCommand } from '../../_core/sapphire';
import { SlashCommandBuilder, SlashCommandSubcommandGroupBuilder } from 'discord.js';

// Dynamically import all command files
function getCommandsByDirectory() {
	const result = new Map<string, pluginCommand[]>();

	// Get all subdirectories
	const directories = readdirSync(__dirname, { withFileTypes: true })
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => dirent.name);

	// For each directory, import all command files
	for (const dir of directories) {
		const dirPath = path.join(__dirname, dir);
		const commandFiles = readdirSync(dirPath, { withFileTypes: true })
			.filter((file) => file.isFile() && file.name.endsWith('.js') && file.name !== 'index.js')
			.map((file) => file.name);

		const commands = [];
		for (const file of commandFiles) {
			try {
				// Dynamic import for each command file
				const commandPath = path.join(dirPath, file);
				// Use require instead of import for synchronous loading
				const commandModule = require(commandPath);

				// Commands are exported as default in TypeScript files
				const commandExport = commandModule.default;

				if (commandExport && commandExport.sapphire && commandExport.discord) {
					commands.push(commandExport);
				} else {
					console.log(`Command at ${commandPath} doesn't have required structure:`, commandExport);
				}
			} catch (error) {
				console.error(`Error loading command from ${path.join(dirPath, file)}:`, error);
			}
		}

		if (commands.length > 0) {
			result.set(dir, commands);
		} else {
			console.log(`No valid commands found in directory: ${dir}`);
		}
	}

	return result;
}

// Get all commands organized by directory
const commandGroups = getCommandsByDirectory();

// Create subcommand entries
const subcommandEntries = Array.from(commandGroups.entries()).map(([groupName, commands]) => ({
	name: groupName,
	type: 'group' as const,
	entries: commands.map((cmd) => cmd.sapphire)
}));

@ApplyOptions<Subcommand.Options>({
	name: 'stardust',
	description: 'Stardust Program management and utilities',
	subcommands: subcommandEntries,
	preconditions: ['leadModsOnly', 'staffOnly']
})
export class UserCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		// Create a new SlashCommandBuilder
		const commandBuilder = new SlashCommandBuilder().setName(this.name).setDescription(this.description);

		// Add all subcommand groups and their commands
		for (const [groupName, commands] of commandGroups.entries()) {
			const groupBuilder = new SlashCommandSubcommandGroupBuilder()
				.setName(groupName)
				.setDescription(`${groupName.charAt(0).toUpperCase() + groupName.slice(1)} commands`);

			// Add each command in the group
			for (const cmd of commands) {
				groupBuilder.addSubcommand(cmd.discord);
			}

			// Add the group to the main command
			commandBuilder.addSubcommandGroup(groupBuilder);
		}

		// Register the command with Sapphire
		registry.registerChatInputCommand(commandBuilder);
	}
}
