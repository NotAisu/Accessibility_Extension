"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDefaultStrategy = exports.getPromptStrategy = exports.PROMPT_STRATEGIES = void 0;
/**
 * One-Shot Learning Strategy
 * Direct, clear instruction with single example for immediate understanding
 */
class OneShotStrategy {
    constructor() {
        this.name = 'one-shot';
        this.displayName = 'One-Shot';
        this.description = 'Direct instruction with single example for quick analysis';
    }
    generatePrompt(codeWithLineNumbers) {
        return `Analyze the following frontend code for ACTUAL WCAG 2.2 AA violations (https://www.w3.org/TR/WCAG22/). Report ONLY genuine issues that map to real success criteria or normative rules. Skip stylistic or already compliant lines.
        If a line already conforms to WCAG 2.2 AA, DO NOT report it.

EXAMPLE:
For code like: <div role="button">Click me</div>
Response: {"line": 1, "element": "<div role=\"button\">", "issue": "Non-semantic button implementation", "recommendation": "Use semantic <button> element instead of div with role", "ruleId": "4.1.2"}

ANALYZE ALL AREAS:

1. SEMANTICS & STRUCTURE:
- Wrong HTML semantics: <div role="button"> instead of <button>
- Illogical heading hierarchy: <h1> then <h3> without <h2>
- Missing landmarks: <div> instead of <main>, <nav>, <section>
- Meaningless generic containers without semantic value

2. ACCESSIBILITY & LABELS:
- Unclear/unspecific labels: "Submit", "Click here", "Read more"
- Missing labels for form elements
- Empty interactive elements: <button></button>, <a href="#"></a>
- Insufficient button/link descriptions without context

3. NAVIGATION & FOCUS:
- Problematic tab order: tabindex without logical structure
- Missing or incorrectly implemented skip links
- Focus traps or inaccessible areas
- Keyboard navigation blocked by CSS/JS

4. ARIA & ACCESSIBILITY:
- Wrong/redundant ARIA attributes: <img aria-label="image">
- aria-hidden on interactive elements
- Missing or wrong aria-describedby/aria-labelledby connections
- Live regions missing for dynamic content

5. VISUAL DESIGN IN CODE:
- Color as only information carrier in CSS
- Insufficient contrast ratios in CSS variables
- Text made invisible by CSS (color: transparent, etc.)
- Responsive design ignoring accessibility breakpoints

6. INTERACTION & TIMING:
- Time-based content without pause/stop functions
- Auto-playing media without controls
- Timeout mechanisms without warning or extension
- Moving content without reduction option

7. FORMS:
- Missing fieldsets/legends for related fields
- Error messages not linked to fields
- Required fields not clearly marked
- Validation only visual, not for screen readers

8. DYNAMIC CONTENT:
- Modal dialogs without focus management
- AJAX updates without screen reader notification
- Progressive enhancement neglected
- Client-side routing without accessibility features

STRICT OUTPUT RULES:
1. Only include a line if it demonstrably violates WCAG 2.2 AA.
2. Use real rule IDs (e.g. "1.3.1", "2.4.4", "4.1.2"). Do NOT invent IDs.
3. Each physical line at most once. No duplicates.
4. If a line is already compliant, DO NOT return it.
5. Ignore purely visual formatting, indentation, class naming, or inline style cosmetics unless they directly break WCAG.
6. Do NOT repeat the same issue wording for similar lines unless each is a distinct violation.
7. Output ONLY JSON objects, one per violation, no prose outside JSON.
8. Keys required: line, element, issue, recommendation, ruleId.

Return one JSON object per line that violates WCAG:
{"line": <line_number>, "element": "<HTML_or_selector>", "issue": "<succinct_problem>", "recommendation": "<specific_fix>", "ruleId": "<WCAG_2.2_AA_ID>"}

Code:
${codeWithLineNumbers}`;
    }
}
/**
 * Few-Shot Learning Strategy
 * Multiple examples to establish pattern recognition
 */
class FewShotStrategy {
    constructor() {
        this.name = 'few-shot';
        this.displayName = 'Few-Shot';
        this.description = 'Multiple examples for better pattern recognition';
    }
    generatePrompt(codeWithLineNumbers) {
        return `Analyze the following frontend code for REAL WCAG 2.2 AA violations (https://www.w3.org/TR/WCAG22/). If a line already conforms to WCAG 2.2 AA, DO NOT report it. Learn strictly from these examples (only genuine violations with valid success criterion IDs):

EXAMPLE 1 - Semantic Issues:
Code: <div role="button" onclick="submit()">Submit</div>
Response: {"line": 1, "element": "<div role=\"button\">", "issue": "Non-semantic button implementation", "recommendation": "Use semantic <button> element: <button onclick=\"submit()\">Submit</button>", "ruleId": "4.1.2"}

EXAMPLE 2 - Missing Labels:
Code: <input type="email" placeholder="Enter email">
Response: {"line": 1, "element": "<input type=\"email\">", "issue": "Missing accessible label", "recommendation": "Add label: <label for=\"email\">Email:</label><input type=\"email\" id=\"email\" placeholder=\"Enter email\">", "ruleId": "3.3.2"}

EXAMPLE 3 - Heading Hierarchy:
Code: <h1>Title</h1><h3>Subsection</h3>
Response: {"line": 2, "element": "<h3>", "issue": "Skipped heading level", "recommendation": "Use h2 instead of h3 to maintain logical hierarchy", "ruleId": "1.3.1"}

EXAMPLE 4 - Empty Links:
Code: <a href="/page"><img src="icon.png"></a>
Response: {"line": 1, "element": "<a href=\"/page\">", "issue": "Link without accessible text", "recommendation": "Add alt text to image or aria-label to link: <a href=\"/page\" aria-label=\"Go to page\"><img src=\"icon.png\" alt=\"\"></a>", "ruleId": "2.4.4"}

EXAMPLE 5 - Color-only Information:
Code: .error { color: red; }
Response: {"line": 1, "element": ".error", "issue": "Information conveyed by color only", "recommendation": "Add text or icon indicators in addition to color", "ruleId": "1.4.1"}

STRICT RULES:
1. Only real WCAG 2.2 AA failures (no stylistic or subjective preferences)
2. Each physical source line at most once; skip compliant lines entirely
3. Use authentic success criterion IDs (e.g. 1.3.1, 2.4.4, 4.1.2) – NEVER invent IDs
4. Ignore color contrast unless a hardcoded color obviously fails contrast (otherwise skip)
5. Ignore pure formatting / class naming / indentation differences
6. Recommendation MUST be a concrete minimal fix (semantic replacement, attribute addition, structural correction)
7. Output ONLY JSON objects (no prose) with keys: line, element, issue, recommendation, ruleId
8. Do not duplicate the same issue wording across multiple lines unless each is a separate instance

Now analyze the following code using the same pattern. Look for:

SEMANTICS & STRUCTURE:
- Non-semantic elements with roles instead of proper HTML elements
- Incorrect heading hierarchy (h1→h3, missing h2)
- Missing landmark elements (main, nav, section, aside)
- Generic containers without semantic meaning

ACCESSIBILITY & LABELS:
- Form elements without proper labels
- Buttons/links with unclear or missing text
- Images without alt text
- Interactive elements without accessible names

NAVIGATION & FOCUS:
- Improper tabindex usage
- Missing skip links
- Focus management issues
- Keyboard navigation barriers

ARIA & ACCESSIBILITY:
- Incorrect ARIA usage
- Redundant or conflicting ARIA attributes
- Missing live regions for dynamic content
- aria-hidden on focusable elements

For each issue found, return a JSON object following the examples above.

Code:
${codeWithLineNumbers}`;
    }
}
/**
 * Chain of Thought Strategy
 * Step-by-step reasoning process for complex analysis
 */
class ChainOfThoughtStrategy {
    constructor() {
        this.name = 'chain-of-thought';
        this.displayName = 'Chain of Thought';
        this.description = 'Step-by-step reasoning for thorough analysis';
    }
    generatePrompt(codeWithLineNumbers) {
        return `Analyze the following frontend code for REAL WCAG 2.2 AA violations (https://www.w3.org/TR/WCAG22/) using step-by-step reasoning. If a line already conforms, skip it entirely.

REASONING PROCESS:
1. First, read through the code to understand its structure and purpose
2. Identify all interactive elements (buttons, links, form controls)
3. Check semantic correctness of each element
4. Verify accessibility attributes and labels
5. Examine the information architecture and navigation
6. Look for visual design issues that affect accessibility
7. Consider dynamic behavior and timing issues

STEP-BY-STEP ANALYSIS EXAMPLE:
Code: <div class="button" onclick="save()">Save</div>

Step 1: Identify element type → This is a div being used as a button
Step 2: Check semantics → div is not semantic for interactive elements
Step 3: Check accessibility → No keyboard support, no ARIA attributes
Step 4: Determine violation → WCAG 4.1.2 (Name, Role, Value)
Step 5: Provide solution → Use <button> element instead

Response: {"line": 1, "element": "<div class=\"button\">", "issue": "Non-semantic button implementation lacks keyboard support", "recommendation": "Replace with semantic button: <button onclick=\"save()\">Save</button>", "ruleId": "4.1.2"}

Now analyze the following code step by step:

STEP 1: STRUCTURAL ANALYSIS
- Read through the code to understand the overall structure
- Identify the main content areas and their relationships
- Note any interactive elements or form controls

STEP 2: SEMANTIC EVALUATION
- Check if HTML elements are used for their intended purpose
- Verify heading hierarchy follows logical order (h1→h2→h3)
- Ensure landmarks (main, nav, section) are properly used

STEP 3: ACCESSIBILITY ATTRIBUTES
- Verify all form elements have proper labels
- Check for appropriate ARIA attributes where needed
- Ensure images have meaningful alt text

STEP 4: NAVIGATION AND FOCUS
- Analyze tab order and keyboard navigation
- Check for focus indicators and focus management
- Verify skip links are present and functional

STEP 5: INTERACTION DESIGN
- Review button and link implementations
- Check for proper error handling and feedback
- Ensure all interactive elements are accessible

STEP 6: VISUAL AND TEMPORAL CONSIDERATIONS
- Look for color-only information conveyance
- Check for sufficient contrast in CSS
- Identify any timing or motion accessibility issues

STRICT OUTPUT RULES:
1. Only authentic WCAG 2.2 AA failures (no subjective style or best-practice-only items)
2. One JSON object per violating line, never more than one per line
3. Use valid success criterion IDs (e.g. 1.3.1, 2.4.4, 4.1.2) – NEVER invent
4. Skip color contrast unless explicit hardcoded values clearly fail
5. Recommendation must be minimal and directly actionable
6. Output ONLY JSON objects (no prose) with keys: line, element, issue, recommendation, ruleId
7. If zero violations, output nothing

For each violation provide:
{"line": <line_number>, "element": "<HTML_element>", "issue": "<concise_reasoning>", "recommendation": "<precise_fix>", "ruleId": "<WCAG_rule_ID>"}

Code to analyze:
${codeWithLineNumbers}`;
    }
}
/**
 * Role-Based Strategy
 * Analysis from the perspective of different user roles and assistive technologies
 */
class RoleBasedStrategy {
    constructor() {
        this.name = 'role-based';
        this.displayName = 'Role-Based';
        this.description = 'Analysis from multiple user perspectives and assistive technologies';
    }
    generatePrompt(codeWithLineNumbers) {
        return `Analyze the following frontend code for REAL WCAG 2.2 AA violations (https://www.w3.org/TR/WCAG22/) from multiple user perspectives. If a line is compliant, do NOT report it.

ROLE-BASED ANALYSIS FRAMEWORK:

🔍 SCREEN READER USER PERSPECTIVE:
- Can all content be accessed and understood through audio?
- Are there proper headings for navigation?
- Do form elements have clear labels?
- Is the reading order logical?
- Are there sufficient landmarks for navigation?

♿ KEYBOARD-ONLY USER PERSPECTIVE:
- Can all interactive elements be reached via keyboard?
- Is the tab order logical and predictable?
- Are there visible focus indicators?
- Can users skip repetitive content?
- Are there keyboard traps?

👁️ LOW VISION USER PERSPECTIVE:
- Is there sufficient color contrast?
- Can content be zoomed to 200% without horizontal scrolling?
- Is information conveyed without relying solely on color?
- Are touch targets large enough (minimum 44px)?
- Is text readable and scalable?

🧠 COGNITIVE ACCESSIBILITY PERSPECTIVE:
- Are instructions clear and simple?
- Is the interface predictable and consistent?
- Are error messages helpful and specific?
- Is there enough time to complete tasks?
- Can users control timing and motion?

🤖 ASSISTIVE TECHNOLOGY COMPATIBILITY:
- Voice control software compatibility
- Switch navigation device support
- Eye-tracking software compatibility
- Alternative input device support

ANALYSIS EXAMPLE:
Code: <span onclick="delete()" class="delete-btn">×</span>

Screen Reader Analysis: No semantic meaning, unclear purpose
Keyboard User Analysis: Not focusable, no keyboard activation
Low Vision Analysis: Small target, unclear symbol
Cognitive Analysis: Unclear action, no confirmation
AT Compatibility: Not accessible to voice commands

Response: {"line": 1, "element": "<span onclick=\"delete()\">", "issue": "Delete action inaccessible to multiple user groups - no keyboard support, unclear labeling, poor semantics", "recommendation": "Use semantic button with clear label: <button onclick=\"delete()\" aria-label=\"Delete item\">Delete</button>", "ruleId": "4.1.2"}

Now analyze the code from each perspective:

FOR SCREEN READER USERS:
- Check all text alternatives and labels
- Verify heading structure and landmarks
- Ensure proper reading order
- Look for missing or redundant ARIA attributes

FOR KEYBOARD USERS:
- Verify all interactive elements are keyboard accessible
- Check tab order and focus management
- Look for skip links and focus indicators
- Identify potential keyboard traps

FOR LOW VISION USERS:
- Check color contrast and color reliance
- Verify zoom and reflow capabilities
- Ensure adequate target sizes
- Look for text scaling issues

FOR COGNITIVE ACCESSIBILITY:
- Check clarity of instructions and labels
- Verify error prevention and recovery
- Look for timing and session issues
- Ensure predictable behavior

FOR ASSISTIVE TECHNOLOGY:
- Check semantic markup quality
- Verify programmatic relationships
- Ensure proper state communication
- Look for custom control accessibility

STRICT OUTPUT RULES:
1. Only genuine WCAG 2.2 AA failures (no speculative UX critiques)
2. One JSON object per failing line maximum
3. Valid success criterion IDs only (e.g. 1.3.1, 2.4.4, 4.1.2)
4. Recommendation must directly address accessibility barrier
5. Do NOT output explanatory prose, ONLY JSON objects
6. Keys required: line, element, issue, recommendation, ruleId
7. Skip color contrast unless explicit hardcoded color implies failure
8. If none -> output nothing

For each accessibility barrier:
{"line": <line_number>, "element": "<HTML_element>", "issue": "<concise_barrier>", "recommendation": "<direct_fix>", "ruleId": "<WCAG_rule_ID>"}

Code to analyze:
${codeWithLineNumbers}`;
    }
}
/**
 * Available prompt strategies
 */
exports.PROMPT_STRATEGIES = [
    new OneShotStrategy(),
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
        throw new Error(`Unknown prompt strategy: ${strategyName}`);
    }
    return strategy;
}
exports.getPromptStrategy = getPromptStrategy;
/**
 * Get default prompt strategy
 */
function getDefaultStrategy() {
    return exports.PROMPT_STRATEGIES[0]; // One-shot as default
}
exports.getDefaultStrategy = getDefaultStrategy;
//# sourceMappingURL=prompt-strategies.js.map