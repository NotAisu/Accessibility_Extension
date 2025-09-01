import * as vscode from 'vscode';

/**
 * The Code Tutor Service uses the VS Code Language Model API (GitHub Copilot)
 * to create inline code annotations that help developers write more accessible code.
 */
export class CodeTutorService {
    private readonly decorationTypes: vscode.TextEditorDecorationType[] = [];
    private isActive: boolean = false; 
    private currentTokenSource: vscode.CancellationTokenSource | null = null;

        public async toggleAnnotations(textEditor: vscode.TextEditor): Promise<void> {
        if (this.isActive) {
            // Annotations are ON → turn off
            this.clearAnnotations();
            this.isActive = false;
            vscode.window.showInformationMessage('Accessibility Tutor: annotations disabled');
            if (this.currentTokenSource) {
                this.currentTokenSource.cancel();
                this.currentTokenSource.dispose();
                this.currentTokenSource = null;
            }
        } else {
            // Annotations are OFF → turn on
            await this.annotateCode(textEditor);
            this.isActive = true;
            vscode.window.showInformationMessage('Accessibility Tutor: annotations enabled');
        }
    }

    /**
     * Main method that creates code annotations for the current editor.
     */
    public async annotateCode(textEditor: vscode.TextEditor): Promise<void> {
        try {
            // Vorherige Annotations entfernen (sonst Duplikate bei Refresh)
            this.clearAnnotations();

            // Step 1: Get visible code with line numbers
            const codeWithLineNumbers = this.getVisibleCodeWithLineNumbers(textEditor);
            
            if (!codeWithLineNumbers.trim()) {
                vscode.window.showInformationMessage('No code found in the visible range.');
                return;
            }

            // Step 2: Select GitHub Copilot model
            // Defensive: LM API ist nur in neueren VS Code Versionen verfügbar
            const lm: any = (vscode as any).lm;
            if (!lm || typeof lm.selectChatModels !== 'function') {
                vscode.window.showWarningMessage('Language Model API not available in this VS Code version. Install/enable GitHub Copilot.');
                return;
            }
            const models: any[] = await lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
            const model = models[0];

            if (!model) {
                vscode.window.showErrorMessage('GitHub Copilot not available. Please ensure you are signed in.');
                return;
            }

            // Step 3: Prepare chat messages
            const lmMessageCtor: any = (vscode as any).LanguageModelChatMessage;
            const messages = lmMessageCtor ? [
                lmMessageCtor.User(this.getAnnotationPrompt()),
                lmMessageCtor.User(codeWithLineNumbers)
            ] : [
                // Fallback: einfacher user Prompt
                { role: 'user', content: this.getAnnotationPrompt() + '\n\n' + codeWithLineNumbers }
            ];

            // Step 4: Send request to model
            // Cancellation verwalten (bei erneutem Start abbrechen)
            if (this.currentTokenSource) {
                this.currentTokenSource.cancel();
                this.currentTokenSource.dispose();
            }
            this.currentTokenSource = new vscode.CancellationTokenSource();
            const chatResponse: any = await model.sendRequest(messages, {}, this.currentTokenSource.token);

            // Step 5: Process response and display decorations
            await this.parseChatResponse(chatResponse, textEditor);

        } catch (error) {
            console.error('Error creating code annotations:', error);
            vscode.window.showErrorMessage(`Code Tutor error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Removes all existing code annotations.
     */
    public clearAnnotations(): void {
        for (const decorationType of this.decorationTypes) {
            decorationType.dispose();
        }
        this.decorationTypes.length = 0;
    }

    /**
     * Gets the visible code with line numbers from the editor.
     */
    private getVisibleCodeWithLineNumbers(textEditor: vscode.TextEditor): string {
        if (!textEditor.visibleRanges.length) return '';
        let startLine = textEditor.visibleRanges[0].start.line;
        let endLineInclusive = textEditor.visibleRanges[0].end.line; // VS Code end ist exklusiv für Range, hier nutzen wir inklusiv für Darstellung
        if (endLineInclusive > 0) endLineInclusive -= 1;
        const lines: string[] = [];
        for (let line = startLine; line <= endLineInclusive; line++) {
            lines.push(`${line + 1}: ${textEditor.document.lineAt(line).text}`);
        }
        return lines.join('\n');
    }

    /**
     * Defines the prompt for the language model.
     */
    private getAnnotationPrompt(): string {
    return `You are an accessibility tutor focused on reviewing source code for accessibility issues according to WCAG 2.2 AA standards. Analyze the provided code and identify line numbers that contain issues or could be improved for accessibility, especially semantic issues not detected by automated tools (semantic HTML structure, meaningful ARIA usage, keyboard accessibility, focus management, descriptive labels, etc.).

For each line you flag, provide a short, constructive suggestion describing how to improve the code. Be concise, helpful, and specific.

Return each suggestion as a standalone JSON object (JSON lines). Do not wrap in triple backticks. Example:
{ "line": 5, "suggestion": "Add an aria-label to describe the purpose of this button for screen readers." }
{ "line": 17, "suggestion": "Use a <nav> element instead of <div> to semantically identify navigation." }`;
    }

    /**
     * Processes the chat response and creates decorations.
     */
    private async parseChatResponse(
    chatResponse: any,
        textEditor: vscode.TextEditor
    ): Promise<void> {
        let buffer = '';
        for await (const fragment of chatResponse.text) {
            buffer += fragment;
            // Stream kann mehrere JSON-Objekte oder Teilobjekte enthalten – zeilenweise prüfen
            const lines = buffer.split(/\r?\n/);
            // Letzte (potenziell unvollständige) Zeile im Buffer behalten
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
                    continue; // Keine vollständige JSON-Zeile
                }
                try {
                    const obj = JSON.parse(trimmed);
                    if (typeof obj.line === 'number' && typeof obj.suggestion === 'string') {
                        this.applyDecoration(textEditor, obj.line, obj.suggestion);
                    }
                } catch {
                    // Ignorieren – Modell könnte Freitext gesendet haben
                }
            }
        }
        // Versuche am Ende verbleibenden Rest als JSON zu interpretieren
        const final = buffer.trim();
        if (final.startsWith('{') && final.endsWith('}')) {
            try {
                const obj = JSON.parse(final);
                if (typeof obj.line === 'number' && typeof obj.suggestion === 'string') {
                    this.applyDecoration(textEditor, obj.line, obj.suggestion);
                }
            } catch {/* noop */}
        }
    }

    /**
     * Applies a decoration (annotation) to a specific line.
     */
    private applyDecoration(editor: vscode.TextEditor, line: number, suggestion: string): void {
        const decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                contentText: ` 💡 ${suggestion.substring(0, 30) + '...'}`,
                color: '#8A9BA8',
                fontStyle: 'italic'
            }
        });

        // Decoration-Type für spätere Aufräumung speichern
        this.decorationTypes.push(decorationType);

        // Ende der Zeile mit der angegebenen Zeilennummer holen
        const lineLength = editor.document.lineAt(line - 1).text.length;
        const range = new vscode.Range(
            new vscode.Position(line - 1, lineLength),
            new vscode.Position(line - 1, lineLength)
        );

        const decoration = { 
            range: range, 
            hoverMessage: new vscode.MarkdownString(`💡 **Accessibility suggestion:**\n\n${suggestion}`) 
        };

        editor.setDecorations(decorationType, [decoration]);
    }
}
