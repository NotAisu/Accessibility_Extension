import * as path from 'path';
import * as vscode from 'vscode';
import type { CheckOutcome } from './analysis-worker';
import type { AnalysisDocument } from './core/analysis';
import { CheckToolInput, runCheckTool } from './review/check-tool';

/** The Language Model Tool `a11y_check`: the Check for agents, on files or proposed code. */
export class A11yCheckTool implements vscode.LanguageModelTool<CheckToolInput> {
    constructor(
        private readonly languages: string[],
        private readonly check: (document: AnalysisDocument) => Promise<CheckOutcome>
    ) {}

    prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<CheckToolInput>): vscode.PreparedToolInvocation {
        const { filePath, code } = options.input;
        const target = code === undefined ? filePath : filePath === undefined ? 'proposed code' : `proposed code for ${filePath}`;
        return { invocationMessage: `Checking ${target ?? 'code'} for WCAG 2.2 problems` };
    }

    async invoke(options: vscode.LanguageModelToolInvocationOptions<CheckToolInput>): Promise<vscode.LanguageModelToolResult> {
        const output = await runCheckTool(options.input, {
            languages: this.languages,
            read: async filePath => {
                const document = await vscode.workspace.openTextDocument(resolve(filePath));
                return { languageId: document.languageId, text: document.getText() };
            },
            check: this.check
        });
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(output)]);
    }
}

// Agents pass workspace-relative paths; open documents include unsaved changes
function resolve(filePath: string): vscode.Uri {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (path.isAbsolute(filePath) || !folder) return vscode.Uri.file(filePath);
    return vscode.Uri.joinPath(folder.uri, filePath);
}
