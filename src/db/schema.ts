import { sql } from 'drizzle-orm'
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const entitledServer = sqliteTable('entitled_server', {
	id: text().primaryKey(),
	domain: text(),
	categoryId: text(),
	incidentsChannelId: text(),
	statusIndicatorChannelId: text(),
	urlChannelId: text(),
	lastOverallState: text(),
	lastSyncedAt: integer(),
	lastSyncError: text()
})

export const serverIncidentMessage = sqliteTable(
	'server_incident_message',
	{
		guildId: text().notNull(),
		incidentId: text().notNull(),
		channelId: text().notNull(),
		messageId: text().notNull(),
		snapshotJson: text().notNull(),
		snapshotHash: text().notNull(),
		active: integer({ mode: 'boolean' }).notNull().default(true),
		lastSeenAt: integer().notNull().default(sql`(unixepoch() * 1000)`)
	},
	(table) => [primaryKey({ columns: [table.guildId, table.incidentId] })]
)
