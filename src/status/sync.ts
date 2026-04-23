import { entitledServer, serverIncidentMessage } from '@/db/schema'
import {
	buildIncidentSnapshot,
	getMostSevereOpenState,
	getOpenIncidents,
	getStatusIndicatorChannelName,
	getUrlChannelName,
	hashSnapshot,
	parseSnapshot,
	renderIncidentMessage,
	type IncidentSnapshot
} from '@/status/incidents'
import type { RawStatus } from '@/types/RawStatus'
import {
	MessageFlags,
	Routes,
	type APIChannel,
	type RESTPatchAPIChannelJSONBody
} from 'discord-api-types/v10'
import type {
	RESTPatchAPIChannelMessageJSONBody,
	RESTPostAPIChannelMessageJSONBody,
	RESTPostAPIChannelMessageResult
} from 'discord-api-types/rest/v10'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { REST } from 'discord.js'
import { ms } from 'ms'

type RegisteredServer = typeof entitledServer.$inferSelect

export async function syncAllRegisteredServers({
	env,
	db
}: {
	env: Env
	db: DrizzleD1Database<Record<string, never>>
}): Promise<void> {
	const rest = new REST().setToken(env.DISCORD_BOT_TOKEN)
	const servers = await db
		.select()
		.from(entitledServer)
		.where(
			and(
				isNotNull(entitledServer.domain),
				isNotNull(entitledServer.incidentsChannelId),
				isNotNull(entitledServer.statusIndicatorChannelId),
				isNotNull(entitledServer.urlChannelId)
			)
		)

	await Promise.all(
		servers.map((server) =>
			syncRegisteredServer({ env, db, rest, server }).catch(async (error) => {
				console.error('Server sync failed', server.id, error)
				await db
					.update(entitledServer)
					.set({
						lastSyncedAt: Date.now(),
						lastSyncError: getErrorMessage(error)
					})
					.where(eq(entitledServer.id, server.id))
			})
		)
	)
}

export async function syncRegisteredServer({
	env,
	db,
	server,
	rest = new REST().setToken(env.DISCORD_BOT_TOKEN)
}: {
	env: Env
	db: DrizzleD1Database<Record<string, never>>
	server: RegisteredServer
	rest?: REST
}): Promise<void> {
	if (
		!(
			server.domain &&
			server.incidentsChannelId &&
			server.statusIndicatorChannelId &&
			server.urlChannelId
		)
	)
		return

	const summary = await fetchStatusSummary(server.domain)
	const overallState = getMostSevereOpenState(summary)

	await Promise.all([
		maybeRenameChannel({
			rest,
			channelId: server.statusIndicatorChannelId,
			desiredName: getStatusIndicatorChannelName(overallState)
		}),
		maybeRenameChannel({
			rest,
			channelId: server.urlChannelId,
			desiredName: getUrlChannelName(server.domain)
		})
	])

	await syncIncidentMessages({ db, rest, server, summary })

	await db
		.update(entitledServer)
		.set({
			lastOverallState: overallState,
			lastSyncedAt: Date.now(),
			lastSyncError: null
		})
		.where(eq(entitledServer.id, server.id))
}

export async function fetchStatusSummary(
	domain: string
): Promise<RawStatus['summary']> {
	const response = await fetch(`https://${domain}/proxy/${domain}`, {
		signal: AbortSignal.timeout(ms('25s'))
	})

	if (!response.ok)
		throw new Error(`Status endpoint for ${domain} returned ${response.status}`)

	const payload = (await response.json()) as RawStatus
	if (
		!(
			payload.summary &&
			typeof payload.summary === 'object' &&
			Array.isArray(payload.summary.ongoing_incidents) &&
			Array.isArray(payload.summary.components)
		)
	)
		throw new Error(`Status endpoint for ${domain} returned an invalid shape`)

	return payload.summary
}

async function maybeRenameChannel({
	rest,
	channelId,
	desiredName
}: {
	rest: REST
	channelId: string
	desiredName: string
}) {
	const channel = (await rest.get(Routes.channel(channelId))) as APIChannel
	if ('name' in channel && channel.name === desiredName) return

	await rest.patch(Routes.channel(channelId), {
		body: {
			name: desiredName
		} satisfies RESTPatchAPIChannelJSONBody
	})
}

async function syncIncidentMessages({
	db,
	rest,
	server,
	summary
}: {
	db: DrizzleD1Database<Record<string, never>>
	rest: REST
	server: RegisteredServer
	summary: RawStatus['summary']
}) {
	if (!server.incidentsChannelId) return

	const existingRows = await db
		.select()
		.from(serverIncidentMessage)
		.where(eq(serverIncidentMessage.guildId, server.id))

	const rowByIncidentId = new Map(
		existingRows.map((row) => [row.incidentId, row] as const)
	)
	const activeIncidents = getOpenIncidents(summary)
	const activeIncidentIds = new Set(activeIncidents.map((incident) => incident.id))

	for (const incident of activeIncidents) {
		const snapshot = buildIncidentSnapshot(summary, incident)
		const snapshotJson = JSON.stringify(snapshot)
		const snapshotHash = await hashSnapshot(
			JSON.stringify(renderIncidentMessage(snapshot))
		)
		const existingRow = rowByIncidentId.get(incident.id)

		const messageId = existingRow
			? await updateIncidentMessage({
				rest,
				channelId: server.incidentsChannelId,
				messageId: existingRow.messageId,
				snapshot,
				snapshotHash,
				existingHash: existingRow.snapshotHash,
				existingActive: existingRow.active
			  })
			: await createIncidentMessage({
				rest,
				channelId: server.incidentsChannelId,
				snapshot
			  })

		await db
			.insert(serverIncidentMessage)
			.values({
				guildId: server.id,
				incidentId: incident.id,
				channelId: server.incidentsChannelId,
				messageId,
				snapshotJson,
				snapshotHash,
				active: true,
				lastSeenAt: Date.now()
			})
			.onConflictDoUpdate({
				target: [serverIncidentMessage.guildId, serverIncidentMessage.incidentId],
				set: {
					channelId: server.incidentsChannelId,
					messageId,
					snapshotJson,
					snapshotHash,
					active: true,
					lastSeenAt: Date.now()
				}
			})
	}

	for (const row of existingRows) {
		if (!row.active || activeIncidentIds.has(row.incidentId)) continue

		const snapshot = {
			...parseSnapshot(row.snapshotJson),
			isActive: false,
			statusLabel: 'Resolved',
			latestUpdate: undefined,
			accentColor: undefined
		} satisfies IncidentSnapshot
		const snapshotJson = JSON.stringify(snapshot)
		const snapshotHash = await hashSnapshot(
			JSON.stringify(renderIncidentMessage(snapshot))
		)
		const messageId = await updateIncidentMessage({
			rest,
			channelId: row.channelId,
			messageId: row.messageId,
			snapshot,
			snapshotHash,
			existingHash: row.snapshotHash,
			existingActive: row.active
		})

		await db
			.update(serverIncidentMessage)
			.set({
				messageId,
				snapshotJson,
				snapshotHash,
				active: false,
				lastSeenAt: Date.now()
			})
			.where(
				and(
					eq(serverIncidentMessage.guildId, row.guildId),
					eq(serverIncidentMessage.incidentId, row.incidentId)
				)
			)
	}
}

async function createIncidentMessage({
	rest,
	channelId,
	snapshot
}: {
	rest: REST
	channelId: string
	snapshot: IncidentSnapshot
}) {
	const message = (await rest.post(Routes.channelMessages(channelId), {
		body: {
			flags: MessageFlags.IsComponentsV2,
			components: renderIncidentMessage(snapshot)
		} satisfies RESTPostAPIChannelMessageJSONBody
	})) as RESTPostAPIChannelMessageResult

	return message.id
}

async function updateIncidentMessage({
	rest,
	channelId,
	messageId,
	snapshot,
	snapshotHash,
	existingHash,
	existingActive
}: {
	rest: REST
	channelId: string
	messageId: string
	snapshot: IncidentSnapshot
	snapshotHash: string
	existingHash: string
	existingActive: boolean
}) {
	if (snapshotHash === existingHash && existingActive === snapshot.isActive)
		return messageId

	try {
		await rest.patch(Routes.channelMessage(channelId, messageId), {
			body: {
				flags: MessageFlags.IsComponentsV2,
				components: renderIncidentMessage(snapshot)
			} satisfies RESTPatchAPIChannelMessageJSONBody
		})
		return messageId
	} catch (error) {
		console.error('Incident message patch failed, recreating message', error)
		return createIncidentMessage({ rest, channelId, snapshot })
	}
}

function getErrorMessage(error: unknown) {
	if (error instanceof Error) return error.message.slice(0, 500)
	return String(error).slice(0, 500)
}
