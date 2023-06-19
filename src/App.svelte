<script lang="ts">
	import {base64_to_buffer, type AsJson, type JsonObject, sha256, text_to_buffer, buffer_to_base58, buffer_to_base93, buffer_to_base64, type Base64, buffer_to_text} from '@blake.regalia/belt';
	import {timeout} from '@blake.regalia/belt';
	import {bech32_decode, exec_contract, SecretContract, type SecretBech32, msgGrantAllowance, anyBasicAllowance, broadcast_result, create_and_sign_tx_direct, sign_query_permit, query_contract_infer, bech32_encode} from '@solar-republic/neutrino';

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

		if(s_error) {
			y_wallet.cta('Testnet Instability', [
				'The API node failed to process a query. This can happen occKionally on the pulsar testnet. Wait a few minutes and try reloading.',
			], 'Reload', () => {
				location.reload();
			});
		}
		else {
			subscribe_snip52_channels(K_WALLET.rpc, k_contract, g_permit, {
				message(a_data) {
					const [atu8_sender, s_message] = a_data as [Uint8Array, string];

					const sa_sender = bech32_encode('secret', atu8_sender) as SecretBech32;

					h_chats[sa_sender].messages.push({
						time: Date.now(),
						text: s_message,
						reactions: [],
						me: false,
					});

					// invalidate chats object and update storage
					ls_write_json('history', (h_chats=h_chats) as AsJson<typeof h_chats>);
					
					// invalidate convo
					if(sa_sender === g_convo?.contact.address) {
						g_convo = h_chats[sa_sender];
						scroll_bottom();
					}
				},

				async reaction(a_data) {
					const [atu8_sender, atu8_hash, s_emoji] = a_data as [Uint8Array, Uint8Array, string];

					const sa_sender = bech32_encode('secret', atu8_sender) as SecretBech32;
					const sb64_msg_hash = buffer_to_base64(atu8_hash);

					// find message they are reacting to
					for(let g_msg of h_chats[sa_sender].messages.slice().reverse()) {
						const sb64_hash = buffer_to_base64(await sha256(text_to_buffer(g_msg.text)));
						if(sb64_hash === sb64_msg_hash) {
							// add reaction
							g_msg.reactions.push(s_emoji);

							// invalidate chats object and update storage
							ls_write_json('history', h_chats=h_chats as AsJson<typeof h_chats>);

							// invalidate convo
							if(sa_sender === g_convo?.contact.address) {
								g_convo = h_chats[sa_sender];
								scroll_bottom();
							}

							// done
							break;
						}
					}
				},
			});
		}
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

		scroll_bottom();
	}

	let dm_scroll: HTMLDivElement;
	async function scroll_bottom() {
		await tick();

		dm_scroll.scrollTo(0, dm_scroll.scrollHeight);
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

		// add message to convo
		if(!xc_code && g_tx_res) {
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

			// clear input and re-enable it
			s_chat_message = '';
			b_chat_disabled = false;

			scroll_bottom();
		}
		else {
			y_wallet.cta('Transaction Failed', [
				sx_res,
			], 'Retry', () => {
				send_message();
				y_wallet.reset_menu();
			});
		}

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

	let g_msg_reaction_busy: Message | null = null;
	let s_reaction_pending = '';
	async function react(g_msg: Message, s_emoji: string) {
		g_msg_reaction_busy = g_msg;
		s_reaction_pending = s_emoji;

		// submit tx
		const [xc_code, sx_res, g_tx_res] = await exec_contract(await dp_contract, K_WALLET, {
			react: {
				author: g_convo?.contact.address,
				message_hash: buffer_to_base64(await sha256(text_to_buffer(g_msg.text))),
				reaction: s_emoji,
			},
		}, [['2500', 'uscrt']], '50000', '', K_GRANTER.addr);

		// add reaction
		g_msg.reactions.push(s_emoji);

		// invalidate convo
		g_convo = g_convo;

		// invalidate chats object and update storage
		ls_write_json('history', h_chats as AsJson<typeof h_chats>);

		g_msg_reaction_busy = null;
		s_reaction_pending = '';

		scroll_bottom();
	}

	function block_mouse_enter(this: HTMLDivElement) {
		if(!g_msg_reaction_busy) {
			this.classList.add('hovering');
		}
	}

	function block_mouse_leave(this: HTMLDivElement) {
		if(!g_msg_reaction_busy) {
			this.classList.remove('hovering');
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

	a {
		color: #eea;

		&:visited {
			color: #eea;
		}
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
		overflow: hidden;

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
			height: 100%;

			display: flex;
			flex-direction: column;
			gap: 1em;

			align-self: self-end;

			&.align-self_auto {
				align-self: auto;
			}

			.scroll {
				overflow: scroll;
			}

			.convo {
				flex-grow: 1;

				display: flex;
				flex-direction: column;
				gap: 0px;

				.intro {
					max-width: 600px;
					line-height: 1.5em;

					h2:not(:first-child) {
						margin-top: 2em;
					}
				}

				.block {
					padding: 6px 0;

					&.hovering>.metadata>.react:not(.never) {
						visibility: visible;
					}

					&:not(.me) {
						.who {
							color: orange;
						}
					}

					.metadata {
						display: flex;
						align-items: baseline;
						gap: 1em;

						.who {
							font-weight: 600;
							font-size: 12px;
						}

						.when {
							font-size: 11px;
							color: #889;
						}

						.react {
							visibility: hidden;
							display: flex;
							gap: 4px;

							&.busy {
								opacity: 0.6;
							}

							&:not(.busy) {
								>span:hover {
									border-color: #222;
									background: #222;
									border-radius: 4px;
								}
							}

							>span {
								padding: 3px 6px;
								border: 1px solid transparent;
								cursor: pointer;

								&.locked {
									border-color: #222;
									background: #222;
									border-radius: 4px;
								}
							}
						}
					}

					.message {
						padding: 0;
					}

					.reactions {
						display: flex;
						gap: 4px;
						margin-top: 5px;

						&>span {
							background: #262629;
							font-size: 11px;
							border: 1px solid #111;
							padding: 2px 5px;
							border-radius: 4px;
						}
					}
				}
			}

			.draft {
				border-top: 1px solid #888;
				padding-top: 1em;
				margin-bottom: 1px;

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
				<div class:active={g_convo?.contact.address === sa_contact} on:click={() => load_chat(g_chat.contact)}>
					{g_chat.contact.name ?? sa_contact}
				</div>
			{/each}
		</div>
	</div>

	<div class="chat" class:align-self_auto={!g_convo}>
		<div class="scroll" bind:this={dm_scroll}>
			<div class="convo">
				{#if !g_convo}
					<div class="intro">
						<h2>
							What is this?
						</h2>

						<p>
							This app is a demonstration of <a href="https://github.com/SolarRepublic/SNIPs/blob/feat/snip-52/SNIP-52.md">SNIP-52: Private Push Notifications</a> for Secret Network. It is not meant to be used as an actual chat app.
						</p>

						<h2>
							What am I looking at?
						</h2>

						<p>
							Your browser generated a unique hot wallet for you when you opened the page. That wallet has already, or is currently being, funded to send transactions on the Pulsar testnet, see wallet in top right corner.
						</p>
						
						<h2>
							What do I do?
						</h2>

						<p>
							Send your address to a friend, or ask for theirs. Paste an address in the input on the left to start a new chat.
						</p>
						
						<h2>
							What's the point?
						</h2>

						<p>
							If you check your network log, you'll notice that the app does not make queries to the contract to discover new incoming messages. Instead, the contract emits notifications which the node "pushes" to your device via WebSocket.
						</p>
					</div>
				{:else}
					{#each (g_convo?.messages || []) as g_msg, i_msg (i_msg)}
						<div class="block"
							class:me={g_msg.me}
							class:hovering={g_msg === g_msg_reaction_busy}
							on:mouseenter={block_mouse_enter}
							on:mouseleave={block_mouse_leave}
						>
							<div class="metadata">
								<span class="who">
									{#if g_msg.me}
										You:
									{:else}
										{g_convo?.contact.name ?? g_convo?.contact.address}
									{/if}
								</span>
								<span class="when">
									{new Date(g_msg.time).toLocaleString()}
								</span>
								<span class="react" class:never={g_msg.me} class:busy={g_msg === g_msg_reaction_busy}>
									{#each ['👍', '🤣', '💯', '🔥'] as s_emoji}
										<span class:locked={s_emoji === s_reaction_pending}
											on:click={() => react(g_msg, s_emoji)}
										>
											{s_emoji}
										</span>
									{/each}
								</span>
							</div>
							<div class="message">
								{g_msg.text}
							</div>
							{#if g_msg.reactions.length}
								<div class="reactions">
									{#each g_msg.reactions as s_reaction}
										<span>{s_reaction}</span>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</div>
		<div class="draft">
			<textarea bind:this={dm_draft} disabled={!g_convo || b_chat_disabled} bind:value={s_chat_message} on:keydown={keydown}></textarea>
			<button disabled={!g_convo || b_chat_disabled}>
				Send{b_chat_disabled? 'ing...': ''}
			</button>
		</div>
	</div>
</section>

<WalletSvelte bind:this={y_wallet} on:spendable={spendable_update} />