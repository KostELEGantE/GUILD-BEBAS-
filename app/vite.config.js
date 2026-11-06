import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Port 3000 = URL default di pengaturan Auth Supabase (http://localhost:3000)
export default defineConfig({
  plugins: [react()],
  server: { port: 3000, strictPort: true },
})
