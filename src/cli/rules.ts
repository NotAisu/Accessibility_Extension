import { proofOf } from '../core/analysis';
import { documentedRules, frameworkOf, ruleDoc } from '../core/rule-docs';
import { LANGUAGES } from './check';
import { SCHEMA_VERSION } from './output';

// What `allyproof explain` and `allyproof rules` print, shared with the MCP server's explain_rule, list_rules and
// rule resources (#46), so an agent reads the same docs and proof status as a person.

/** A rule's docs in the examples of `languageId`'s framework, with its proof status; undefined for an unknown rule. */
export function explanation(ruleId: string, languageId = 'html'): string | undefined {
    const doc = ruleDoc(ruleId);
    if (!doc) return undefined;
    const example = doc.examples[frameworkOf(languageId)];
    return [
        `${ruleId}: ${doc.message}`,
        '',
        `WCAG: ${doc.wcag.map(link => `${link.title} (${link.url})`).join('; ')}`,
        '',
        `Why: ${doc.why}`,
        '',
        `How to fix: ${doc.fix}`,
        '',
        `Fails${example.file ? `, in ${example.file}` : ''}:`,
        indent(example.bad),
        '',
        'Passes:',
        indent(example.good),
        '',
        `Proof: ${proofLine(ruleId)}`,
        ''
    ].join('\n');
}

/** Every documented rule with its WCAG criteria, Layer and proof status per language, as `allyproof rules --format json`. */
export function ruleList() {
    return {
        schemaVersion: SCHEMA_VERSION,
        rules: documentedRules().map(ruleId => ({
            ruleId,
            criteria: ruleDoc(ruleId)!.wcag.map(link => link.criterion),
            layer: 'check' as const,
            proof: Object.fromEntries(proofsOf(ruleId).map(({ languageId, proof }) => [languageId, proof]))
        }))
    };
}

const indent = (code: string) => code.split('\n').map(line => `    ${line}`).join('\n');

function proofLine(ruleId: string): string {
    const languages = proofsOf(ruleId);
    if (languages.length === 0) return 'no evidence yet, so its matches are listed as Needs Review';
    return languages.map(({ languageId, proof }) => `${languageId} ${proof.proven ? 'Proven' : 'Unproven'} (${proof.correct} of ${proof.correct + proof.wrong} correct, precision at least ${(proof.lowerBound * 100).toFixed(1)} %)`).join('; ');
}

function proofsOf(ruleId: string) {
    return LANGUAGES.flatMap(languageId => {
        const proof = proofOf(ruleId, languageId);
        return proof ? [{ languageId, proof }] : [];
    });
}
