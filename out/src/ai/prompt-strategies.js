"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDefaultStrategy = exports.getPromptStrategy = exports.PROMPT_STRATEGIES = void 0;
// Direct instruction (zero-shot)
class DirectInstructionStrategy {
    constructor() {
        this.name = 'direct-instruction';
        this.displayName = 'Direct Instruction (Zero-Shot)';
        this.description = 'Optimized zero-shot approach with explicit role assignment and structured task decomposition';
    }
    generatePrompt(codeWithLineNumbers) {
        return `DIRECT WCAG 2.2 AA ACCESSIBILITY AUDIT (ZERO-SHOT)

TASK:
Identify ONLY genuine WCAG 2.2 Level AA violations in the code. If none: output nothing.

EXCLUDE (never report): stylistic preferences, SEO, performance, maintainability, speculative UX, color contrast guesses without evidence, vague risks.

FOCUS (illustrative, not exhaustive):
1.1.1 text alternatives | 1.3.1 structure | 1.4.1 colour reliance | 2.4.4 link purpose | 3.3.2 form labels | 4.1.2 name/role/value

ZERO-SHOT CHECKLIST (internal, silent):
1. Line scan → potential normative obligation?  
2. Confirm concrete criterion violated (no guessing).  
3. Draft minimal actionable fix (no rewrites).  
4. Remove borderline / ambiguous cases.  
5. Enforce uniqueness (line, ruleId) & format.  

OUTPUT (JSON Lines ONLY, no extra prose):
{"line": <int>, "element": "<minimal snippet>", "issue": "<concise violation>", "recommendation": "<minimal actionable fix>", "ruleId": "<SC>"}
Rules: ruleId pattern ^([1-4]\.[1-4]\.[1-9]|2\.5\.8)$ ; ≤1 object per source line; no duplicates; issue ≤80 chars; recommendation ≤120 chars.
No arrays. No markdown. Empty output if no violations.

SILENT SELF-VERIFY before emitting: all genuine, no style/false positives, format valid.

CODE:
<<<
${codeWithLineNumbers}
>>>`;
    }
}
// Few-shot with examples
class FewShotStrategy {
    constructor() {
        this.name = 'few-shot';
        this.displayName = 'Few-Shot Learning';
        this.description = 'Strategic pattern induction through curated high-signal examples';
    }
    generatePrompt(codeWithLineNumbers) {
        return `WCAG 2.2 AA ACCESSIBILITY AUDIT (FEW-SHOT)

OBJECTIVE:
Generalise from exemplars. Report only genuine WCAG 2.2 AA violations. Output nothing if none.

EXEMPLARS (Input → Expected JSON Line):
1)
<div onclick="save()">Save</div>
{"line": 1, "element": "<div onclick=\"save()\">", "issue": "Div used as button lacks semantics", "recommendation": "Use <button onclick=\"save()\">Save</button>", "ruleId": "4.1.2"}

2)
<input type="email" placeholder="Email">
{"line": 1, "element": "<input type=\"email\">", "issue": "Email input missing accessible label", "recommendation": "Add <label for=\"em\">Email</label> + id=\"em\"", "ruleId": "3.3.2"}

3)
<h1>Main</h1>\n<h3>Sub</h3>
{"line": 2, "element": "<h3>", "issue": "Heading level skips from h1 to h3", "recommendation": "Change h3 to h2 for order", "ruleId": "1.3.1"}

4)
<a href="/docs"><img src="doc.png" alt=""></a>
{"line": 1, "element": "<a href=\"/docs\">", "issue": "Link lacks accessible name", "recommendation": "Add meaningful alt or aria-label", "ruleId": "2.4.4"}

5)
<span class="error">Required</span>
{"line": 1, "element": ".error", "issue": "Error conveyed only by color", "recommendation": "Add icon or text cue besides color", "ruleId": "1.4.1"}

ABSTRACTED PATTERNS (internal, do not output): semantics (4.1.2); labeling (3.3.2/4.1.2); structural sequence (1.3.1); link purpose naming (2.4.4); non-color redundancy (1.4.1).
Do not copy wording blindly; adapt to actual code.

OUTPUT (JSON Lines only):
{"line": <int>, "element": "<minimal snippet>", "issue": "<concise violation>", "recommendation": "<minimal actionable fix>", "ruleId": "<SC>"}
Rules: ruleId ^([1-4]\.[1-4]\.[1-9]|2\.5\.8)$ ; ≤1 per line; unique (line,ruleId); issue ≤80 chars; recommendation ≤120 chars; no arrays/markdown; empty if none.

CODE:
<<<
${codeWithLineNumbers}
>>>`;
    }
}
// Chain-of-thought (internal steps; output remains compact)
class ChainOfThoughtStrategy {
    constructor() {
        this.name = 'chain-of-thought';
        this.displayName = 'Chain-of-Thought Reasoning';
        this.description = 'Structured analytical reasoning with explicit intermediate steps';
    }
    generatePrompt(codeWithLineNumbers) {
        return `WCAG 2.2 AA ACCESSIBILITY AUDIT (CHAIN-OF-THOUGHT)

INSTRUCTION: Perform the following INTERNAL reasoning pipeline silently. Output ONLY final JSON Lines (no reasoning text, no commentary).

INTERNAL STEPS (do not emit):
1. INVENTORY: Internally list elements, interactive widgets, forms, media, headings, ARIA usage.
2. CRITERION MAPPING: For each candidate, test against WCAG 2.2 AA (focus: 1.1.1, 1.3.1, 1.4.1, 2.4.4, 3.3.2, 4.1.2). Reject uncertain cases.
3. CANDIDATE REFINEMENT: Remove stylistic / speculative / ambiguous items.
4. FIX SYNTHESIS: Draft minimal, specific remediation for each validated violation.
5. FORMAT ENFORCEMENT: Ensure uniqueness (line,ruleId), ≤1 per line, field length limits, regex compliance.
6. FINAL SELF-CHECK: All genuine, no reasoning leaked.

OUTPUT FORMAT (JSON Lines only):
{"line": <int>, "element": "<minimal snippet>", "issue": "<concise violation>", "recommendation": "<minimal actionable fix>", "ruleId": "<SC>"}
Rules: ruleId pattern ^([1-4]\.[1-4]\.[1-9]|2\.5\.8)$ ; issue ≤80 chars; recommendation ≤120 chars; no arrays/markdown; empty if none.

CODE:
<<<
${codeWithLineNumbers}
>>>`;
    }
}
// Available strategies
exports.PROMPT_STRATEGIES = [
    new DirectInstructionStrategy(),
    new FewShotStrategy(),
    new ChainOfThoughtStrategy()
];
// Strategy by name
function getPromptStrategy(strategyName) {
    const strategy = exports.PROMPT_STRATEGIES.find(s => s.name === strategyName);
    if (!strategy) {
        throw new Error(`Unknown prompt strategy: ${strategyName}. Available: ${exports.PROMPT_STRATEGIES.map(s => s.name).join(', ')}`);
    }
    return strategy;
}
exports.getPromptStrategy = getPromptStrategy;
// Default strategy
function getDefaultStrategy() {
    return exports.PROMPT_STRATEGIES[0];
}
exports.getDefaultStrategy = getDefaultStrategy;
//# sourceMappingURL=prompt-strategies.js.map