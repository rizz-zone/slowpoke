import {
	ChannelType,
	InteractionContextType,
	PermissionFlagsBits,
	SlashCommandBuilder,
	type RESTPostAPIChatInputApplicationCommandsJSONBody
} from 'discord.js'

export const commands = {
	ping: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('ARE WE ALIVE? ARE WE ALIVE?')
		.setContexts(InteractionContextType.Guild)
		.toJSON(),
	register_server: new SlashCommandBuilder()
		.setName('register_server')
		.setDescription("Set this server's status tracking up")
		.setDefaultMemberPermissions(
			PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageChannels
		)
		.addStringOption((option) =>
			option
				.setName('domain')
				.setDescription('The incident.io status page to monitor')
				.setRequired(true)
		)
		.addChannelOption((option) =>
			option
				.setName('category')
				.setDescription('The category to create status channels under')
				.setRequired(false)
				.addChannelTypes(ChannelType.GuildCategory)
		)
		.setContexts(InteractionContextType.Guild)
		.toJSON()
} satisfies { [key: string]: RESTPostAPIChatInputApplicationCommandsJSONBody }
