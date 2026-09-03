import { defineConfig } from 'vitest/config'

// Harness aparte para el proceso principal de Electron (electron/**). Corre en
// Node puro (sin jsdom, sin Angular): estos módulos hablan con SQLite y HTTP,
// no con el DOM. `npm test` (Angular @angular/build:unit-test) sigue intacto y
// solo mira src/** — este config nunca se cruza con aquél porque acota `include`
// a los specs de electron/.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/**/*.spec.ts'],
    watch: false,
  },
})
