import type { AnalysisOptions, RuleSetting } from '../core/analysis';

/** A problem with the configuration the command line was given; exit code 2. */
export class ConfigError extends Error {}

const RULE_SETTINGS: readonly RuleSetting[] = ['off', 'error', 'warning', 'information'];

/**
 * The Check's options from the text of a `.vscode/settings.json`: the same `allyproof.rules`, `allyproof.components`
 * and `allyproof.polymorphicPropName` keys the editor reads. The file is data, parsed as JSON with comments.
 */
export function optionsFromSettings(text: string, file: string): AnalysisOptions {
    let settings: unknown;
    try {
        settings = JSON.parse(withoutComments(text));
    } catch (error) {
        throw new ConfigError(`${file} is not valid JSON: ${(error as Error).message}`);
    }
    if (!isRecord(settings)) throw new ConfigError(`${file} must hold a JSON object`);
    const rules = settings['allyproof.rules'] ?? {};
    const components = settings['allyproof.components'] ?? {};
    const polymorphicPropName = settings['allyproof.polymorphicPropName'] ?? '';
    if (!isRecord(rules) || !Object.values(rules).every(value => RULE_SETTINGS.includes(value as RuleSetting))) {
        throw new ConfigError(`allyproof.rules in ${file} maps rule ids to one of ${RULE_SETTINGS.join(', ')}`);
    }
    if (!isRecord(components) || !Object.values(components).every(value => typeof value === 'string')) {
        throw new ConfigError(`allyproof.components in ${file} maps component names to element names`);
    }
    if (typeof polymorphicPropName !== 'string') throw new ConfigError(`allyproof.polymorphicPropName in ${file} is a string`);
    return {
        rules: rules as Record<string, RuleSetting>,
        components: { components: components as Record<string, string>, ...polymorphicPropName ? { polymorphicPropName } : {} }
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// JSON with comments, as VS Code writes settings: line and block comments and trailing commas, outside strings
export function withoutComments(text: string): string {
    let out = '';
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '"') {
            const end = stringEnd(text, i);
            out += text.slice(i, end);
            i = end - 1;
        } else if (char === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            out += '\n';
        } else if (char === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end === -1 ? text.length : end + 1;
        } else {
            out += char;
        }
    }
    // shortcut: also drops a comma before } or ] inside a string value, upgrade to a scanner if a setting needs one
    return out.replace(/,(\s*[}\]])/g, '$1');
}

function stringEnd(text: string, start: number): number {
    for (let i = start + 1; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === '"') return i + 1;
    }
    return text.length;
}
