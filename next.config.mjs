import nextra from 'nextra'
import {z} from 'zod'

const Env = z.object({
  STORAGE_ORIGIN: z.string().url(),
})

const env = Env.parse(process.env)

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
  webpack: (config, {webpack}) => {
    // wtf https://github.com/vercel/next.js/discussions/50177
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^pg-native$|^cloudflare:sockets$/,
      }),
    )

    return config
  },
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
      source: '/https\\://:path*',
      destination: '/api/openapi/https/:path*',
    },
    {
      source: '/https\\:/:path*',
      destination: '/api/openapi/https/:path*',
    },
  ],
  // unfortunately, rewrites won't work for now - vercel storage doesn't let you view html/other browser-renderable content inline: https://vercel.com/docs/storage/vercel-blob#security
  // rewrites: async () => {
  //   return [
  //     {
  //       source: '/artifact/blob/:filepath*',
  //       destination: `${env.STORAGE_ORIGIN}/:filepath*`,
  //     },
  //   ]
  // },
}

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
})

export default withNextra(baseConfig)
