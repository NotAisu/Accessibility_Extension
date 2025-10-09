"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAIAnalysis = void 0;
function parseAIAnalysis(aiResponse) {
    const violations = [];
    if (!aiResponse || !aiResponse.trim())
        return violations;
    const fenceRegex = /```(?:json)?\n([\s\S]*?)```/gi;
    const fencedBlocks = [];
    let fenceMatch;
    while ((fenceMatch = fenceRegex.exec(aiResponse)) !== null) {
        if (fenceMatch[1])
            fencedBlocks.push(fenceMatch[1]);
    }
    const candidateText = fencedBlocks.length > 0 ? fencedBlocks.join('\n') : aiResponse;
    const push = (obj) => {
        if (!obj || typeof obj.line !== 'number')
            return;
        if (obj.line <= 0)
            return;
        violations.push({
            line: obj.line,
            element: obj.element,
            issue: obj.issue,
            recommendation: obj.recommendation,
            ruleId: obj.ruleId
        });
    };
    try {
        const maybeArray = JSON.parse(candidateText);
        if (Array.isArray(maybeArray)) {
            for (const o of maybeArray)
                push(o);
            if (violations.length > 0)
                return violations;
        }
    }
    catch { /* ignore */ }
    const lines = candidateText.split(/\r?\n/);
    let buffer = '';
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line)
            continue;
        buffer += (buffer ? ' ' : '') + line;
        if (/([}\]])[, ]?$/.test(line)) {
            try {
                const parsed = JSON.parse(buffer);
                if (Array.isArray(parsed)) {
                    for (const o of parsed)
                        push(o);
                }
                else {
                    push(parsed);
                }
                buffer = '';
            }
            catch { }
        }
    }
    if (violations.length === 0) {
        const objectRegex = /\{[^}]*"line"[^}]*\}/g;
        const matches = candidateText.match(objectRegex) || [];
        for (const m of matches) {
            try {
                push(JSON.parse(m));
            }
            catch { }
        }
    }
    const seen = new Set();
    return violations.filter(v => {
        const key = v.line + '|' + (v.issue || '') + '|' + (v.ruleId || '');
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
exports.parseAIAnalysis = parseAIAnalysis;
//# sourceMappingURL=ai-response-parser.js.map