import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_API_PROXY_TARGET || 'http://10.66.101.184:3002'

  return {
    server: {
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
        },
      },
    },
  }
})
