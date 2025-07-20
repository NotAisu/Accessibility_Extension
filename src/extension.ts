import * as vscode from 'vscode';
import { JSDOM } from 'jsdom';
import * as axe from 'axe-core';
import { LLMService } from './llm/llm-service';
import { CodeTutorService } from './code-tutor/code-tutor-service';
import { LLMSettingsProvider } from './views/llm-settings-provider';
import { AISemanticAnalyzer } from './ai/ai-semantic-analyzer';


const diagnosticCollection = vscode.languages.createDiagnosticCollection('accessibility');
let llmService: LLMService;
let codeTutorService: CodeTutorService;
let aiSemanticAnalyzer: AISemanticAnalyzer;


export function activate(context: vscode.ExtensionContext) {
    // Services mit SecretStorage initialisieren
    llmService = new LLMService(context.secrets);
    codeTutorService = new CodeTutorService();
    
    aiSemanticAnalyzer = new AISemanticAnalyzer(llmService);

    
    // Register LLM Settings webview provider
    const llmSettingsProvider = new LLMSettingsProvider(context.extensionUri, llmService);
    llmSettingsProvider.setAIAnalyzer(aiSemanticAnalyzer);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(LLMSettingsProvider.viewType, llmSettingsProvider)
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

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            ['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact'],
            new AccessibilityActionProvider(),
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
        )
    );

  
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(runDiagnostics));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(runDiagnostics));

    vscode.window.visibleTextEditors.forEach(editor => runDiagnostics(editor.document));
}

/**
 * Führt Diagnostics für ein Dokument aus (axe-core + AI)
 */
async function runDiagnostics(document: vscode.TextDocument): Promise<void> {
    // Nur für unterstützte Dateitypen
    const supportedLanguages = ['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact'];
    if (!supportedLanguages.includes(document.languageId)) {
        return;
    }

    try {
        // 1. Axe-core Diagnostics ausführen (sofortiges Feedback)
        await updateDiagnostics(document);
        
        // 2. AI Semantic Analysis (nur wenn aktiviert)
        const axeDiagnostics = Array.from(diagnosticCollection.get(document.uri) || []);
        await aiSemanticAnalyzer.analyzeVisibleCode(document, axeDiagnostics);
        
    } catch (error) {
        console.error('Error running diagnostics:', error);
    }
}

async function updateDiagnostics(document: vscode.TextDocument) {
    const text = document.getText();
    if (!text) {
        diagnosticCollection.set(document.uri, []);
        return;
    }

    const { window } = new JSDOM(text);

    try {
        const results = await axe.run(window.document.documentElement, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
            resultTypes: ['violations']
        });

        const diagnostics: vscode.Diagnostic[] = [];
        for (const violation of results.violations) {
            for (const node of violation.nodes) {
                let range: vscode.Range | undefined;

                if (node.target.length === 1 && node.target[0] === 'html') {
                    const htmlTagRegex = /<html[^>]*>/i;
                    const match = text.match(htmlTagRegex);
                    if (match && typeof match.index === 'number') {
                        range = new vscode.Range(
                            document.positionAt(match.index),
                            document.positionAt(match.index + match[0].length)
                        );
                    }
                } else {
                    const problematicHtml = node.html;
                    const index = text.indexOf(problematicHtml);

                    if (index !== -1) {
                        range = new vscode.Range(
                            document.positionAt(index),
                            document.positionAt(index + problematicHtml.length)
                        );
                    }
                }

                if (range) {
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `${violation.help} (Regel: ${violation.id})`,
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.code = JSON.stringify({ ruleId: violation.id, help: violation.help });
                    diagnostics.push(diagnostic);
                }
            }
        }

        diagnosticCollection.set(document.uri, diagnostics);

    } catch (error) {
        console.error('Error in accessibility analysis:', error);
        vscode.window.showErrorMessage('An error occurred during accessibility analysis.');
    }
}

class AccessibilityActionProvider implements vscode.CodeActionProvider {
    provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
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
            } catch (error) {
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

    private createCommandAction(diagnostic: vscode.Diagnostic): vscode.CodeAction {
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
            
            const suggestion = await llmService.getAccessibilityFix(prompt);
            
            const edit = new vscode.WorkspaceEdit();
            edit.replace(editor.document.uri, diagnostic.range, suggestion);
            await vscode.workspace.applyEdit(edit);

            vscode.window.showInformationMessage('Fix applied by AI!');
        } catch (error) {
            console.error(error);
            vscode.window.showErrorMessage(`Failed to get suggestion from AI: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });
}

export function deactivate() {
    diagnosticCollection.clear();
    if (codeTutorService) {
        codeTutorService.clearAnnotations();
    }
    if (aiSemanticAnalyzer) {
        aiSemanticAnalyzer.dispose();
    }
}