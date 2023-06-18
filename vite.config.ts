import {resolve} from 'path';

import resolveNode from '@rollup/plugin-node-resolve';
import {svelte} from '@sveltejs/vite-plugin-svelte';
import sveltePreprocess from 'svelte-preprocess';

import {defineConfig} from 'vite';

export default defineConfig(({mode}) => {
	const B_DEV = 'development' === mode;

	return {
		build: {
			outDir: resolve(__dirname, 'dist'),
			emptyOutDir: false,
			minify: !B_DEV,
			sourcemap: B_DEV? 'inline': false,
			target: ['esnext'],
		},

		plugins: [			
			// node-style resolution
			resolveNode({
				browser: true,
			}),

			svelte({
				preprocess: sveltePreprocess({}),
			})
		],
	};
});
