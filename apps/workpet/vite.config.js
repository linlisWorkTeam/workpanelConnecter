import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { copyFileSync, cpSync, createReadStream, mkdirSync } from 'node:fs';

const modelsSource = fileURLToPath(new URL('./ui/models', import.meta.url));
const modelsOutput = fileURLToPath(new URL('./dist/models', import.meta.url));
const cubismCoreSource = fileURLToPath(new URL('./node_modules/live2dcubismcore/live2dcubismcore.min.js', import.meta.url));
const cubismCoreOutput = fileURLToPath(new URL('./dist/vendor/live2dcubismcore.min.js', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('./ui', import.meta.url)),
  base: './',
  server: {
    strictPort: true,
  },
  plugins: [
    {
      name: 'serve-and-copy-live2d-assets',
      configureServer(server) {
        server.middlewares.use('/vendor/live2dcubismcore.min.js', (_request, response) => {
          response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          createReadStream(cubismCoreSource).pipe(response);
        });
      },
      closeBundle() {
        cpSync(modelsSource, modelsOutput, { recursive: true });
        mkdirSync(fileURLToPath(new URL('./dist/vendor', import.meta.url)), { recursive: true });
        copyFileSync(cubismCoreSource, cubismCoreOutput);
      },
    },
  ],
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
});
