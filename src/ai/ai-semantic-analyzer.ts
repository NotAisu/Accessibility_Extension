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

/**
 * AI Semantic Analyzer mit blauer Farbkodierung für WCAG-Semantik-Verstöße
 */
export class AISemanticAnalyzer {
    private aiDiagnosticCollection = vscode.languages.createDiagnosticCollection('ai-accessibility');
    private llmService: LLMService;
    private metricsService?: MetricsService;
    private isEnabled: boolean = false;
    private analysisScope: 'visible' | 'document' = 'visible';
    private promptStrategy: string = 'one-shot';
    private getDiagnosticsCallback?: (uri: vscode.Uri) => vscode.Diagnostic[];
    // Merkt sich kürzlich per "Fix with AI" (oder AI QuickFix auf axe) behobene Zeilen, damit diese
    // bei unmittelbar folgenden Analysen nicht erneut als Verstöße auftauchen, solange sich die Zeile
    // inhaltlich nicht verändert hat. (URI -> (Line -> { textSnapshot, ts }))
    private recentlyFixed: Map<string, Map<number, { text: string; ts: number }>> = new Map();
    private RECENTLY_FIXED_TTL_MS = 1000 * 60 * 5; // Default 5 Min (override by setting)
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
        this.promptStrategy = config.get<string>('aiAnalyzer.promptStrategy', 'one-shot');
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

    /**
     * Manuelle Analyse-Methode (wird von Button getriggert)
     */
    public async startAnalysis(
        document?: vscode.TextDocument,
        existingAxeDiagnostics?: vscode.Diagnostic[]
    ): Promise<void> {
        if (!this.isEnabled) {
            vscode.window.showWarningMessage('AI Semantic Analyzer is not enabled');
            return;
        }

        // Aktuelles Dokument verwenden wenn nicht übergeben
        if (!document) {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('Kein aktiver Editor gefunden');
                return;
            }
            document = editor.document;
        }

        // Unterstützte Dateitypen prüfen
        const supportedLanguages = ['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact'];
        if (!supportedLanguages.includes(document.languageId)) {
            vscode.window.showWarningMessage(`Dateityp ${document.languageId} wird nicht unterstützt`);
            return;
        }

        // Bestehende axe-core Diagnostics holen wenn nicht übergeben
        if (!existingAxeDiagnostics) {
            existingAxeDiagnostics = this.getDiagnosticsCallback ? 
                this.getDiagnosticsCallback(document.uri) : 
                [];
        }

        await this.analyzeVisibleCode(document, existingAxeDiagnostics);
    }

    /**
     * Hauptanalyse-Methode (jetzt privat, wird von startAnalysis aufgerufen)
     */
    private async analyzeVisibleCode(
        document: vscode.TextDocument, 
        existingAxeDiagnostics: vscode.Diagnostic[]
    ): Promise<void> {
        if (!this.isEnabled) {
            this.aiDiagnosticCollection.set(document.uri, []);
            return;
        }

        // Start Performance-Timer
        const analysisId = this.metricsService?.startAIAnalysis();

        try {
            await this.performAnalysis(document, existingAxeDiagnostics);
            
            // End Performance-Timer bei Erfolg
            if (analysisId && this.metricsService) {
                this.metricsService.endAIAnalysis(analysisId);
            }
        } catch (error) {
            console.error('AI Semantic Analysis failed:', error);
            
            // End Performance-Timer auch bei Fehler
            if (analysisId && this.metricsService) {
                this.metricsService.endAIAnalysis(analysisId);
            }
        }
    }

    /**
     * Interne Analyse-Methode
     */
    private async performAnalysis(
        document: vscode.TextDocument,
        existingAxeDiagnostics: vscode.Diagnostic[]
    ): Promise<void> {
        try {
            // Sichtbaren Code holen
            const codeWithLineNumbers = this.getCodeWithLineNumbers(document);
            
            if (!codeWithLineNumbers.trim()) {
                this.aiDiagnosticCollection.set(document.uri, []);
                return;
            }

            // AI-Analyse durchführen
            const aiFindings = await this.performAIAnalysis(codeWithLineNumbers, document);
            
            // Axe-core Duplikate filtern
            const filteredFindings = this.filterAxeProblems(aiFindings, existingAxeDiagnostics);

            // Kürzlich behobene Zeilen ausfiltern (nur wenn unverändert)
            const stableFindings = this.filterRecentlyFixedProblems(filteredFindings, document);
            this.lastReportedCount = stableFindings.length;
            
            // Blaue AI-Diagnostics erstellen (inkl. Metrics-Update)
            const aiDiagnostics = this.createAIDiagnostics(stableFindings, document);
            
            // Diagnostics setzen
            this.aiDiagnosticCollection.set(document.uri, aiDiagnostics);

        } catch (error) {
            console.error('AI Semantic Analysis error:', error);
            // Fehler nicht anzeigen, um UX nicht zu beeinträchtigen
            this.aiDiagnosticCollection.set(document.uri, []);
        }
    }

    /**
     * Markiert eine Zeile als kürzlich behoben. Wird nach erfolgreichem Fix aufgerufen.
     */
    public recordFixedLine(document: vscode.TextDocument, line: number): void {
        this.recordFixedRange(document, new vscode.Range(line, 0, line, 0));
    }

    /**
     * Markiert alle Zeilen einer Range als gefixt (z.B. bei Mehrzeilen-Ersatz durch AI)
     */
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

    /** Entfernt abgelaufene Einträge aus recentlyFixed */
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

    /**
     * Filtert Findings heraus, deren Zeilen unmittelbar zuvor gefixt wurden
     * und deren Inhalt unverändert geblieben ist.
     */
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

    /** Liefert zuletzt unterdrückte & gemeldete Counts (für StatusBar) */
    public getLastCounts(): { reported: number; suppressed: number } {
        return { reported: this.lastReportedCount, suppressed: this.lastSuppressedCount };
    }

    /** Löscht den Memory für kürzlich gefixte Zeilen */
    public clearRecentFixMemory(): void {
        this.recentlyFixed.clear();
        this.lastSuppressedCount = 0;
    }

    /**
     * Holt Code basierend auf Analysis-Scope (visible vs. document)
     */
    private getCodeWithLineNumbers(document: vscode.TextDocument): string {
        if (this.analysisScope === 'document') {
            return this.getAllCodeWithLineNumbers(document);
        } else {
            return this.getVisibleCodeWithLineNumbers(document);
        }
    }
    /**
     * Holt sichtbaren Code mit Zeilennummern
     */
    private getVisibleCodeWithLineNumbers(document: vscode.TextDocument): string {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.toString() !== document.uri.toString()) {
            // Fallback: komplettes Dokument analysieren
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

    /**
     * Fallback: Komplettes Dokument mit Zeilennummern
     */
    private getAllCodeWithLineNumbers(document: vscode.TextDocument): string {
        let code = '';
        for (let line = 0; line < document.lineCount; line++) {
            code += `${line + 1}: ${document.lineAt(line).text}\n`;
        }
        return code;
    }

    /**
     * Führt AI-Analyse durch und gibt semantische WCAG-Verstöße zurück
     */
    private async performAIAnalysis(
        codeWithLineNumbers: string, 
        document: vscode.TextDocument
    ): Promise<WCAGViolation[]> {
        try {
            const strategy = getPromptStrategy(this.promptStrategy);
            const prompt = strategy.generatePrompt(codeWithLineNumbers);
            
            const aiResponse = await this.llmService.getAIAnalysis(prompt);
            const violations = this.parseAIResponse(aiResponse, document);
            
            return violations;
        } catch (error) {
            console.error('AI analysis request failed:', error);
            // Fallback to default strategy if current strategy fails
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

    /**
     * Parst AI-Response zu WCAGViolation Array
     */
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

    /**
     * Verhindert Duplikate zwischen AI-Findings und axe-core Diagnostics
     */
    private filterAxeProblems(
        aiFindings: WCAGViolation[], 
        axeDiagnostics: vscode.Diagnostic[]
    ): WCAGViolation[] {
        return aiFindings.filter(aiFinding => {
            // Prüfen ob axe-core bereits ein Problem in derselben Zeile gefunden hat
            return !axeDiagnostics.some(axeDiag => {
                return this.rangesOverlap(aiFinding.range, axeDiag.range);
            });
        });
    }

    /**
     * Prüft ob zwei Ranges überlappen
     */
    private rangesOverlap(range1: vscode.Range, range2: vscode.Range): boolean {
        return range1.start.line === range2.start.line ||
               range1.end.line === range2.end.line ||
               (range1.start.line < range2.end.line && range1.end.line > range2.start.line);
    }

    /**
     * Erstellt blaue AI-Diagnostics für gefundene semantische Probleme
     */
    private createAIDiagnostics(
        findings: WCAGViolation[], 
        document: vscode.TextDocument
    ): vscode.Diagnostic[] {
        return findings.map(finding => {
            // Basis erweitert um Start-Character + Hash eines Issue-Ausschnitts für Kollisionsreduktion
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

    /** Entfernt eine einzelne AI-Diagnostic anhand violationId */
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

    /**
     * Cleanup-Methode
     */
    public dispose(): void {
        this.aiDiagnosticCollection.dispose();
    }

    /**
     * Holt AI-Diagnostics für ein Dokument
     */
    public getAIDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] {
        return this.aiDiagnosticCollection.get(uri) || [];
    }

    /**
     * Gibt die DiagnosticCollection zurück für Metrics
     */
    public getDiagnosticCollection(): vscode.DiagnosticCollection {
        return this.aiDiagnosticCollection;
    }

    /**
     * Clearer alle AI-Diagnostics
     */
    public clearAll(): void {
        this.aiDiagnosticCollection.clear();
    }
}
