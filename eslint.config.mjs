import tseslint from 'typescript-eslint';

export default tseslint.config(
    // Ground-truth cases and typical files are checked code, not project code
    { ignores: ['out', 'dist', '**/*.d.ts', 'test/ground-truth/*/cases', 'test/ground-truth/field', 'test/ground-truth/injection', 'test/unit/fixtures/typical'] },
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
        // The analysis core runs outside VS Code: in tests, the ground-truth gate and the analysis worker.
        // The AI Review module too: it runs against a fake model port in tests and the AI benchmark.
        files: ['src/core/**/*.ts', 'src/review/**/*.ts'],
        rules: {
            'no-restricted-imports': ['error', {
                paths: [{ name: 'vscode', message: 'The analysis core has no VS Code dependency; adapt in the extension layer.' }]
            }]
        }
    }
);
