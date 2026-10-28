import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist', 'coverage', '.vite', 'node_modules',
    // Workspace apps under apps/ build into their own dist folders.
    'apps/*/dist',
    // The Expo app has its own toolchain (tsc + vitest) and its own module
    // system; linting it with the web app's browser globals flags valid
    // CommonJS config plugins as no-undef.
    'mobile',
    // The standalone NLP companion owns its Vite/Vitest environment and dependencies.
    'nlp-lab',
    'backend/.venv*', 'backend/.pytest_cache',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Context modules intentionally co-export provider hooks. These React compiler
      // recommendations are not correctness rules and conflict with existing state-sync UI.
      'react-refresh/only-export-components': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
])
