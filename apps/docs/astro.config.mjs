import starlight from '@astrojs/starlight'
import {defineConfig} from 'astro/config'

export default defineConfig({
  site: 'https://artifact.ci',
  output: 'static',
  vite: {
    server: {
      hmr: false,
    },
  },
  integrations: [
    starlight({
      title: 'artifact.ci',
      description: 'Docs for publishing and viewing build artifacts without cargo-culting a full app framework into the docs stack.',
      pagefind: false,
      customCss: ['./src/styles/theme.css'],
      components: {
        SocialIcons: './src/components/SocialIcons.astro',
      },
      social: [
        {icon: 'github', label: 'GitHub', href: 'https://github.com/mmkal/artifact.ci'},
      ],
      sidebar: [
        {
          label: 'Start here',
          items: ['index', 'advanced', 'not', 'self-hosting'],
        },
        {
          label: 'Recipes — JS test frameworks',
          autogenerate: {directory: 'recipes/testing'},
        },
        {
          label: 'Recipes — other languages',
          autogenerate: {directory: 'recipes/other-languages'},
        },
        {
          label: 'Recipes — more',
          autogenerate: {directory: 'recipes/more'},
        },
        {
          label: 'Recipes — misc',
          items: ['recipes/badges', 'recipes/viewing-artifacts'],
        },
        {
          label: 'Guides',
          autogenerate: {directory: 'guides'},
        },
        {
          label: 'Legal',
          autogenerate: {directory: 'legal'},
        },
      ],
    }),
  ],
})
