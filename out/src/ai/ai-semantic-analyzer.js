"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AISemanticAnalyzer = void 0;
const vscode = __importStar(require("vscode"));
const prompt_strategies_1 = require("./prompt-strategies");
const ai_response_parser_1 = require("./ai-response-parser");
const rule_id_normalizer_1 = require("../core/rule-id-normalizer");
class AISemanticAnalyzer {
    constructor(llmService) {
        this.aiDiagnosticCollection = vscode.languages.createDiagnosticCollection('ai-accessibility');
        this.isEnabled = false;
        this.analysisScope = 'visible';
        this.promptStrategy = 'direct-instruction';
        // Tracks recently fixed lines to avoid immediate re-reporting of the same issue
        this.recentlyFixed = new Map();
        this.RECENTLY_FIXED_TTL_MS = 1000 * 60 * 5;
        this.lastSuppressedCount = 0;
        this.lastReportedCount = 0;
        this.llmService = llmService;
        this.loadSettings();
    }
    setDiagnosticsCallback(callback) {
        this.getDiagnosticsCallback = callback;
    }
    setMetricsService(metricsService) {
        this.metricsService = metricsService;
    }
    loadSettings() {
        const config = vscode.workspace.getConfiguration('accessibility');
        this.isEnabled = config.get('aiAnalyzer.enabled', false);
        this.analysisScope = config.get('aiAnalyzer.scope', 'visible');
        this.promptStrategy = config.get('aiAnalyzer.promptStrategy', 'direct-instruction');
        const ttl = config.get('aiAnalyzer.recentFixSuppressionTTL', 300000);
        this.RECENTLY_FIXED_TTL_MS = Math.max(0, ttl);
    }
    setEnabled(enabled) {
        this.isEnabled = enabled;
        const config = vscode.workspace.getConfiguration('accessibility');
        config.update('aiAnalyzer.enabled', enabled, vscode.ConfigurationTarget.Global);
    }
    setAnalysisScope(scope) {
        this.analysisScope = scope;
        const config = vscode.workspace.getConfiguration('accessibility');
        config.update('aiAnalyzer.scope', scope, vscode.ConfigurationTarget.Global);
    }
    setPromptStrategy(strategy) {
        this.promptStrategy = strategy;
        const config = vscode.workspace.getConfiguration('accessibility');
        config.update('aiAnalyzer.promptStrategy', strategy, vscode.ConfigurationTarget.Global);
    }
    getPromptStrategy() {
        return this.promptStrategy;
    }
    getAnalysisScope() {
        return this.analysisScope;
    }
    isAnalyzerEnabled() {
        return this.isEnabled;
    }
    async startAnalysis(document, existingAxeDiagnostics, signal) {
        if (!this.isEnabled) {
            vscode.window.showWarningMessage('AI Semantic Analyzer is not enabled');
            return;
        }
        // Use current document if not provided
        if (!document) {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor found');
                return;
            }
            document = editor.document;
        }
        // Check supported languages
        const supportedLanguages = ['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact'];
        if (!supportedLanguages.includes(document.languageId)) {
            vscode.window.showWarningMessage(`Language ${document.languageId} is not supported`);
            return;
        }
        // Get axe-core diagnostics if not provided
        if (!existingAxeDiagnostics) {
            existingAxeDiagnostics = this.getDiagnosticsCallback ?
                this.getDiagnosticsCallback(document.uri) :
                [];
        }
        await this.analyzeVisibleCode(document, existingAxeDiagnostics, signal);
    }
    async analyzeVisibleCode(document, existingAxeDiagnostics, signal) {
        if (!this.isEnabled) {
            this.aiDiagnosticCollection.set(document.uri, []);
            return;
        }
        // Start performance timer
        const analysisId = this.metricsService?.startAIAnalysis();
        try {
            await this.performAnalysis(document, existingAxeDiagnostics, signal);
            // End performance timer on success
            if (analysisId && this.metricsService) {
                this.metricsService.endAIAnalysis(analysisId);
            }
        }
        catch (error) {
            console.error('AI Semantic Analysis failed:', error);
            // End performance timer on error
            if (analysisId && this.metricsService) {
                this.metricsService.endAIAnalysis(analysisId);
            }
        }
    }
    // Internal analysis method
    async performAnalysis(document, existingAxeDiagnostics, signal) {
        try {
            // Get code with line numbers based on scope
            const codeWithLineNumbers = this.getCodeWithLineNumbers(document);
            if (!codeWithLineNumbers.trim()) {
                this.aiDiagnosticCollection.set(document.uri, []);
                return;
            }
            // Perform AI analysis
            // Abort early if requested
            if (signal?.aborted)
                throw new Error('AI analysis aborted');
            const aiFindings = await this.performAIAnalysis(codeWithLineNumbers, document, signal);
            if (signal?.aborted)
                throw new Error('AI analysis aborted');
            // Filter out duplicates with axe-core diagnostics
            const filteredFindings = this.filterAxeProblems(aiFindings, existingAxeDiagnostics);
            // Suppress recently fixed lines (only if unchanged)
            const stableFindings = this.filterRecentlyFixedProblems(filteredFindings, document);
            this.lastReportedCount = stableFindings.length;
            // Create blue AI diagnostics (also updates metrics)
            const aiDiagnostics = this.createAIDiagnostics(stableFindings, document);
            // Set diagnostics
            this.aiDiagnosticCollection.set(document.uri, aiDiagnostics);
        }
        catch (error) {
            console.error('AI Semantic Analysis error:', error);
            // Do not surface the error to the user to avoid disrupting UX
            this.aiDiagnosticCollection.set(document.uri, []);
        }
    }
    // Marks a line as recently fixed. Called after a successful fix.
    recordFixedLine(document, line) {
        this.recordFixedRange(document, new vscode.Range(line, 0, line, 0));
    }
    // Marks all lines in a range as fixed (e.g., when AI replaces multiple lines)
    recordFixedRange(document, range) {
        const start = Math.max(0, Math.min(range.start.line, document.lineCount - 1));
        const end = Math.max(0, Math.min(range.end.line, document.lineCount - 1));
        const uriKey = document.uri.toString();
        let map = this.recentlyFixed.get(uriKey);
        if (!map) {
            map = new Map();
            this.recentlyFixed.set(uriKey, map);
        }
        for (let line = start; line <= end; line++) {
            const lineText = document.lineAt(line).text;
            map.set(line, { text: lineText, ts: Date.now() });
        }
        this.cleanupRecentlyFixed();
    }
    // Removes expired entries from the recentlyFixed map
    cleanupRecentlyFixed() {
        const now = Date.now();
        for (const [uri, lineMap] of this.recentlyFixed.entries()) {
            for (const [line, meta] of lineMap.entries()) {
                if (now - meta.ts > this.RECENTLY_FIXED_TTL_MS) {
                    lineMap.delete(line);
                }
            }
            if (lineMap.size === 0) {
                this.recentlyFixed.delete(uri);
            }
        }
    }
    // Filters out findings on lines recently fixed where the line content is unchanged
    filterRecentlyFixedProblems(findings, document) {
        if (findings.length === 0)
            return findings;
        this.cleanupRecentlyFixed();
        const uriKey = document.uri.toString();
        const lineMap = this.recentlyFixed.get(uriKey);
        if (!lineMap || this.RECENTLY_FIXED_TTL_MS === 0)
            return findings;
        const result = [];
        let suppressed = 0;
        for (const f of findings) {
            const entry = lineMap.get(f.range.start.line);
            if (!entry) {
                result.push(f);
                continue;
            }
            const currentText = document.lineAt(f.range.start.line).text;
            if (currentText === entry.text) {
                suppressed++;
                continue; // suppress
            }
            result.push(f);
        }
        this.lastSuppressedCount = suppressed;
        return result;
    }
    // Returns last suppressed & reported counts (for status bar)
    getLastCounts() {
        return { reported: this.lastReportedCount, suppressed: this.lastSuppressedCount };
    }
    // Clears memory for recently fixed lines
    clearRecentFixMemory() {
        this.recentlyFixed.clear();
        this.lastSuppressedCount = 0;
    }
    // Returns code based on analysis scope (visible vs. document)
    getCodeWithLineNumbers(document) {
        if (this.analysisScope === 'document') {
            return this.getAllCodeWithLineNumbers(document);
        }
        else {
            return this.getVisibleCodeWithLineNumbers(document);
        }
    }
    // Returns visible code with line numbers
    getVisibleCodeWithLineNumbers(document) {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.toString() !== document.uri.toString()) {
            // Fallback: analyze whole document
            return this.getAllCodeWithLineNumbers(document);
        }
        if (editor.visibleRanges.length === 0) {
            return '';
        }
        let code = '';
        const startLine = editor.visibleRanges[0].start.line;
        const endLine = editor.visibleRanges[0].end.line;
        for (let currentLine = startLine; currentLine <= endLine; currentLine++) {
            if (currentLine < document.lineCount) {
                code += `${currentLine + 1}: ${document.lineAt(currentLine).text}\n`;
            }
        }
        return code;
    }
    // Fallback: whole document with line numbers
    getAllCodeWithLineNumbers(document) {
        let code = '';
        for (let line = 0; line < document.lineCount; line++) {
            code += `${line + 1}: ${document.lineAt(line).text}\n`;
        }
        return code;
    }
    // Runs AI analysis and returns semantic WCAG violations
    async performAIAnalysis(codeWithLineNumbers, document, signal) {
        try {
            const strategy = (0, prompt_strategies_1.getPromptStrategy)(this.promptStrategy);
            const prompt = strategy.generatePrompt(codeWithLineNumbers);
            const aiResponse = await this.llmService.getAIAnalysis(prompt);
            const violations = this.parseAIResponse(aiResponse, document);
            return violations;
        }
        catch (error) {
            const err = error;
            if (err && (err.name === 'AbortError' || (err instanceof Error && err.message === 'The user aborted a request.') || (err instanceof Error && err.message === 'AI analysis aborted'))) {
                console.log('AI analysis was aborted by user');
                return [];
            }
            console.error('AI analysis request failed:', error);
            try {
                const defaultStrategy = (0, prompt_strategies_1.getDefaultStrategy)();
                const prompt = defaultStrategy.generatePrompt(codeWithLineNumbers);
                const aiResponse = await this.llmService.getAIAnalysis(prompt);
                return this.parseAIResponse(aiResponse, document);
            }
            catch (fallbackError) {
                console.error('Fallback AI analysis also failed:', fallbackError);
                return [];
            }
        }
    }
    // Parses AI response into a list of WCAG violations
    parseAIResponse(aiResponse, document) {
        const parsed = (0, rule_id_normalizer_1.normalizeRuleIds)((0, ai_response_parser_1.parseAIAnalysis)(aiResponse));
        const violations = [];
        for (const p of parsed) {
            this.pushIfValidViolation({
                line: p.line,
                element: p.element || '',
                issue: p.issue || '',
                recommendation: p.recommendation || '',
                ruleId: (0, rule_id_normalizer_1.normalizeRuleId)(p.ruleId) || 'ai-semantic'
            }, document, violations);
        }
        return violations;
    }
    pushIfValidViolation(parsed, document, violations) {
        if (!parsed || typeof parsed.line !== 'number')
            return;
        if (parsed.line <= 0 || parsed.line > document.lineCount)
            return;
        const lineIndex = parsed.line - 1;
        const lineText = document.lineAt(lineIndex).text;
        const range = new vscode.Range(new vscode.Position(lineIndex, 0), new vscode.Position(lineIndex, lineText.length));
        violations.push({
            element: parsed.element || lineText.trim(),
            message: `${parsed.issue}: ${parsed.recommendation}`,
            range,
            ruleId: parsed.ruleId || 'ai-semantic',
            severity: 'warning'
        });
    }
    // Prevents duplicates between AI findings and axe-core diagnostics
    filterAxeProblems(aiFindings, axeDiagnostics) {
        return aiFindings.filter(aiFinding => {
            // Check whether axe-core already reported an issue in the same line
            return !axeDiagnostics.some(axeDiag => {
                return this.rangesOverlap(aiFinding.range, axeDiag.range);
            });
        });
    }
    // Checks if two ranges overlap
    rangesOverlap(range1, range2) {
        return range1.start.line === range2.start.line ||
            range1.end.line === range2.end.line ||
            (range1.start.line < range2.end.line && range1.end.line > range2.start.line);
    }
    // Creates blue AI diagnostics for found semantic issues
    createAIDiagnostics(findings, document) {
        return findings.map(finding => {
            // Base extends start character + hash from issue snippet to reduce collisions
            const issueFragment = finding.message.slice(0, 50);
            const base = `${document.uri.toString()}|${finding.range.start.line}|${finding.range.start.character}|${finding.ruleId}|${finding.element?.slice(0, 40)}|${issueFragment}`;
            const hash = require('crypto').createHash('sha1').update(base).digest('hex').slice(0, 10);
            const vId = `ai-${hash}`;
            const diagnostic = new vscode.Diagnostic(finding.range, `[AI Semantic] ${finding.message} (vID:${vId})`, vscode.DiagnosticSeverity.Information);
            diagnostic.code = JSON.stringify({
                ruleId: finding.ruleId,
                isAIGenerated: true,
                element: finding.element,
                recommendation: finding.message,
                vId,
                feedbackGiven: false
            });
            diagnostic.source = 'AI Accessibility Analyzer';
            return diagnostic;
        });
    }
    // Removes a single AI diagnostic by violationId
    removeAIDiagnostic(id) {
        this.aiDiagnosticCollection.forEach((uri, diagnostics) => {
            const filtered = diagnostics.filter(d => {
                try {
                    if (typeof d.code === 'string') {
                        const data = JSON.parse(d.code);
                        if (data.vId === id)
                            return false;
                        if (data.violationId === id)
                            return false; // legacy support
                    }
                }
                catch { }
                return true;
            });
            if (filtered.length !== diagnostics.length) {
                this.aiDiagnosticCollection.set(uri, filtered);
            }
        });
    }
    // Cleanup
    dispose() {
        this.aiDiagnosticCollection.dispose();
    }
    // Returns AI diagnostics for a document
    getAIDiagnostics(uri) {
        return this.aiDiagnosticCollection.get(uri) || [];
    }
    // Returns the diagnostic collection for metrics
    getDiagnosticCollection() {
        return this.aiDiagnosticCollection;
    }
    // Clears all AI diagnostics
    clearAll() {
        this.aiDiagnosticCollection.clear();
    }
}
exports.AISemanticAnalyzer = AISemanticAnalyzer;
//# sourceMappingURL=ai-semantic-analyzer.js.map