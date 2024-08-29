const {z} = require('zod')

const Env = z.object({
  STORAGE_ORIGIN: z.string().url(),
})

const env = Env.parse(process.env)

/** @type {import('next').NextConfig} */
const baseConfig = {
  reactStrictMode: true,
  eslint: {ignoreDuringBuilds: true},
  typescript: {ignoreBuildErrors: true},
  experimental: {
    serverActions: {
      allowedOrigins: ['http://localhost:3000', 'http://localhost:3001', 'https://*.vercel.app'],
      bodySizeLimit: '100mb',
    },
  },
  rewrites: async () => {
    return [
      {
        source: '/artifact/blob/:filepath*',
        destination: `${env.STORAGE_ORIGIN}/:filepath*`,
      },
    ]
  },
}

const withNextra = require('nextra')({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
})

module.exports = withNextra(baseConfig)
