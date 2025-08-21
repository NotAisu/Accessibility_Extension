# WCAG Accessibility Test Suite

Einfache und effektive WCAG 2.2 AA Accessibility Tests mit drei Modi:

## 🚀 Quick Start

```bash
# Setup (einmalig)
cp .env.example .env
# Füge deinen OpenRouter API Key hinzu

# Tests ausführen
npm run test:axe        # Nur Axe-Core
npm run test:ai         # Nur AI (alle Strategien)
npm run test:combined   # Beide zusammen mit Deduplizierung
```

## 📊 Test-Modi

### 1. Axe-Only (`npm run test:axe`)
- **Echtes axe-core** wie in der Extension
- Funktioniert mit **allen Frontend-Frameworks** (HTML, JSX, TSX, Vue, Svelte)
- Framework-Content wird in HTML gewrappt für axe-core
- Zuverlässige Standard-Violations

### 2. AI-Only (`npm run test:ai`)
- Alle 4 Prompt-Strategien: one-shot, few-shot, chain-of-thought, role-based
- Semantische Analyse komplexer Probleme
- Erkennt Framework-spezifische Issues
- **Nur kostenlose OpenRouter Modelle**

### 3. Combined (`npm run test:combined`)
- Axe + AI mit Deduplizierung
- Beste Abdeckung
- Zeigt überlappende und einzigartige Violations

## 📁 Test-Dateien

- `wcag-violations.html` (37 erwartete Violations)
- `wcag-violations.jsx` (5 erwartete Violations)
- `wcag-violations.tsx` (5 erwartete Violations)
- `wcag-violations.vue` (37 erwartete Violations)
- `wcag-violations.svelte` (37 erwartete Violations)

## 💾 Ergebnisse

- **Console**: Echtzeit-Output während Tests
- **CSV**: Automatischer Export nach `test/results/`
  - `axe-YYYY-MM-DD.csv`
  - `ai-YYYY-MM-DD.csv` 
  - `combined-YYYY-MM-DD.csv`

## ⚡ Kostenlose Modelle

Nur FREE OpenRouter Modelle (keine unerwarteten Kosten):
- `qwen/qwen-2.5-coder-32b-instruct` (Standard)
- `meta-llama/llama-3.2-3b-instruct:free`
- `microsoft/phi-3-mini-128k-instruct:free`
- `google/gemma-2-9b-it:free`

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

## 📈 Ausgabe-Format

```
🔍 Running Axe-Core Tests...

✓ wcag-violations.html: 10/37 (27%) - 627ms
✓ wcag-violations.jsx: 1/5 (20%) - 20ms  
✓ wcag-violations.tsx: 1/5 (20%) - 10ms
✓ wcag-violations.vue: 10/37 (27%) - 546ms
✓ wcag-violations.svelte: 10/37 (27%) - 549ms

💾 Results saved: test/results/axe-2025-08-21T14-20-21.csv
```

**CSV-Spalten**: file, mode, strategy, found, expected, rate, timeMs, tokens, details

## 🛠️ Environment

```bash
# .env
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_DEFAULT_MODEL=qwen/qwen-2.5-coder-32b-instruct
```
