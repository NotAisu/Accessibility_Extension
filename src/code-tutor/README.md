# Code Tutor Feature

Das Code Tutor Feature nutzt die VS Code Language Model API (GitHub Copilot), um intelligente Code-Annotationen zu erstellen, die Entwicklern dabei helfen, besseren Code zu schreiben.

## Was macht das Feature?

- **Automatische Code-Analyse**: Analysiert den sichtbaren Code im Editor
- **KI-gestützte Vorschläge**: Nutzt GitHub Copilot, um Verbesserungsvorschläge zu generieren  
- **Inline-Annotationen**: Zeigt Vorschläge direkt neben dem Code an
- **Hover-Details**: Vollständige Erklärungen beim Überfahren mit der Maus

## Wie wird es verwendet?

1. **Annotationen aktivieren**: Klicke auf das Kommentar-Icon (💬) in der Editor-Titelleiste oder nutze die Befehlspalette: "Code Tutor: Annotationen ein/ausschalten"

2. **Annotationen ansehen**: Nach kurzer Zeit erscheinen Vorschläge als graue, kursive Texte am Ende der Codezeilen

3. **Details anzeigen**: Fahre mit der Maus über eine Annotation, um die vollständige Erklärung zu sehen

4. **Annotationen löschen**: Nutze die Befehlspalette: "Code Tutor: Annotationen löschen"

## Voraussetzungen

- **GitHub Copilot**: Du musst bei GitHub Copilot angemeldet sein
- **VS Code**: Version 1.85.0 oder höher

## Technische Details

Das Feature besteht aus:

- `code-tutor-service.ts`: Hauptlogik für die Code-Analyse und Annotation
- Integration in `extension.ts`: Registrierung der Befehle und Services
- `package.json`: Konfiguration der Befehle und Menüs

## Funktionsweise

1. **Code erfassen**: Holt den sichtbaren Code mit Zeilennummern
2. **KI-Anfrage**: Sendet den Code an GitHub Copilot mit einem spezialisierten Prompt
3. **Response verarbeiten**: Parst die JSON-Antworten der KI
4. **Visualisierung**: Erstellt VS Code Decorations für die Anzeige
