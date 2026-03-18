import alchemy from 'alchemy/cloudflare/tanstack-start'
import {tanstackStart} from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {defineConfig} from 'vite'

const rootDir = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  plugins: [alchemy(), tanstackStart(), react()],
  resolve: {
    alias: {
      '@artifact/config': path.join(rootDir, 'packages/config/src'),
      '@artifact/domain': path.join(rootDir, 'packages/domain/src'),
      '~': path.join(rootDir, 'src'),
    },
  },
})
