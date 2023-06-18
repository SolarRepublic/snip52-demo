
import { Wallet, gen_sk } from '@solar-republic/neutrino';
import App from './App.svelte';
import {ls_read_b64, ls_write_b64} from '@nfps.dev/runtime';
import { hex_to_buffer } from '@blake.regalia/belt';

let atu8_sk = ls_read_b64('sk');
if(!atu8_sk) {
	atu8_sk = gen_sk();
	ls_write_b64('sk', atu8_sk);
}

const K_WALLET = await Wallet(atu8_sk, import.meta.env['VITE_CHAIN_ID'], import.meta.env['VITE_LCD'], import.meta.env['VITE_RPC']);

// grant feegrant from assaf's testnet demo wallet  :)
const K_GRANTER = await Wallet(
	hex_to_buffer('0c6d4f954d05df5fc97d14913b8f530e5814b01323854c4461f595d406641fbe'),
	K_WALLET.ref, K_WALLET.lcd, K_WALLET.rpc);


const k_app = new App({
	target: document.body,
	context: new Map(Object.entries({
		env: {
			K_WALLET,
			K_GRANTER,
		},
	})),
});

export default k_app;
