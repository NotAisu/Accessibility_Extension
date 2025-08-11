# WCAG 2.2 AA Accessibility Test Suite

Eine umfassende Test-Suite für die Accessibility Extension, die WCAG 2.2 AA Violations in verschiedenen Frontend-Frameworks erkennt und vergleicht.

## 🚀 Schnellstart

```bash
# Alle Testdateien mit Standard-Modell (gpt-4o) testen
npm run test

# Spezifische Datei testen
npm run test wcag-violations.html

# Mit bestimmtem GitHub Copilot Modell
npm run test --model claude-3.5-sonnet

# JSON-Ausgabe
npm run test --format json

# Kombiniert: Spezifische Datei + Modell + Format
npm run test wcag-violations.vue --model gpt-4o --format both
```

## 📁 Testdateien

Die Suite testet umfassende WCAG 2.2 AA Violations in:

- **HTML** (`wcag-violations.html`) - Standard HTML mit 40+ Violation Types
- **JSX** (`wcag-violations.jsx`) - React ohne TypeScript
- **TSX** (`wcag-violations.tsx`) - React mit TypeScript  
- **Vue** (`wcag-violations.vue`) - Vue.js Single File Component
- **Svelte** (`wcag-violations.svelte`) - Svelte Component

## 🧪 Test-Ansätze

### 1. Axe-Core Only
- **Automatisierte Erkennung** von Standard-WCAG-Violations
- **Schnell und zuverlässig** für bekannte Patterns
- **Limitiert** auf vordefinierte Regeln

### 2. AI Semantic Analyzer Only  
- **GitHub Copilot** für semantische Analyse
- **Erkennt komplexe Probleme** die axe-core übersieht
- **Kontextbewusst** für moderne Framework-Patterns

### 3. Combined Approach
- **Beste Abdeckung** durch Kombination beider Methoden
- **Duplikat-Filterung** für saubere Ergebnisse
- **Maximale WCAG-Compliance**

## 🎯 Verfügbare WCAG Violations

Basierend auf der umfassenden Knowledge Base:

### Perceivable (Wahrnehmbar)
- **1.1.1** Non-text Content - Fehlende Alt-Attribute
- **1.3.1** Info and Relationships - Semantische Struktur
- **1.4.3** Contrast (Minimum) - Kontrastverhältnisse
- **1.4.1** Use of Color - Farbe als einziger Informationsträger

### Operable (Bedienbar)  
- **2.1.1** Keyboard - Tastatur-Zugänglichkeit
- **2.2.2** Pause, Stop, Hide - Auto-Playing Content
- **2.4.2** Page Titled - Seitentitel
- **2.4.4** Link Purpose - Link-Zweck
- **2.4.7** Focus Visible - Fokus-Indikatoren
- **2.5.8** Target Size - Touch-Target-Größe

### Understandable (Verständlich)
- **3.1.1** Language of Page - Seitensprache
- **3.2.2** On Input - Kontext-Änderungen
- **3.3.2** Labels or Instructions - Form-Labels

### Robust (Robust)
- **4.1.2** Name, Role, Value - Zugängliche Namen
- ARIA-Missbrauch und -Implementierung

## 🤖 GitHub Copilot Modelle

```bash
# Standard Modelle
npm run test --model gpt-4o          # Standard (empfohlen)
npm run test --model gpt-4.1         # Erweitert

# Claude Modelle  
npm run test --model claude-3.5-sonnet     # Hochwertig
npm run test --model claude-3.7-sonnet     # Neueste Version
npm run test --model claude-4-sonnet       # Premium

# Google Modelle
npm run test --model gemini-2.0-flash      # Schnell
npm run test --model gemini-2.5-pro        # Premium

# OpenAI Neue Modelle
npm run test --model o3-mini               # Kompakt
npm run test --model o4-mini               # Neueste
```

## 📊 Ausgabe-Formate

### Table Format (Standard)
```
📋 Results Table:
┌────────────────────┬────────────┬────────────┬──────────────┬─────────────────┐
│ Filename           │ Axe-Core   │ AI Only    │ Combined     │ Improvement %   │
├────────────────────┼────────────┼────────────┼──────────────┼─────────────────┤
│ wcag-violations... │ 12         │ 18         │ 25           │ +108%           │
│ wcag-violations... │ 8          │ 22         │ 27           │ +237%           │
└────────────────────┴────────────┴────────────┴──────────────┴─────────────────┘

⏱️  Performance Results (ms):
┌────────────────────┬────────────┬────────────┬──────────────┐
│ Filename           │ Axe-Core   │ AI Only    │ Combined     │
├────────────────────┼────────────┼────────────┼──────────────┤
│ wcag-violations... │ 145        │ 3240       │ 3420         │
└────────────────────┴────────────┴────────────┴──────────────┘
```

### JSON Format
```json
{
  "filename": "wcag-violations.html",
  "axeViolations": 12,
  "aiViolations": 18, 
  "combinedViolations": 25,
  "axeDetails": [...],
  "aiDetails": [...],
  "executionTime": {
    "axe": 145,
    "ai": 3240,
    "combined": 3420
  }
}
```

## 📈 Metriken und Insights

### Coverage Analysis
- **Axe-Core Abdeckung**: Automatisiert erkennbare WCAG-Regeln
- **AI Unique Discoveries**: Semantische Probleme die Tools übersehen
- **Improvement Percentage**: Qualitätssteigerung durch AI-Integration

### Performance Benchmarks
- **Axe-Core**: ~100-200ms (sehr schnell)
- **AI Analyzer**: ~2-5s (abhängig vom Modell)
- **Combined**: Summe beider Ansätze

### Quality Insights  
- **False Positive Rate**: AI vs. Axe-Core Genauigkeit
- **Unique Problem Detection**: AI-spezifische Erkennungen
- **Framework-specific Issues**: Vue/React/Svelte Patterns

## 🔧 Erweiterte Konfiguration

### Custom Test Files
```bash
# Eigene Testdateien hinzufügen
mkdir test/fixtures/custom
# Dateien nach test/fixtures/ kopieren
npm run test custom-component.vue
```

### Modell-Performance Vergleich
```bash
# Verschiedene Modelle testen und vergleichen
npm run test --model gpt-4o --format json > results-gpt4o.json
npm run test --model claude-3.5-sonnet --format json > results-claude.json
```

### CI/CD Integration
```bash
# In GitHub Actions / Jenkins
npm run test --format json | jq '.[] | select(.combinedViolations > 20)'
```

## 🛠️ Technische Details

### Dependencies
- **axe-core**: ^4.8.4 - Automatisierte WCAG-Tests
- **jsdom**: ^26.1.0 - DOM-Simulation für Tests
- **vscode**: VS Code Extension API für AI-Integration

### Test Environment
- **TypeScript**: Vollständig typisiert
- **Mocha Compatible**: Integration in bestehende Test-Suites
- **Mock VS Code**: Standalone-Ausführung möglich

### Architecture
```
test/
├── fixtures/                 # Testdateien mit WCAG Violations
│   ├── wcag-violations.html  # Standard HTML
│   ├── wcag-violations.jsx   # React JSX
│   ├── wcag-violations.tsx   # React TypeScript
│   ├── wcag-violations.vue   # Vue Component
│   └── wcag-violations.svelte # Svelte Component
├── accessibility-test-suite.ts # Haupt-Test-Logic
├── cli.ts                    # Command Line Interface
└── README.md                 # Diese Dokumentation
```

## 🎯 Beispiel-Workflow

```bash
# 1. Entwicklung: Schneller Check einer Datei
npm run test my-component.vue --model gpt-4o

# 2. CI/CD: Vollständige Suite
npm run test --format json

# 3. Performance Analysis: Modell-Vergleich  
npm run test --model claude-3.5-sonnet --format both

# 4. Documentation: Detaillierte Ergebnisse
npm run test --format json > accessibility-report.json
```

## 🔍 Troubleshooting

### Häufige Probleme

**GitHub Copilot nicht verfügbar**
```bash
# VS Code Extension installieren und anmelden
code --install-extension GitHub.copilot
```

**Modell nicht gefunden**
```bash
# Verfügbare Modelle prüfen
npm run test --help
```

**Performance Issues**
```bash
# Nur axe-core für schnelle Tests
# Modifikation in accessibility-test-suite.ts
```

### Debug Mode
```bash
# Detaillierte Logs aktivieren
DEBUG=accessibility:* npm run test
```

## 📋 Roadmap

- [ ] **Web Components** Support
- [ ] **Angular** Test Files  
- [ ] **Performance Profiling** für verschiedene Modelle
- [ ] **Custom Rule Definition** für AI Analyzer
- [ ] **Integration** in VS Code Test Explorer
- [ ] **Batch Processing** für große Projekte
- [ ] **WCAG 3.0** Vorbereitung

---

**Erstellt für die Accessibility Extension** - Umfassende WCAG 2.2 AA Compliance durch intelligente Kombination von automatisierten Tools und AI-basierter semantischer Analyse.
