import tseslint from 'typescript-eslint';

// Pre-rebuild AI code, replaced by the AI Review module (#18); remove from this list when it goes
const LEGACY = ['src/extension.ts', 'src/ai/**', 'src/llm/**'];

export default tseslint.config(
    { ignores: ['out', 'dist', '**/*.d.ts'] },
    {
        files: ['**/*.ts'],
        extends: [tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
        },
        rules: {
            '@typescript-eslint/naming-convention': ['warn', { selector: 'property', format: null }],
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            curly: 'off',
            eqeqeq: 'warn',
            'no-throw-literal': 'warn',
            semi: 'off'
        }
    },
    {
        // The analysis core runs outside VS Code: in tests, the ground-truth gate and the analysis worker
        files: ['src/core/**/*.ts'],
        rules: {
            'no-restricted-imports': ['error', {
                paths: [{ name: 'vscode', message: 'The analysis core has no VS Code dependency; adapt in the extension layer.' }]
            }]
        }
    },
    {
        files: LEGACY,
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/require-await': 'off',
            '@typescript-eslint/no-unnecessary-type-assertion': 'off',
            '@typescript-eslint/no-require-imports': 'off',
            '@typescript-eslint/no-misused-promises': 'off'
        }
    }
);
