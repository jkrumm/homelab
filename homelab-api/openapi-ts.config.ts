import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: 'https://ticktick.com/openapi.yaml',
  output: {
    path: 'src/generated/ticktick',
    postProcess: ['prettier'],
  },
  plugins: ['@hey-api/client-fetch', '@hey-api/sdk', '@hey-api/typescript'],
})
