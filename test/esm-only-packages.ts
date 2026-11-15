import { registerHooks } from 'module';

// eslint-plugin-astro and astro-eslint-parser export only an "import" entry, which the CommonJS
// require() of the TypeScript source under ts-node cannot resolve. The bundle imports them as ESM.
const ESM_ONLY = ['eslint-plugin-astro', 'astro-eslint-parser'];

registerHooks({
    resolve: (specifier, context, next) => next(specifier, ESM_ONLY.includes(specifier)
        ? { ...context, conditions: [...context.conditions, 'import'] }
        : context)
});
