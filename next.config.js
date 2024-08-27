/** @type {import('next').NextConfig} */
const baseConfig = {
  reactStrictMode: true,
  eslint: {ignoreDuringBuilds: true},
  typescript: {ignoreBuildErrors: true},
}

const withNextra = require('nextra')({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
})

module.exports = withNextra(baseConfig)
