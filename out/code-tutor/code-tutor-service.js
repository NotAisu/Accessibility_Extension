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
 * Der Code Tutor Service nutzt die VS Code Language Model API (GitHub Copilot),
 * um Code-Annotationen zu erstellen, die Entwicklern helfen, besseren Code zu schreiben.
 */
class CodeTutorService {
    constructor() {
        this.decorationTypes = [];
        this.isActive = false;
    }
    async toggleAnnotations(textEditor) {
        if (this.isActive) {
            // Annotationen sind AN → ausschalten
            this.clearAnnotations();
            this.isActive = false;
            vscode.window.showInformationMessage('Accessibility Tutor: Annotationen ausgeschaltet');
        }
        else {
            // Annotationen sind AUS → einschalten
            await this.annotateCode(textEditor);
            this.isActive = true;
            vscode.window.showInformationMessage('Accessibility Tutor: Annotationen eingeschaltet');
        }
    }
    /**
     * Hauptmethode, die Code-Annotationen für den aktuellen Editor erstellt
     */
    async annotateCode(textEditor) {
        try {
            // Schritt 1: Sichtbaren Code mit Zeilennummern holen
            const codeWithLineNumbers = this.getVisibleCodeWithLineNumbers(textEditor);
            if (!codeWithLineNumbers.trim()) {
                vscode.window.showInformationMessage('Kein Code im sichtbaren Bereich gefunden.');
                return;
            }
            // Schritt 2: GitHub Copilot Model auswählen
            const [model] = await vscode.lm.selectChatModels({
                vendor: 'copilot',
                family: 'gpt-4o'
            });
            if (!model) {
                vscode.window.showErrorMessage('GitHub Copilot ist nicht verfügbar. Bitte stelle sicher, dass du angemeldet bist.');
                return;
            }
            // Schritt 3: Chat-Nachrichten vorbereiten
            const messages = [
                vscode.LanguageModelChatMessage.User(this.getAnnotationPrompt()),
                vscode.LanguageModelChatMessage.User(codeWithLineNumbers)
            ];
            // Schritt 4: Request an das Model senden
            const chatResponse = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
            // Schritt 5: Response verarbeiten und Decorations anzeigen
            await this.parseChatResponse(chatResponse, textEditor);
        }
        catch (error) {
            console.error('Fehler beim Erstellen von Code-Annotationen:', error);
            vscode.window.showErrorMessage(`Fehler beim Code Tutor: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`);
        }
    }
    /**
     * Entfernt alle bestehenden Code-Annotationen
     */
    clearAnnotations() {
        for (const decorationType of this.decorationTypes) {
            decorationType.dispose();
        }
        this.decorationTypes.length = 0;
    }
    /**
     * Holt den sichtbaren Code mit Zeilennummern aus dem Editor
     */
    getVisibleCodeWithLineNumbers(textEditor) {
        // Position der ersten und letzten sichtbaren Zeile holen
        let currentLine = textEditor.visibleRanges[0].start.line;
        const endLine = textEditor.visibleRanges[0].end.line;
        let code = '';
        // Text von jeder Zeile holen und mit Zeilennummer versehen
        // Die Zeilennummer ist 0-basiert, daher +1 für 1-basierte Nummerierung
        while (currentLine < endLine) {
            code += `${currentLine + 1}: ${textEditor.document.lineAt(currentLine).text} \n`;
            currentLine++;
        }
        return code;
    }
    /**
     * Definiert den Prompt für das Language Model
     */
    getAnnotationPrompt() {
        return `Du bist ein Accessibility Tutor, spezialisiert auf die Prüfung von Quellcode hinsichtlich Barrierefreiheit nach den WCAG-Standards. Deine Aufgabe ist es, den vom Nutzer bereitgestellten Code zu analysieren und Zeilen zu identifizieren, die gegen WCAG-Richtlinien verstoßen oder verbessert werden können, insbesondere solche Probleme, die von automatisierten Tools wie axe-core nicht erkannt werden (z.B. semantische HTML-Strukturen, sinnvolle ARIA-Nutzung, Tastaturbedienbarkeit, visuelle Hinweise, Fokusmanagement, verständliche Labels, etc.).

      Für jede gefundene Zeile gib einen kurzen, konstruktiven Lösungsvorschlag, wie der Code barrierefreier und konformer zu den WCAG-Standards gestaltet werden kann. Sei freundlich und unterstützend in deinen Formulierungen.

      Formatiere jeden Vorschlag als ein einzelnes JSON-Objekt. Es ist nicht notwendig, deine Antwort in dreifache Backticks zu setzen. Beispiel:

      { "line": 5, "suggestion": "Füge ein aria-label hinzu, um die Funktion dieses Buttons für Screenreader zu beschreiben." }
      { "line": 17, "suggestion": "Verwende ein <nav>-Element statt eines <div>, um die Navigation semantisch korrekt zu markieren." }`;
    }
    /**
     * Verarbeitet die Chat-Response und erstellt Decorations
     */
    async parseChatResponse(chatResponse, textEditor) {
        let accumulatedResponse = '';
        for await (const fragment of chatResponse.text) {
            accumulatedResponse += fragment;
            // Wenn das Fragment eine } enthält, versuchen wir die ganze Zeile zu parsen
            if (fragment.includes('}')) {
                try {
                    const annotation = JSON.parse(accumulatedResponse);
                    this.applyDecoration(textEditor, annotation.line, annotation.suggestion);
                    // Accumulator für die nächste Zeile zurücksetzen
                    accumulatedResponse = '';
                }
                catch (e) {
                    // Nichts tun - warten auf vollständige JSON
                }
            }
        }
    }
    /**
     * Wendet eine Decoration (Annotation) auf eine bestimmte Zeile an
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
            hoverMessage: new vscode.MarkdownString(`💡 **Accessibility Verbesserungsvorschlag:**\n\n${suggestion}`)
        };
        editor.setDecorations(decorationType, [decoration]);
    }
}
exports.CodeTutorService = CodeTutorService;
//# sourceMappingURL=code-tutor-service.js.map