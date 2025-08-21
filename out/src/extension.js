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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const jsdom_1 = require("jsdom");
const axe = __importStar(require("axe-core"));
const llm_service_1 = require("./llm/llm-service");
const code_tutor_service_1 = require("./code-tutor/code-tutor-service");
const llm_settings_provider_1 = require("./views/llm-settings-provider");
const ai_semantic_analyzer_1 = require("./ai/ai-semantic-analyzer");
const metrics_service_1 = require("./metrics/metrics-service");
const metrics_dashboard_provider_1 = require("./views/metrics-dashboard-provider");
const feedback_service_1 = require("./feedback/feedback-service");
const diagnosticCollection = vscode.languages.createDiagnosticCollection('accessibility');
let llmService;
let codeTutorService;
let aiSemanticAnalyzer;
let metricsService;
let feedbackService;
function activate(context) {
    console.log('🚀 Activating Accessibility Extension...');
    // Services mit SecretStorage initialisieren
    llmService = new llm_service_1.LLMService(context.secrets);
    codeTutorService = new code_tutor_service_1.CodeTutorService();
    metricsService = metrics_service_1.MetricsService.getInstance(context);
    feedbackService = feedback_service_1.FeedbackService.getInstance(metricsService);
    // Set metrics service in LLM service
    llmService.setMetricsService(metricsService);
    aiSemanticAnalyzer = new ai_semantic_analyzer_1.AISemanticAnalyzer(llmService);
    aiSemanticAnalyzer.setMetricsService(metricsService);
    // Set up callback for AI analyzer to access axe-core diagnostics
    aiSemanticAnalyzer.setDiagnosticsCallback((uri) => {
        return Array.from(diagnosticCollection.get(uri) || []);
    });
    console.log('📊 Services initialized successfully');
    // Register LLM Settings webview provider
    const llmSettingsProvider = new llm_settings_provider_1.LLMSettingsProvider(context.extensionUri, llmService);
    llmSettingsProvider.setAIAnalyzer(aiSemanticAnalyzer);
    llmSettingsProvider.setCodeTutorService(codeTutorService);
    llmSettingsProvider.setMetricsService(metricsService);
    llmSettingsProvider.setDiagnosticCollections(diagnosticCollection, aiSemanticAnalyzer.getDiagnosticCollection());
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(llm_settings_provider_1.LLMSettingsProvider.viewType, llmSettingsProvider));
    console.log(`Registered LLM Settings Provider with viewType: ${llm_settings_provider_1.LLMSettingsProvider.viewType}`);
    // Register Metrics Dashboard webview provider
    const metricsDashboardProvider = new metrics_dashboard_provider_1.MetricsDashboardProvider(context.extensionUri, metricsService);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(metrics_dashboard_provider_1.MetricsDashboardProvider.viewType, metricsDashboardProvider));
    console.log(`Registered Metrics Dashboard Provider with viewType: ${metrics_dashboard_provider_1.MetricsDashboardProvider.viewType}`);
    // Set DiagnosticCollections for the dashboard provider so it can refresh violations after clearing data
    metricsDashboardProvider.setDiagnosticCollections(diagnosticCollection, aiSemanticAnalyzer.getDiagnosticCollection());
    console.log('Accessibility Extension: All WebView Providers registered successfully');
    // Register feedback command
    context.subscriptions.push(feedbackService.createFeedbackCommand());
    // Register feedback hover provider
    context.subscriptions.push(vscode.languages.registerHoverProvider(['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact'], feedbackService.createFeedbackHoverProvider()));
    // Accessibility-bezogene Befehle
    context.subscriptions.push(vscode.commands.registerCommand('accessibility-extension.fixWithAI', fixWithAI));
    // AI Analysis Command (wird vom WebView Button getriggert)
    context.subscriptions.push(vscode.commands.registerCommand('accessibility-extension.startAIAnalysis', async () => {
        try {
            await aiSemanticAnalyzer.startAnalysis();
            // Metrics nach AI-Analyse aktualisieren
            updateGlobalViolationMetrics();
        }
        catch (error) {
            console.error('AI Analysis command failed:', error);
        }
    }));
    // Test Connection Command
    context.subscriptions.push(vscode.commands.registerCommand('accessibility-extension.testConnection', async () => {
        try {
            const isConnected = await llmService.testConnection();
            const message = isConnected ?
                'AI provider connection successful!' :
                'AI provider connection failed. Please check your settings.';
            if (isConnected) {
                vscode.window.showInformationMessage(message);
            }
            else {
                vscode.window.showErrorMessage(message);
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }));
    // Debug Commands for Testing
    context.subscriptions.push(vscode.commands.registerCommand('accessibility-extension.openDashboard', async () => {
        await vscode.commands.executeCommand('accessibilityMetricsDashboard.focus');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('accessibility-extension.openSettings', async () => {
        await vscode.commands.executeCommand('aiAccessibilitySettings.focus');
    }));
    // Code Tutor Befehle
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('accessibility-extension.codeTutorAnnotate', async (textEditor) => {
        await codeTutorService.toggleAnnotations(textEditor);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('accessibility-extension.codeTutorClear', () => {
        codeTutorService.clearAnnotations();
        vscode.window.showInformationMessage('Code Tutor Annotationen wurden gelöscht.');
    }));
    // Metrics and Feedback Commands
    context.subscriptions.push(vscode.commands.registerCommand('accessibility-extension.showMetrics', () => {
        vscode.commands.executeCommand('workbench.view.extension.accessibility-metrics');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('accessibility-extension.clearMetrics', async () => {
        const result = await vscode.window.showWarningMessage('Are you sure you want to clear all metrics data?', 'Clear Data', 'Cancel');
        if (result === 'Clear Data') {
            // Verwende clearDataAndRefresh um aktuelle Violations beizubehalten
            metricsService.clearDataAndRefresh(diagnosticCollection, aiSemanticAnalyzer.getDiagnosticCollection());
            vscode.window.showInformationMessage('Metrics data cleared successfully.');
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('accessibility-extension.showFeedbackStats', () => {
        const stats = metricsService.getDashboardData();
        vscode.window.showInformationMessage(`📊 Metrics Stats - Detection Accuracy: ${stats.detectionAccuracy.toFixed(1)}%, ` +
            `Quick Fix Success Rate: ${stats.quickFixSuccessRate.toFixed(1)}%, ` +
            `Total Current Violations: ${stats.totalCurrentViolations}`);
    }));
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider(['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact'], new AccessibilityActionProvider(), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(runDiagnostics));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(runDiagnostics));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => {
        // Clean up diagnostics for closed document
        diagnosticCollection.delete(document.uri);
        aiSemanticAnalyzer.getDiagnosticCollection().delete(document.uri);
        // Update global metrics after cleanup
        updateGlobalViolationMetrics();
    }));
    vscode.window.visibleTextEditors.forEach(editor => runDiagnostics(editor.document));
}
/**
 * Führt Diagnostics für ein Dokument aus (nur axe-core, AI ist jetzt manuell)
 */
async function runDiagnostics(document) {
    // Nur für unterstützte Dateitypen
    const supportedLanguages = ['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact'];
    if (!supportedLanguages.includes(document.languageId)) {
        return;
    }
    try {
        // 1. Axe-core Diagnostics ausführen (sofortiges Feedback)
        await updateDiagnostics(document);
        // 2. Zentrale Metrics-Update für alle Diagnostics
        updateGlobalViolationMetrics();
    }
    catch (error) {
        console.error('Error running diagnostics:', error);
    }
}
/**
 * Updates die globalen Violation Metrics basierend auf allen aktuellen Diagnostics
 */
function updateGlobalViolationMetrics() {
    if (!metricsService)
        return;
    // Sammle alle Violations aus den DiagnosticCollections
    metricsService.updateCurrentViolationsFromDiagnostics(diagnosticCollection, aiSemanticAnalyzer.getDiagnosticCollection());
}
async function updateDiagnostics(document) {
    const text = document.getText();
    if (!text) {
        diagnosticCollection.set(document.uri, []);
        return;
    }
    const { window } = new jsdom_1.JSDOM(text);
    if (!window.HTMLCanvasElement.prototype.getContext) {
        window.HTMLCanvasElement.prototype.getContext = function () {
            return null;
        };
    }
    try {
        const results = await axe.run(window.document.documentElement, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
            resultTypes: ['violations'],
            rules: {
                'color-contrast': { enabled: false },
                'color-contrast-enhanced': { enabled: false }
            }
        });
        const diagnostics = [];
        for (const violation of results.violations) {
            for (const node of violation.nodes) {
                let range;
                if (node.target.length === 1 && node.target[0] === 'html') {
                    const htmlTagRegex = /<html[^>]*>/i;
                    const match = text.match(htmlTagRegex);
                    if (match && typeof match.index === 'number') {
                        range = new vscode.Range(document.positionAt(match.index), document.positionAt(match.index + match[0].length));
                    }
                }
                else {
                    const problematicHtml = node.html;
                    const index = text.indexOf(problematicHtml);
                    if (index !== -1) {
                        range = new vscode.Range(document.positionAt(index), document.positionAt(index + problematicHtml.length));
                    }
                }
                if (range) {
                    const diagnostic = new vscode.Diagnostic(range, `${violation.help} (Regel: ${violation.id})`, vscode.DiagnosticSeverity.Warning);
                    diagnostic.code = JSON.stringify({ ruleId: violation.id, help: violation.help });
                    diagnostics.push(diagnostic);
                }
            }
        }
        diagnosticCollection.set(document.uri, diagnostics);
    }
    catch (error) {
        console.error('Error in accessibility analysis:', error);
        if (error instanceof Error && error.message.includes('HTMLCanvasElement.prototype.getContext')) {
            console.warn('Canvas context not available in JSDOM - color contrast checks disabled');
        }
        else {
            vscode.window.showErrorMessage('An error occurred during accessibility analysis.');
        }
        diagnosticCollection.set(document.uri, []);
    }
}
class AccessibilityActionProvider {
    provideCodeActions(document, range, context) {
        // Filter für alle Accessibility-Diagnostics (axe-core und AI)
        const accessibilityDiagnostics = context.diagnostics.filter(diagnostic => {
            // axe-core Diagnostics haben string code
            if (typeof diagnostic.code === 'string') {
                return true;
            }
            // AI-Diagnostics haben JSON code mit isAIGenerated flag
            try {
                if (typeof diagnostic.code === 'string') {
                    const codeData = JSON.parse(diagnostic.code);
                    return codeData.isAIGenerated === true;
                }
            }
            catch (error) {
                // Ignore parsing errors
            }
            return false;
        });
        if (accessibilityDiagnostics.length === 0) {
            return [];
        }
        // Eine einheitliche "Fix with AI" Aktion für alle Accessibility-Probleme
        return accessibilityDiagnostics.map(diagnostic => this.createCommandAction(diagnostic));
    }
    createCommandAction(diagnostic) {
        const action = new vscode.CodeAction('Fix with AI', vscode.CodeActionKind.QuickFix);
        action.command = {
            command: 'accessibility-extension.fixWithAI',
            title: 'Generate fix with AI',
            arguments: [diagnostic]
        };
        action.diagnostics = [diagnostic];
        action.isPreferred = true;
        return action;
    }
}
async function fixWithAI(diagnostic) {
    const editor = vscode.window.activeTextEditor;
    if (!editor)
        return;
    const code = editor.document.getText(diagnostic.range);
    // Variable für quickFixId außerhalb des try-catch definieren
    let quickFixId = '';
    // Unterscheiden zwischen axe-core und AI-Diagnostics
    let help;
    let isAIGenerated = false;
    try {
        if (typeof diagnostic.code === 'string') {
            const codeData = JSON.parse(diagnostic.code);
            if (codeData.isAIGenerated === true) {
                // AI-Generated Diagnostic
                help = codeData.recommendation || diagnostic.message;
                isAIGenerated = true;
            }
            else {
                // axe-core Diagnostic
                help = codeData.help || diagnostic.message;
            }
        }
        else {
            help = diagnostic.message;
        }
    }
    catch (error) {
        help = diagnostic.message;
    }
    // Capture document version before requesting fix
    const originalVersion = editor.document.version;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: isAIGenerated ? "Applying AI semantic fix..." : "Asking AI for an accessibility fix...",
        cancellable: false
    }, async () => {
        try {
            let prompt;
            // Erweiterten Kontext um das Problem herum holen
            const extendedRange = new vscode.Range(Math.max(0, diagnostic.range.start.line - 2), 0, Math.min(editor.document.lineCount - 1, diagnostic.range.end.line + 2), editor.document.lineAt(Math.min(editor.document.lineCount - 1, diagnostic.range.end.line + 2)).text.length);
            const contextCode = editor.document.getText(extendedRange);
            if (isAIGenerated) {
                // Verbesserter Prompt für AI-generierte semantische Probleme
                prompt = `You are an accessibility expert. Fix the WCAG semantic violation in this Frontend code.

CONTEXT:
${contextCode}

PROBLEM:
- Line ${diagnostic.range.start.line + 1}: ${help}
- Affected code: ${code}

REQUIREMENTS:
1. Fix ONLY the problematic code on line ${diagnostic.range.start.line + 1}
2. Maintain the same functionality and styling
3. Follow WCAG 2.2 AA semantic requirements
4. Use proper HTML5 semantic elements
5. Ensure keyboard accessibility

Return ONLY the corrected code for line ${diagnostic.range.start.line + 1}, nothing else.`;
            }
            else {
                // Verbesserter Prompt für axe-core Probleme
                prompt = `You are an accessibility expert. Fix the WCAG violation in this Frontend code.

CONTEXT:
${contextCode}

VIOLATION:
- Rule: ${help}
- Line ${diagnostic.range.start.line + 1}: ${code}

REQUIREMENTS:
1. Fix ONLY the code on line ${diagnostic.range.start.line + 1}
2. Maintain existing functionality and appearance
3. Follow WCAG 2.2 AA guidelines
4. Add necessary accessibility attributes
5. Ensure screen reader compatibility

Return ONLY the corrected code for line ${diagnostic.range.start.line + 1}, nothing else.`;
            }
            const response = await llmService.getAccessibilityFix(prompt);
            let suggestion = response.result.trim();
            quickFixId = response.quickFixId;
            // Detect fenced code blocks and extract core content
            const fenced = suggestion.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
            if (fenced && fenced[1]) {
                suggestion = fenced[1].trim();
            }
            // Multi-line support: if suggestion has multiple lines and original range is single line,
            // expand replacement to whole line (or lines) heuristically.
            const originalLineText = editor.document.lineAt(diagnostic.range.start.line).text;
            const isSingleLineRange = diagnostic.range.start.line === diagnostic.range.end.line;
            let targetRange = diagnostic.range;
            if (isSingleLineRange) {
                const suggestionLineCount = suggestion.split(/\r?\n/).length;
                if (suggestionLineCount > 1) {
                    // Expand to full original line only; keep rest of document stable.
                    targetRange = new vscode.Range(new vscode.Position(diagnostic.range.start.line, 0), new vscode.Position(diagnostic.range.start.line, originalLineText.length));
                }
            }
            // Safety: ensure document unchanged at target line before applying
            if (editor.document.version !== originalVersion) {
                const currentLineNow = editor.document.lineAt(diagnostic.range.start.line).text;
                if (currentLineNow !== originalLineText) {
                    vscode.window.showWarningMessage('Document changed since diagnostic was generated. Aborting fix to prevent conflicts.');
                    return;
                }
            }
            const edit = new vscode.WorkspaceEdit();
            edit.replace(editor.document.uri, targetRange, suggestion);
            const applied = await vscode.workspace.applyEdit(edit);
            if (applied) {
                vscode.window.showInformationMessage('✅ AI fix applied.');
            }
            else {
                vscode.window.showErrorMessage('Failed to apply AI fix edit.');
            }
            // Extract rule ID from diagnostic for feedback
            let ruleId = '';
            try {
                if (typeof diagnostic.code === 'string') {
                    const codeData = JSON.parse(diagnostic.code);
                    ruleId = codeData.ruleId || ruleId;
                }
            }
            catch (error) {
                console.log(error);
            }
            // Show feedback request after a delay
            setTimeout(() => {
                feedbackService.showQuickFixFeedback(quickFixId, ruleId);
            }, 1500);
        }
        catch (error) {
            console.error('QuickFix failed:', error);
            vscode.window.showErrorMessage(`Failed to get suggestion from AI: ${error instanceof Error ? error.message : 'Unknown error'}`);
            // Record failed attempt in metrics
            metricsService.recordQuickFixFeedback(quickFixId, 'negative');
        }
    });
}
function deactivate() {
    diagnosticCollection.clear();
    if (codeTutorService) {
        codeTutorService.clearAnnotations();
    }
    if (aiSemanticAnalyzer) {
        aiSemanticAnalyzer.dispose();
    }
    if (metricsService) {
        metricsService.dispose();
    }
}
//# sourceMappingURL=extension.js.map