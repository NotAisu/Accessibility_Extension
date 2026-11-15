import * as vscode from 'vscode';
import { LLMService } from './llm/llm-service';
import { AISemanticAnalyzer } from './ai/ai-semantic-analyzer';
import { CheckDiagnostics, CHECK_SOURCE } from './check-diagnostics';

const SUPPORTED_LANGUAGES = ['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact'];

const check = new CheckDiagnostics();
const diagnosticCollection = check.collection;
let llmService: LLMService;
let aiSemanticAnalyzer: AISemanticAnalyzer;
let aiStatusBarItem: vscode.StatusBarItem;
let cleanupTimer: NodeJS.Timeout | undefined;
const CLEANUP_INTERVAL_MS = 30000;


export function activate(context: vscode.ExtensionContext) {
    llmService = new LLMService();
    aiSemanticAnalyzer = new AISemanticAnalyzer(llmService);
    aiSemanticAnalyzer.setDiagnosticsCallback((uri: vscode.Uri) => {
        return Array.from(diagnosticCollection.get(uri) || []);
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('allyproof.fixWithAI', fixWithAI)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('allyproof.startAIReview', async () => {
            try {
                await aiSemanticAnalyzer.startAnalysis();
                updateAIStatusBar();
            } catch (error) {
                console.error('AI Review command failed:', error);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('allyproof.testConnection', async () => {
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

    context.subscriptions.push(vscode.commands.registerCommand('allyproof.clearRecentAIMemory', () => {
        aiSemanticAnalyzer.clearRecentFixMemory();
        vscode.window.showInformationMessage('AI recent fix memory cleared.');
        updateAIStatusBar();
    }));

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            SUPPORTED_LANGUAGES,
            new AccessibilityActionProvider(),
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
        )
    );

    check.start(context.asAbsolutePath('dist/worker.mjs'));
    context.subscriptions.push(check, vscode.languages.registerHoverProvider(SUPPORTED_LANGUAGES, check));
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(runDiagnostics));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(runDiagnostics));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => {
        check.delete(document.uri);
        aiSemanticAnalyzer.getDiagnosticCollection().delete(document.uri);
    }));

    vscode.window.visibleTextEditors.forEach(editor => runDiagnostics(editor.document));

    startDiagnosticCleanup();

    aiStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    aiStatusBarItem.text = 'AI: inactive';
    aiStatusBarItem.command = 'allyproof.startAIReview';
    aiStatusBarItem.tooltip = 'Start AI Review';
    aiStatusBarItem.show();
    context.subscriptions.push(aiStatusBarItem);
}

function startDiagnosticCleanup(): void {
    cleanupTimer = setInterval(() => {
        cleanupInactiveDiagnostics();
    }, CLEANUP_INTERVAL_MS);
}

function cleanupInactiveDiagnostics(): void {
    const activeDocuments = new Set(
        vscode.workspace.textDocuments.map(doc => doc.uri.toString())
    );

    // Clean up main diagnostic collection
    const staleUris: vscode.Uri[] = [];
    diagnosticCollection.forEach((uri) => {
        if (!activeDocuments.has(uri.toString())) {
            staleUris.push(uri);
        }
    });

    // Clean up AI diagnostic collection
    const aiCollection = aiSemanticAnalyzer.getDiagnosticCollection();
    aiCollection.forEach((uri) => {
        if (!activeDocuments.has(uri.toString())) {
            staleUris.push(uri);
        }
    });

    staleUris.forEach(uri => {
        check.delete(uri);
        aiCollection.delete(uri);
    });
}

async function runDiagnostics(document: vscode.TextDocument): Promise<void> {
    if (!SUPPORTED_LANGUAGES.includes(document.languageId)) {
        return;
    }

    try {
        await updateDiagnostics(document);
    } catch (error) {
        console.error('Error running diagnostics:', error);
    }
}

function updateAIStatusBar(): void {
    if (!aiSemanticAnalyzer || !aiStatusBarItem) return;
    const counts = aiSemanticAnalyzer.getLastCounts();
    aiStatusBarItem.text = `AI: ${counts.reported} findings (${counts.suppressed} suppressed)`;
}

async function updateDiagnostics(document: vscode.TextDocument) {
    try {
        await check.update(document);
    } catch (error) {
        if (error instanceof Error && error.message === 'axe-timeout') {
            console.warn('axe-core analysis aborted after timeout');
        } else {
            console.error('Error in accessibility analysis:', error);
        }
        check.delete(document.uri);
    }
}

class AccessibilityActionProvider implements vscode.CodeActionProvider {
    provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
        // Check diagnostics carry the Allyproof source, AI diagnostics a JSON string code
        const accessibilityDiagnostics = context.diagnostics.filter(diagnostic =>
            diagnostic.source === CHECK_SOURCE || typeof diagnostic.code === 'string'
        );

        if (accessibilityDiagnostics.length === 0) {
            return [];
        }

    // Provide a unified "Fix with AI" action for all accessibility issues
        return accessibilityDiagnostics.map(diagnostic => this.createCommandAction(diagnostic));
    }

    private createCommandAction(diagnostic: vscode.Diagnostic): vscode.CodeAction {
        const action = new vscode.CodeAction('Fix with AI', vscode.CodeActionKind.QuickFix);
        action.command = {
            command: 'allyproof.fixWithAI',
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

    // Capture document version before requesting fix
    const originalVersion = editor.document.version;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: isAIGenerated ? "Applying AI semantic fix..." : "Asking AI for an accessibility fix...",
        cancellable: false
    }, async () => {
        try {
            let prompt: string;
            
            // Erweiterten Kontext um das Problem herum holen
            const extendedRange = new vscode.Range(
                Math.max(0, diagnostic.range.start.line - 2),
                0,
                Math.min(editor.document.lineCount - 1, diagnostic.range.end.line + 2),
                editor.document.lineAt(Math.min(editor.document.lineCount - 1, diagnostic.range.end.line + 2)).text.length
            );
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
            } else {
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
            
            let suggestion = (await llmService.getAccessibilityFix(prompt)).trim();
            
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
                    targetRange = new vscode.Range(
                        new vscode.Position(diagnostic.range.start.line, 0),
                        new vscode.Position(diagnostic.range.start.line, originalLineText.length)
                    );
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
                // After a successful fix only remove the AI diagnostic (axe-core remains and will
                // be re-evaluated on the next run). Also record the fixed line(s) to avoid immediate
                // re-reporting of the same AI issue.
                try {
                    if (typeof diagnostic.code === 'string') {
                        const codeData = JSON.parse(diagnostic.code);
                        // Register range (may span multiple lines)
                        aiSemanticAnalyzer.recordFixedRange(editor.document, diagnostic.range);
                        const removeId = codeData.vId || codeData.violationId; // support legacy
                        if (codeData.isAIGenerated && removeId) {
                            aiSemanticAnalyzer.removeAIDiagnostic(removeId);
                        }
                    } else {
                        aiSemanticAnalyzer.recordFixedRange(editor.document, diagnostic.range);
                    }
                } catch {
                    aiSemanticAnalyzer.recordFixedRange(editor.document, diagnostic.range);
                }
                updateAIStatusBar();
            } else {
                vscode.window.showErrorMessage('Failed to apply AI fix edit.');
            }
        } catch (error) {
            console.error('QuickFix failed:', error);
            vscode.window.showErrorMessage(`Failed to get suggestion from AI: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });
}

export function deactivate() {
    // Clear timers to prevent memory leaks
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = undefined;
    }

    // Clear diagnostics
    diagnosticCollection.clear();
    
    // Dispose services
    if (aiSemanticAnalyzer) {
        aiSemanticAnalyzer.dispose();
    }
}