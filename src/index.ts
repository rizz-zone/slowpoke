import {
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ComponentType,
	InteractionResponseType,
	MessageFlags,
	InteractionType,
	type APIInteraction,
	type APIMessageComponentButtonInteraction
} from 'discord-api-types/v10'
import { completeRegistrationHandler } from '@/commands/handlers/complete_registration'
import { deregisterServerHandler } from '@/commands/handlers/deregister_server'
import { verifyKey } from 'discord-interactions'
import { REST, type APIInteractionResponse } from 'discord.js'
import { StatusCodes } from 'http-status-codes'
import type { commands } from '@/commands/defs'
import { PendingRegistration } from '@/durable/pending_registration'
import { ButtonInteractionIntent } from '@/types/ButtonInteractionIntent'
import { pingHandler } from './commands/handlers/ping'
import { drizzle } from 'drizzle-orm/d1'
import { registerServerHandler } from './commands/handlers/register_server'
import { isEntitled } from './one_billion_dollars/entitled'
import { syncAllRegisteredServers } from './status/sync'

function handleInteraction({
	env,
	ctx,
	interaction
}: {
	env: Env
	ctx: ExecutionContext
	interaction: APIInteraction
}): APIInteractionResponse | Promise<APIInteractionResponse> | undefined {
	const db = drizzle(env.GLOBAL_DB)

	switch (interaction.type) {
		case InteractionType.Ping:
			return { type: InteractionResponseType.Pong }
		case InteractionType.ApplicationCommand: {
			if (interaction.data.type !== ApplicationCommandType.ChatInput) return
			const name = interaction.data.name as keyof typeof commands
			return (() => {
				switch (name) {
					case 'ping':
						return pingHandler()
					case 'register_server': {
						const rest = new REST().setToken(env.DISCORD_BOT_TOKEN)

						const options = interaction.data.options
						const guildId = interaction.guild_id
						if (!(options && guildId)) return

						const domainOption = options.find(
							(item) =>
								item.name === 'domain' &&
								item.type === ApplicationCommandOptionType.String
						)
						if (
							!(
								domainOption &&
								'value' in domainOption &&
								typeof domainOption.value === 'string'
							)
						)
							return
						const domain = domainOption.value

						const categoryOption = options.find(
							(item) =>
								item.name === 'category' &&
								item.type === ApplicationCommandOptionType.Channel
						)
						const categoryId =
							categoryOption &&
							'value' in categoryOption &&
							typeof categoryOption.value === 'string'
								? categoryOption.value
								: undefined

						return registerServerHandler({
							env,
							ctx,
							db,
							domain,
							categoryId,
							guildId,
							entitled: isEntitled(env, interaction),
							rest,
							continuationToken: interaction.token
						})
					}
					default:
						name satisfies never
						return
				}
			})()
		}
		case InteractionType.MessageComponent: {
			const buttonInteraction =
				interaction as APIMessageComponentButtonInteraction
			if (buttonInteraction.data.component_type !== ComponentType.Button) return

			const [rawIntent, payload] = buttonInteraction.data.custom_id.split(
				':',
				2
			)
			if (!payload)
				return {
					type: InteractionResponseType.ChannelMessageWithSource,
					data: {
						flags: MessageFlags.Ephemeral,
						content: "That button doesn't have enough information anymore."
					}
				}

			switch (Number(rawIntent) as ButtonInteractionIntent) {
				case ButtonInteractionIntent.CompleteRegistration:
				case ButtonInteractionIntent.CompleteRegistrationAfterPurchase:
					return completeRegistrationHandler({
						env,
						ctx,
						db,
						interaction: buttonInteraction,
						intent: Number(rawIntent) as
							| ButtonInteractionIntent.CompleteRegistration
							| ButtonInteractionIntent.CompleteRegistrationAfterPurchase,
						pendingRegistrationId: payload
					})
				case ButtonInteractionIntent.DeregisterServer:
					return deregisterServerHandler({
						env,
						ctx,
						db,
						interaction: buttonInteraction,
						guildId: payload
					})
				default:
					return {
						type: InteractionResponseType.ChannelMessageWithSource,
						data: {
							flags: MessageFlags.Ephemeral,
							content: 'That button is not available right now.'
						}
					}
			}
		}
	}
}

export { PendingRegistration }

export default {
	async fetch(req, env, ctx) {
		const signature = req.headers.get('X-Signature-Ed25519')
		const timestamp = req.headers.get('X-Signature-Timestamp')
		const body = await req.text()
		if (!signature || !timestamp)
			return new Response('Unauthorized', { status: StatusCodes.UNAUTHORIZED })
		const isValidRequest = await verifyKey(
			body,
			signature,
			timestamp,
			env.DISCORD_PUBLIC_KEY
		)
		if (!isValidRequest) {
			return new Response('Unauthorized', { status: StatusCodes.UNAUTHORIZED })
		}

		const response = await handleInteraction({
			env,
			ctx,
			interaction: JSON.parse(body) as APIInteraction
		})
		if (!response)
			return new Response('Internal Server Error', {
				status: StatusCodes.INTERNAL_SERVER_ERROR
			})
		return new Response(JSON.stringify(response), {
			headers: { 'Content-Type': 'application/json' }
		})
	},
	async scheduled(_controller, env, _ctx) {
		const db = drizzle(env.GLOBAL_DB)
		await syncAllRegisteredServers({ env, db })
	}
} satisfies ExportedHandler<Env>
