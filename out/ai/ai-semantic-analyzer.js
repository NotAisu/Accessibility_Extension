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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AISemanticAnalyzer = void 0;
const vscode = __importStar(require("vscode"));
/**
 * AI Semantic Analyzer mit gelber Farbkodierung für WCAG-Semantik-Verstöße
 */
class AISemanticAnalyzer {
    constructor(llmService) {
        this.aiDiagnosticCollection = vscode.languages.createDiagnosticCollection('ai-accessibility');
        this.isEnabled = false;
        this.llmService = llmService;
        this.loadSettings();
    }
    loadSettings() {
        const config = vscode.workspace.getConfiguration('accessibility');
        this.isEnabled = config.get('aiAnalyzer.enabled', false);
    }
    setEnabled(enabled) {
        this.isEnabled = enabled;
        const config = vscode.workspace.getConfiguration('accessibility');
        config.update('aiAnalyzer.enabled', enabled, vscode.ConfigurationTarget.Global);
    }
    isAnalyzerEnabled() {
        return this.isEnabled;
    }
    /**
     * Hauptanalyse-Methode ohne Debouncing
     */
    async analyzeVisibleCode(document, existingAxeDiagnostics) {
        if (!this.isEnabled) {
            this.aiDiagnosticCollection.set(document.uri, []);
            return;
        }
        try {
            await this.performAnalysis(document, existingAxeDiagnostics);
        }
        catch (error) {
            console.error('AI Semantic Analysis failed:', error);
        }
    }
    /**
     * Interne Analyse-Methode
     */
    async performAnalysis(document, existingAxeDiagnostics) {
        try {
            // Sichtbaren Code holen (analog zu CodeTutorService)
            const visibleCode = this.getVisibleCodeWithLineNumbers(document);
            if (!visibleCode.trim()) {
                this.aiDiagnosticCollection.set(document.uri, []);
                return;
            }
            // AI-Analyse durchführen
            const aiFindings = await this.performAIAnalysis(visibleCode, document);
            // Axe-core Duplikate filtern
            const filteredFindings = this.filterAxeProblems(aiFindings, existingAxeDiagnostics);
            // Gelbe AI-Diagnostics erstellen
            const aiDiagnostics = this.createAIDiagnostics(filteredFindings, document);
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
     * Holt sichtbaren Code mit Zeilennummern (analog zu CodeTutorService)
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
        const prompt = this.createSemanticAnalysisPrompt(codeWithLineNumbers);
        try {
            const aiResponse = await this.llmService.getAccessibilityFix(prompt);
            return this.parseAIResponse(aiResponse, document);
        }
        catch (error) {
            console.error('AI analysis request failed:', error);
            return [];
        }
    }
    /**
     * Erstellt AI-Prompt für semantische WCAG-Analyse
     */
    createSemanticAnalysisPrompt(codeWithLineNumbers) {
        return `Analysiere den folgenden HTML/JSX Code auf SEMANTISCHE und KONTEXTUELLE WCAG-Verstöße, die automatisierte Tools wie axe-core NICHT finden können.

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
    parseAIResponse(aiResponse, document) {
        const violations = [];
        // JSON-Objekte aus Response extrahieren
        const jsonRegex = /\{[^}]*"line"[^}]*\}/g;
        const matches = aiResponse.match(jsonRegex);
        if (!matches) {
            return violations;
        }
        for (const match of matches) {
            try {
                const parsed = JSON.parse(match);
                if (parsed.line && parsed.line > 0 && parsed.line <= document.lineCount) {
                    const lineIndex = parsed.line - 1;
                    const lineText = document.lineAt(lineIndex).text;
                    // Range für die komplette Zeile erstellen
                    const range = new vscode.Range(new vscode.Position(lineIndex, 0), new vscode.Position(lineIndex, lineText.length));
                    violations.push({
                        element: parsed.element || lineText.trim(),
                        message: `${parsed.issue}: ${parsed.recommendation}`,
                        range: range,
                        ruleId: parsed.ruleId || 'ai-semantic',
                        severity: 'warning'
                    });
                }
            }
            catch (error) {
                // Ignore malformed JSON
                continue;
            }
        }
        return violations;
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
            const diagnostic = new vscode.Diagnostic(finding.range, `[AI Semantic] ${finding.message}`, vscode.DiagnosticSeverity.Information // Blaue wellenförmige Unterstreichung
            );
            diagnostic.code = JSON.stringify({
                ruleId: finding.ruleId,
                isAIGenerated: true,
                element: finding.element,
                recommendation: finding.message
            });
            diagnostic.source = 'AI Accessibility Analyzer';
            diagnostic.tags = [vscode.DiagnosticTag.Unnecessary]; // Zusätzliche visuelle Kennzeichnung
            return diagnostic;
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
     * Clearer alle AI-Diagnostics
     */
    clearAll() {
        this.aiDiagnosticCollection.clear();
    }
}
exports.AISemanticAnalyzer = AISemanticAnalyzer;
//# sourceMappingURL=ai-semantic-analyzer.js.map