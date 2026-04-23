import { SUPPORT_SERVER_LINK } from '@/constants'
import {
	ActionRowBuilder,
	ButtonBuilder,
	TextDisplayBuilder
} from '@discordjs/builders'
import { DurableObject } from 'cloudflare:workers'
import { ButtonStyle, MessageFlags, Routes } from 'discord-api-types/v10'
import type { RESTPatchAPIChannelMessageJSONBody } from 'discord-api-types/rest/v10'
import { REST } from 'discord.js'
import { ms } from 'ms'

interface PendingRegistrationData {
	domain: string
	guildId: string
	summaryChannelId: string
	summaryMessageId: string
	categoryId?: string
	createdAt: number
}

const DATA_KEY = 'data'
const SESSION_TTL = ms('24h')

export class PendingRegistration extends DurableObject<Env> {
	async init(input: Omit<PendingRegistrationData, 'createdAt'>): Promise<void> {
		const data: PendingRegistrationData = {
			...input,
			createdAt: Date.now()
		}
		this.ctx.storage.kv.put(DATA_KEY, data)
		await this.ctx.storage.setAlarm(Date.now() + SESSION_TTL)
	}

	async getInfo(): Promise<PendingRegistrationData | null> {
		return this.ctx.storage.kv.get<PendingRegistrationData>(DATA_KEY) ?? null
	}

	async deleteSelf(): Promise<void> {
		await this.ctx.storage.deleteAlarm()
		await this.ctx.storage.deleteAll()
	}

	override async alarm(): Promise<void> {
		const data = this.ctx.storage.kv.get<PendingRegistrationData>(DATA_KEY)
		if (data) {
			try {
				const rest = new REST().setToken(this.env.DISCORD_BOT_TOKEN)
				await rest.patch(
					Routes.channelMessage(data.summaryChannelId, data.summaryMessageId),
					{
						body: {
							flags: MessageFlags.IsComponentsV2,
							components: [
								new TextDisplayBuilder()
									.setContent('# ⏳ Registration session expired')
									.toJSON(),
								new TextDisplayBuilder()
									.setContent(
										'This registration was not completed within 24 hours, so it has been cancelled. Run `/register_server` again if you still want to register this server.'
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
						} satisfies RESTPatchAPIChannelMessageJSONBody
					}
				)
			} catch (e) {
				// Fail open - the message may have been deleted, or any other
				// Discord error. Either way, continue to storage cleanup.
				console.log('PendingRegistration alarm: message edit failed', e)
			}
		}
		await this.ctx.storage.deleteAll()
	}
}

export type { PendingRegistrationData }
