import {
	PRIVACY_POLICY_LINK,
	REPO_LINK,
	SUPPORT_SERVER_LINK,
	TERMS_LINK
} from '@/constants'
import { entitledServer } from '@/db/schema'
import { ButtonInteractionIntent } from '@/types/ButtonInteractionIntent'
import { IncidentStatusColor } from '@/types/IncidentStatusColor'
import type { RawStatus } from '@/types/RawStatus'
import {
	ActionRowBuilder,
	ButtonBuilder,
	ContainerBuilder,
	SectionBuilder,
	SeparatorBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder
} from '@discordjs/builders'
import {
	ButtonStyle,
	InteractionResponseType,
	MessageFlags,
	Routes,
	SeparatorSpacingSize,
	type APIInteractionResponse
} from 'discord-api-types/v10'
import type { RESTPatchAPIInteractionOriginalResponseResult } from 'discord-api-types/rest/v10'
import { type REST, type WebhookMessageEditOptions } from 'discord.js'
import { eq } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { ms } from 'ms'

export async function registerServerHandler({
	env,
	ctx,
	db,
	guildId,
	domain,
	categoryId,
	entitled,
	rest,
	continuationToken
}: {
	env: Env
	ctx: ExecutionContext
	db: DrizzleD1Database<Record<string, never>>
	guildId: string
	domain: string
	categoryId?: string
	entitled: boolean
	rest: REST
	continuationToken: string
}): Promise<APIInteractionResponse> {
	let baseUrl: URL
	try {
		if (
			domain.startsWith('https:') ||
			domain.startsWith('http:') ||
			domain.includes('/')
		)
			throw new Error()
		baseUrl = new URL(`https://${domain}`)
		domain = baseUrl.host
	} catch {
		return {
			type: InteractionResponseType.ChannelMessageWithSource,
			data: {
				flags: MessageFlags.IsComponentsV2,
				components: [
					new TextDisplayBuilder()
						.setContent("This doesn't seem like a valid domain.")
						.toJSON(),
					new TextDisplayBuilder()
						.setContent(
							'-# Ensure you include **only** the domain (for example, `status.poke.com`).'
						)
						.toJSON()
				]
			}
		}
	}

	const entitlementsEnabled =
		'DISCORD_CONSUMABLE_SKU' in env &&
		typeof env.DISCORD_CONSUMABLE_SKU === 'string'

	const dbEntry = await db
		.select()
		.from(entitledServer)
		.where(eq(entitledServer.id, guildId))
		.get()

	if (dbEntry && dbEntry.categoryId)
		return {
			type: InteractionResponseType.ChannelMessageWithSource,
			data: {
				flags: MessageFlags.IsComponentsV2,
				components: [
					new TextDisplayBuilder()
						.setContent(`# 📃 Server already registered`)
						.toJSON(),
					new TextDisplayBuilder()
						.setContent(
							`Your status should be appearing in the <#${dbEntry.categoryId}> section, but you can deregister it and register it again if you don't see it.`
						)
						.toJSON(),
					new ActionRowBuilder<ButtonBuilder>()
						.addComponents(
							new ButtonBuilder()
								.setLabel('💀 Deregister server')
								.setCustomId(
									`${ButtonInteractionIntent.DeregisterServer}:${guildId}`
								)
								.setStyle(ButtonStyle.Danger)
						)
						.toJSON(),
					...(entitlementsEnabled
						? [
								new TextDisplayBuilder()
									.setContent(
										`-# Deregistering the server will not remove its Server Access purchase.`
									)
									.toJSON()
							]
						: [])
				]
			}
		}

	ctx.waitUntil(
		(async () => {
			try {
				const res = await fetch(new URL(`/proxy/${domain}`, baseUrl), {
					// 25 seconds because ctx.waitUntil only provides up to 30
					signal: AbortSignal.timeout(ms('25s'))
				})
				if (!res.ok)
					return await rest.patch(
						Routes.webhookMessage(
							env.DISCORD_APPLICATION_ID,
							continuationToken,
							'@original'
						),
						{
							body: {
								flags: MessageFlags.IsComponentsV2,
								components: [
									new TextDisplayBuilder()
										.setContent('# ✏️ Endpoint returned error')
										.toJSON(),
									new TextDisplayBuilder()
										.setContent(
											`The info endpoint on this domain returned ${res.status} instead of 200. Ensure that it definitely hosts an incident.io status page, or reach out if you need more help!`
										)
										.toJSON(),
									new ActionRowBuilder()
										.addComponents(
											new ButtonBuilder()
												.setURL(SUPPORT_SERVER_LINK)
												.setLabel('Get support')
												.setStyle(ButtonStyle.Link)
										)
										.toJSON()
								]
							} satisfies WebhookMessageEditOptions
						}
					)

				const statusPayload: RawStatus = await res.json()
				if (
					!(
						'summary' in statusPayload &&
						typeof statusPayload.summary === 'object' &&
						'ongoing_incidents' in statusPayload.summary
					)
				)
					return await rest.patch(
						Routes.webhookMessage(
							env.DISCORD_APPLICATION_ID,
							continuationToken,
							'@original'
						),
						{
							body: {
								flags: MessageFlags.IsComponentsV2,
								components: [
									new TextDisplayBuilder()
										.setContent('# 🧲 Invalid info format')
										.toJSON(),
									new TextDisplayBuilder()
										.setContent(
											`The info endpoint on this domain provided a response, but the info returned does not appear to be in the correct format. Ensure that it definitely hosts an incident.io status page, or reach out if you need more help!`
										)
										.toJSON(),
									new ActionRowBuilder()
										.addComponents(
											new ButtonBuilder()
												.setURL(SUPPORT_SERVER_LINK)
												.setLabel('Get support')
												.setStyle(ButtonStyle.Link)
										)
										.toJSON()
								]
							} satisfies WebhookMessageEditOptions
						}
					)

				const pendingRegistrationId =
					env.PENDING_REGISTRATION.newUniqueId().toString()

				const summaryMessage = (await rest.patch(
					Routes.webhookMessage(
						env.DISCORD_APPLICATION_ID,
						continuationToken,
						'@original'
					),
					{
						body: {
							flags: MessageFlags.IsComponentsV2,
							components: [
								new ContainerBuilder()
									.addSectionComponents(
										new SectionBuilder()
											.addTextDisplayComponents(
												new TextDisplayBuilder().setContent(
													`## ${statusPayload.summary.name.replaceAll('\n', '')}
-# Status page available since ${new Date(
														statusPayload.summary.data_available_since
													).toLocaleDateString(undefined, {
														year: 'numeric',
														month: 'long',
														day: 'numeric'
													})}`
												),
												new TextDisplayBuilder().setContent(`### Current stats
- ${statusPayload.summary.components.length} components currently tracked
- ${statusPayload.summary.ongoing_incidents.length} ongoing incidents
### Category
${categoryId ? `<#${categoryId}>` : 'Status (new category)'}`)
											)
											.setThumbnailAccessory(
												new ThumbnailBuilder()
													.setURL(
														statusPayload.summary.favicon_url ??
															'https://slowpoke.rizz.zone/default.png'
													)
													.setDescription(
														'The favicon for this incident.io page'
													)
											)
									)
									.setAccentColor(
										statusPayload.summary.ongoing_incidents.some((incident) =>
											incident.component_impacts.some(
												(impact) =>
													!impact.end_at && impact.status === 'full_outage'
											)
										)
											? IncidentStatusColor.Outage
											: statusPayload.summary.ongoing_incidents.some(
														(incident) =>
															incident.component_impacts.some(
																(impact) =>
																	!impact.end_at &&
																	impact.status === 'partial_outage'
															)
												  )
												? IncidentStatusColor.PartialOutage
												: statusPayload.summary.ongoing_incidents.some(
															(incident) =>
																incident.component_impacts.some(
																	(impact) =>
																		!impact.end_at &&
																		impact.status === 'degraded_performance'
																)
													  )
													? IncidentStatusColor.DegradedPerformance
													: IncidentStatusColor.FullyOperational
									)
									.toJSON(),
								new SeparatorBuilder()
									.setDivider(true)
									.setSpacing(SeparatorSpacingSize.Large)
									.toJSON(),
								new TextDisplayBuilder()
									.setContent(
										"Ensure that you're happy with the details retrieved from the endpoint and the destination category."
									)
									.toJSON(),
								...(entitlementsEnabled
									? dbEntry
										? [
												new TextDisplayBuilder()
													.setContent(
														"This server already has a Server Access purchase assigned to it, so you're good to go."
													)
													.toJSON()
											]
										: entitled
											? [
													new TextDisplayBuilder()
														.setContent(
															'You have an unused Server Access purchase associated with your Discord account. Once you register, it will be transferred to this server — you will need to get it again if you want to register another server.'
														)
														.toJSON()
												]
											: [
													new TextDisplayBuilder()
														.setContent(
															'To register this server, you will need to buy **Server Access**. This is a one-time purchase that will allow this server to continuously¹ receive status updates.'
														)
														.toJSON()
												]
									: []),
								...(entitlementsEnabled && !(dbEntry || entitled)
									? [
											new ActionRowBuilder<ButtonBuilder>()
												.addComponents(
													new ButtonBuilder()
														.setSKUId(env.DISCORD_CONSUMABLE_SKU as string)
														.setStyle(ButtonStyle.Premium),
													new ButtonBuilder()
														.setCustomId(
															`${ButtonInteractionIntent.CompleteRegistrationAfterPurchase}:${pendingRegistrationId}`
														)
														.setLabel('Done')
														.setStyle(ButtonStyle.Success)
												)
												.toJSON(),
											new TextDisplayBuilder()
												.setContent(
													`-# ¹ While slowpoke will continue to work on a best-effort basis, incident.io can make API changes to stop the bot from working. See [terms](<${TERMS_LINK}>) and [privacy policy](<${PRIVACY_POLICY_LINK}>). You can self-host slowpoke instead by following the instructions in the [GitHub repo](<${REPO_LINK}>) if you prefer.`
												)
												.toJSON()
										]
									: [
											new ActionRowBuilder<ButtonBuilder>()
												.addComponents(
													new ButtonBuilder()
														.setCustomId(
															`${ButtonInteractionIntent.CompleteRegistration}:${pendingRegistrationId}`
														)
														.setLabel('Confirm')
														.setStyle(ButtonStyle.Success)
												)
												.toJSON()
										])
							]
						} satisfies WebhookMessageEditOptions
					}
				)) as RESTPatchAPIInteractionOriginalResponseResult

				try {
					await env.PENDING_REGISTRATION.get(
						env.PENDING_REGISTRATION.idFromString(pendingRegistrationId)
					).init({
						domain,
						guildId,
						summaryChannelId: summaryMessage.channel_id,
						summaryMessageId: summaryMessage.id,
						categoryId
					})
				} catch (error) {
					console.log('PendingRegistration init failed', error)
				}
			} catch (e) {
				if (e instanceof Error && e.name === 'TimeoutError')
					return await rest.patch(
						Routes.webhookMessage(
							env.DISCORD_APPLICATION_ID,
							continuationToken,
							'@original'
						),
						{
							body: {
								flags: MessageFlags.IsComponentsV2,
								components: [
									new TextDisplayBuilder().setContent(`# ⌛ Timeout`).toJSON(),
									new TextDisplayBuilder()
										.setContent(
											`The request to the info endpoint did not complete. Ensure that it definitely hosts an incident.io status page — try visiting it manually first, and reach out if you're still having trouble.`
										)
										.toJSON(),
									new ActionRowBuilder()
										.addComponents(
											new ButtonBuilder()
												.setURL(SUPPORT_SERVER_LINK)
												.setLabel('Get support')
												.setStyle(ButtonStyle.Link)
										)
										.toJSON()
								]
							} satisfies WebhookMessageEditOptions
						}
					)

				console.log(e)
				await rest.patch(
					Routes.webhookMessage(
						env.DISCORD_APPLICATION_ID,
						continuationToken,
						'@original'
					),
					{
						body: {
							flags: MessageFlags.IsComponentsV2,
							components: [
								new TextDisplayBuilder().setContent(`# 🚨 Error`).toJSON(),
								new TextDisplayBuilder()
									.setContent(
										`An error occurred while attempting to obtain information about this endpoint.`
									)
									.toJSON(),
								new ActionRowBuilder()
									.addComponents(
										new ButtonBuilder()
											.setURL(SUPPORT_SERVER_LINK)
											.setLabel('Get support')
											.setStyle(ButtonStyle.Link)
									)
									.toJSON()
							]
						} satisfies WebhookMessageEditOptions
					}
				)
			}
		})()
	)

	return {
		type: InteractionResponseType.DeferredChannelMessageWithSource
	}
}
