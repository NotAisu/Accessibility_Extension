import * as vscode from 'vscode';
import { JSDOM } from 'jsdom';
import * as axe from 'axe-core';
import { LLMService } from './llm/llm-service';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('accessibility');
let llmService: LLMService;

export function activate(context: vscode.ExtensionContext) {
    llmService = new LLMService();
    
    context.subscriptions.push(
        vscode.commands.registerCommand('accessibility-extension.fixWithAI', fixWithAI)
    );

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            ['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact'],
            new AccessibilityActionProvider(),
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
        )
    );

    const runDiagnostics = (doc: vscode.TextDocument) => {
        if (['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact'].includes(doc.languageId)) {
            updateDiagnostics(doc);
        }
    };

    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(runDiagnostics));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(runDiagnostics));

    vscode.window.visibleTextEditors.forEach(editor => runDiagnostics(editor.document));
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
        return context.diagnostics
            .filter(diagnostic => typeof diagnostic.code === 'string')
            .map(diagnostic => this.createCommandAction(diagnostic));
    }

    private createCommandAction(diagnostic: vscode.Diagnostic): vscode.CodeAction {
        const action = new vscode.CodeAction('Fix with Local AI', vscode.CodeActionKind.QuickFix);
        action.command = {
            command: 'accessibility-extension.fixWithAI',
            title: 'Generate fix with Local AI',
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
    const { help } = JSON.parse(diagnostic.code as string);

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Asking local AI for a fix...",
        cancellable: false
    }, async () => {
        try {
            const config = vscode.workspace.getConfiguration('accessibility');
            const verbosity = config.get<string>('fixVerbosity', 'minimal');
            
            let prompt = `Fix this HTML to be WCAG compliant:
Rule violated: ${help}
HTML code: ${code}`;
            
            if (verbosity === 'minimal') {
                prompt += '\n\nReturn only the fixed HTML code.';
            } else {
                prompt += '\n\nReturn the fixed HTML code, then explain the changes.';
            }
            
            const suggestion = await llmService.getAccessibilityFix(prompt);
            
            const edit = new vscode.WorkspaceEdit();
            edit.replace(editor.document.uri, diagnostic.range, suggestion);
            await vscode.workspace.applyEdit(edit);

            vscode.window.showInformationMessage('Fix applied by Local AI!');
        } catch (error) {
            console.error(error);
            vscode.window.showErrorMessage(`Failed to get suggestion from local AI: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });
}

export function deactivate() {
    diagnosticCollection.clear();
}