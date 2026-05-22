import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: [
      'src/main/providers/provider-contract-suite.test.ts',
      'src/main/backends/repository-backend-contract-suite.test.ts'
    ],
    restoreMocks: true
  }
})
