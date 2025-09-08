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
exports.deactivate = exports.activate = void 0;
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
const rule_id_normalizer_1 = require("./core/rule-id-normalizer");
const diagnosticCollection = vscode.languages.createDiagnosticCollection('accessibility');
let llmService;
let codeTutorService;
let aiSemanticAnalyzer;
let metricsService;
let feedbackService;
let aiStatusBarItem;
// Memory leak prevention: Track active documents and cleanup timer
let cleanupTimer;
const CLEANUP_INTERVAL_MS = 30000; // 30 seconds
// Race condition prevention: Debounced metrics updates
let metricsUpdateTimer;
const METRICS_UPDATE_DELAY_MS = 300;
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
    // Jetzt wo der Analyzer existiert, AI DiagnosticCollection an FeedbackService durchreichen
    if (typeof feedbackService.setAIDiagnosticCollection === 'function') {
        feedbackService.setAIDiagnosticCollection(aiSemanticAnalyzer.getDiagnosticCollection());
    }
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
            updateAIStatusBar();
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
    // Start memory cleanup timer
    startDiagnosticCleanup();
    // StatusBar Item
    aiStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    aiStatusBarItem.text = 'AI: inactive';
    aiStatusBarItem.command = 'accessibility-extension.startAIAnalysis';
    aiStatusBarItem.tooltip = 'Run AI Accessibility Analysis';
    aiStatusBarItem.show();
    context.subscriptions.push(aiStatusBarItem);
    // Command: Clear Recent Fix Memory
    context.subscriptions.push(vscode.commands.registerCommand('accessibility-extension.clearRecentAIMemory', () => {
        aiSemanticAnalyzer.clearRecentFixMemory();
        vscode.window.showInformationMessage('AI recent fix memory cleared.');
        updateAIStatusBar();
    }));
}
exports.activate = activate;
/**
 * Periodically cleans up diagnostics for closed/inactive documents
 */
function startDiagnosticCleanup() {
    cleanupTimer = setInterval(() => {
        cleanupInactiveDiagnostics();
    }, CLEANUP_INTERVAL_MS);
}
/**
 * Removes diagnostics for documents that are no longer open
 */
function cleanupInactiveDiagnostics() {
    const activeDocuments = new Set(vscode.workspace.textDocuments.map(doc => doc.uri.toString()));
    // Clean up main diagnostic collection
    const staleUris = [];
    diagnosticCollection.forEach((uri, diagnostics) => {
        if (!activeDocuments.has(uri.toString())) {
            staleUris.push(uri);
        }
    });
    // Clean up AI diagnostic collection
    const aiCollection = aiSemanticAnalyzer.getDiagnosticCollection();
    aiCollection.forEach((uri, diagnostics) => {
        if (!activeDocuments.has(uri.toString())) {
            staleUris.push(uri);
        }
    });
    // Remove stale diagnostics
    staleUris.forEach(uri => {
        diagnosticCollection.delete(uri);
        aiCollection.delete(uri);
    });
    if (staleUris.length > 0) {
        console.log(`🧹 Cleaned up ${staleUris.length} stale diagnostic entries`);
        debouncedMetricsUpdate();
    }
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
 * Debounced to prevent race conditions
 */
function updateGlobalViolationMetrics() {
    debouncedMetricsUpdate();
}
function updateAIStatusBar() {
    if (!aiSemanticAnalyzer || !aiStatusBarItem)
        return;
    const counts = aiSemanticAnalyzer.getLastCounts();
    aiStatusBarItem.text = `AI: ${counts.reported} findings (${counts.suppressed} suppressed)`;
}
/**
 * Debounced metrics update to prevent race conditions
 */
function debouncedMetricsUpdate() {
    if (metricsUpdateTimer) {
        clearTimeout(metricsUpdateTimer);
    }
    metricsUpdateTimer = setTimeout(() => {
        if (!metricsService)
            return;
        try {
            metricsService.updateCurrentViolationsFromDiagnostics(diagnosticCollection, aiSemanticAnalyzer.getDiagnosticCollection());
        }
        catch (error) {
            console.error('Failed to update metrics:', error);
        }
    }, METRICS_UPDATE_DELAY_MS);
}
async function updateDiagnostics(document) {
    const text = document.getText();
    if (!text) {
        diagnosticCollection.set(document.uri, []);
        return;
    }
    // Use a JSDOM window and execute scripts in its own realm so axe runs in the same context
    const { window } = new jsdom_1.JSDOM(text, { runScripts: 'dangerously' });
    // Stub häufig fehlender Browser-APIs / Assets um axe "preload" Timeouts zu verhindern
    try {
        window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
        window.cancelAnimationFrame = (id) => clearTimeout(id);
        // Fetch nur stubben, wenn es nicht existiert – verhindert, dass axe Preload-Assets fehlschlagen
        if (!window.fetch) {
            window.fetch = async () => ({ ok: true, text: async () => '', json: async () => ({}) });
        }
    }
    catch { }
    if (!window.HTMLCanvasElement.prototype.getContext) {
        window.HTMLCanvasElement.prototype.getContext = function () {
            return null;
        };
    }
    try {
        // Inject axe into the same realm as JSDOM to avoid cross-realm argument validation issues
        try {
            // eslint-disable-next-line no-eval
            window.eval(axe.source);
        }
        catch (e) {
            console.warn('Failed to inject axe into JSDOM window:', e);
        }
        // Timeout Schutz: axe darf nicht ewig hängen
        const AXE_TIMEOUT_MS = 5000;
        const axeOptions = {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
            resultTypes: ['violations'],
            rules: {
                'color-contrast': { enabled: false },
                'color-contrast-enhanced': { enabled: false }
            }
        };
        // Einige axe-Builds unterstützen 'preload'; wenn vorhanden, explizit deaktivieren
        try {
            axeOptions.preload = false;
        }
        catch { }
        const axePromise = window.axe.run(window.document, axeOptions);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('axe-timeout')), AXE_TIMEOUT_MS));
        const results = await Promise.race([axePromise, timeoutPromise]);
        if (!results) {
            console.warn('axe returned no results (possibly timed out)');
            diagnosticCollection.set(document.uri, []);
            return;
        }
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
                    const normId = (0, rule_id_normalizer_1.normalizeRuleId)(violation.id);
                    const diagnostic = new vscode.Diagnostic(range, `${violation.help} (Regel: ${normId || violation.id})`, vscode.DiagnosticSeverity.Warning);
                    diagnostic.code = JSON.stringify({ ruleId: normId || violation.id, help: violation.help, originalRuleId: violation.id });
                    diagnostics.push(diagnostic);
                }
            }
        }
        diagnosticCollection.set(document.uri, diagnostics);
    }
    catch (error) {
        if (error instanceof Error && error.message === 'axe-timeout') {
            console.warn('axe-core analysis aborted after timeout');
        }
        else {
            console.error('Error in accessibility analysis:', error);
        }
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
function findElementRangeForDoc(document, lineIndex, element) {
    const safeLine = Math.max(0, Math.min(lineIndex, document.lineCount - 1));
    if (!element) {
        const lt = document.lineAt(safeLine).text;
        return new vscode.Range(safeLine, 0, safeLine, lt.length);
    }
    const tagMatch = element.match(/^<([A-Za-z0-9-]+)/);
    if (!tagMatch) {
        const lt = document.lineAt(safeLine).text;
        return new vscode.Range(safeLine, 0, safeLine, lt.length);
    }
    const tag = tagMatch[1];
    const openPat = `<${tag}`;
    const closePat = `</${tag}>`;
    const searchRadius = 20;
    const startLine = Math.max(0, safeLine - searchRadius);
    const startOffset = document.offsetAt(new vscode.Position(startLine, 0));
    const full = document.getText();
    let openIdx = full.indexOf(openPat, startOffset);
    if (openIdx === -1)
        openIdx = full.indexOf(openPat);
    if (openIdx === -1) {
        const lt = document.lineAt(safeLine).text;
        return new vscode.Range(safeLine, 0, safeLine, lt.length);
    }
    const gtIdx = full.indexOf('>', openIdx);
    if (gtIdx === -1) {
        const pos = document.positionAt(openIdx);
        const lt = document.lineAt(pos.line).text;
        return new vscode.Range(pos.line, 0, pos.line, lt.length);
    }
    const selfCloseIdx = full.lastIndexOf('/>', gtIdx);
    if (selfCloseIdx !== -1 && selfCloseIdx >= openIdx && selfCloseIdx <= gtIdx + 2) {
        return new vscode.Range(document.positionAt(openIdx), document.positionAt(selfCloseIdx + 2));
    }
    const closeIdx = full.indexOf(closePat, gtIdx + 1);
    if (closeIdx !== -1) {
        return new vscode.Range(document.positionAt(openIdx), document.positionAt(closeIdx + closePat.length));
    }
    return new vscode.Range(document.positionAt(openIdx), document.positionAt(gtIdx + 1));
}
async function fixWithAI(diagnostic) {
    const editor = vscode.window.activeTextEditor;
    if (!editor)
        return;
    // Versuche Element-Range über Diagnostic-Metadaten zu bestimmen (AI enthält element)
    let elementRange = diagnostic.range;
    let element = '';
    try {
        if (typeof diagnostic.code === 'string') {
            const data = JSON.parse(diagnostic.code);
            element = data.element || '';
        }
    }
    catch { }
    if (element) {
        elementRange = findElementRangeForDoc(editor.document, diagnostic.range.start.line, element);
    }
    const code = editor.document.getText(elementRange);
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
            // Ersetze auf Element-Range
            const targetRange = elementRange;
            // Safety: ensure document unchanged at target line before applying
            if (editor.document.version !== originalVersion) {
                const currentElementText = editor.document.getText(elementRange);
                if (currentElementText !== code) {
                    vscode.window.showWarningMessage('Document changed since diagnostic was generated. Aborting fix to prevent conflicts.');
                    return;
                }
            }
            const edit = new vscode.WorkspaceEdit();
            edit.replace(editor.document.uri, targetRange, suggestion);
            const applied = await vscode.workspace.applyEdit(edit);
            if (applied) {
                vscode.window.showInformationMessage('✅ AI fix applied.');
                // Nach erfolgreichem Fix nur AI-Diagnostic entfernen (axe-core bleibt bestehen und wird
                // beim nächsten regulären Lauf neu bewertet). Zusätzlich die fixte Zeile merken, um sofortige
                // Re-Deklaration des gleichen AI-Verstoßes zu vermeiden.
                try {
                    if (typeof diagnostic.code === 'string') {
                        const codeData = JSON.parse(diagnostic.code);
                        // Range (kann mehrere Zeilen umfassen) registrieren
                        aiSemanticAnalyzer.recordFixedRange(editor.document, elementRange);
                        const removeId = codeData.vId || codeData.violationId; // support legacy
                        if (codeData.isAIGenerated && removeId) {
                            aiSemanticAnalyzer.removeAIDiagnostic(removeId);
                            // Mark feedbackGiven true in remaining diagnostics with same violationId (defensiv)
                            try {
                                const aiDiags = aiSemanticAnalyzer.getDiagnosticCollection().get(editor.document.uri) || [];
                                const updated = aiDiags.map(d => {
                                    if (typeof d.code === 'string') {
                                        try {
                                            const data = JSON.parse(d.code);
                                            if (data.vId === removeId || data.violationId === removeId) {
                                                data.feedbackGiven = true;
                                                d.code = JSON.stringify(data);
                                            }
                                        }
                                        catch { }
                                    }
                                    return d;
                                });
                                aiSemanticAnalyzer.getDiagnosticCollection().set(editor.document.uri, updated);
                            }
                            catch { }
                        }
                    }
                    else {
                        aiSemanticAnalyzer.recordFixedRange(editor.document, elementRange);
                    }
                }
                catch {
                    aiSemanticAnalyzer.recordFixedRange(editor.document, elementRange);
                }
                updateAIStatusBar();
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
    // Clear timers to prevent memory leaks
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = undefined;
    }
    if (metricsUpdateTimer) {
        clearTimeout(metricsUpdateTimer);
        metricsUpdateTimer = undefined;
    }
    // Clear diagnostics
    diagnosticCollection.clear();
    // Dispose services
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
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map