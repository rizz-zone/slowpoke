export type RawStatusComponentStatus =
	| 'operational'
	| 'degraded_performance'
	| 'partial_outage'
	| 'full_outage'

export type RawStatusIncidentStatus =
	| 'investigating'
	| 'identified'
	| 'monitoring'
	| 'resolved'

export type RawStatusIncidentType = 'incident' | 'maintenance'

export type RawStatusRichTextNode = {
	type: string
	text?: string
	content?: RawStatusRichTextNode[]
	[key: string]: unknown
}

export type RawStatusMessage = {
	type: string
	content?: RawStatusRichTextNode[]
	[key: string]: unknown
}

export type RawStatusComponent = {
	id: string
	name: string
	status_page_id: string
	description?: string
}

export type RawStatusAffectedComponent = {
	component_id: string
	status: RawStatusComponentStatus
	current_status?: RawStatusComponentStatus
}

export type RawStatusIncidentUpdate = {
	published_at: string
	id: string
	message: RawStatusMessage
	message_string: string
	to_status: RawStatusIncidentStatus
	component_statuses: RawStatusAffectedComponent[]
	automated_update: boolean
}

export type RawStatusComponentImpact = {
	start_at: string
	end_at?: string
	id: string
	component_id: string
	status_page_incident_id: string
	status: RawStatusComponentStatus
}

export type RawStatusStatusSummary = {
	start_at: string
	end_at?: string
	worst_component_status: RawStatusComponentStatus
}

export type RawStatusIncident = {
	updates: RawStatusIncidentUpdate[]
	component_impacts: RawStatusComponentImpact[]
	status_summaries: RawStatusStatusSummary[]
	published_at: string
	id: string
	status_page_id: string
	name: string
	status: RawStatusIncidentStatus
	affected_components: RawStatusAffectedComponent[]
	type: RawStatusIncidentType
}

export type RawStatusStructureComponentItem = {
	component: {
		component_id: string
		display_uptime: boolean
		name: string
		hidden: boolean
		description?: string
		data_available_since: string
	}
}

export type RawStatusStructureGroupItem = {
	group: {
		id: string
		name: string
		display_aggregated_uptime: boolean
		hidden: boolean
		description?: string
		components: Array<{
			component_id: string
			display_uptime: boolean
			name: string
			hidden: boolean
			description?: string
			data_available_since: string
		}>
	}
}

export type RawStatusStructureItem =
	| RawStatusStructureComponentItem
	| RawStatusStructureGroupItem

export type RawStatus = {
	summary: {
		id: string
		name: string
		subpath: string
		support_url?: string
		support_label?: string
		public_url: string
		logo_url?: string
		favicon_url?: string
		components: RawStatusComponent[]
		subscriptions_disabled: boolean
		display_uptime_mode: string
		allow_search_engine_indexing: boolean
		affected_components: RawStatusAffectedComponent[]
		ongoing_incidents: RawStatusIncident[]
		scheduled_maintenances: RawStatusIncident[]
		structure: {
			id: string
			status_page_id: string
			items: RawStatusStructureItem[]
		}
		google_analytics_tag?: string
		terms_of_service_url?: string
		privacy_policy_url?: string
		expose_status_summary_api: boolean
		theme: string
		date_view: string
		locale: string
		page_type: string
		data_available_since: string
		page_view_tracking_disabled: boolean
		page_level_subscriptions_disabled: boolean
		sms_subscriptions_enabled: boolean
		subscribe_button_highlighted: boolean
		show_parent_page_banner: boolean
	}
}
