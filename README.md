# Accessibility Extension für VS Code

Eine professionelle VS Code-Extension zur Prüfung und Verbesserung der Barrierefreiheit in Webprojekten. Analysiert HTML-, Vue-, Svelte- und React-Code auf WCAG-Konformität und bietet KI-generierte Lösungen.

## Features

- **Automatische Erkennung von Barrierefreiheitsproblemen** nach WCAG 2.0-2.2 (A, AA)
- **KI-gestützte Korrekturen** durch lokalen KI-Server
- **Unterstützung mehrerer Frameworks**: HTML, Vue, Svelte, React
- **Integrierte Quickfixes** direkt im Editor

## Voraussetzungen

- VS Code 1.85.0+
- Lokaler KI-Server unter `http://127.0.0.1:1234/generate`
- Modell: `deepseek/deepseek-r1-0528-qwen3-8b`

## Installation & Nutzung

1. Extension über VS Code Marketplace installieren
2. Lokalen KI-Server starten
3. HTML/JS/TS-Dateien öffnen und Quickfixes verwenden

## Konfiguration

* `accessibility.fixVerbosity`: 
  * `minimal`: Nur korrigierter Code (Standard)
  * `detailed`: Code mit Erklärungen

## API-Integration

Die Extension kommuniziert mit dem KI-Server via POST an `/v1/chat/completions`:

```json
{
  "model": "deepseek/deepseek-r1-0528-qwen3-8b",
  "messages": [
    {
      "role": "user", 
      "content": "Fix this HTML code that violates an accessibility rule..."
    }
  ],
  "temperature": 0.2,
  "max_tokens": 512
}
```

```json
{
  "text": "Korrigierter HTML-Code",
  // oder
  "content": "Korrigierter HTML-Code",
  // oder
  "response": "Korrigierter HTML-Code"
  // und weitere gängige LLM-API-Formate
}
```

## Fehlerbehebung

- **Verbindungsprobleme**: Stellen Sie sicher, dass der KI-Server unter `/generate` erreichbar ist
- **API-Antwort**: Die Extension unterstützt verschiedene Antwortformate (`text`, `content`, `response`, etc.)
- **Korrekturergebnisse**: Die Extension extrahiert HTML-Code aus Markdown-Codeblöcken oder Text

## Datenschutz

Alle Daten werden lokal verarbeitet. Nur der zu korrigierende Code wird an Ihren lokalen KI-Server gesendet.

## Lizenz

MIT

---

**Für ein barrierefreies Web**
