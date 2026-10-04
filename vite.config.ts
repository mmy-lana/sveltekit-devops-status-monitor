import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-auto';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter(),
      // `plan.md` specifies `$lib/...` module specifiers throughout the codebase.
      // SvelteKit 3 defaults to `#lib`, so the legacy alias is restored here to
      // keep the documented import contract intact.
      alias: { $lib: 'src/lib' }
    })
  ]
});
