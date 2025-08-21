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
exports.CodeTutorService = void 0;
const vscode = __importStar(require("vscode"));
/**
 * The Code Tutor Service uses the VS Code Language Model API (GitHub Copilot)
 * to create inline code annotations that help developers write more accessible code.
 */
class CodeTutorService {
    constructor() {
        this.decorationTypes = [];
        this.isActive = false;
    }
    async toggleAnnotations(textEditor) {
        if (this.isActive) {
            // Annotations are ON → turn off
            this.clearAnnotations();
            this.isActive = false;
            vscode.window.showInformationMessage('Accessibility Tutor: annotations disabled');
        }
        else {
            // Annotations are OFF → turn on
            await this.annotateCode(textEditor);
            this.isActive = true;
            vscode.window.showInformationMessage('Accessibility Tutor: annotations enabled');
        }
    }
    /**
     * Main method that creates code annotations for the current editor.
     */
    async annotateCode(textEditor) {
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
            const chatResponse = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
            // Step 5: Process response and display decorations
            await this.parseChatResponse(chatResponse, textEditor);
        }
        catch (error) {
            console.error('Error creating code annotations:', error);
            vscode.window.showErrorMessage(`Code Tutor error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    /**
     * Removes all existing code annotations.
     */
    clearAnnotations() {
        for (const decorationType of this.decorationTypes) {
            decorationType.dispose();
        }
        this.decorationTypes.length = 0;
    }
    /**
     * Gets the visible code with line numbers from the editor.
     */
    getVisibleCodeWithLineNumbers(textEditor) {
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
    getAnnotationPrompt() {
        return `You are an accessibility tutor focused on reviewing source code for accessibility issues according to WCAG 2.2 AA standards. Analyze the provided code and identify line numbers that contain issues or could be improved for accessibility, especially semantic issues not detected by automated tools (semantic HTML structure, meaningful ARIA usage, keyboard accessibility, focus management, descriptive labels, etc.).

For each line you flag, provide a short, constructive suggestion describing how to improve the code. Be concise, helpful, and specific.

Return each suggestion as a standalone JSON object (JSON lines). Do not wrap in triple backticks. Example:
{ "line": 5, "suggestion": "Add an aria-label to describe the purpose of this button for screen readers." }
{ "line": 17, "suggestion": "Use a <nav> element instead of <div> to semantically identify navigation." }`;
    }
    /**
     * Processes the chat response and creates decorations.
     */
    async parseChatResponse(chatResponse, textEditor) {
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
                }
                catch (e) {
                    // Nichts tun - warten auf vollständige JSON
                }
            }
        }
    }
    /**
     * Applies a decoration (annotation) to a specific line.
     */
    applyDecoration(editor, line, suggestion) {
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
        const range = new vscode.Range(new vscode.Position(line - 1, lineLength), new vscode.Position(line - 1, lineLength));
        const decoration = {
            range: range,
            hoverMessage: new vscode.MarkdownString(`💡 **Accessibility suggestion:**\n\n${suggestion}`)
        };
        editor.setDecorations(decorationType, [decoration]);
    }
}
exports.CodeTutorService = CodeTutorService;
//# sourceMappingURL=code-tutor-service.js.map