import { defineConfig } from 'vitest/config'

/**
 * The primitives module imports the shell's ui-primitives package for its
 * chevron icon, which transitively pulls stylesheet assets (katex.min.css).
 * Node's ESM loader has no handler for `.css`, so tests must run through Vite's
 * transform pipeline, which inlines CSS as an empty module.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    server: {
      deps: {
        // Transform the package rather than externalising it to Node's loader.
        inline: [/@deepseek-ai\/dsh-client-ui-primitives/],
      },
    },
  },
})
