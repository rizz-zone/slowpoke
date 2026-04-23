import { IncidentStatusColor } from '@/types/IncidentStatusColor'
import type {
	RawStatus,
	RawStatusComponentStatus,
	RawStatusIncident,
	RawStatusIncidentStatus
} from '@/types/RawStatus'
import {
	ButtonBuilder,
	ContainerBuilder,
	SectionBuilder,
	TextDisplayBuilder
} from '@discordjs/builders'
import { ButtonStyle } from 'discord-api-types/v10'

export type IncidentSeverity = RawStatusComponentStatus

export type IncidentSnapshot = {
	incidentId: string
	name: string
	statusLabel: string
	url: string
	affectedComponents: string[]
	startedAtUnixSeconds: number
	latestUpdate?: string
	accentColor?: IncidentStatusColor
	overallState: IncidentSeverity
	isActive: boolean
}

const STATUS_LABELS: Record<RawStatusIncidentStatus, string> = {
	investigating: 'Investigating',
	identified: 'Identified',
	monitoring: 'Monitoring',
	resolved: 'Resolved'
}

const STATUS_CHANNEL_NAMES: Record<IncidentSeverity, string> = {
	full_outage: '🔴 Full Outage',
	partial_outage: '🟠 Partial Outage',
	degraded_performance: '🟡 Degraded Performance',
	operational: '🟢 Operational'
}

export function getOpenIncidents(summary: RawStatus['summary']) {
	return summary.ongoing_incidents.filter(
		(incident) => incident.type === 'incident' && incident.status !== 'resolved'
	)
}

export function getMostSevereOpenState(
	summary: RawStatus['summary']
): IncidentSeverity {
	const severities = getOpenIncidents(summary).map(getIncidentSeverity)

	if (severities.includes('full_outage')) return 'full_outage'
	if (severities.includes('partial_outage')) return 'partial_outage'
	if (severities.includes('degraded_performance')) return 'degraded_performance'
	return 'operational'
}

export function getStatusIndicatorChannelName(severity: IncidentSeverity) {
	return STATUS_CHANNEL_NAMES[severity]
}

export function getUrlChannelName(domain: string) {
	return domain
}

export function buildIncidentSnapshot(
	summary: RawStatus['summary'],
	incident: RawStatusIncident
): IncidentSnapshot {
	const overallState = getIncidentSeverity(incident)
	return {
		incidentId: incident.id,
		name: incident.name.replaceAll('\n', ' ').trim() || 'Untitled incident',
		statusLabel: STATUS_LABELS[incident.status],
		url: `${summary.public_url.replace(/\/$/, '')}/incidents/${incident.id}`,
		affectedComponents: getAffectedComponentNames(summary, incident),
		startedAtUnixSeconds: getIncidentStartedAtUnixSeconds(incident),
		latestUpdate: getLatestIncidentUpdate(incident),
		accentColor: getAccentColor(overallState),
		overallState,
		isActive: true
	}
}

export function renderIncidentMessage(snapshot: IncidentSnapshot) {
	const container = new ContainerBuilder().addSectionComponents(
		new SectionBuilder()
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`# ${snapshot.name}\n-# ${snapshot.statusLabel}`
				),
				new TextDisplayBuilder().setContent(
					`${snapshot.isActive && snapshot.latestUpdate ? `${snapshot.latestUpdate}\n` : ''}### Affected components\n${formatAffectedComponents(snapshot.affectedComponents)}`
				),
				new TextDisplayBuilder().setContent(
					`Started <t:${snapshot.startedAtUnixSeconds}:R>`
				)
			)
			.setButtonAccessory(
				new ButtonBuilder()
					.setStyle(ButtonStyle.Link)
					.setLabel('Open incident')
					.setURL(snapshot.url)
			)
	)

	if (snapshot.accentColor !== undefined)
		container.setAccentColor(snapshot.accentColor)

	return [container.toJSON()]
}

export async function hashSnapshot(value: string) {
	const bytes = new TextEncoder().encode(value)
	const digest = await crypto.subtle.digest('SHA-256', bytes)
	return [...new Uint8Array(digest)]
		.map((chunk) => chunk.toString(16).padStart(2, '0'))
		.join('')
}

export function parseSnapshot(value: string): IncidentSnapshot {
	const parsed: unknown = JSON.parse(value)
	if (!isRecord(parsed))
		throw new Error('Stored incident snapshot is not an object')

	if (
		typeof parsed.incidentId !== 'string' ||
		typeof parsed.name !== 'string' ||
		typeof parsed.statusLabel !== 'string' ||
		typeof parsed.url !== 'string' ||
		!Array.isArray(parsed.affectedComponents) ||
		parsed.affectedComponents.some(
			(component) => typeof component !== 'string'
		) ||
		typeof parsed.startedAtUnixSeconds !== 'number' ||
		!Number.isFinite(parsed.startedAtUnixSeconds) ||
		!isIncidentSeverity(parsed.overallState) ||
		typeof parsed.isActive !== 'boolean' ||
		!(
			parsed.latestUpdate === undefined ||
			typeof parsed.latestUpdate === 'string'
		) ||
		!(
			parsed.accentColor === undefined || typeof parsed.accentColor === 'number'
		)
	)
		throw new Error('Stored incident snapshot has an invalid shape')

	return {
		incidentId: parsed.incidentId,
		name: parsed.name,
		statusLabel: parsed.statusLabel,
		url: parsed.url,
		affectedComponents: parsed.affectedComponents,
		startedAtUnixSeconds: parsed.startedAtUnixSeconds,
		latestUpdate: parsed.latestUpdate,
		accentColor: parsed.accentColor,
		overallState: parsed.overallState,
		isActive: parsed.isActive
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getLatestIncidentUpdate(
	incident: RawStatusIncident
): string | undefined {
	const latestUpdate = [...incident.updates].sort(
		(a, b) =>
			new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
	)[0]
	const message = latestUpdate?.message_string.trim()
	return message ? message : undefined
}

function getAffectedComponentNames(
	summary: RawStatus['summary'],
	incident: RawStatusIncident
) {
	const componentNames = new Map(
		summary.components.map(
			(component) => [component.id, component.name] as const
		)
	)
	const affectedIds = incident.component_impacts.some(
		(impact) => !impact.end_at
	)
		? incident.component_impacts
				.filter((impact) => !impact.end_at)
				.map((impact) => impact.component_id)
		: incident.affected_components.map((component) => component.component_id)

	return [...new Set(affectedIds)]
		.map((componentId) => componentNames.get(componentId))
		.filter((name): name is string => Boolean(name))
		.sort((a, b) => a.localeCompare(b))
}

function getIncidentSeverity(incident: RawStatusIncident): IncidentSeverity {
	const statuses = incident.component_impacts
		.filter((impact) => !impact.end_at)
		.map((impact) => impact.status)

	if (!statuses.length && incident.affected_components.length)
		statuses.push(
			...incident.affected_components.map(
				(component) => component.current_status ?? component.status
			)
		)

	if (statuses.includes('full_outage')) return 'full_outage'
	if (statuses.includes('partial_outage')) return 'partial_outage'
	if (statuses.includes('degraded_performance')) return 'degraded_performance'
	return 'operational'
}

function isIncidentSeverity(value: unknown): value is IncidentSeverity {
	return (
		value === 'operational' ||
		value === 'degraded_performance' ||
		value === 'partial_outage' ||
		value === 'full_outage'
	)
}

function getAccentColor(
	severity: IncidentSeverity
): IncidentStatusColor | undefined {
	switch (severity) {
		case 'full_outage':
			return IncidentStatusColor.Outage
		case 'partial_outage':
			return IncidentStatusColor.PartialOutage
		case 'degraded_performance':
			return IncidentStatusColor.DegradedPerformance
		case 'operational':
			return undefined
	}
	severity satisfies never
	return undefined
}

function getIncidentStartedAtUnixSeconds(incident: RawStatusIncident) {
	return Math.floor(
		Math.min(
			new Date(incident.published_at).getTime(),
			...incident.component_impacts.map((impact) =>
				new Date(impact.start_at).getTime()
			),
			...incident.status_summaries.map((summary) =>
				new Date(summary.start_at).getTime()
			)
		) / 1000
	)
}

function formatAffectedComponents(components: string[]) {
	if (!components.length) return '- None listed'
	return components.map((component) => `- ${component}`).join('\n')
}
