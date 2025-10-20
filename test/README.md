# WCAG Accessibility Test Suite (Research Grade)

Diese Suite liefert reproduzierbare WCAG 2.2 AA Evaluierungen mit:
- Automatischem axe-core Scan
- Mehreren LLM Prompt-Strategien
- Multi-Model Vergleich (AI_MODELS)
- Präzisionsmetriken (TP / FP / FN, Precision, Recall, F1)
- Ground Truth JSON je Datei (line + ruleId + element + issue)
- Mehrfachläufen (AI_RUNS) für Varianz / Stabilität

## 🚀 Quick Start

```bash
# Setup (einmalig)
cp .env.example .env
# Füge deinen OpenRouter API Key hinzu

# Tests ausführen
npm run test:axe        # Nur Axe-Core
npm run test:ai         # Nur AI (alle Strategien × Modelle)
npm run test:combined   # Axe + AI kombiniert
```

## 📊 Test-Modi

### 1. Axe-Only (`npm run test:axe`)
- **Echtes axe-core** wie in der Extension
- Funktioniert mit **allen Frontend-Frameworks** (HTML, JSX, TSX, Vue, Svelte)
- Framework-Content wird in HTML gewrappt für axe-core
- Zuverlässige Standard-Violations

### 2. AI-Only (`npm run test:ai`)
- 3 Prompt-Strategien: one-shot, few-shot, chain-of-thought
- Multi-Model Schleife (ENV `AI_MODELS`)
- Striktes JSON Output Schema (erzwungen durch Prompt)
- Nutzung des zentralen Parsers (`parseAIAnalysis`)

### 3. Combined (`npm run test:combined`)
- Kombiniert axe-core Basis + AI semantische Findings (aktuell ohne Zeilen-Mapping aus axe, Fokus: AI Keys)
- Gleiche Metriken wie AI-Only

## 📁 Test-Dateien & Ground Truth

Jede Datei besitzt eine korrespondierende JSON Ground Truth unter `test/expected/<filename>.json`.
Struktur eines Eintrags:
```json
{
  "line": 42,
  "ruleId": "1.1.1",
  "element": "img",
  "issue": "Missing alt attribute"
}
```
Key für Matching: `line|ruleId` (Element & Issue werden nur für Kontext gespeichert).
Fehlerquellen: Bei späteren Änderungen unbedingt Zeilennummern stabil halten oder Ground Truth regenerieren.

## 💾 Ergebnisse & CSV

Alle Läufe erzeugen CSVs in `test/results/`:
- `axe-<timestamp>.csv`
- `ai-<timestamp>.csv`
- `combined-<timestamp>.csv`
- Zusätzlich: `*-summary-<timestamp>.csv` (Aggregat über Läufe)

Spalten (Detail CSV):
```
file, mode, strategy, run, provider, model, found, expected, tp, fp, fn, precision, recall, f1, rate, timeMs, tokens, details
```
Definitionen:
- found: Anzahl unterschiedlicher AI Keys (line|ruleId)
- expected: Anzahl Ground Truth Keys
- tp / fp / fn: True / False Positives / False Negatives relativ zu Ground Truth
- precision = tp / (tp+fp)
- recall = tp / (tp+fn)
- f1 = 2 * p * r / (p + r)
- rate = found / expected (rein quantitativ, nicht Qualität)
- details: Serialisierung der AI Violations (Lesbarkeit)

Summary CSV Spalten:
```
file, mode, strategy, model, runs, found_mean, found_std, precision_mean, precision_std, recall_mean, recall_std, f1_mean, f1_std
```

## ⚡ Multi-Model Setup

ENV Variable `AI_MODELS` (Komma-getrennt). Beispiel (nur Free):
```
AI_MODELS=qwen/qwen-2.5-coder-32b-instruct:free,meta-llama/llama-3.2-3b-instruct:free,microsoft/phi-3-mini-128k-instruct:free,google/gemma-2-9b-it:free
```
Fehlt `AI_MODELS`, wird `OPENROUTER_DEFAULT_MODEL` verwendet.
Mehrfachläufe: `AI_RUNS=5` wiederholt komplette Schleife (file × model × strategy).

## 🔧 Framework-Unterstützung

### Axe-Core Integration
- **HTML**: Direkte axe-core Analyse
- **JSX/TSX**: Extrahiert JSX → HTML Wrapping
- **Vue**: Extrahiert `<template>` → HTML Wrapping  
- **Svelte**: Entfernt `<script>/<style>` → HTML Wrapping

### ESLint A11y (Extension only)
ESLint a11y Packages sind installiert aber **nur für die Extension** aktiviert:
- `eslint-plugin-jsx-a11y` für React
- `eslint-plugin-vuejs-accessibility` für Vue
- Statische Analyse in der Extension, nicht in Tests

## 📈 Konsolen-Output Beispiel

```
🔍 Running Axe-Core Tests...

✓ wcag-violations.html: 10/37 (27%) - 627ms
✓ wcag-violations.jsx: 1/5 (20%) - 20ms  
✓ wcag-violations.tsx: 1/5 (20%) - 10ms
✓ wcag-violations.vue: 10/37 (27%) - 546ms
✓ wcag-violations.svelte: 10/37 (27%) - 549ms

💾 Results saved: test/results/axe-2025-08-21T14-20-21.csv
```

Siehe Abschnitt Ergebnisse & CSV für vollständige Spaltenliste.

## 🛠️ Environment Variablen

```bash
# .env
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_DEFAULT_MODEL=qwen/qwen-2.5-coder-32b-instruct:free
AI_MODELS=qwen/qwen-2.5-coder-32b-instruct:free,meta-llama/llama-3.2-3b-instruct:free
AI_RUNS=3
# Structured Outputs aktivieren/deaktivieren (1=an, 0=aus)
AI_STRUCTURED=1
# Prompt Caching (cache_control) aktivieren (1=an) – nur sinnvoll bei großen statischen Blöcken
AI_CACHE=0
```

Hinweise:
- Setze AI_STRUCTURED=0 falls ein Modell 400 Bad Request liefert (nicht unterstützt).
- Bei häufig identischen großen Codeblöcken kann AI_CACHE=1 Kosten reduzieren (Provider mit automatischem Caching profitieren weniger von cache_control Breakpoints).

## 🔬 Methodik (Kurzfassung für Bachelorarbeit)

1. Ground Truth Definition: Manuell kuratierte Violations pro Datei (WCAG 2.2 AA) mit stabilen Zeilennummern.
2. Modell-Prompting: Einheitliches Schema erzwingt strukturierte JSON-Ausgabe (Parser robust gegen Noise / Code Fences / JSON-Lines).
3. Matching Key: (line|ruleId) minimiert False Matches durch generische Beschreibungen.
4. Kennzahlen: Precision/Recall/F1 messen Qualität, nicht nur Quantität (rate). Mehrfachläufe geben Varianz (Std-Abweichung).
5. Multi-Model & Strategien: Systematische Vergleichsdimension → Evaluierung Promptwirkung vs. Modellleistung.
6. Reproduzierbarkeit: Temperatur 0, deterministische Pipeline, fixe Fixtures / Ground Truth.
7. Grenzen: axe-core Zeilen-Mapping in Combined aktuell rudimentär; zukünftige Erweiterung könnte DOM-zu-Quellcode Mapping ergänzen.

## ❗ Häufige Fehler
- Leere Ground Truth: Leere Expected JSON Dateien → alle Kennzahlen 0.
- Geänderte Zeilen: Verschiebt sich Code, stimmen line Keys nicht mehr.
- Fehlendes AI_MODELS: Nur ein Modell wird getestet (kein Vergleich).

## Quellen der Testdaten
- https://github.com/FormBold/html-form-examples-templates
- https://github.com/snidersd/react-examples/blob/master/src/App.js
- https://github.com/mdn/todo-vue
- https://github.com/ignitedotdev-templates/svelte-realword-example/tree/main/src/routes
- der Rest wurde synthetisch erstellt

## ✅ ToDo bei Erweiterungen
- Axe Violations auf Lines mappen (Source Maps / AST Parsing)
- Signifikanztests (z.B. McNemar) für Modellvergleiche nach Stabilisierung
- Erweiterte Rule Coverage (ARIA, Live Regions, Dynamik)

---
Fragen / Erweiterungen: Siehe Haupt-README oder Issue im Repo anlegen.
```
