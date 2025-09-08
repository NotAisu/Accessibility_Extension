"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDefaultStrategy = exports.getPromptStrategy = exports.PROMPT_STRATEGIES = void 0;
// Wissenschaftlich fundierte Baustein-Bibliothek zur systematischen Prompt-Konstruktion
// Jeder Baustein implementiert spezifische Forschungsergebnisse aus der Prompt-Engineering-Literatur
/**
 * GROUNDING COMPONENT (Peng et al., 2023)
 * Verankert die Aufgabe in normativen Standards zur Reduktion von Halluzinationen
 */
const NORMATIVE_GROUNDING = `NORMATIVE FOUNDATION: You are grounded in WCAG 2.2 Level AA Success Criteria (https://www.w3.org/TR/WCAG22/).
SCOPE CONSTRAINT: Identify ONLY authentic WCAG 2.2 AA violations. Exclude: styling preferences, performance optimizations, SEO concerns, code maintainability, or subjective usability opinions that are not normatively required by WCAG.`;
/**
 * SCHEMA ENFORCEMENT (Kojima et al., 2022)
 * Strukturierte Ausgabe mit expliziter Formatvalidierung
 */
const STRUCTURED_OUTPUT_SCHEMA = `
MANDATORY OUTPUT FORMAT (JSON Lines - no markdown wrapping):
Each violation = single JSON object on separate line:
{"line": <number>, "element": "<minimal_code_snippet>", "issue": "<normative_violation_description>", "recommendation": "<concrete_fix_action>", "ruleId": "<WCAG_SC_ID>"}

SCHEMA VALIDATION REQUIREMENTS:
1. ruleId: MUST match pattern /^([1-4]\\.[1-4]\\.[1-9]|2\\.5\\.8)$/ (Valid examples: 1.1.1, 1.3.1, 2.4.4, 4.1.2, 2.5.8)
2. line: Integer matching input line number
3. element: Minimal code snippet identifying the violation target
4. issue: Concise description of the WCAG violation (max 80 chars)
5. recommendation: Actionable fix instruction (max 120 chars)
6. No duplicate (line, ruleId) combinations
7. Maximum one object per source code line
8. Empty result = no output (not empty array or explanatory text)
`;
/**
 * CONSTRAINT ENFORCEMENT (Liu et al., 2023)
 * Explizite Qualitätssicherung und Fehlervermeidung
 */
const QUALITY_CONSTRAINTS = `
QUALITY ENFORCEMENT PROTOCOL:
- PRECISION: Each violation must be demonstrably non-compliant with specific WCAG 2.2 AA criterion
- SPECIFICITY: Avoid general observations; target concrete accessibility barriers
- ACTIONABILITY: Recommendations must be implementable without major architectural changes  
- MINIMALISM: Prefer targeted fixes over comprehensive rewrites
- VALIDATION: Cross-reference against official WCAG 2.2 documentation before inclusion
`;
/**
 * SELF-VERIFICATION COMPONENT (Dhuliawala et al., 2023)
 * Multi-stage internal validation vor Ausgabe
 */
const INTERNAL_VERIFICATION = `
INTERNAL VERIFICATION CHECKLIST (execute silently):
□ Each identified issue violates a specific WCAG 2.2 AA Success Criterion  
□ ruleId corresponds to actual WCAG numbering (not invented)
□ Recommendation is technically feasible and minimal
□ No false positives or subjective style judgments included
□ Output format strictly adheres to JSON Lines schema
□ No duplicate violations on same line
PROCEED ONLY after all checks pass.
`;
/**
 * CURATED EXEMPLARS für Few-Shot Learning (Min et al., 2022)
 * Strategisch ausgewählte Beispiele zur optimalen Musterinduzierung
 */
const STRATEGIC_EXEMPLARS = [
    {
        context: "Semantic Elements Violation",
        input: '<div onclick="submit()" class="btn">Submit</div>',
        output: '{"line": 1, "element": "<div onclick=\\"submit()\\">", "issue": "Non-semantic interactive element lacks accessible semantics", "recommendation": "Replace with <button onclick=\\"submit()\\">Submit</button>", "ruleId": "4.1.2"}'
    },
    {
        context: "Form Labeling Violation",
        input: '<input type="email" placeholder="Enter email">',
        output: '{"line": 1, "element": "<input type=\\"email\\">", "issue": "Form input missing accessible label", "recommendation": "Add <label for=\\"email\\">Email</label> and id=\\"email\\" attribute", "ruleId": "3.3.2"}'
    },
    {
        context: "Heading Hierarchy Violation",
        input: '<h1>Page Title</h1>\\n<h3>Section</h3>',
        output: '{"line": 2, "element": "<h3>", "issue": "Heading level skips from h1 to h3", "recommendation": "Change to <h2> for sequential hierarchy", "ruleId": "1.3.1"}'
    },
    {
        context: "Link Context Violation",
        input: '<a href="/docs"><img src="pdf.png" alt=""></a>',
        output: '{"line": 1, "element": "<a href=\\"/docs\\">", "issue": "Link contains image with empty alt, no accessible link text", "recommendation": "Add meaningful alt text or aria-label to link", "ruleId": "2.4.4"}'
    },
    {
        context: "Color-Only Information",
        input: '.error { color: red; } <span class="error">Required</span>',
        output: '{"line": 1, "element": ".error", "issue": "Error indication relies solely on color", "recommendation": "Add non-color indicator like icon or explicit text", "ruleId": "1.4.1"}'
    }
];
function formatExemplarsForStrategy(exemplars, count) {
    return exemplars.slice(0, count).map((ex, i) => `EXAMPLE ${i + 1} (${ex.context}):\nInput: ${ex.input}\nOutput: ${ex.output}`).join('\n\n');
}
/**
 * DIRECT INSTRUCTION STRATEGY (Zero-Shot Optimized)
 * Implementiert direkte Instruktion mit optimaler Klarheit (Brown et al., 2020)
 * Wissenschaftliche Basis: Explizite Rollenzuweisung + strukturierte Aufgabendekomposition
 */
class DirectInstructionStrategy {
    constructor() {
        this.name = 'direct-instruction';
        this.displayName = 'Direct Instruction (Zero-Shot)';
        this.description = 'Optimized zero-shot approach with explicit role assignment and structured task decomposition';
    }
    generatePrompt(codeWithLineNumbers) {
        return `ROLE ASSIGNMENT: You are a Senior Accessibility Auditor with expertise in WCAG 2.2 Level AA compliance analysis.

TASK DEFINITION: Perform systematic accessibility audit to identify authentic WCAG 2.2 AA violations in the provided code.

${NORMATIVE_GROUNDING}

ANALYSIS METHODOLOGY:
1. SEMANTIC ANALYSIS: Review HTML semantics, ARIA usage, form structures
2. NAVIGATION PATTERNS: Evaluate focus management, keyboard accessibility, skip links  
3. CONTENT STRUCTURE: Assess heading hierarchy, landmark roles, reading order
4. INTERACTIVE ELEMENTS: Validate form labels, button semantics, link contexts
5. INFORMATION DESIGN: Check color-only information, error identification, status communication

${STRATEGIC_EXEMPLARS.slice(0, 1).map(ex => `DEMONSTRATION:\nInput: ${ex.input}\nExpected: ${ex.output}`).join('\n')}

${STRUCTURED_OUTPUT_SCHEMA}
${QUALITY_CONSTRAINTS}
${INTERNAL_VERIFICATION}

EXECUTE ANALYSIS NOW:
CODE_INPUT:
<<<
${codeWithLineNumbers}
>>>`;
    }
}
/**
 * FEW-SHOT LEARNING STRATEGY (Optimized Exemplar Selection)
 * Implementiert strategische Musterinduzierung (Min et al., 2022)
 * Wissenschaftliche Basis: Kuratierte Exemplare für optimale Pattern Recognition
 */
class FewShotStrategy {
    constructor() {
        this.name = 'few-shot';
        this.displayName = 'Few-Shot Learning';
        this.description = 'Strategic pattern induction through curated high-signal examples';
    }
    generatePrompt(codeWithLineNumbers) {
        return `ROLE ASSIGNMENT: Expert Accessibility Compliance Analyst with WCAG 2.2 specialization.

TASK OBJECTIVE: Apply learned patterns from exemplars to detect authentic WCAG 2.2 AA violations.

${NORMATIVE_GROUNDING}

PATTERN LEARNING EXEMPLARS:
${formatExemplarsForStrategy(STRATEGIC_EXEMPLARS, 5)}

PATTERN RECOGNITION PROTOCOL:
- SEMANTIC PATTERNS: Interactive elements require proper semantics (4.1.2)
- LABELING PATTERNS: Form inputs need accessible labels (3.3.2, 4.1.2) 
- HIERARCHY PATTERNS: Headings must follow sequential order (1.3.1)
- CONTEXT PATTERNS: Links need meaningful accessible names (2.4.4)
- INFORMATION PATTERNS: Color-only information needs alternatives (1.4.1)

${STRUCTURED_OUTPUT_SCHEMA}
${QUALITY_CONSTRAINTS}
${INTERNAL_VERIFICATION}

APPLY LEARNED PATTERNS TO:
<<<
${codeWithLineNumbers}
>>>`;
    }
}
/**
 * CHAIN-OF-THOUGHT REASONING STRATEGY (Explicit Analytical Process)
 * Implementiert schrittweise Reasoning-Prozesse (Wei et al., 2022)
 * Wissenschaftliche Basis: Strukturierte Denkphasen verbessern komplexe Analyseaufgaben
 */
class ChainOfThoughtStrategy {
    constructor() {
        this.name = 'chain-of-thought';
        this.displayName = 'Chain-of-Thought Reasoning';
        this.description = 'Structured analytical reasoning with explicit intermediate steps';
    }
    generatePrompt(codeWithLineNumbers) {
        return `ROLE ASSIGNMENT: Senior Accessibility Specialist conducting systematic WCAG 2.2 AA compliance analysis.

ANALYTICAL METHODOLOGY: Execute structured reasoning sequence for thorough accessibility evaluation.

${NORMATIVE_GROUNDING}

REASONING CHAIN PROTOCOL (execute internally, output only final JSON):

STEP 1 - STRUCTURAL INVENTORY:
- Identify semantic HTML elements, ARIA roles, interactive components
- Catalog form elements, media content, navigation structures
- Map heading hierarchy and landmark relationships

STEP 2 - COMPLIANCE MAPPING:
- Cross-reference each element against WCAG 2.2 AA Success Criteria
- Focus on: 1.1.1, 1.3.1, 1.4.1, 2.4.4, 3.3.2, 4.1.2 (high-frequency violations)
- Eliminate false positives and subjective assessments

STEP 3 - VIOLATION DETECTION:
- Apply normative criteria systematically per line
- Document specific compliance failures with evidence
- Formulate targeted, minimal remediation actions

STEP 4 - VALIDATION FILTER:
- Verify each finding against official WCAG 2.2 documentation
- Ensure recommendations are technically feasible
- Remove ambiguous or borderline cases

${formatExemplarsForStrategy(STRATEGIC_EXEMPLARS, 2)}

${STRUCTURED_OUTPUT_SCHEMA}
${QUALITY_CONSTRAINTS}
${INTERNAL_VERIFICATION}

EXECUTE REASONING CHAIN ON:
<<<
${codeWithLineNumbers}
>>>`;
    }
}
/**
 * MULTI-PERSPECTIVE ROLE-BASED STRATEGY (Diverse Viewpoint Analysis)
 * Implementiert Multi-Perspektiven-Ansatz (Wang et al., 2023)
 * Wissenschaftliche Basis: Unterschiedliche Nutzerperspektiven erhöhen Erkennungstiefe
 */
class RoleBasedStrategy {
    constructor() {
        this.name = 'role-based';
        this.displayName = 'Multi-Perspective Role-Based Analysis';
        this.description = 'Comprehensive evaluation through multiple user perspective lenses';
    }
    generatePrompt(codeWithLineNumbers) {
        return `ROLE ASSIGNMENT: Accessibility Consultant conducting multi-perspective compliance assessment.

PERSPECTIVE INTEGRATION METHODOLOGY: Evaluate code through distinct user experience lenses to identify comprehensive WCAG 2.2 AA violations.

${NORMATIVE_GROUNDING}

PERSPECTIVE ANALYSIS FRAMEWORK (internal evaluation - output only violations):

SCREEN READER USER PERSPECTIVE:
- Semantic structure: landmarks, headings, reading order
- Programmatic access: ARIA labels, roles, states
- Content relationships: form associations, table headers

KEYBOARD-ONLY USER PERSPECTIVE:
- Focus management: tab order, focus visibility, skip navigation
- Interactive semantics: proper button/link implementation
- Keyboard traps: modal focus containment

LOW-VISION USER PERSPECTIVE:
- Information transmission: color-only indicators, contrast requirements
- Target sizing: interactive element dimensions
- Structural clarity: heading hierarchy, content organization

COGNITIVE ACCESSIBILITY PERSPECTIVE:
- Predictability: consistent navigation, clear labels
- Error management: form validation, error association
- Content clarity: accessible language, help text

ASSISTIVE TECHNOLOGY PERSPECTIVE:
- Programmatic interfaces: proper ARIA implementation
- State communication: dynamic content updates
- Technical compliance: valid HTML semantics

${formatExemplarsForStrategy(STRATEGIC_EXEMPLARS, 3)}

PERSPECTIVE CONSOLIDATION: Report only violations identified through ≥1 perspective that constitute genuine WCAG 2.2 AA failures.

${STRUCTURED_OUTPUT_SCHEMA}
${QUALITY_CONSTRAINTS}
${INTERNAL_VERIFICATION}

MULTI-PERSPECTIVE ANALYSIS TARGET:
<<<
${codeWithLineNumbers}
>>>`;
    }
}
/**
 * Available prompt strategies (scientifically grounded implementations)
 */
exports.PROMPT_STRATEGIES = [
    new DirectInstructionStrategy(),
    new FewShotStrategy(),
    new ChainOfThoughtStrategy(),
    new RoleBasedStrategy()
];
/**
 * Get a prompt strategy by name
 */
function getPromptStrategy(strategyName) {
    const strategy = exports.PROMPT_STRATEGIES.find(s => s.name === strategyName);
    if (!strategy) {
        throw new Error(`Unknown prompt strategy: ${strategyName}. Available: ${exports.PROMPT_STRATEGIES.map(s => s.name).join(', ')}`);
    }
    return strategy;
}
exports.getPromptStrategy = getPromptStrategy;
/**
 * Get default prompt strategy (Direct Instruction optimized for zero-shot performance)
 */
function getDefaultStrategy() {
    return exports.PROMPT_STRATEGIES[0]; // Direct Instruction as scientifically optimized default
}
exports.getDefaultStrategy = getDefaultStrategy;
//# sourceMappingURL=prompt-strategies.js.map