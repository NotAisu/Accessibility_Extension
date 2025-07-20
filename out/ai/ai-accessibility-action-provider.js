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
exports.AIAccessibilityActionProvider = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Code Action Provider für AI-basierte WCAG Fixes
 */
class AIAccessibilityActionProvider {
    constructor(llmService) {
        this.llmService = llmService;
    }
    provideCodeActions(document, range, context, token) {
        // Nur AI-generierte Diagnostics berücksichtigen
        const aiDiagnostics = context.diagnostics.filter(diagnostic => {
            try {
                if (typeof diagnostic.code === 'string') {
                    const codeData = JSON.parse(diagnostic.code);
                    return codeData.isAIGenerated === true;
                }
            }
            catch (error) {
                // Ignore parsing errors
            }
            return false;
        });
        if (aiDiagnostics.length === 0) {
            return [];
        }
        // Code Actions für jede AI-Diagnostic erstellen
        const actions = [];
        for (const diagnostic of aiDiagnostics) {
            const action = this.createAISemanticFixAction(diagnostic);
            if (action) {
                actions.push(action);
            }
        }
        return actions;
    }
    createAISemanticFixAction(diagnostic) {
        try {
            const codeData = JSON.parse(diagnostic.code);
            const action = new vscode.CodeAction('🧠 Fix with AI (Semantic)', vscode.CodeActionKind.QuickFix);
            action.command = {
                command: 'accessibility-extension.fixWithAISemantic',
                title: 'Generate semantic fix with AI',
                arguments: [diagnostic, codeData]
            };
            action.diagnostics = [diagnostic];
            action.isPreferred = true;
            return action;
        }
        catch (error) {
            console.error('Error creating AI semantic fix action:', error);
            return null;
        }
    }
    /**
     * Generiert AI-basierten Fix für semantische WCAG-Probleme
     */
    async generateAISemanticFix(diagnostic, codeData) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            throw new Error('Kein aktiver Editor gefunden');
        }
        try {
            const code = editor.document.getText(diagnostic.range);
            const prompt = this.createSemanticFixPrompt(code, codeData, diagnostic.message);
            const suggestion = await this.llmService.getAccessibilityFix(prompt);
            return this.extractFixedCode(suggestion);
        }
        catch (error) {
            throw new Error(`AI Semantic Fix fehlgeschlagen: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`);
        }
    }
    /**
     * Erstellt spezialisierten Prompt für semantische WCAG-Fixes
     */
    createSemanticFixPrompt(code, codeData, diagnosticMessage) {
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
    extractFixedCode(aiResponse) {
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
exports.AIAccessibilityActionProvider = AIAccessibilityActionProvider;
//# sourceMappingURL=ai-accessibility-action-provider.js.map