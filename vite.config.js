import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode artifact` produces one self-contained HTML file (no WebRTC features).
export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact';
  return {
    base: './',
    define: { 'import.meta.env.VITE_ARTIFACT': JSON.stringify(artifact) },
    plugins: artifact ? [viteSingleFile()] : [],
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 900,
      outDir: artifact ? 'dist-artifact' : 'dist',
      copyPublicDir: !artifact,
    },
  };
});
