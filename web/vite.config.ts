import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 2756,
		proxy: {
			'/api': 'http://localhost:2755',
			'/runs': 'http://localhost:2755',
			'/health': 'http://localhost:2755',
		},
	},
});
