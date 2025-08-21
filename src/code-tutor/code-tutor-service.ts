import * as vscode from 'vscode';

/**
 * The Code Tutor Service uses the VS Code Language Model API (GitHub Copilot)
 * to create inline code annotations that help developers write more accessible code.
 */
export class CodeTutorService {
    private readonly decorationTypes: vscode.TextEditorDecorationType[] = [];
    private isActive: boolean = false; 

        public async toggleAnnotations(textEditor: vscode.TextEditor): Promise<void> {
        if (this.isActive) {
            // Annotations are ON → turn off
            this.clearAnnotations();
            this.isActive = false;
            vscode.window.showInformationMessage('Accessibility Tutor: annotations disabled');
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
            // Step 1: Get visible code with line numbers
            const codeWithLineNumbers = this.getVisibleCodeWithLineNumbers(textEditor);
            
            if (!codeWithLineNumbers.trim()) {
                vscode.window.showInformationMessage('No code found in the visible range.');
                return;
            }

            // Step 2: Select GitHub Copilot model
            const [model] = await vscode.lm.selectChatModels({
                vendor: 'copilot',
                family: 'gpt-4o'
            });

            if (!model) {
                vscode.window.showErrorMessage('GitHub Copilot not available. Please ensure you are signed in.');
                return;
            }

            // Step 3: Prepare chat messages
            const messages = [
                vscode.LanguageModelChatMessage.User(this.getAnnotationPrompt()),
                vscode.LanguageModelChatMessage.User(codeWithLineNumbers)
            ];

            // Step 4: Send request to model
            const chatResponse = await model.sendRequest(
                messages,
                {},
                new vscode.CancellationTokenSource().token
            );

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
    // Determine first and last visible lines
        let currentLine = textEditor.visibleRanges[0].start.line;
        const endLine = textEditor.visibleRanges[0].end.line;

        let code = '';

    // Collect text from each line and prefix with 1-based line number
        while (currentLine < endLine) {
            code += `${currentLine + 1}: ${textEditor.document.lineAt(currentLine).text} \n`;
            currentLine++;
        }
        
        return code;
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
        chatResponse: vscode.LanguageModelChatResponse,
        textEditor: vscode.TextEditor
    ): Promise<void> {
        let accumulatedResponse = '';

        for await (const fragment of chatResponse.text) {
            accumulatedResponse += fragment;

            // When the fragment contains a closing brace, try to parse accumulated JSON
            if (fragment.includes('}')) {
                try {
                    const annotation = JSON.parse(accumulatedResponse);
                    this.applyDecoration(textEditor, annotation.line, annotation.suggestion);
                    // Reset accumulator for next object
                    accumulatedResponse = '';
                } catch (e) {
                    // Nichts tun - warten auf vollständige JSON
                }
            }
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
