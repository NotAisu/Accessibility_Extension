import * as vscode from 'vscode';
import { LLMService } from './llm/llm-service';
import { CodeTutorService } from './code-tutor/code-tutor-service';
import { LLMSettingsProvider } from './views/llm-settings-provider';
import { AISemanticAnalyzer } from './ai/ai-semantic-analyzer';
import { MetricsService } from './metrics/metrics-service';
import { MetricsDashboardProvider } from './views/metrics-dashboard-provider';
import { FeedbackService } from './feedback/feedback-service';
import { UnifiedLinterService } from './linters/unified-linter-service';
import { LinterViolation } from './linters/linter-types';


const linterDiagnosticCollection = vscode.languages.createDiagnosticCollection('linter-accessibility');
const aiDiagnosticCollection = vscode.languages.createDiagnosticCollection('ai-accessibility');
let llmService: LLMService;
let codeTutorService: CodeTutorService;
let aiSemanticAnalyzer: AISemanticAnalyzer;
let metricsService: MetricsService;
let feedbackService: FeedbackService;
let unifiedLinterService: UnifiedLinterService;


export function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Activating Accessibility Extension...');
    
    // Services mit SecretStorage initialisieren
    llmService = new LLMService(context.secrets);
    codeTutorService = new CodeTutorService();
    metricsService = MetricsService.getInstance(context);
    feedbackService = FeedbackService.getInstance(metricsService);
    unifiedLinterService = new UnifiedLinterService();
    
    // Set metrics service in LLM service
    llmService.setMetricsService(metricsService);
    
    aiSemanticAnalyzer = new AISemanticAnalyzer(llmService);
    aiSemanticAnalyzer.setMetricsService(metricsService);

    console.log('📊 Services initialized successfully');

    
    // Register LLM Settings webview provider
    const llmSettingsProvider = new LLMSettingsProvider(context.extensionUri, llmService);
    llmSettingsProvider.setAIAnalyzer(aiSemanticAnalyzer);
    llmSettingsProvider.setCodeTutorService(codeTutorService);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(LLMSettingsProvider.viewType, llmSettingsProvider)
    );
    console.log(`Registered LLM Settings Provider with viewType: ${LLMSettingsProvider.viewType}`);

    // Register Metrics Dashboard webview provider
    const metricsDashboardProvider = new MetricsDashboardProvider(context.extensionUri, metricsService);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(MetricsDashboardProvider.viewType, metricsDashboardProvider)
    );
    console.log(`Registered Metrics Dashboard Provider with viewType: ${MetricsDashboardProvider.viewType}`);

    // Set DiagnosticCollections for the dashboard provider so it can refresh violations after clearing data
    metricsDashboardProvider.setDiagnosticCollections(
        linterDiagnosticCollection,
        aiSemanticAnalyzer.getDiagnosticCollection()
    );

    console.log('Accessibility Extension: All WebView Providers registered successfully');

    // Register feedback command
    context.subscriptions.push(
        feedbackService.createFeedbackCommand()
    );

    // Register feedback hover provider
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            ['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact'],
            feedbackService.createFeedbackHoverProvider()
        )
    );
    
    // Accessibility-bezogene Befehle
    context.subscriptions.push(
        vscode.commands.registerCommand('accessibility-extension.fixWithAI', fixWithAI)
    );

    // Test Connection Command
    context.subscriptions.push(
        vscode.commands.registerCommand('accessibility-extension.testConnection', async () => {
            try {
                const isConnected = await llmService.testConnection();
                const message = isConnected ? 
                    'AI provider connection successful!' : 
                    'AI provider connection failed. Please check your settings.';
                if (isConnected) {
                    vscode.window.showInformationMessage(message);
                } else {
                    vscode.window.showErrorMessage(message);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );

    // Debug Commands for Testing
    context.subscriptions.push(
        vscode.commands.registerCommand('accessibility-extension.openDashboard', async () => {
            await vscode.commands.executeCommand('accessibilityMetricsDashboard.focus');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('accessibility-extension.openSettings', async () => {
            await vscode.commands.executeCommand('aiAccessibilitySettings.focus');
        })
    );

    // Code Tutor Befehle
    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('accessibility-extension.codeTutorAnnotate', async (textEditor: vscode.TextEditor) => {
            await codeTutorService.toggleAnnotations(textEditor);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('accessibility-extension.codeTutorClear', () => {
            codeTutorService.clearAnnotations();
            vscode.window.showInformationMessage('Code Tutor Annotationen wurden gelöscht.');
        })
    );

    // Metrics and Feedback Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('accessibility-extension.showMetrics', () => {
            vscode.commands.executeCommand('workbench.view.extension.accessibility-metrics');
        })
    );


    context.subscriptions.push(
        vscode.commands.registerCommand('accessibility-extension.clearMetrics', async () => {
            const result = await vscode.window.showWarningMessage(
                'Are you sure you want to clear all metrics data?',
                'Clear Data',
                'Cancel'
            );

            if (result === 'Clear Data') {
                // Verwende clearDataAndRefresh um aktuelle Violations beizubehalten
                metricsService.clearDataAndRefresh(
                    linterDiagnosticCollection,
                    aiSemanticAnalyzer.getDiagnosticCollection()
                );
                vscode.window.showInformationMessage('Metrics data cleared successfully.');
            }
        })
    );


    
    context.subscriptions.push(
        vscode.commands.registerCommand('accessibility-extension.showFeedbackStats', () => {
            const stats = metricsService.getDashboardData();
            
            vscode.window.showInformationMessage(
                `📊 Metrics Stats - Detection Accuracy: ${stats.detectionAccuracy.toFixed(1)}%, ` +
                `Quick Fix Success Rate: ${stats.quickFixSuccessRate.toFixed(1)}%, ` +
                `Total Current Violations: ${stats.totalCurrentViolations}`
            );
        })
    );

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            ['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact'],
            new AccessibilityActionProvider(),
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
        )
    );

  
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(runDiagnostics));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(runDiagnostics));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => {
        // Clean up diagnostics for closed document
        linterDiagnosticCollection.delete(document.uri);
        aiSemanticAnalyzer.getDiagnosticCollection().delete(document.uri);
        // Update global metrics after cleanup
        updateGlobalViolationMetrics();
    }));

    vscode.window.visibleTextEditors.forEach(editor => runDiagnostics(editor.document));
}

/**
 * Führt Diagnostics für ein Dokument aus (Unified Linter + AI)
 */
async function runDiagnostics(document: vscode.TextDocument): Promise<void> {
    try {
        // 1. Unified Linter Diagnostics ausführen (sofortiges Feedback)
        await updateLinterDiagnostics(document);
        
        // 2. AI Semantic Analysis (nur wenn aktiviert)
        const linterDiagnostics = Array.from(linterDiagnosticCollection.get(document.uri) || []);
        await aiSemanticAnalyzer.analyzeVisibleCode(document, linterDiagnostics);
        
        // 3. Zentrale Metrics-Update für alle Diagnostics
        updateGlobalViolationMetrics();
        
    } catch (error) {
        console.error('Error running diagnostics:', error);
    }
}

/**
 * Updates die globalen Violation Metrics basierend auf allen aktuellen Diagnostics
 */
function updateGlobalViolationMetrics(): void {
    if (!metricsService) return;

    // Sammle alle Violations aus den DiagnosticCollections
    metricsService.updateCurrentViolationsFromDiagnostics(
        linterDiagnosticCollection,
        aiSemanticAnalyzer.getDiagnosticCollection()
    );
}

async function updateLinterDiagnostics(document: vscode.TextDocument) {
    try {
        const violations = await unifiedLinterService.lintDocument(document);
        
        const diagnostics = violations.map(violation => {
            const diagnostic = new vscode.Diagnostic(
                violation.range,
                violation.message,
                violation.severity
            );
            
            diagnostic.code = JSON.stringify({
                ruleId: violation.ruleId,
                source: violation.source,
                framework: violation.framework,
                element: violation.element
            });
            
            diagnostic.source = `${violation.source} Linter`;
            
            return diagnostic;
        });
        
        linterDiagnosticCollection.set(document.uri, diagnostics);
        
    } catch (error) {
        console.error('Linter diagnostics failed:', error);
        linterDiagnosticCollection.set(document.uri, []);
    }
}

class AccessibilityActionProvider implements vscode.CodeActionProvider {
    provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
        // Filter für alle Accessibility-Diagnostics (Linter und AI)
        const linterDiagnostics = context.diagnostics.filter(diagnostic => {
            return diagnostic.source?.includes('Linter') || 
                   (typeof diagnostic.code === 'string' && !this.isAIGenerated(diagnostic));
        });
        
        const aiDiagnostics = context.diagnostics.filter(diagnostic => {
            return this.isAIGenerated(diagnostic);
        });

        const actions: vscode.CodeAction[] = [];

        // Create actions for linter diagnostics
        linterDiagnostics.forEach(diagnostic => {
            actions.push(this.createCommandAction(diagnostic, 'Fix with AI'));
        });

        // Create actions for AI diagnostics
        aiDiagnostics.forEach(diagnostic => {
            actions.push(this.createCommandAction(diagnostic, 'Fix AI Semantic Issue'));
        });

        return actions;
    }

    private isAIGenerated(diagnostic: vscode.Diagnostic): boolean {
        try {
            if (typeof diagnostic.code === 'string') {
                const codeData = JSON.parse(diagnostic.code);
                return codeData.isAIGenerated === true;
            }
        } catch (error) {
            // Ignore parsing errors
        }
        return false;
    }

    private createCommandAction(diagnostic: vscode.Diagnostic, title: string): vscode.CodeAction {
        const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
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

async function fixWithAI(diagnostic: vscode.Diagnostic) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const code = editor.document.getText(diagnostic.range);
    
    // Variable für quickFixId außerhalb des try-catch definieren
    let quickFixId = '';
    
    // Unterscheiden zwischen axe-core und AI-Diagnostics
    let help: string;
    let isAIGenerated = false;
    
    try {
        if (typeof diagnostic.code === 'string') {
            const codeData = JSON.parse(diagnostic.code);
            
            if (codeData.isAIGenerated === true) {
                // AI-Generated Diagnostic
                help = codeData.recommendation || diagnostic.message;
                isAIGenerated = true;
            } else {
                // axe-core Diagnostic
                help = codeData.help || diagnostic.message;
            }
        } else {
            help = diagnostic.message;
        }
    } catch (error) {
        help = diagnostic.message;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: isAIGenerated ? "AI Semantic Fix wird angewendet..." : "Asking AI for a fix...",
        cancellable: false
    }, async () => {
        try {
            const config = vscode.workspace.getConfiguration('accessibility');
            const verbosity = config.get<string>('fixVerbosity', 'minimal');
            
            let prompt: string;
            
            if (isAIGenerated) {
                // Prompt für AI-generierte semantische Probleme
                prompt = `Fix this HTML/CSS code according to WCAG semantic requirements:
Semantic Issue: ${help}
Code: ${code}`;
            } else {
                // Prompt für axe-core Probleme
                prompt = `Fix this HTML to be WCAG compliant:
Rule violated: ${help}
HTML code: ${code}`;
            }
            
            if (verbosity === 'minimal') {
                prompt += '\n\nReturn only the fixed code.';
            } else {
                prompt += '\n\nReturn the fixed code, then explain the changes.';
            }
            
            const response = await llmService.getAccessibilityFix(prompt);
            const suggestion = response.result;
            quickFixId = response.quickFixId;
            
            const edit = new vscode.WorkspaceEdit();
            edit.replace(editor.document.uri, diagnostic.range, suggestion);
            await vscode.workspace.applyEdit(edit);

            vscode.window.showInformationMessage('✅ Fix applied by AI!');
            
            // Extract rule ID from diagnostic for feedback
            let ruleId = '';
            try {
                if (typeof diagnostic.code === 'string') {
                    const codeData = JSON.parse(diagnostic.code);
                    ruleId = codeData.ruleId || ruleId;
                }
            } catch (error) {
                console.log(error)
            }
            
            // Show feedback request after a delay
            setTimeout(() => {
                feedbackService.showQuickFixFeedback(quickFixId, ruleId);
            }, 1500);
            
        } catch (error) {
            console.error('QuickFix failed:', error);
            vscode.window.showErrorMessage(`Failed to get suggestion from AI: ${error instanceof Error ? error.message : 'Unknown error'}`);
            
            // Record failed attempt in metrics
            metricsService.recordQuickFixFeedback(quickFixId, 'negative');
        }
    });
}

export function deactivate() {
    linterDiagnosticCollection.clear();
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