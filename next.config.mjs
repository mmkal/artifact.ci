import nextra from 'nextra'

/** @type {import('next').NextConfig} */
const baseConfig = {
  reactStrictMode: true,
  eslint: {ignoreDuringBuilds: true},
  typescript: {ignoreBuildErrors: true},
  productionBrowserSourceMaps: true,
  experimental: {
    serverSourceMaps: true,
    serverActions: {
      allowedOrigins: ['http://localhost:3000', 'http://localhost:3001', 'https://*.vercel.app'],
      bodySizeLimit: '100mb',
    },
  },
  webpack: (config, {isServer}) => {
    // wtf https://github.com/vercel/next.js/discussions/50177
    config.externals.push('cloudflare:sockets')
    if (isServer) config.devtool = 'inline-source-map'

    return config
  },
  redirects: async () => [
    {
      source: '/artifact',
      destination: '/artifact/view',
      permanent: false,
    },
  ],
  rewrites: async () => [
    {
      source: '/ingest/static/:path*',
      destination: 'https://us-assets.i.posthog.com/static/:path*',
    },
    {
      source: '/ingest/:path*',
      destination: 'https://us.i.posthog.com/:path*',
    },
    {
      source: String.raw`/https\://:path*`,
      destination: '/api/openapi/https/:path*',
    },
    {
      source: String.raw`/https\:/:path*`,
      destination: '/api/openapi/https/:path*',
    },
  ],
}

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
})

export default withNextra(baseConfig)
