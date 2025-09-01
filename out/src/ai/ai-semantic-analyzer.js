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
/**
 * AI Semantic Analyzer mit blauer Farbkodierung für WCAG-Semantik-Verstöße
 */
class AISemanticAnalyzer {
    constructor(llmService) {
        this.aiDiagnosticCollection = vscode.languages.createDiagnosticCollection('ai-accessibility');
        this.isEnabled = false;
        this.analysisScope = 'visible';
        this.promptStrategy = 'one-shot';
        // Merkt sich kürzlich per "Fix with AI" (oder AI QuickFix auf axe) behobene Zeilen, damit diese
        // bei unmittelbar folgenden Analysen nicht erneut als Verstöße auftauchen, solange sich die Zeile
        // inhaltlich nicht verändert hat. (URI -> (Line -> { textSnapshot, ts }))
        this.recentlyFixed = new Map();
        this.RECENTLY_FIXED_TTL_MS = 1000 * 60 * 5; // Default 5 Min (override by setting)
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
        this.promptStrategy = config.get('aiAnalyzer.promptStrategy', 'one-shot');
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
    /**
     * Manuelle Analyse-Methode (wird von Button getriggert)
     */
    async startAnalysis(document, existingAxeDiagnostics) {
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
    async analyzeVisibleCode(document, existingAxeDiagnostics) {
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
        }
        catch (error) {
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
    async performAnalysis(document, existingAxeDiagnostics) {
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
        }
        catch (error) {
            console.error('AI Semantic Analysis error:', error);
            // Fehler nicht anzeigen, um UX nicht zu beeinträchtigen
            this.aiDiagnosticCollection.set(document.uri, []);
        }
    }
    /**
     * Markiert eine Zeile als kürzlich behoben. Wird nach erfolgreichem Fix aufgerufen.
     */
    recordFixedLine(document, line) {
        this.recordFixedRange(document, new vscode.Range(line, 0, line, 0));
    }
    /**
     * Markiert alle Zeilen einer Range als gefixt (z.B. bei Mehrzeilen-Ersatz durch AI)
     */
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
    /** Entfernt abgelaufene Einträge aus recentlyFixed */
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
    /**
     * Filtert Findings heraus, deren Zeilen unmittelbar zuvor gefixt wurden
     * und deren Inhalt unverändert geblieben ist.
     */
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
    /** Liefert zuletzt unterdrückte & gemeldete Counts (für StatusBar) */
    getLastCounts() {
        return { reported: this.lastReportedCount, suppressed: this.lastSuppressedCount };
    }
    /** Löscht den Memory für kürzlich gefixte Zeilen */
    clearRecentFixMemory() {
        this.recentlyFixed.clear();
        this.lastSuppressedCount = 0;
    }
    /**
     * Holt Code basierend auf Analysis-Scope (visible vs. document)
     */
    getCodeWithLineNumbers(document) {
        if (this.analysisScope === 'document') {
            return this.getAllCodeWithLineNumbers(document);
        }
        else {
            return this.getVisibleCodeWithLineNumbers(document);
        }
    }
    /**
     * Holt sichtbaren Code mit Zeilennummern
     */
    getVisibleCodeWithLineNumbers(document) {
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
    getAllCodeWithLineNumbers(document) {
        let code = '';
        for (let line = 0; line < document.lineCount; line++) {
            code += `${line + 1}: ${document.lineAt(line).text}\n`;
        }
        return code;
    }
    /**
     * Führt AI-Analyse durch und gibt semantische WCAG-Verstöße zurück
     */
    async performAIAnalysis(codeWithLineNumbers, document) {
        try {
            const strategy = (0, prompt_strategies_1.getPromptStrategy)(this.promptStrategy);
            const prompt = strategy.generatePrompt(codeWithLineNumbers);
            const aiResponse = await this.llmService.getAIAnalysis(prompt);
            const violations = this.parseAIResponse(aiResponse, document);
            return violations;
        }
        catch (error) {
            console.error('AI analysis request failed:', error);
            // Fallback to default strategy if current strategy fails
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
    /**
     * Parst AI-Response zu WCAGViolation Array
     */
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
    /**
     * Verhindert Duplikate zwischen AI-Findings und axe-core Diagnostics
     */
    filterAxeProblems(aiFindings, axeDiagnostics) {
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
    rangesOverlap(range1, range2) {
        return range1.start.line === range2.start.line ||
            range1.end.line === range2.end.line ||
            (range1.start.line < range2.end.line && range1.end.line > range2.start.line);
    }
    /**
     * Erstellt blaue AI-Diagnostics für gefundene semantische Probleme
     */
    createAIDiagnostics(findings, document) {
        return findings.map(finding => {
            // Basis erweitert um Start-Character + Hash eines Issue-Ausschnitts für Kollisionsreduktion
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
    /** Entfernt eine einzelne AI-Diagnostic anhand violationId */
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
    /**
     * Cleanup-Methode
     */
    dispose() {
        this.aiDiagnosticCollection.dispose();
    }
    /**
     * Holt AI-Diagnostics für ein Dokument
     */
    getAIDiagnostics(uri) {
        return this.aiDiagnosticCollection.get(uri) || [];
    }
    /**
     * Gibt die DiagnosticCollection zurück für Metrics
     */
    getDiagnosticCollection() {
        return this.aiDiagnosticCollection;
    }
    /**
     * Clearer alle AI-Diagnostics
     */
    clearAll() {
        this.aiDiagnosticCollection.clear();
    }
}
exports.AISemanticAnalyzer = AISemanticAnalyzer;
//# sourceMappingURL=ai-semantic-analyzer.js.map