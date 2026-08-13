import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { devRoomServer } from './dev/devRoomServer.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), devRoomServer()],
  build: {
    target: 'es2022',
    // The word list is pulled in via dynamic import, so Rollup already splits it
    // into its own chunk. No manual chunking needed.
  },
})
