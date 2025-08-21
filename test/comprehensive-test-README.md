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
- Gefundene vs. erwartete Violations
- Verbesserungsrate in %
- Ausführungszeit in ms
- Token-Verbrauch
- CSV-Export mit allen Details

## 📋 Setup

1. **Environment konfigurieren:**
```bash
cp .env.example .env
# Editiere .env und füge deinen OpenRouter API Key hinzu
```

2. **Verfügbare Modelle** (in .env):
```bash
# Kostenlose Modelle:
OPENROUTER_DEFAULT_MODEL=qwen/qwen-2.5-coder-32b-instruct
OPENROUTER_DEFAULT_MODEL=meta-llama/llama-3.2-3b-instruct:free

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
Automatischer Export nach `test-results/accessibility-test-YYYY-MM-DD.csv` mit:
- Alle Metriken
- Detaillierte Violation-Listen
- Timestamp und Modell-Info

## 🎯 Erwartete Violations

Basierend auf Comment-Analyse der Test-Fixtures:
- `wcag-violations.html`: 37 Violations
- `wcag-violations.jsx`: 5 Violations  
- `wcag-violations.tsx`: 5 Violations
- `wcag-violations.vue`: 37 Violations
- `wcag-violations.svelte`: 37 Violations

## 🔧 Technische Details

### OpenRouter Integration
- Echte API-Calls (keine Mocks)
- Token-Tracking
- Error-Handling
- Model-Switching

### Deduplizierung
- Axe + AI Violations werden kombiniert
- Duplikate entfernt basierend auf Ähnlichkeit
- Verbesserungsrate berechnet

### Performance
- Parallel-Tests wo möglich
- Timeout-Handling
- Memory-effizient durch Streaming

## 📈 Beispiel-Workflow

```bash
# 1. Environment setup
cp .env.example .env
# Füge OPENROUTER_API_KEY hinzu

# 2. Kompilieren
npm run compile

# 3. Alle Tests ausführen
npm run test:comprehensive

# 4. Ergebnisse analysieren
# Console: Sofortige Übersicht
# CSV: Detaillierte Analyse in test-results/
```

Dieser Test-Suite ersetzt die bisherigen Mock-Tests mit **echter AI-Integration** und liefert **messbare, vergleichbare Ergebnisse** für verschiedene Prompt-Strategien und Modelle.
