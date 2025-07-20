# AI Semantic Analyzer Setup

## Neue Features

### 🧠 AI-gestützter WCAG Semantic Analyzer
- **Komplementäre Analyse**: Findet semantische WCAG-Verstöße, die axe-core übersieht
- **Gelbe Unterstreichungen**: Separate Markierungen für AI-gefundene Probleme
- **Keine Duplikate**: Intelligent filtering um axe-core Ergebnisse nicht zu wiederholen

### 🎯 AI-Fokussierte WCAG-Bereiche
- Semantisches HTML: `<div role="button">` → `<button>`
- Unlogische Heading-Hierarchie: `<h1>` → `<h3>` ohne `<h2>`
- Unverständliche Labels: `<button>Submit</button>` ohne Kontext
- Tab-Reihenfolge-Probleme: `tabindex` ohne logische Struktur
- Sinnlose ARIA-Attribute: `<img aria-label="image">`
- Leere interaktive Elemente ohne Labels

### 🔧 Activity Bar Integration
- **Brain Icon** in der Activity Bar für AI Settings
- **Provider-Auswahl**: Local LLM, GitHub Copilot, Custom API
- **Connection Status**: Echtzeit-Anzeige der Verbindung
- **Toggle**: AI Analyzer ein/ausschalten

### ⚡ AI QuickFix
- **"Fix with AI (Semantic)"** für blau unterstrichene AI-Findings
- Spezialisierte Prompts für semantische WCAG-Probleme
- Intelligente Code-Korrekturen mit Kontext

## Verwendung

### 1. AI Provider konfigurieren
1. Klicke auf das 🧠 Brain Icon in der Activity Bar
2. Wähle deinen bevorzugten AI Provider:
   - **Local LLM**: LM Studio (http://127.0.0.1:1234)
   - **GitHub Copilot**: VS Code Extension
   - **Custom API**: OpenAI, Anthropic, etc.
3. Teste die Verbindung

### 2. AI Analyzer aktivieren
1. Setze den Haken bei "AI Semantic Analyzer aktivieren"
2. Öffne eine HTML/JSX-Datei
3. Sieh gelbe Unterstreichungen für semantische Probleme

### 3. AI Fixes anwenden
1. Hovere über blau unterstrichene Bereiche
2. Klicke auf "Fix with AI"
3. AI korrigiert das semantische Problem automatisch

## Beispiel-Workflow

```html
<!-- VORHER: Axe-core findet missing alt -->
<img src="test.jpg">

<!-- AI findet zusätzlich: Non-semantic button -->
<div role="button" onclick="submit()">Submit</div>

<!-- NACHHER: AI Fix angewendet -->
<button onclick="submit()">Submit</button>
```

## Konfiguration

### VS Code Settings
```json
{
  "accessibility.aiProvider": "local",
  "accessibility.aiAnalyzer.enabled": true,
  "accessibility.localLLM.endpoint": "http://127.0.0.1:1234",
  "accessibility.localLLM.model": "mistralai/devstral-small-2507"
}
```

### LM Studio Setup
1. Installiere LM Studio
2. Starte Local Server auf Port 1234
3. Lade ein passendes Model (z.B. Devstral)
4. Teste Verbindung in der Extension

## Validierung

✅ **Keine Doppel-Markierungen** zwischen axe-core und AI  
✅ **Activity Bar Icon** sichtbar und funktional  
✅ **Provider-Switching** ohne Extension-Restart  
✅ **AI erkennt semantische Probleme**, die Linter übersehen  
✅ **QuickFix funktioniert** für gelb markierte AI-Findings  
✅ **Bestehende Funktionalität** bleibt erhalten (CodeTutor, fixWithAI)

## Technische Details

- **Separate DiagnosticCollection**: `ai-accessibility`
- **Performance**: Keine Blocking-Operations
- **Error Handling**: Robuste Fallbacks bei AI-API-Ausfällen
- **Clean Architecture**: TypeScript mit Interfaces
- **VS Code Compliance**: Extension Best Practices
