import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
    plugins: [react(), viteSingleFile()],
    root: '.',
    build: {
        target: 'esnext',
        assetsInlineLimit: 100000000,
        chunkSizeWarningLimit: 100000000,
        cssCodeSplit: false,
        brotliSize: false,
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            output: {
                inlineDynamicImports: true,
                entryFileNames: '[name].js',
            },
        },
    },
});
