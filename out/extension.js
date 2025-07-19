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
const diagnosticCollection = vscode.languages.createDiagnosticCollection('accessibility');
let llmService;
let codeTutorService;
function activate(context) {
    llmService = new llm_service_1.LLMService();
    codeTutorService = new code_tutor_service_1.CodeTutorService();
    // Accessibility-bezogene Befehle
    context.subscriptions.push(vscode.commands.registerCommand('accessibility-extension.fixWithAI', fixWithAI));
    // Code Tutor Befehle
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('accessibility-extension.codeTutorAnnotate', async (textEditor) => {
        await codeTutorService.toggleAnnotations(textEditor);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('accessibility-extension.codeTutorClear', () => {
        codeTutorService.clearAnnotations();
        vscode.window.showInformationMessage('Code Tutor Annotationen wurden gelöscht.');
    }));
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider(['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact'], new AccessibilityActionProvider(), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
    const runDiagnostics = (doc) => {
        if (['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact'].includes(doc.languageId)) {
            updateDiagnostics(doc);
        }
    };
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(runDiagnostics));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(runDiagnostics));
    vscode.window.visibleTextEditors.forEach(editor => runDiagnostics(editor.document));
}
async function updateDiagnostics(document) {
    const text = document.getText();
    if (!text) {
        diagnosticCollection.set(document.uri, []);
        return;
    }
    const { window } = new jsdom_1.JSDOM(text);
    try {
        const results = await axe.run(window.document.documentElement, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
            resultTypes: ['violations']
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
        vscode.window.showErrorMessage('An error occurred during accessibility analysis.');
    }
}
class AccessibilityActionProvider {
    provideCodeActions(document, range, context) {
        return context.diagnostics
            .filter(diagnostic => typeof diagnostic.code === 'string')
            .map(diagnostic => this.createCommandAction(diagnostic));
    }
    createCommandAction(diagnostic) {
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
async function fixWithAI(diagnostic) {
    const editor = vscode.window.activeTextEditor;
    if (!editor)
        return;
    const code = editor.document.getText(diagnostic.range);
    const { help } = JSON.parse(diagnostic.code);
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Asking local AI for a fix...",
        cancellable: false
    }, async () => {
        try {
            const config = vscode.workspace.getConfiguration('accessibility');
            const verbosity = config.get('fixVerbosity', 'minimal');
            let prompt = `Fix this HTML to be WCAG compliant:
Rule violated: ${help}
HTML code: ${code}`;
            if (verbosity === 'minimal') {
                prompt += '\n\nReturn only the fixed HTML code.';
            }
            else {
                prompt += '\n\nReturn the fixed HTML code, then explain the changes.';
            }
            const suggestion = await llmService.getAccessibilityFix(prompt);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(editor.document.uri, diagnostic.range, suggestion);
            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage('Fix applied by Local AI!');
        }
        catch (error) {
            console.error(error);
            vscode.window.showErrorMessage(`Failed to get suggestion from local AI: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });
}
function deactivate() {
    diagnosticCollection.clear();
    if (codeTutorService) {
        codeTutorService.clearAnnotations();
    }
}
//# sourceMappingURL=extension.js.map