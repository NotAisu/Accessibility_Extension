import * as vscode from 'vscode';
import { LLMService } from '../llm/llm-service';
import { MetricsService } from '../metrics/metrics-service';

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
    private getDiagnosticsCallback?: (uri: vscode.Uri) => vscode.Diagnostic[];

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
            vscode.window.showWarningMessage('AI Semantic Analyzer ist nicht aktiviert');
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
            
            // Blaue AI-Diagnostics erstellen (inkl. Metrics-Update)
            const aiDiagnostics = this.createAIDiagnostics(filteredFindings, document);
            
            // Diagnostics setzen
            this.aiDiagnosticCollection.set(document.uri, aiDiagnostics);

        } catch (error) {
            console.error('AI Semantic Analysis error:', error);
            // Fehler nicht anzeigen, um UX nicht zu beeinträchtigen
            this.aiDiagnosticCollection.set(document.uri, []);
        }
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
        const prompt = this.createSemanticAnalysisPrompt(codeWithLineNumbers);
        
        try {
            const aiResponse = await this.llmService.getAIAnalysis(prompt);
            const violations = this.parseAIResponse(aiResponse, document);
            
            return violations;
        } catch (error) {
            console.error('AI analysis request failed:', error);
            return [];
        }
    }

    /**
     * Erstellt AI-Prompt für semantische WCAG-Analyse
     */
    private createSemanticAnalysisPrompt(codeWithLineNumbers: string): string {
        return `Analysiere den folgenden HTML/JSX Code auf SEMANTISCHE und KONTEXTUELLE WCAG-Verstöße WCAG 2.2 AA, die automatisierte Tools wie axe-core NICHT finden können.

FOKUS NUR AUF:
- Semantisches HTML: <div role="button"> statt <button>
- Unlogische Heading-Hierarchie: <h1> dann <h3> ohne <h2>
- Unverständliche Labels: <button>Submit</button> ohne Kontext
- Leere interaktive Elemente: <button></button>, <a href="#"></a>
- Tab-Reihenfolge-Probleme: tabindex ohne logische Struktur
- Sinnlose ARIA-Attribute: <img aria-label="image">
- Fokus-Management-Probleme bei dynamischen Inhalten

IGNORIERE standard-HTML-Validierung (fehlende alt-Attribute, etc.) - das macht axe-core bereits.

Für jedes gefundene semantische Problem gib ein JSON-Objekt zurück:
{"line": 5, "element": "<div role=\\"button\\">", "issue": "Non-semantic interactive element", "recommendation": "Replace with <button> element for better semantics", "ruleId": "semantic-button"}

Code:
${codeWithLineNumbers}`;
    }

    /**
     * Parst AI-Response zu WCAGViolation Array
     */
    private parseAIResponse(aiResponse: string, document: vscode.TextDocument): WCAGViolation[] {
        const violations: WCAGViolation[] = [];
        
        // JSON-Objekte aus Response extrahieren
        const jsonRegex = /\{[^}]*"line"[^}]*\}/g;
        const matches = aiResponse.match(jsonRegex);
        
        if (!matches) {
            return violations;
        }

        for (const match of matches) {
            try {
                const parsed: AIAnalysisResult = JSON.parse(match);
                
                if (parsed.line && parsed.line > 0 && parsed.line <= document.lineCount) {
                    const lineIndex = parsed.line - 1;
                    const lineText = document.lineAt(lineIndex).text;
                    
                    // Range für die komplette Zeile erstellen
                    const range = new vscode.Range(
                        new vscode.Position(lineIndex, 0),
                        new vscode.Position(lineIndex, lineText.length)
                    );

                    violations.push({
                        element: parsed.element || lineText.trim(),
                        message: `${parsed.issue}: ${parsed.recommendation}`,
                        range: range,
                        ruleId: parsed.ruleId || 'ai-semantic',
                        severity: 'warning'
                    });
                }
            } catch (error) {
                // Ignore malformed JSON
                continue;
            }
        }

        return violations;
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
        const diagnostics = findings.map(finding => {
            const diagnostic = new vscode.Diagnostic(
                finding.range,
                `[AI Semantic] ${finding.message}`,
                vscode.DiagnosticSeverity.Information 
            );
            
            diagnostic.code = JSON.stringify({ 
                ruleId: finding.ruleId, 
                isAIGenerated: true,
                element: finding.element,
                recommendation: finding.message,
                violationId: `ai_violation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            });
            
            diagnostic.source = 'AI Accessibility Analyzer';
            
            return diagnostic;
        });

        return diagnostics;
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
