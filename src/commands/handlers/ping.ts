import {
	InteractionResponseType,
	MessageFlags,
	type APIInteractionResponse
} from 'discord-api-types/v10'

export const pingHandler = (): APIInteractionResponse => ({
	type: InteractionResponseType.ChannelMessageWithSource,
	data: { content: 'pong :>', flags: MessageFlags.Ephemeral }
})
