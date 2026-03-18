import alchemy from 'alchemy/cloudflare/astro'
import react from '@astrojs/react'
import starlight from '@astrojs/starlight'
import {defineConfig} from 'astro/config'

export default defineConfig({
  site: 'https://artifact.ci',
  adapter: alchemy({prerenderEnvironment: 'node'}),
  output: 'server',
  integrations: [
    react(),
    starlight({
      title: 'artifact.ci',
      description: 'Docs for publishing and viewing build artifacts without cargo-culting a full app framework into the docs stack.',
      prerender: false,
      pagefind: false,
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
