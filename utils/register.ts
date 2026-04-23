/**
 * Registers Discord application (/) commands with the Discord API.
 *
 * Reads the pre-serialized command bodies from `src/commands.ts` and has
 * no knowledge of — or expectations about — how the gateway bot dispatches
 * them at runtime.
 *
 * Run with: `bun run utils/register.ts`
 */

import { REST, Routes } from 'discord.js'
import type {
	RESTPutAPIApplicationCommandsResult,
	RESTPutAPIApplicationGuildCommandsResult
} from 'discord-api-types/v10'
import { commands } from '../src/commands/defs.ts'

const { DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID } =
	process.env

if (!DISCORD_BOT_TOKEN) {
	throw new Error('Missing DISCORD_BOT_TOKEN in environment (.env)')
}
if (!DISCORD_APPLICATION_ID) {
	throw new Error('Missing DISCORD_APPLICATION_ID in environment (.env)')
}

const body = Object.values(commands)
const rest = new REST().setToken(DISCORD_BOT_TOKEN)
const route = DISCORD_GUILD_ID
	? Routes.applicationGuildCommands(DISCORD_APPLICATION_ID, DISCORD_GUILD_ID)
	: Routes.applicationCommands(DISCORD_APPLICATION_ID)
const scope = DISCORD_GUILD_ID ? `guild ${DISCORD_GUILD_ID}` : 'globally'

console.log(`Registering ${body.length} command(s) ${scope}…`)
const result = (await rest.put(route, { body })) as
	| RESTPutAPIApplicationCommandsResult
	| RESTPutAPIApplicationGuildCommandsResult
console.log(`Successfully registered ${result.length} command(s) ${scope}.`)
