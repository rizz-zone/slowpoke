import { SUPPORT_SERVER_LINK } from '@/constants'
import { entitledServer, serverIncidentMessage } from '@/db/schema'
import { ButtonInteractionIntent } from '@/types/ButtonInteractionIntent'
import {
	ActionRowBuilder,
	ButtonBuilder,
	TextDisplayBuilder
} from '@discordjs/builders'
import {
	ButtonStyle,
	ChannelType,
	InteractionResponseType,
	MessageFlags,
	Routes,
	type APIInteractionResponse,
	type APIMessageComponentButtonInteraction
} from 'discord-api-types/v10'
import type {
	RESTGetAPIGuildChannelsResult,
	RESTPatchAPIChannelMessageJSONBody
} from 'discord-api-types/rest/v10'
import { REST } from 'discord.js'
import { eq } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'

export async function deregisterServerHandler({
	env,
	ctx,
	db,
	interaction,
	guildId
}: {
	env: Env
	ctx: ExecutionContext
	db: DrizzleD1Database<Record<string, never>>
	interaction: APIMessageComponentButtonInteraction
	guildId: string
}): Promise<APIInteractionResponse> {
	if (interaction.guild_id !== guildId)
		return buildEphemeralResponse('That button is not for this server.')

	const existingServer = await db
		.select()
		.from(entitledServer)
		.where(eq(entitledServer.id, guildId))
		.get()

	if (!hasActiveRegistration(existingServer))
		return buildEphemeralResponse(
			'This server does not have an active registration to remove.'
		)

	ctx.waitUntil(
		finalizeDeregistration({ env, db, interaction, guildId, existingServer })
	)

	return {
		type: InteractionResponseType.DeferredMessageUpdate
	}
}

async function finalizeDeregistration({
	env,
	db,
	interaction,
	guildId,
	existingServer
}: {
	env: Env
	db: DrizzleD1Database<Record<string, never>>
	interaction: APIMessageComponentButtonInteraction
	guildId: string
	existingServer: NonNullable<typeof entitledServer.$inferSelect>
}) {
	const rest = new REST().setToken(env.DISCORD_BOT_TOKEN)
	const issues: string[] = []

	for (const channelId of new Set(
		[
			existingServer.statusIndicatorChannelId,
			existingServer.urlChannelId,
			existingServer.incidentsChannelId
		].filter((item): item is string => Boolean(item))
	)) {
		try {
			await rest.delete(Routes.channel(channelId))
		} catch (error) {
			console.error(error)
			issues.push(`Couldn't delete <#${channelId}>.`)
		}
	}

	if (existingServer.categoryId)
		try {
			const shouldDeleteCategory = await categoryOnlyHasTrackedChannels({
				rest,
				guildId,
				categoryId: existingServer.categoryId
			})

			if (shouldDeleteCategory)
				await rest.delete(Routes.channel(existingServer.categoryId))
		} catch (error) {
			console.error(error)
			issues.push(`Couldn't delete category <#${existingServer.categoryId}>.`)
		}

	try {
		await db
			.update(entitledServer)
			.set({
				domain: null,
				categoryId: null,
				incidentsChannelId: null,
				statusIndicatorChannelId: null,
				urlChannelId: null,
				lastOverallState: null,
				lastSyncedAt: null,
				lastSyncError: null
			})
			.where(eq(entitledServer.id, guildId))
	} catch (error) {
		console.error(error)
		return await editDeregisterMessage({
			rest,
			interaction,
			components: [
				new TextDisplayBuilder()
					.setContent('# Could not deregister server')
					.toJSON(),
				new TextDisplayBuilder()
					.setContent(
						"An error occurred while clearing this server's registration. Nothing was removed from the database."
					)
					.toJSON(),
				new ActionRowBuilder<ButtonBuilder>()
					.addComponents(
						new ButtonBuilder()
							.setLabel('Deregister server')
							.setCustomId(
								`${ButtonInteractionIntent.DeregisterServer}:${guildId}`
							)
							.setStyle(ButtonStyle.Danger)
					)
					.toJSON(),
				new ActionRowBuilder<ButtonBuilder>()
					.addComponents(
						new ButtonBuilder()
							.setURL(SUPPORT_SERVER_LINK)
							.setLabel('Get support')
							.setStyle(ButtonStyle.Link)
					)
					.toJSON()
			]
		})
	}

	try {
		await db
			.delete(serverIncidentMessage)
			.where(eq(serverIncidentMessage.guildId, guildId))
	} catch (error) {
		console.error(error)
		issues.push("Couldn't clear tracked incident messages from the database.")
	}

	await editDeregisterMessage({
		rest,
		interaction,
		components: [
			new TextDisplayBuilder().setContent('# Server deregistered').toJSON(),
			new TextDisplayBuilder()
				.setContent(
					'The tracked channels and endpoint have been removed. Server Access is still assigned to this server, so you can run `/register_server` again whenever you want to set it back up.'
				)
				.toJSON(),
			...(issues.length
				? [
						new TextDisplayBuilder()
							.setContent(issues.map((issue) => `- ${issue}`).join('\n'))
							.toJSON(),
						new ActionRowBuilder<ButtonBuilder>()
							.addComponents(
								new ButtonBuilder()
									.setURL(SUPPORT_SERVER_LINK)
									.setLabel('Get support')
									.setStyle(ButtonStyle.Link)
							)
							.toJSON()
					]
				: [])
		]
	})
}

async function editDeregisterMessage({
	rest,
	interaction,
	components
}: {
	rest: REST
	interaction: APIMessageComponentButtonInteraction
	components: RESTPatchAPIChannelMessageJSONBody['components']
}) {
	try {
		await rest.patch(
			Routes.channelMessage(interaction.channel_id, interaction.message.id),
			{
				body: {
					flags: MessageFlags.IsComponentsV2,
					components
				} satisfies RESTPatchAPIChannelMessageJSONBody
			}
		)
	} catch (error) {
		console.error(error)
	}
}

function buildEphemeralResponse(content: string): APIInteractionResponse {
	return {
		type: InteractionResponseType.ChannelMessageWithSource,
		data: {
			flags: MessageFlags.Ephemeral,
			content
		}
	}
}

function hasActiveRegistration(
	server: typeof entitledServer.$inferSelect | undefined
): server is NonNullable<typeof entitledServer.$inferSelect> {
	return Boolean(
		server &&
		(server.domain ||
			server.categoryId ||
			server.incidentsChannelId ||
			server.statusIndicatorChannelId ||
			server.urlChannelId)
	)
}

async function categoryOnlyHasTrackedChannels({
	rest,
	guildId,
	categoryId
}: {
	rest: REST
	guildId: string
	categoryId: string
}) {
	const channels = (await rest.get(
		Routes.guildChannels(guildId)
	)) as RESTGetAPIGuildChannelsResult
	const category = channels.find((channel) => channel.id === categoryId)
	if (!category || category.type !== ChannelType.GuildCategory) return false

	return !channels.some((channel) => channel.parent_id === categoryId)
}
