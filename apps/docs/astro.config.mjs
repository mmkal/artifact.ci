import starlight from '@astrojs/starlight'
import {defineConfig} from 'astro/config'

export default defineConfig({
  site: 'https://artifact.ci',
  output: 'static',
  // Canonical URLs have no trailing slash. Keep Astro's default directory
  // output (`/foo/index.html`) so generated anchor hrefs stay extensionless
  // — the frontdoor rewrites `/foo` to `/foo/index.html` on the upstream
  // fetch, and 308s any `/foo/` back to `/foo`.
  trailingSlash: 'never',
  vite: {
    server: {
      hmr: false,
    },
  },
  integrations: [
    starlight({
      title: 'artifact.ci',
      description: 'Docs for publishing and viewing build artifacts without cargo-culting a full app framework into the docs stack.',
      customCss: ['./src/styles/theme.css'],
      // Data-URI SVG with the moai emoji — matches the app's favicon and
      // avoids needing a real .ico file in apps/docs/public.
      head: [
        {
          tag: 'link',
          attrs: {
            rel: 'icon',
            href: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🗿</text></svg>',
          },
        },
      ],
      components: {
        SocialIcons: './src/components/SocialIcons.astro',
      },
      social: [
        {icon: 'github', label: 'GitHub', href: 'https://github.com/mmkal/artifact.ci'},
      ],
      // Priority order mirrors index.mdx's "Usage" section — autogenerate
      // would fall back to alphabetical, so items are listed explicitly.
      sidebar: [
        {
          label: 'Start here',
          items: ['index', 'advanced', 'not', 'self-hosting'],
        },
        {
          label: 'Recipes — JS test frameworks',
          items: [
            'recipes/testing/vitest',
            'recipes/testing/playwright',
            'recipes/testing/jest',
            'recipes/testing/mocha',
            'recipes/testing/ava',
          ],
        },
        {
          label: 'Recipes — other languages',
          items: ['recipes/other-languages/python', 'recipes/other-languages/go'],
        },
        {
          label: 'Recipes — more',
          items: ['recipes/more/website', 'recipes/more/pdf', 'recipes/more/eslint'],
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
