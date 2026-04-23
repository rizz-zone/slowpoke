import { SUPPORT_SERVER_LINK } from '@/constants'
import type { PendingRegistrationData } from '@/durable/pending_registration'
import { entitledServer } from '@/db/schema'
import {
	getConsumableSku,
	getUnusedConsumableEntitlement,
	isAlwaysFreeUser
} from '@/one_billion_dollars/entitled'
import { syncRegisteredServer } from '@/status/sync'
import { ButtonInteractionIntent } from '@/types/ButtonInteractionIntent'
import type { RawStatus } from '@/types/RawStatus'
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
	OverwriteType,
	PermissionFlagsBits,
	Routes,
	type APIInteractionResponse,
	type APIMessageComponentButtonInteraction
} from 'discord-api-types/v10'
import type {
	RESTGetAPIChannelResult,
	RESTPatchAPIChannelMessageJSONBody,
	RESTPostAPIGuildChannelJSONBody,
	RESTPostAPIGuildChannelResult
} from 'discord-api-types/rest/v10'
import { REST } from 'discord.js'
import { eq } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { ms } from 'ms'

const CREATE_TEXT_DENY = (
	PermissionFlagsBits.SendMessages |
	PermissionFlagsBits.CreatePublicThreads |
	PermissionFlagsBits.CreatePrivateThreads |
	PermissionFlagsBits.SendMessagesInThreads
).toString()

const BOT_TEXT_ALLOW = (
	PermissionFlagsBits.SendMessages |
	PermissionFlagsBits.EmbedLinks |
	PermissionFlagsBits.ManageMessages
).toString()

const VOICE_DENY = (
	PermissionFlagsBits.Connect | PermissionFlagsBits.Speak
).toString()

export async function completeRegistrationHandler({
	env,
	ctx,
	db,
	interaction,
	intent,
	pendingRegistrationId
}: {
	env: Env
	ctx: ExecutionContext
	db: DrizzleD1Database<Record<string, never>>
	interaction: APIMessageComponentButtonInteraction
	intent:
		| ButtonInteractionIntent.CompleteRegistration
		| ButtonInteractionIntent.CompleteRegistrationAfterPurchase
	pendingRegistrationId: string
}): Promise<APIInteractionResponse> {
	const stub = env.PENDING_REGISTRATION.get(
		env.PENDING_REGISTRATION.idFromString(pendingRegistrationId)
	)
	const info = await stub.getInfo()

	if (!info) return buildExpiredInteractionResponse()

	const existingServer = await db
		.select()
		.from(entitledServer)
		.where(eq(entitledServer.id, info.guildId))
		.get()

	const consumableSku = getConsumableSku(env)
	const alwaysFree = isAlwaysFreeUser(env, interaction)
	const unusedEntitlement = getUnusedConsumableEntitlement(env, interaction)
	const serverAlreadyEntitled = Boolean(existingServer)

	if (
		!alwaysFree &&
		!serverAlreadyEntitled &&
		consumableSku &&
		!unusedEntitlement
	)
		return buildMissingEntitlementResponse({ env, intent })

	if (
		!alwaysFree &&
		!serverAlreadyEntitled &&
		consumableSku &&
		unusedEntitlement
	) {
		try {
			const rest = new REST().setToken(env.DISCORD_BOT_TOKEN)
			await rest.post(
				Routes.consumeEntitlement(
					env.DISCORD_APPLICATION_ID,
					unusedEntitlement.id
				)
			)
		} catch {
			return buildMissingEntitlementResponse({ env, intent })
		}
	}

	try {
		await db
			.insert(entitledServer)
			.values({
				id: info.guildId,
				domain: info.domain,
				categoryId: existingServer?.categoryId,
				incidentsChannelId: existingServer?.incidentsChannelId,
				statusIndicatorChannelId: existingServer?.statusIndicatorChannelId,
				urlChannelId: existingServer?.urlChannelId
			})
			.onConflictDoUpdate({
				target: entitledServer.id,
				set: { domain: info.domain }
			})
	} catch (error) {
		console.error(error)

		return buildEphemeralMessage({
			content:
				"Couldn't write this server to the database, so nothing else was changed. Try again in a moment.",
			includePremiumButton: false,
			env
		})
	}

	ctx.waitUntil(finalizeRegistration({ env, db, info, existingServer, stub }))

	return {
		type: InteractionResponseType.DeferredMessageUpdate
	}
}

async function finalizeRegistration({
	env,
	db,
	info,
	existingServer,
	stub
}: {
	env: Env
	db: DrizzleD1Database<Record<string, never>>
	info: PendingRegistrationData
	existingServer: InferSelectModel<typeof entitledServer> | undefined
	stub: DurableObjectStub<
		import('@/durable/pending_registration').PendingRegistration
	>
}) {
	const rest = new REST().setToken(env.DISCORD_BOT_TOKEN)
	const issues: string[] = []

	try {
		const statusChannelName = await getStatusChannelName(info.domain)

		const categoryId = await resolveCategoryId({
			rest,
			guildId: info.guildId,
			preferredCategoryId:
				info.categoryId ?? existingServer?.categoryId ?? undefined,
			issues
		})

		const statusIndicatorChannelId = await ensureChannel({
			rest,
			guildId: info.guildId,
			existingChannelId: existingServer?.statusIndicatorChannelId ?? undefined,
			body: {
				name: statusChannelName,
				type: ChannelType.GuildVoice,
				parent_id: categoryId,
				permission_overwrites: [
					{
						id: info.guildId,
						type: OverwriteType.Role,
						deny: VOICE_DENY
					}
				]
			},
			issues,
			failureMessage: "Couldn't create the status voice channel."
		})

		const urlChannelId = await ensureChannel({
			rest,
			guildId: info.guildId,
			existingChannelId: existingServer?.urlChannelId ?? undefined,
			body: {
				name: info.domain,
				type: ChannelType.GuildVoice,
				parent_id: categoryId,
				permission_overwrites: [
					{
						id: info.guildId,
						type: OverwriteType.Role,
						deny: VOICE_DENY
					}
				]
			},
			issues,
			failureMessage: "Couldn't create the URL voice channel."
		})

		const incidentsChannelId = await ensureChannel({
			rest,
			guildId: info.guildId,
			existingChannelId: existingServer?.incidentsChannelId ?? undefined,
			body: {
				name: 'incidents',
				type: ChannelType.GuildText,
				parent_id: categoryId,
				permission_overwrites: [
					{
						id: info.guildId,
						type: OverwriteType.Role,
						deny: CREATE_TEXT_DENY
					},
					{
						id: env.DISCORD_APPLICATION_ID,
						type: OverwriteType.Member,
						allow: BOT_TEXT_ALLOW
					}
				]
			},
			issues,
			failureMessage: "Couldn't create the incidents text channel."
		})

		await db
			.update(entitledServer)
			.set({
				categoryId,
				statusIndicatorChannelId,
				urlChannelId,
				incidentsChannelId
			})
			.where(eq(entitledServer.id, info.guildId))

		const registeredServer = await db
			.select()
			.from(entitledServer)
			.where(eq(entitledServer.id, info.guildId))
			.get()

		if (registeredServer)
			try {
				await syncRegisteredServer({
					env,
					db,
					server: registeredServer,
					rest
				})
			} catch (error) {
				console.error('Initial status sync failed', error)
				issues.push(
					'Channels were created, but the initial incident sync failed. The scheduled sync will retry automatically.'
				)
			}

		await editSummaryMessage({
			rest,
			info,
			categoryId,
			issues
		})
	} catch (error) {
		console.log('finalizeRegistration failed', error)
		await editSummaryMessage({
			rest,
			info,
			issues: [
				'registration completed in the database, but channel setup hit an error.'
			]
		})
	} finally {
		try {
			await stub.deleteSelf()
		} catch (error) {
			console.log('PendingRegistration cleanup failed', error)
		}
	}
}

async function resolveCategoryId({
	rest,
	guildId,
	preferredCategoryId,
	issues
}: {
	rest: REST
	guildId: string
	preferredCategoryId?: string
	issues: string[]
}): Promise<string | undefined> {
	if (preferredCategoryId) {
		const existingCategory = await getExistingChannel(rest, preferredCategoryId)
		if (existingCategory?.type === ChannelType.GuildCategory)
			return preferredCategoryId
	}

	try {
		const category = (await rest.post(Routes.guildChannels(guildId), {
			body: {
				name: 'Status',
				type: ChannelType.GuildCategory
			} satisfies RESTPostAPIGuildChannelJSONBody
		})) as RESTPostAPIGuildChannelResult

		return category.id
	} catch (error) {
		console.log('Category creation failed', error)
		issues.push("Couldn't create the Status category.")
		return undefined
	}
}

async function ensureChannel({
	rest,
	guildId,
	existingChannelId,
	body,
	issues,
	failureMessage
}: {
	rest: REST
	guildId: string
	existingChannelId?: string
	body: RESTPostAPIGuildChannelJSONBody
	issues: string[]
	failureMessage: string
}): Promise<string | undefined> {
	if (existingChannelId) {
		const existingChannel = await getExistingChannel(rest, existingChannelId)
		if (existingChannel) return existingChannelId
	}

	try {
		const createdChannel = (await rest.post(Routes.guildChannels(guildId), {
			body
		})) as RESTPostAPIGuildChannelResult

		return createdChannel.id
	} catch (error) {
		console.log(failureMessage, error)
		issues.push(failureMessage)
		return undefined
	}
}

async function getExistingChannel(rest: REST, channelId: string) {
	try {
		return (await rest.get(
			Routes.channel(channelId)
		)) as RESTGetAPIChannelResult
	} catch {
		return undefined
	}
}

async function editSummaryMessage({
	rest,
	info,
	categoryId,
	issues = []
}: {
	rest: REST
	info: PendingRegistrationData
	categoryId?: string
	issues?: string[]
}) {
	try {
		await rest.patch(
			Routes.channelMessage(info.summaryChannelId, info.summaryMessageId),
			{
				body: {
					flags: MessageFlags.IsComponentsV2,
					components: [
						new TextDisplayBuilder().setContent('# 🎉 Registered!').toJSON(),
						new TextDisplayBuilder()
							.setContent(
								categoryId
									? `Registered \`${info.domain}\` under category <#${categoryId}>. This will now automatically update with status changes, and slowpoke should be fully good to go in this server.`
									: `Registered \`${info.domain}\`. This will now automatically update with status changes, and slowpoke should be fully good to go in this server.`
							)
							.toJSON(),
						...(issues.length
							? [
									new TextDisplayBuilder()
										.setContent(issues.map((issue) => `- ${issue}`).join('\n'))
										.toJSON()
								]
							: []),
						new ActionRowBuilder<ButtonBuilder>()
							.addComponents(
								new ButtonBuilder()
									.setLabel('💀 Deregister server')
									.setCustomId(
										`${ButtonInteractionIntent.DeregisterServer}:${info.guildId}`
									)
									.setStyle(ButtonStyle.Danger)
							)
							.toJSON(),
						...(issues.length
							? [
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
				} satisfies RESTPatchAPIChannelMessageJSONBody
			}
		)
	} catch (error) {
		console.log('Failed to update registration summary message', error)
	}
}

function buildExpiredInteractionResponse(): APIInteractionResponse {
	return buildEphemeralMessage({
		content:
			'This registration session has expired. Run `/register_server` again if you still want to finish it.',
		includePremiumButton: false
	})
}

function buildMissingEntitlementResponse({
	env,
	intent
}: {
	env: Env
	intent:
		| ButtonInteractionIntent.CompleteRegistration
		| ButtonInteractionIntent.CompleteRegistrationAfterPurchase
}): APIInteractionResponse {
	return buildEphemeralMessage({
		content:
			intent === ButtonInteractionIntent.CompleteRegistrationAfterPurchase
				? 'pressed done without buying. bold strategy.'
				: 'The Server Access on your account seems to have gone somewhere already. Grab another with the button below to finish registering here.',
		includePremiumButton: true,
		env
	})
}

function buildEphemeralMessage({
	content,
	includePremiumButton,
	env
}: {
	content: string
	includePremiumButton: boolean
	env?: Env
}): APIInteractionResponse {
	return {
		type: InteractionResponseType.ChannelMessageWithSource,
		data: {
			flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
			components: [
				new TextDisplayBuilder().setContent(content).toJSON(),
				...(includePremiumButton && env?.DISCORD_CONSUMABLE_SKU
					? [
							new ActionRowBuilder<ButtonBuilder>()
								.addComponents(
									new ButtonBuilder()
										.setSKUId(env.DISCORD_CONSUMABLE_SKU)
										.setStyle(ButtonStyle.Premium)
								)
								.toJSON()
						]
					: [])
			]
		}
	}
}

async function getStatusChannelName(domain: string) {
	try {
		const response = await fetch(`https://${domain}/proxy/${domain}`, {
			signal: AbortSignal.timeout(ms('10s'))
		})
		if (!response.ok) return 'Unknown Status'

		const statusPayload = (await response.json()) as RawStatus
		if (
			!(statusPayload.summary && 'ongoing_incidents' in statusPayload.summary)
		)
			return 'Unknown Status'

		if (
			statusPayload.summary.ongoing_incidents.some((incident) =>
				incident.component_impacts.some(
					(impact) => !impact.end_at && impact.status === 'full_outage'
				)
			)
		)
			return '🔴 Full Outage'

		if (
			statusPayload.summary.ongoing_incidents.some((incident) =>
				incident.component_impacts.some(
					(impact) => !impact.end_at && impact.status === 'partial_outage'
				)
			)
		)
			return '🟠 Partial Outage'

		if (
			statusPayload.summary.ongoing_incidents.some((incident) =>
				incident.component_impacts.some(
					(impact) => !impact.end_at && impact.status === 'degraded_performance'
				)
			)
		)
			return '🟡 Degraded Performance'

		return '🟢 Operational'
	} catch {
		return 'Unknown Status'
	}
}
