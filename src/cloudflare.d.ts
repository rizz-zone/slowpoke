import type { PendingRegistration } from '@/durable/pending_registration'

declare global {
	namespace Cloudflare {
		interface Env {
			PENDING_REGISTRATION: DurableObjectNamespace<PendingRegistration>
			DISCORD_CONSUMABLE_SKU?: string
			ALWAYS_FREE_USERS?: string
		}

		interface GlobalProps {
			durableNamespaces: 'PendingRegistration'
		}
	}
}

export {}
