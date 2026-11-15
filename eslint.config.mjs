import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['out', 'dist', '**/*.d.ts'] },
    {
        files: ['**/*.ts'],
        languageOptions: { parser: tseslint.parser, ecmaVersion: 2020, sourceType: 'module' },
        plugins: { '@typescript-eslint': tseslint.plugin },
        rules: {
            '@typescript-eslint/naming-convention': ['warn', { selector: 'property', format: null }],
            curly: 'off',
            eqeqeq: 'warn',
            'no-throw-literal': 'warn',
            semi: 'off'
        }
    }
);
