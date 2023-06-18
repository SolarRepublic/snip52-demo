/// <reference types="vite/client" />

import type { HttpsUrl, SecretBech32 } from '@solar-republic/neutrino'

interface ImportMetaEnv {
	readonly VITE_CHAIN_ID: string;
	readonly VITE_LCD: HttpsUrl;
	readonly VITE_RPC: HttpsUrl;
	readonly VITE_CONTRACT: SecretBech32;
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
