<script lang="ts">
	import { hex_to_buffer, type AsJson, type JsonObject, timeout } from '@blake.regalia/belt';
	import {bech32_decode, exec_contract, SecretContract, type SecretBech32, msgGrantAllowance, anyBasicAllowance, broadcast_result, create_and_sign_tx_direct, sign_query_permit, query_contract_infer} from '@solar-republic/neutrino';

	import { getContext, setContext, tick } from 'svelte';
	import WalletSvelte from './Wallet.svelte';

	import {
		Wallet,
		gen_sk,
		subscribe_snip52_channels,
	} from '@solar-republic/neutrino';

	import { create_html, ls_read_json, ls_write_json, qsa } from '@nfps.dev/runtime';

	interface Contact extends JsonObject {
		address: SecretBech32;
		name: string | null;
	}

	interface Message {
		time: number;
		text: string;
		reactions: string[];
		me: boolean;
	}

	interface Conversation {
		contact: Contact;
		messages: Message[];
	}

	type ChatHistory = Record<SecretBech32, Conversation>;

	const {
		K_WALLET,
		K_GRANTER,
	} = getContext<{
		K_WALLET: Wallet,
		K_GRANTER: Wallet,
	}>('env');

	let y_wallet!: WalletSvelte;

	let dm_draft: HTMLTextAreaElement;

	let h_chats: ChatHistory = ls_read_json<AsJson<ChatHistory>>('history') || {};

	let s_input = '';
	let b_input_disabled = false;

	let dp_contract = SecretContract(K_WALLET.lcd, import.meta.env['VITE_CONTRACT']);
	let k_contract;

	let g_convo: Conversation | null = null;

	(async function load() {
		k_contract = await dp_contract;

		if(y_wallet && !Object.keys(h_chats).length) {
			y_wallet.reset_menu();
			y_wallet.notify('Direct messaging', [
				'Share your address with a friend:',

				create_html('code', {}, [
					K_WALLET.addr,
				]),

				create_html('div', {
					style: 'display: flex; gap: 6px;',
				}, [
					create_html('button', {
						class: 'copy-addr cta',
					}, [
						'Copy',
					]),

					create_html('button', {
						class: 'dismiss',
					}, [
						'Dismiss',
					]),
				])
			]);

			await tick();

			const dm_copy = qsa(document.body, '.copy-addr')[0];
			dm_copy.onclick = () => {
				navigator.clipboard.writeText(K_WALLET.addr);
				dm_copy.textContent = 'Copied!';
			};

			qsa(document.body, '.dismiss')[0].onclick = () => {
				y_wallet.reset_menu();
				y_wallet.generic_click();
			};
		}

		const g_permit = await sign_query_permit(K_WALLET, 'snip52-demo', [k_contract.addr], ['owner']);

		let [g_result, xc_code, s_error] = await query_contract_infer(k_contract, 'channel_info', {
			channel: 'message',
		}, g_permit);

		debugger;

		console.log(g_result, xc_code, s_error);


		subscribe_snip52_channels(K_WALLET.rpc, k_contract, g_permit, {
			message() {

			},

			reaction() {

			},
		});
	})();

	async function new_contact() {
		// valid address
		if(/^secret1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38}$/.exec(s_input) && bech32_decode(s_input)) {
			// disable input
			b_input_disabled = true;

			// prep contact
			const g_contact = {
				address: s_input as SecretBech32,
				name: null,
			};

			// open chat
			load_chat(g_contact);

			// clear input and re-enable it
			s_input = '';
			b_input_disabled = false;

			dm_draft.focus();
		}
	}

	function keydown(d_event: KeyboardEvent) {
		if('Enter' === d_event.key) {
			d_event.preventDefault();
			void send_message();
		}
	}

	async function load_chat(g_contact: Contact) {
		g_convo = h_chats[g_contact.address] || (h_chats[g_contact.address] = {
			contact: g_contact,
			messages: [],
		});
	}

	let s_chat_message = '';
	let b_chat_disabled = false;
	async function send_message() {
		if(!g_convo) return;

		// disable input
		b_chat_disabled = true;

		const sa_recipient = g_convo.contact.address;

		// submit tx
		const [xc_code, sx_res, g_tx_res] = await exec_contract(await dp_contract, K_WALLET, {
			send: {
				recipient: sa_recipient,
				message: s_chat_message,
			},
		}, [['2500', 'uscrt']], '50000', '', K_GRANTER.addr);

		debugger;
		console.log(xc_code, sx_res, g_tx_res);

		// add message to convo
		// if(!xc_code && g_tx_res) {
			h_chats[sa_recipient].messages.push({
				time: Date.now(),
				text: s_chat_message,
				reactions: [],
				me: true,
			});

			// invalidate chats object and update storage
			ls_write_json('history', (h_chats=h_chats) as AsJson<typeof h_chats>);
			
			// invalidate convo
			if(sa_recipient === g_convo.contact.address) {
				g_convo = h_chats[sa_recipient];
			}
		// }

		// clear input and re-enable it
		s_chat_message ='';
		b_chat_disabled = false;

		void y_wallet.refresh_spendable_gas();
	}

	let b_busy = false;
	async function spendable_update(d_event: CustomEvent<bigint>) {
		if(b_busy) return;

		// running low or out of funds
		if(d_event.detail < 50_000n) {
			b_busy = true;

			const atu8_allowance = anyBasicAllowance([['10000000', 'uscrt']]);
			const atu8_grant = msgGrantAllowance(K_GRANTER.addr, K_WALLET.addr, atu8_allowance);

			// sign in direct mode
			let [atu8_tx_raw, , si_txn] = await create_and_sign_tx_direct(K_GRANTER, [atu8_grant], [['190', 'uscrt']], '15000');

			// broadcast to chain
			let [xc_error, sx_res, g_tx_res] = await broadcast_result(K_GRANTER, atu8_tx_raw, si_txn);

			// no errors; refresh spendable
			if(!xc_error && g_tx_res) {
				await timeout(1e3);
				y_wallet.refresh_spendable_gas();
			}

			b_busy = false;
		}
	}

</script>

<style lang="less">
	:global(body) {
		background: #313138;
		color: #f7f7f7;
		font-family: Tahoma;

		margin: 1em 2em;
		overflow: hidden;
	}

	code {
		background-color: rgba(0,0,0,0.2);
		padding: 8px 12px;
		overflow: scroll;
	}

	input, textarea {
		background: rgba(0,0,0,0.2);
		color: #fff;
		padding: 8px 12px;
		border: 0;
		width: 40ch;
		border-radius: 4px;

		&:focus {
			outline: 1px solid orange;
			border-radius: 2px;
		}

		&:disabled {
			:global(&) {
				opacity: 0.8;
			}
		}
	}

	.title {
		h1, h2, h3, h4 {
			margin: 0;
		}

		h4 {
			font-weight: 400;
		}
	}

	section {
		margin: 2em 0;
		position: absolute;
		height: calc(100% - 150px);
	}

	.app {
		display: flex;
		width: 100%;

		.nav {
			border-right: 1px solid #888;
			padding-right: 1em;
			margin-right: 1em;
			width: 320px;
			overflow: hidden;
			padding-left: 1px;

			.new {
				display: flex;
				flex-direction: column;
				gap: 1em;

				>div {
					display: flex;
					flex-direction: column;
					gap: 6px;
				}
			}

			#new-contact {
				margin-top: 4px;
				font-size: 1em;
				width: 40ch;
				max-width: calc(100% - 20px);
				font-family: monospace;
			}

			.contacts {
				font-size: 14px;
				display: flex;
				flex-direction: column;
				gap: 1em;
				margin-top: 1em;

				>div {
					border: 1px solid rgba(250,250,250,0.2);
					border-radius: 4px;
					padding: 8px 12px;
					cursor: pointer;
					overflow: hidden;

					&.active {
						background: rgba(0,0,0,0.4);
						border-color: white;
					}
				}
			}
		}

		.chat {
			flex-grow: 1;
			max-width: 800px;

			display: flex;
			flex-direction: column;
			gap: 1em;

			.convo {
				flex-grow: 1;
				padding-bottom: 1em;
				border-bottom: 1px solid #888;
			}

			.draft {
				flex-basis: 50px;
				display: flex;
				gap: 2px;

				textarea {
					flex-grow: 1;
				}

				button {
					height: 100%;
					flex-basis: 125px;
					background: #222;
					border: 1px solid #0470ee;
					color: #f7f7f7;

					&:disabled {
						opacity: 0.8;
					}
				}
			}
		}
	}

	.info {
		display: flex;
		gap: 2em;
		color: #ccc;
	}

</style>

<div class="title">
	<h1>
		Chat App Demo for Secret Network
	</h1>
	<h2>
		SNIP-52: Private Push Notifications
	</h2>
	<h4>
		By Blake Regalia (supdoggie) and Ben Adams (darwinzer0)
	</h4>
</div>

<section class="app">
	<!-- <div class="info">
		<span>
			Chain: {import.meta.env['VITE_CHAIN_ID']}
		</span>
		<span>
			LCD: {import.meta.env['VITE_LCD']}
		</span>
		<span>
			RPC: {import.meta.env['VITE_RPC']}
		</span>
		<span>
			Contract: {import.meta.env['VITE_CONTRACT']}
		</span>
	</div> -->
	<div class="nav">
		<div class="new">
			<div>
				<div>
					Your hot wallet address:
				</div>
				<code>
					{K_WALLET?.addr}
				</code>
			</div>

			<label>
				<div>
					Paste an address to start a new chat:
				</div>
				<input id="new-contact" type="text" bind:value={s_input} on:input={new_contact} placeholder="secret1...">
			</label>
		</div>

		{#if Object.keys(h_chats)?.length}
			<div>
				<h3>
					Contacts
				</h3>
			</div>
		{/if}

		<div class="contacts">
			{#each Object.entries(h_chats) as [sa_contact, g_chat] (sa_contact)}
				<div class:active={g_chat.contact.address === sa_contact}>
					{g_chat.contact.name ?? sa_contact}
				</div>
			{/each}
		</div>
	</div>

	<div class="chat">
		<div class="convo">
			{#each (g_convo?.messages || []) as g_msg, i_msg (i_msg)}
				<div class="metadata">
					<span class="who">
						{#if g_msg.me}
							You:
						{:else}
							{g_convo?.contact.name ?? g_convo?.contact.address}
						{/if}
					</span>
					<span class="when">
						{new Date(g_msg.time).toISOString()}
					</span>
				</div>
				<div class="message">
					{g_msg.text}
				</div>
			{/each}
		</div>
		<div class="draft">
			<textarea bind:this={dm_draft} disabled={b_chat_disabled} bind:value={s_chat_message} on:keydown={keydown}></textarea>
			<button disabled={b_chat_disabled}>
				Send{b_chat_disabled? 'ing...': ''}
			</button>
		</div>
	</div>
</section>

<WalletSvelte bind:this={y_wallet} on:spendable={spendable_update} />