import { defineConfig } from 'vite';
import istanbul from 'vite-plugin-istanbul';

export default defineConfig({
  plugins: [
    istanbul({
      include: 'src/**/*.{js,jsx,ts,tsx}',
      exclude: ['node_modules', 'test/**', 'tests/**', '**/*.spec.ts'],
      extension: ['.js', '.jsx', '.ts', '.tsx'],
      requireEnv: false,
    }),
  ],
  build: {
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
