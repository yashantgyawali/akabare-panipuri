import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  build: {
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks (cache well across deploys) and the shared card components;
        // the routes themselves are lazy-loaded in src/App.tsx.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/ },
            { name: 'cards', test: (id: string) => /src[\\/]cards[\\/]/.test(id) && !id.includes('CardGallery') },
          ],
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
} as never);
