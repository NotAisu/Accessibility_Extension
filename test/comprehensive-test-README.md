# WCAG Comprehensive Test Suite

Diese neue Test-Suite bietet **echte AI Integration mit OpenRouter** und umfassende WCAG-Tests.

## 🚀 Features

### Test-Modi
- **Axe-only**: Nur axe-core Scanner
- **AI-only**: Nur AI Semantic Analysis (alle Prompt-Strategien)  
- **Combined**: Axe + AI mit Deduplizierung

### Prompt-Strategien
- `one-shot`: Direkter Einzelprompt
- `few-shot`: Mit Beispielen
- `chain-of-thought`: Schrittweise Analyse
- `role-based`: Rollenbasierte Analyse

### Metriken
- Found / Expected (Quantität)
- TP / FP / FN (Qualität gegen Ground Truth)
- Precision / Recall / F1
- Laufzeit (ms)
- Tokens
- Multi-Run Aggregation (Mittelwert / Std-Abweichung)

## 📋 Setup

1. **Environment konfigurieren:**
```bash
cp .env.example .env
# Editiere .env und füge deinen OpenRouter API Key hinzu
```

2. **Modelle konfigurieren** (`.env`):
```bash
OPENROUTER_DEFAULT_MODEL=qwen/qwen-2.5-coder-32b-instruct:free
# Optional mehrere Modelle (Komma-getrennt)
AI_MODELS=qwen/qwen-2.5-coder-32b-instruct:free,meta-llama/llama-3.2-3b-instruct:free,microsoft/phi-3-mini-128k-instruct:free
AI_RUNS=3
```

## 🧪 Tests ausführen

### Alle Tests
```bash
npm run test:comprehensive
```

### Spezifische Dateien
```bash
npm run test:comprehensive:html    # Nur HTML-Dateien
npm run test:comprehensive:js      # Nur JSX/TSX-Dateien
```

### Spezifische Strategien
```bash
npm run test:comprehensive:one-shot  # Nur one-shot Strategie
```

### Custom Parameter
```bash
# Spezifische Dateien und Strategien
node out/test/cli-comprehensive.js --files "wcag-violations.html" --strategies "one-shot,few-shot"

# Anderes Modell verwenden
node out/test/cli-comprehensive.js --model "anthropic/claude-3.5-sonnet"
```

## 📊 Ausgabe-Format

### Console Output
```
📊 COMPREHENSIVE TEST RESULTS
┌─────────────────────┬─────────────────┬─────────────────┬──────────────┬────────────┬────────────┐
│ File / Test         │ Strategy        │ Found/Expected  │ Improvement  │ Time (ms)  │ Tokens     │
├─────────────────────┼─────────────────┼─────────────────┼──────────────┼────────────┼────────────┤
│ wcag-violations.html│ axe-only        │ N/A             │ 15/37        │ 41%        │ 120        │
│                     │ ai-only         │ one-shot        │ 22/37        │ 59%        │ 1250       │
│                     │ ai-only         │ few-shot        │ 28/37        │ 76%        │ 1850       │
│                     │ combined        │ one-shot        │ 31/37        │ 84%        │ 1370       │
└─────────────────────┴─────────────────┴─────────────────┴──────────────┴────────────┴────────────┘
```

### CSV Export
Automatischer Export nach `test/results/` mit Spalten:
```
file, mode, strategy, run, provider, model, found, expected, tp, fp, fn, precision, recall, f1, rate, timeMs, tokens, details
```
Zusätzlich: Summary CSV (`*-summary-<timestamp>.csv`):
```
file, mode, strategy, model, runs, found_mean, found_std, precision_mean, precision_std, recall_mean, recall_std, f1_mean, f1_std
```
Ground Truth: JSON Dateien unter `test/expected/<filename>.json` mit Feldern: line, ruleId, element, issue.

Determinismus: Temperatur fest 0. Prompt erzwingt reines JSON.

## 🎯 Erwartete Violations

Basierend auf Comment-Analyse der Test-Fixtures:
- `wcag-violations.html`: 37 Violations
- `wcag-violations.jsx`: 5 Violations  
- `wcag-violations.tsx`: 5 Violations
- `wcag-violations.vue`: 37 Violations
- `wcag-violations.svelte`: 37 Violations

## 🔧 Technische Details (aktualisiert)

### OpenRouter Integration
- Echte API-Calls (keine Mocks)
- Token-Tracking
- Error-Handling
- Model-Switching

### Matching & Keys
- AI Output → Parser (`parseAIAnalysis`) extrahiert strukturierte Objekte
- Matching-Key: `line|ruleId`
- Axe aktuell ohne Zeilen: Combined nutzt AI Keys (Axe Erweiterung optional)

### Performance
- Mehrfachläufe seriell pro Modell (für Varianz)
- Geringe Overhead-Parsing-Kosten

## 📈 Beispiel-Workflow

```bash
# 1. Environment setup
cp .env.example .env
# Füge OPENROUTER_API_KEY hinzu

# 2. (Optional) Transpile falls TS benötigt
npm run compile

# 3. Alle Tests ausführen
npm run test:comprehensive

# 4. Ergebnisse analysieren
# Console: Sofortige Übersicht
# CSV: Detaillierte Analyse in test-results/
```

Diese Suite liefert reproduzierbare, forschungsnahe Metriken für Strategien & Modelle und kann in einer Bachelorarbeit direkt zitiert werden (Methodik siehe `test/README.md`).
