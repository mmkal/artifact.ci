import cloudflare from '@astrojs/cloudflare'
import react from '@astrojs/react'
import starlight from '@astrojs/starlight'
import {defineConfig} from 'astro/config'

export default defineConfig({
  adapter: cloudflare(),
  integrations: [
    react(),
    starlight({
      title: 'artifact.ci',
      description: 'Docs for publishing and viewing build artifacts without cargo-culting a full app framework into the docs stack.',
      sidebar: [
        {
          label: 'Start Here',
          items: ['index', 'guides/architecture', 'guides/routing'],
        },
        {
          label: 'Recipes',
          autogenerate: {directory: 'recipes'},
        },
      ],
    }),
  ],
})
