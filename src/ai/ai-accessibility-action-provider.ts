import * as vscode from 'vscode';
import { LLMService } from '../llm/llm-service';

/**
 * Code Action Provider für AI-basierte WCAG Fixes
 */
export class AIAccessibilityActionProvider implements vscode.CodeActionProvider {
    private llmService: LLMService;

    constructor(llmService: LLMService) {
        this.llmService = llmService;
    }

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeAction[]> {
        
        // Nur AI-generierte Diagnostics berücksichtigen
        const aiDiagnostics = context.diagnostics.filter(diagnostic => {
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

        if (aiDiagnostics.length === 0) {
            return [];
        }

        // Code Actions für jede AI-Diagnostic erstellen
        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of aiDiagnostics) {
            const action = this.createAISemanticFixAction(diagnostic);
            if (action) {
                actions.push(action);
            }
        }

        return actions;
    }

    private createAISemanticFixAction(diagnostic: vscode.Diagnostic): vscode.CodeAction | null {
        try {
            const codeData = JSON.parse(diagnostic.code as string);
            
            const action = new vscode.CodeAction(
                '🧠 Fix with AI (Semantic)',
                vscode.CodeActionKind.QuickFix
            );

            action.command = {
                command: 'accessibility-extension.fixWithAISemantic',
                title: 'Generate semantic fix with AI',
                arguments: [diagnostic, codeData]
            };

            action.diagnostics = [diagnostic];
            action.isPreferred = true;

            return action;

        } catch (error) {
            console.error('Error creating AI semantic fix action:', error);
            return null;
        }
    }

    /**
     * Generiert AI-basierten Fix für semantische WCAG-Probleme
     */
    public async generateAISemanticFix(
        diagnostic: vscode.Diagnostic,
        codeData: any
    ): Promise<string> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            throw new Error('Kein aktiver Editor gefunden');
        }

        try {
            const code = editor.document.getText(diagnostic.range);
            const prompt = this.createSemanticFixPrompt(code, codeData, diagnostic.message);

            const suggestion = await this.llmService.getAccessibilityFix(prompt);
            return this.extractFixedCode(suggestion);
        } catch (error) {
            throw new Error(`AI Semantic Fix fehlgeschlagen: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`);
        }
    }

    /**
     * Erstellt spezialisierten Prompt für semantische WCAG-Fixes
     */
    private createSemanticFixPrompt(
        code: string,
        codeData: any,
        diagnosticMessage: string
    ): string {
        return `Fix this HTML/JSX code to be semantically correct and WCAG compliant.

PROBLEM: ${diagnosticMessage}
ELEMENT: ${codeData.element || 'Unknown'}
RULE: ${codeData.ruleId || 'semantic-wcag'}

ORIGINAL CODE:
${code}

REQUIREMENTS:
- Focus on semantic HTML structure
- Ensure proper accessibility attributes
- Maintain functionality while improving semantics
- Use appropriate ARIA labels where needed
- Follow WCAG 2.2 guidelines

Return ONLY the corrected HTML/JSX code without explanations, markdown formatting, or additional text.

EXAMPLES:
- <div role="button"> → <button>
- <button></button> → <button aria-label="descriptive label">Content</button>
- <h1>Title</h1><h3>Subtitle</h3> → <h1>Title</h1><h2>Subtitle</h2>

FIXED CODE:`;
    }

    /**
     * Extrahiert den korrigierten Code aus der AI-Response
     */
    private extractFixedCode(aiResponse: string): string {
        // HTML-Code zwischen ```html und ``` extrahieren
        const htmlCodeBlockRegex = /```html\s*([\s\S]*?)\s*```/;
        const htmlMatch = aiResponse.match(htmlCodeBlockRegex);
        
        if (htmlMatch && htmlMatch[1]) {
            return htmlMatch[1].trim();
        }
        
        // Generischen Code zwischen ``` und ``` extrahieren
        const codeBlockRegex = /```\s*([\s\S]*?)\s*```/;
        const genericMatch = aiResponse.match(codeBlockRegex);
        
        if (genericMatch && genericMatch[1]) {
            return genericMatch[1].trim();
        }
        
        // Prüfen, ob der Text selbst gültiges HTML/JSX ist
        if (aiResponse.includes('<') && aiResponse.includes('>')) {
            // Erste Zeile mit HTML-Tag finden
            const lines = aiResponse.split('\n');
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine.includes('<') && trimmedLine.includes('>')) {
                    // Multi-line HTML extrahieren
                    const startIndex = aiResponse.indexOf(trimmedLine);
                    let extractedHTML = aiResponse.substring(startIndex);
                    
                    // Alles nach dem letzten > abschneiden
                    const lastTagIndex = extractedHTML.lastIndexOf('>');
                    if (lastTagIndex !== -1) {
                        extractedHTML = extractedHTML.substring(0, lastTagIndex + 1);
                    }
                    
                    return extractedHTML.trim();
                }
            }
        }
        
        // Fallback: komplette Response zurückgeben
        return aiResponse.trim();
    }
}
