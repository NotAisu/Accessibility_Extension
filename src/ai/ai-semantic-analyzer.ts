import * as vscode from 'vscode';
import { LLMService } from '../llm/llm-service';
import { MetricsService } from '../metrics/metrics-service';
import { PromptStrategy, getPromptStrategy, getDefaultStrategy } from './prompt-strategies';
import { parseAIAnalysis } from './ai-response-parser';
import { normalizeRuleIds, normalizeRuleId } from '../core/rule-id-normalizer';

interface WCAGViolation {
    element: string;
    message: string;
    range: vscode.Range;
    ruleId: string;
    severity: 'warning' | 'error';
}

interface AIAnalysisResult {
    line: number;
    element: string;
    issue: string;
    recommendation: string;
    ruleId: string;
}

export class AISemanticAnalyzer {
    private aiDiagnosticCollection = vscode.languages.createDiagnosticCollection('ai-accessibility');
    private llmService: LLMService;
    private metricsService?: MetricsService;
    private isEnabled: boolean = false;
    private analysisScope: 'visible' | 'document' = 'visible';
    private promptStrategy: string = 'direct-instruction';
    private getDiagnosticsCallback?: (uri: vscode.Uri) => vscode.Diagnostic[];
    // Tracks recently fixed lines to avoid immediate re-reporting of the same issue
    private recentlyFixed: Map<string, Map<number, { text: string; ts: number }>> = new Map();
    private RECENTLY_FIXED_TTL_MS = 1000 * 60 * 5;
    private lastSuppressedCount: number = 0;
    private lastReportedCount: number = 0;

    constructor(llmService: LLMService) {
        this.llmService = llmService;
        this.loadSettings();
    }

    public setDiagnosticsCallback(callback: (uri: vscode.Uri) => vscode.Diagnostic[]): void {
        this.getDiagnosticsCallback = callback;
    }

    public setMetricsService(metricsService: MetricsService): void {
        this.metricsService = metricsService;
    }

    private loadSettings(): void {
        const config = vscode.workspace.getConfiguration('accessibility');
        this.isEnabled = config.get<boolean>('aiAnalyzer.enabled', false);
        this.analysisScope = config.get<'visible' | 'document'>('aiAnalyzer.scope', 'visible');
        this.promptStrategy = config.get<string>('aiAnalyzer.promptStrategy', 'direct-instruction');
    const ttl = config.get<number>('aiAnalyzer.recentFixSuppressionTTL', 300000);
    this.RECENTLY_FIXED_TTL_MS = Math.max(0, ttl);
    }

    public setEnabled(enabled: boolean): void {
        this.isEnabled = enabled;
        const config = vscode.workspace.getConfiguration('accessibility');
        config.update('aiAnalyzer.enabled', enabled, vscode.ConfigurationTarget.Global);
    }

    public setAnalysisScope(scope: 'visible' | 'document'): void {
        this.analysisScope = scope;
        const config = vscode.workspace.getConfiguration('accessibility');
        config.update('aiAnalyzer.scope', scope, vscode.ConfigurationTarget.Global);
    }

    public setPromptStrategy(strategy: string): void {
        this.promptStrategy = strategy;
        const config = vscode.workspace.getConfiguration('accessibility');
        config.update('aiAnalyzer.promptStrategy', strategy, vscode.ConfigurationTarget.Global);
    }

    public getPromptStrategy(): string {
        return this.promptStrategy;
    }

    public getAnalysisScope(): 'visible' | 'document' {
        return this.analysisScope;
    }

    public isAnalyzerEnabled(): boolean {
        return this.isEnabled;
    }

    public async startAnalysis(
        document?: vscode.TextDocument,
        existingAxeDiagnostics?: vscode.Diagnostic[],
        signal?: AbortSignal
    ): Promise<void> {
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

    private async analyzeVisibleCode(
        document: vscode.TextDocument, 
        existingAxeDiagnostics: vscode.Diagnostic[],
        signal?: AbortSignal
    ): Promise<void> {
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
        } catch (error) {
            console.error('AI Semantic Analysis failed:', error);
            
            // End performance timer on error
            if (analysisId && this.metricsService) {
                this.metricsService.endAIAnalysis(analysisId);
            }
        }
    }

    // Internal analysis method
    private async performAnalysis(
        document: vscode.TextDocument,
        existingAxeDiagnostics: vscode.Diagnostic[],
        signal?: AbortSignal
    ): Promise<void> {
        try {
            // Get code with line numbers based on scope
            const codeWithLineNumbers = this.getCodeWithLineNumbers(document);
            
            if (!codeWithLineNumbers.trim()) {
                this.aiDiagnosticCollection.set(document.uri, []);
                return;
            }

            // Perform AI analysis
            // Abort early if requested
            if (signal?.aborted) throw new Error('AI analysis aborted');
            const aiFindings = await this.performAIAnalysis(codeWithLineNumbers, document, signal);
            if (signal?.aborted) throw new Error('AI analysis aborted');
            
            // Filter out duplicates with axe-core diagnostics
            const filteredFindings = this.filterAxeProblems(aiFindings, existingAxeDiagnostics);

            // Suppress recently fixed lines (only if unchanged)
            const stableFindings = this.filterRecentlyFixedProblems(filteredFindings, document);
            this.lastReportedCount = stableFindings.length;
            
            // Create blue AI diagnostics (also updates metrics)
            const aiDiagnostics = this.createAIDiagnostics(stableFindings, document);
            
            // Set diagnostics
            this.aiDiagnosticCollection.set(document.uri, aiDiagnostics);

        } catch (error) {
            console.error('AI Semantic Analysis error:', error);
            // Do not surface the error to the user to avoid disrupting UX
            this.aiDiagnosticCollection.set(document.uri, []);
        }
    }

    // Marks a line as recently fixed. Called after a successful fix.
    public recordFixedLine(document: vscode.TextDocument, line: number): void {
        this.recordFixedRange(document, new vscode.Range(line, 0, line, 0));
    }

    // Marks all lines in a range as fixed (e.g., when AI replaces multiple lines)
    public recordFixedRange(document: vscode.TextDocument, range: vscode.Range): void {
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
    private cleanupRecentlyFixed(): void {
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
    private filterRecentlyFixedProblems(findings: WCAGViolation[], document: vscode.TextDocument): WCAGViolation[] {
        if (findings.length === 0) return findings;
        this.cleanupRecentlyFixed();
        const uriKey = document.uri.toString();
        const lineMap = this.recentlyFixed.get(uriKey);
        if (!lineMap || this.RECENTLY_FIXED_TTL_MS === 0) return findings;
        const result: WCAGViolation[] = [];
        let suppressed = 0;
        for (const f of findings) {
            const entry = lineMap.get(f.range.start.line);
            if (!entry) { result.push(f); continue; }
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
    public getLastCounts(): { reported: number; suppressed: number } {
        return { reported: this.lastReportedCount, suppressed: this.lastSuppressedCount };
    }

    // Clears memory for recently fixed lines
    public clearRecentFixMemory(): void {
        this.recentlyFixed.clear();
        this.lastSuppressedCount = 0;
    }

    // Returns code based on analysis scope (visible vs. document)
    private getCodeWithLineNumbers(document: vscode.TextDocument): string {
        if (this.analysisScope === 'document') {
            return this.getAllCodeWithLineNumbers(document);
        } else {
            return this.getVisibleCodeWithLineNumbers(document);
        }
    }
    // Returns visible code with line numbers
    private getVisibleCodeWithLineNumbers(document: vscode.TextDocument): string {
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
    private getAllCodeWithLineNumbers(document: vscode.TextDocument): string {
        let code = '';
        for (let line = 0; line < document.lineCount; line++) {
            code += `${line + 1}: ${document.lineAt(line).text}\n`;
        }
        return code;
    }

    // Runs AI analysis and returns semantic WCAG violations
    private async performAIAnalysis(
        codeWithLineNumbers: string, 
        document: vscode.TextDocument,
        signal?: AbortSignal
    ): Promise<WCAGViolation[]> {
        try {
            const strategy = getPromptStrategy(this.promptStrategy);
            const prompt = strategy.generatePrompt(codeWithLineNumbers);
            
            const aiResponse = await this.llmService.getAIAnalysis(prompt);
            const violations = this.parseAIResponse(aiResponse, document);
            
            return violations;
        } catch (error) {
            const err: any = error;
            if (err && (err.name === 'AbortError' || (err instanceof Error && err.message === 'The user aborted a request.') || (err instanceof Error && err.message === 'AI analysis aborted'))) {
                console.log('AI analysis was aborted by user');
                return [];
            }
            console.error('AI analysis request failed:', error);
            try {
                const defaultStrategy = getDefaultStrategy();
                const prompt = defaultStrategy.generatePrompt(codeWithLineNumbers);
                const aiResponse = await this.llmService.getAIAnalysis(prompt);
                return this.parseAIResponse(aiResponse, document);
            } catch (fallbackError) {
                console.error('Fallback AI analysis also failed:', fallbackError);
                return [];
            }
        }
    }

    // Parses AI response into a list of WCAG violations
    private parseAIResponse(aiResponse: string, document: vscode.TextDocument): WCAGViolation[] {
    const parsed = normalizeRuleIds(parseAIAnalysis(aiResponse));
        const violations: WCAGViolation[] = [];
        for (const p of parsed) {
            this.pushIfValidViolation({
                line: p.line,
                element: p.element || '',
                issue: p.issue || '',
                recommendation: p.recommendation || '',
        ruleId: normalizeRuleId(p.ruleId) || 'ai-semantic'
            }, document, violations);
        }
        return violations;
    }

    private pushIfValidViolation(parsed: AIAnalysisResult, document: vscode.TextDocument, violations: WCAGViolation[]): void {
        if (!parsed || typeof parsed.line !== 'number') return;
        if (parsed.line <= 0 || parsed.line > document.lineCount) return;
        const lineIndex = parsed.line - 1;
        const lineText = document.lineAt(lineIndex).text;
        const range = new vscode.Range(
            new vscode.Position(lineIndex, 0),
            new vscode.Position(lineIndex, lineText.length)
        );
        violations.push({
            element: parsed.element || lineText.trim(),
            message: `${parsed.issue}: ${parsed.recommendation}`,
            range,
            ruleId: parsed.ruleId || 'ai-semantic',
            severity: 'warning'
        });
    }

    // Prevents duplicates between AI findings and axe-core diagnostics
    private filterAxeProblems(
        aiFindings: WCAGViolation[], 
        axeDiagnostics: vscode.Diagnostic[]
    ): WCAGViolation[] {
        return aiFindings.filter(aiFinding => {
            // Check whether axe-core already reported an issue in the same line
            return !axeDiagnostics.some(axeDiag => {
                return this.rangesOverlap(aiFinding.range, axeDiag.range);
            });
        });
    }

    // Checks if two ranges overlap
    private rangesOverlap(range1: vscode.Range, range2: vscode.Range): boolean {
        return range1.start.line === range2.start.line ||
               range1.end.line === range2.end.line ||
               (range1.start.line < range2.end.line && range1.end.line > range2.start.line);
    }

    // Creates blue AI diagnostics for found semantic issues
    private createAIDiagnostics(
        findings: WCAGViolation[], 
        document: vscode.TextDocument
    ): vscode.Diagnostic[] {
        return findings.map(finding => {
            // Base extends start character + hash from issue snippet to reduce collisions
            const issueFragment = finding.message.slice(0,50);
            const base = `${document.uri.toString()}|${finding.range.start.line}|${finding.range.start.character}|${finding.ruleId}|${finding.element?.slice(0,40)}|${issueFragment}`;
            const hash = require('crypto').createHash('sha1').update(base).digest('hex').slice(0,10);
            const vId = `ai-${hash}`;
            const diagnostic = new vscode.Diagnostic(
                finding.range,
                `[AI Semantic] ${finding.message} (vID:${vId})`,
                vscode.DiagnosticSeverity.Information 
            );
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
    public removeAIDiagnostic(id: string): void {
        this.aiDiagnosticCollection.forEach((uri, diagnostics) => {
            const filtered = diagnostics.filter(d => {
                try {
                    if (typeof d.code === 'string') {
                        const data = JSON.parse(d.code);
                        if (data.vId === id) return false;
                        if (data.violationId === id) return false; // legacy support
                    }
                } catch {}
                return true;
            });
            if (filtered.length !== diagnostics.length) {
                this.aiDiagnosticCollection.set(uri, filtered);
            }
        });
    }

    // Cleanup
    public dispose(): void {
        this.aiDiagnosticCollection.dispose();
    }

    // Returns AI diagnostics for a document
    public getAIDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] {
        return this.aiDiagnosticCollection.get(uri) || [];
    }

    // Returns the diagnostic collection for metrics
    public getDiagnosticCollection(): vscode.DiagnosticCollection {
        return this.aiDiagnosticCollection;
    }

    // Clears all AI diagnostics
    public clearAll(): void {
        this.aiDiagnosticCollection.clear();
    }
}
