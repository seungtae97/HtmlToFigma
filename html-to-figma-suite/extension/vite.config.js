import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync } from 'fs';

export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                popup: resolve(__dirname, 'src/popup/index.html'),
                content: resolve(__dirname, 'src/content/content.js'),
                background: resolve(__dirname, 'src/background/background.js'),
            },
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: '[name].js',
                assetFileNames: '[name].[ext]',
            },
        },
        outDir: 'dist',
        emptyOutDir: true,
    },
    plugins: [
        {
            name: 'copy-manifest',
            writeBundle() {
                copyFileSync(resolve(__dirname, 'src/manifest.json'), resolve(__dirname, 'dist/manifest.json'));
                copyFileSync(resolve(__dirname, 'src/content/content.js'), resolve(__dirname, 'dist/content.js'));
            }
        }
    ]
});
