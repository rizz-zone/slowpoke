import type {
	APIEntitlement,
	APIInteraction,
	APIInteractionGuildMember
} from 'discord.js'

export const getConsumableSku = (env: Env) =>
	typeof env.DISCORD_CONSUMABLE_SKU === 'string'
		? env.DISCORD_CONSUMABLE_SKU
		: undefined

export const getAlwaysFreeUsers = (env: Env) => {
	if (typeof env.ALWAYS_FREE_USERS !== 'string') return []

	try {
		const parsed = JSON.parse(env.ALWAYS_FREE_USERS) as unknown
		return Array.isArray(parsed)
			? parsed.filter((item): item is string => typeof item === 'string')
			: []
	} catch {
		return []
	}
}

export const isAlwaysFreeUser = (env: Env, interaction: APIInteraction) => {
	const member = interaction.member as APIInteractionGuildMember | undefined
	return member ? getAlwaysFreeUsers(env).includes(member.user.id) : false
}

export const getUnusedConsumableEntitlement = (
	env: Env,
	interaction: APIInteraction
): APIEntitlement | undefined => {
	const sku = getConsumableSku(env)
	if (!sku) return

	return interaction.entitlements.find(
		(item) => item.sku_id === sku && !item.consumed
	)
}

export const isEntitled = (env: Env, interaction: APIInteraction) =>
	!getConsumableSku(env) ||
	Boolean(getUnusedConsumableEntitlement(env, interaction)) ||
	isAlwaysFreeUser(env, interaction)
