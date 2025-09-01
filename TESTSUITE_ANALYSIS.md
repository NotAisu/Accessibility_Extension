# Testsuite Tiefanalyse - Axe-Core vs. AI Combined Testing

## **Übersicht**

Die Testsuite ist darauf ausgelegt, das Verhalten der Extension korrekt zu simulieren:
- **Axe-Core**: Findet bekannte WCAG-Violations mit 100% Precision (keine False Positives)
- **AI**: Findet ZUSÄTZLICHE Violations, die Axe-Core übersehen hat
- **Combined**: Zeigt den Mehrwert der AI gegenüber Axe-Core allein

## **Aktuelle Test-Modi**

### 1. **Axe-Core Tests** (`npm run test:axe`)
```bash
npx ts-node test/axe-cli.ts
```
**Zweck**: Baseline-Messung von Axe-Core
**Ergebnis**: 
- ✅ **Immer 100% Precision** (keine False Positives)
- ✅ **Hohe Recall** für bekannte WCAG-Regeln
- ✅ **Echte Axe-Core Integration** wie in der Extension

**Beispiel-Output**:
```
✓ wcag-violations.html [axe] Found=10 P=1.00 R=1.00 F1=1.00 TP=10 FP=0 FN=0 t=626ms
✓ wcag-violations.jsx [axe] Found=1 P=1.00 R=1.00 F1=1.00 TP=1 FP=0 FN=0 t=22ms
```

### 2. **AI Tests** (`npm run test:ai`)
```bash
npx ts-node test/ai-cli.ts
```
**Zweck**: Standalone AI-Performance-Messung
**Ergebnis**: Zeigt, wie gut AI allein bei der WCAG-Detection ist

### 3. **Combined Tests** (`npm run test:combined`) - **VERBESSERT**
```bash
npx ts-node test/combined-cli.ts
```
**Zweck**: **Simualiert echtes Extension-Verhalten**

#### **Neue Logik** (Angepasst für Extension-Realität):

1. **Axe-Core läuft zuerst** → Findet bekannte Violations
2. **AI läuft auf derselben Datei** → Findet potentiell zusätzliche Violations
3. **Duplikate werden gefiltert** → AI-Findings, die bereits von Axe gefunden wurden, werden entfernt
4. **Combined-Result** = Axe (100% TP) + AI (nur zusätzliche Findings)

#### **Neue Metriken-Aufschlüsselung**:

**Console Output**:
```
✓ file.html (strategy) [combined model] 
  axe_tp=10 axe_fp=0 
  ai_add_tp=3 ai_add_fp=1 
  recall_gain=0.150 
  P=0.93 R=0.87 F1=0.90 
  Found=14/15 t=1200ms tok=450
```

**CSV-Spalten** (erweitert für Combined):
- `axe_tp`: True Positives von Axe-Core (sollte = axe_found sein)
- `axe_fp`: False Positives von Axe-Core (sollte = 0 sein)
- `ai_additional_tp`: Zusätzliche True Positives, die nur AI fand
- `ai_additional_fp`: Zusätzliche False Positives, die nur AI fand
- `recall_gain`: Recall-Verbesserung durch AI (Combined_Recall - Axe_Recall)

## **Wichtige Erkenntnisse**

### **Warum diese Aufteilung?**

1. **Extension-Realität**: In der echten Extension läuft Axe-Core zuerst, dann AI nur für zusätzliche Findings
2. **Axe-Core Qualität**: Axe-Core ist hochqualitativ und hat praktisch keine False Positives
3. **AI-Mehrwert**: AI soll zusätzliche, subtile Accessibility-Issues finden, die Axe übersieht
4. **Performance-Transparenz**: Nutzer sehen klar, was von welchem Tool kommt

### **Test-Dateien & Ground Truth**

**Fixtures**:
- `test/fixtures/wcag-violations.html` - HTML mit bekannten WCAG-Verletzungen
- `test/fixtures/wcag-violations.jsx` - React-JSX mit Accessibility-Issues
- `test/fixtures/wcag-violations.tsx` - TypeScript-React
- `test/fixtures/wcag-violations.vue` - Vue.js Template
- `test/fixtures/wcag-violations.svelte` - Svelte Component
- `test/fixtures/no-violations.html` - Saubere HTML-Datei (Negativkontrolle)

**Expected Results**:
- `test/expected/*.json` - Ground Truth Annotations
- Format: `[{"line": 35, "ruleId": "1.1.1"}, ...]`

### **Axe-Core Mapping-Herausforderung**

**Problem**: Axe-Core gibt HTML-Fragmente zurück, keine Zeilennummern
**Lösung**: `mapAxeLineKeys()` Heuristik
- Sucht HTML-Fragment im Original-Code
- Fallback: Sucht nach Tag-Namen
- Limitierung: Bei mehrfach vorkommenden Tags ungenau

```typescript
private mapAxeLineKeys(originalContent: string, axeViolations: any[]): Set<string> {
    // Findet erste Übereinstimmung von HTML-Fragment → Zeilennummer
    // Für echte Extension ist das genauer, da DOM-Elemente verfügbar sind
}
```

## **Verwendung & Konfiguration**

### **Environment Variables**:
```bash
# API-Konfiguration
OPENROUTER_API_KEY=your_key_here
AI_MODELS=qwen/qwen3-coder:free,anthropic/claude-3-haiku
AI_STRATEGIES=basic,detailed,accessibility-focused
AI_RUNS=3  # Für statistische Stabilität
AI_TIMEOUT_MS=45000

# Performance-Tuning
AI_STRUCTURED=1  # Structured JSON Output
AI_CACHE=1       # Prompt Caching
```

### **Strategie-Tests**:
```bash
# Nur eine Strategie testen
AI_STRATEGIES=accessibility-focused npx ts-node test/combined-cli.ts

# Mehrere Strategien
AI_STRATEGIES=basic,detailed npx ts-node test/combined-cli.ts
```

### **Multi-Model Evaluation**:
```bash
AI_MODELS=qwen/qwen3-coder:free,anthropic/claude-3-haiku,meta-llama/llama-3.1-8b-instruct:free npx ts-node test/ai-cli.ts
```

## **Interpretation der Ergebnisse**

### **Perfekte Combined-Test Szenarien**:

1. **Axe Perfect, AI Adds Value**:
   ```
   axe_tp=10, axe_fp=0, ai_additional_tp=3, ai_additional_fp=0, recall_gain=0.20
   ```
   → Ideal: Axe findet 10 korrekt, AI findet 3 zusätzliche korrekt

2. **Axe Perfect, AI Mixed**:
   ```
   axe_tp=10, axe_fp=0, ai_additional_tp=2, ai_additional_fp=1, recall_gain=0.13
   ```
   → Realistisch: AI hat Mehrwert, aber auch False Positives

3. **Problem-Fall**:
   ```
   axe_tp=8, axe_fp=2, ai_additional_tp=1, ai_additional_fp=3, recall_gain=0.07
   ```
   → Axe hat unerwartete FPs (Mapping-Problem oder Ground Truth Issue)

### **Wichtige KPIs**:

1. **`axe_fp` sollte ≈ 0 sein** (bestätigt Axe-Core Qualität)
2. **`recall_gain` > 0** zeigt AI-Mehrwert
3. **`ai_additional_tp / (ai_additional_tp + ai_additional_fp)`** = AI-Additional-Precision
4. **`combined_recall > axe_recall`** bestätigt Verbesserung

## **Limitierungen & Nächste Schritte**

### **Aktuelle Limitierungen**:
1. **Axe Line-Mapping**: Heuristisch, nicht 100% akkurat
2. **Ground Truth**: Manuell annotiert, potentiell unvollständig
3. **AI-Kosten**: Echte API-Calls für alle Tests

### **Verbesserungsvorschläge**:
1. **DOM-basiertes Testing**: Echte Browser-Umgebung für präzisere Axe-Integration
2. **Erweiterte Ground Truth**: Mehr annotierte Testfälle
3. **Performance-Benchmarks**: Token-Effizienz und Latenz-Messungen
4. **Regression-Tests**: Automatische Qualitätssicherung bei Code-Änderungen

## **Kommandos für schnelle Tests**

```bash
# Vollständige Test-Suite
npm run test:all

# Nur Axe-Core (schnell, ohne API)
npx ts-node test/axe-cli.ts

# Combined mit spezifischer Konfiguration
AI_MODELS=qwen/qwen3-coder:free AI_STRATEGIES=basic AI_RUNS=1 npx ts-node test/combined-cli.ts

# Ergebnisse analysieren
ls test/results/
head -5 test/results/combined-*-latest.csv
```

---

**Fazit**: Die Testsuite bildet jetzt korrekt die Extension-Realität ab, wo Axe-Core als zuverlässiger Baseline-Scanner fungiert und AI zusätzlichen Mehrwert durch das Finden subtiler, manuell erkennbarer Accessibility-Issues bietet.
