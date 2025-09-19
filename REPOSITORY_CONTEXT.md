# VS Code Accessibility Extension - Vollständige Repository-Dokumentation

## Projekt-Übersicht

Diese VS Code Extension kombiniert regelbasierte Accessibility-Analyse (axe-core) mit KI-gestützter semantischer Analyse für WCAG 2.2 AA Compliance. Das Projekt ist die technische Grundlage für eine Bachelorarbeit über "KI-gestützte Accessibility-Analyse und Quick-Fixes in einer VS Code Extension für barrierefreien Frontend-Code".

## Technische Architektur

### Core-Komponenten

```
src/
├── extension.ts                    # Haupteinstiegspunkt und Service-Orchestrierung
├── ai/
│   ├── ai-semantic-analyzer.ts    # KI-basierte semantische WCAG-Analyse
│   ├── ai-response-parser.ts      # Parsing von LLM-Antworten zu strukturierten Diagnostics
│   └── prompt-strategies.ts       # Wissenschaftlich fundierte Prompt-Strategien
├── llm/
│   └── llm-service.ts             # Multi-Provider LLM-Integration (Local/Copilot/OpenRouter)
├── metrics/
│   └── metrics-service.ts         # Metriken-Erfassung und -Persistierung
├── feedback/
│   └── feedback-service.ts        # User-Feedback für Quick-Fixes
├── views/
│   ├── llm-settings-provider.ts   # WebView für AI-Konfiguration
│   └── metrics-dashboard-provider.ts # Dashboard für Performance-Metriken
├── code-tutor/
│   └── code-tutor-service.ts      # Code-Annotationen mit AI-Erklärungen
└── core/
    ├── prompt-cache.ts            # LLM-Response-Caching
    └── rule-id-normalizer.ts      # WCAG-Regel-Normalisierung
```

### Datenfluss-Architektur

1. **Automatische Analyse bei Datei-Änderungen:**
   - `extension.ts` → `updateDiagnostics()` → axe-core via JSDOM → VS Code Diagnostics Collection

2. **Manuelle AI-Analyse:**
   - WebView Button → `AISemanticAnalyzer.startAnalysis()` → `LLMService` → Prompt Strategy → LLM API → Parser → AI Diagnostics

3. **Quick-Fix Workflow:**
   - Code Action → `fixWithAI()` → Kontext-Extraktion → LLM → Security Checks → Code Edit → Suppression Registry

### Wissenschaftliche Prompt-Strategien

**Direct Instruction** (Zero-Shot Optimized):
```typescript
class DirectInstructionStrategy implements PromptStrategy {
    generatePrompt(code: string): string {
        return `Analyze this HTML/JSX code for WCAG 2.2 AA violations.
Focus on semantic issues that automated tools miss:
- Missing accessible names
- Incorrect heading hierarchy  
- Poor semantic structure

Code:
${code}

Return JSON array: [{"line": number, "ruleId": "X.X.X", "element": "tag", "issue": "description"}]`;
    }
}
```

**Few-Shot Learning** (Pattern Induction):
- Verwendet 3-5 Code-Beispiele mit bekannten Violations
- Basiert auf Brown et al. (2020) Few-Shot Learning Prinzipien

**Chain-of-Thought** (Structured Reasoning):
- Implementiert Wei et al. (2022) schrittweise Analyse
- "Step 1: Check interactive elements... Step 2: Verify heading structure..."


### LLM-Provider-Integration

**Local LLM (Ollama/LM Studio):**
```typescript
class LocalLLMProvider implements LLMProvider {
    async getAccessibilityFix(prompt: string): Promise<string> {
        const response = await fetch(this.endpoint + '/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: 512
            })
        });
        return this.extractContent(await response.json());
    }
}
```

**GitHub Copilot Integration:**
- Nutzt VS Code's offizielle Copilot Chat API
- Automatisches Fallback bei API-Limits

**OpenRouter (Multiple Models):**
- Unterstützt 20+ Modelle (Claude, GPT-4, Llama, Mixtral)
- Structured Outputs für konsistentes JSON
- Prompt Caching für Performance

### Metriken und Evaluation

**Erfasste Metriken:**
```typescript
interface SimpleMetrics {
    totalViolationsFound: number;        // Axe + AI combined
    axeViolationsFound: number;          // Pure axe-core
    aiViolationsFound: number;           // AI-only findings
    aiViolationsSuppressed: number;      // Recently fixed suppressions
    quickFixAttempts: number;            // User-initiated fixes
    quickFixSuccesses: number;           // Successful code edits
    userFeedbackPositive: number;        // Thumbs up on violations
    userFeedbackNegative: number;        // Thumbs down on violations
    averageAnalysisTimeMs: number;       // AI response latency
}
```

**Suppression-Mechanismus:**
- TTL-basierte Unterdrückung kürzlich gefixter Zeilen (300s default)
- Verhindert Sofort-Re-Report nach AI-Fix
- Text-Snapshot-Vergleich für Änderungs-Detection

### axe-core Integration

**JSDOM-basierte Analyse:**
```typescript
const { window } = new JSDOM(htmlContent, { runScripts: 'dangerously' });

// Browser-API Stubs für axe-core Kompatibilität
window.requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 16);
window.alert = (msg: string) => console.log(`[JSDOM Alert]: ${msg}`);

// axe-core Ausführung
const results = await axe.run(window.document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    resultTypes: ['violations'],
    rules: {
        'color-contrast': { enabled: false },  // JSDOM kann keine Farben rendern
        'color-contrast-enhanced': { enabled: false }
    }
});
```

**Framework-Unterstützung:**
- HTML, Vue, Svelte, React/JSX, TypeScript JSX
- Framework-spezifische Content-Extraktion und HTML-Wrapping

## Forschungsgrade Test-Suite

### Test-Modi

**1. Axe-Only Tests (`npm run test:axe`):**
- Baseline-Messung der axe-core Performance
- Immer 100% Precision (keine False Positives)
- Framework-agnostische HTML-Konvertierung

**2. AI-Only Tests (`npm run test:ai`):**
- Standalone LLM-Performance-Messung
- Multi-Model-Vergleich (ENV: `AI_MODELS`)
- 4 Prompt-Strategien × N Modelle × M Runs

**3. Combined Tests (`npm run test:combined`):**
- Simuliert echtes Extension-Verhalten
- axe-core Baseline + AI Additional Findings
- Duplikats-Filtering und Recall-Gain-Messung

### Ground Truth System

**Struktur pro Test-Datei:**
```json
{
  "file": "wcag-violations.html",
  "violations": [
    {
      "line": 12,
      "ruleId": "1.1.1",
      "element": "img",
      "issue": "Image missing alt attribute",
      "wcagLevel": "A",
      "detectionType": "axe-core"
    },
    {
      "line": 25,
      "ruleId": "1.3.1", 
      "element": "div",
      "issue": "Div used instead of semantic button",
      "wcagLevel": "A",
      "detectionType": "semantic-ai"
    }
  ]
}
```

**Metriken-Berechnung:**
```typescript
// Precision = True Positives / (True Positives + False Positives)
const precision = truePositives / (truePositives + falsePositives);

// Recall = True Positives / (True Positives + False Negatives) 
const recall = truePositives / (truePositives + falseNegatives);

// F1-Score = 2 * (Precision * Recall) / (Precision + Recall)
const f1Score = 2 * (precision * recall) / (precision + recall);

// Coverage Delta = AI zusätzliche Findings / Gesamte Expected
const coverageDelta = aiAdditionalTruePositives / totalExpected;
```

### Multi-Model Evaluation

**Unterstützte Modelle:**
```bash
export AI_MODELS="openai/gpt-4o-mini,anthropic/claude-3.5-sonnet,meta-llama/llama-3.1-8b-instruct,mistralai/mixtral-8x7b-instruct"
export AI_RUNS=3  # Mehrfachläufe für statistische Signifikanz
export AI_STRUCTURED=1  # Structured JSON outputs
export AI_CACHE=1  # Response caching
```

**CSV-Output für statistische Analyse:**
```csv
file,mode,strategy,provider,model,run,found,expected,precision,recall,f1,tp,fp,fn,timeMs,tokens,cost
wcag-violations.html,ai,direct-instruction,OpenRouter,gpt-4o-mini,1,8,10,0.875,0.7,0.778,7,1,3,1250,145,0.00023
```

## Benutzeroberfläche

### WebView-basierte Konfiguration

**AI Settings Panel:**
- Provider-Auswahl (Local/Copilot/OpenRouter)
- Model-Konfiguration mit Dropdown
- Prompt-Strategy-Selektor mit Erklärungen
- Analysis Scope: Visible vs. Document
- Real-time Connection Testing

**Metrics Dashboard:**
- Live-Metriken (Violations, Fixes, Feedback)
- Performance-Diagramme (Latenz, Token-Verbrauch)
- Export-Funktionen für Analyse

### Developer Experience

**Inline Diagnostics:**
- Axe-core: Rote Wellenlinien (hohe Konfidenz)
- AI-Findings: Blaue Wellenlinien (semantische Analyse)
- Hover-Tooltips mit WCAG-Referenzen

**Quick-Fix Actions:**
```typescript
// Code Action Provider für "Fix with AI"
const codeAction = new vscode.CodeAction('Fix with AI', vscode.CodeActionKind.QuickFix);
codeAction.command = {
    command: 'accessibility-extension.fixWithAI',
    title: 'Fix with AI',
    arguments: [document, range, diagnostic]
};
```

**Feedback-System:**
- Thumbs Up/Down auf Violations
- Kommentar-Funktion für qualitatives Feedback
- Persistence in globalStorage

## Wissenschaftliche Validierung

### Reproduzierbarkeit

**Deterministische Tests:**
- Seed-basierte LLM-Konfiguration (temperature: 0)
- Versionierte Ground Truth
- Docker-Container für konsistente Umgebung

**Statistische Rigorosität:**
- Multiple Runs pro Model/Strategy-Kombination
- Confidence Intervals für Performance-Metriken
- ANOVA für Strategy-Vergleiche

### Threat Validity

**Internal Validity:**
- Ground Truth durch Doppel-Annotation
- Inter-Rater Agreement Measurement
- Bias-Kontrolle durch Model-Diversität

**External Validity:**
- Real-World Code Samples (GitHub, Open Source)
- Multi-Framework Support
- Industry-Standard Tool Integration (axe-core)

**Construct Validity:**
- WCAG 2.2 AA Compliance als Goldstandard
- Line-Level Precision für granulare Messung
- Semantic vs. Syntactic Violation Classification

## Performance und Skalierbarkeit

### Optimierungen

**Caching-Strategien:**
- LLM Response Caching (2min TTL, max 50 entries)
- Prompt-Prefixes für wiederholte Inhalte
- Debouncing für häufige Datei-Änderungen

**Resource Management:**
- JSDOM Memory Cleanup nach Analyse
- Background-Processing für große Dateien
- Rate-Limiting für API-Calls

**Error Handling:**
- Provider-Fallback-Ketten
- Graceful Degradation bei API-Fehlern
- User-Notification für kritische Fehler

## Konfiguration und Deployment

### VS Code Extension Settings

```json
{
  "accessibility.aiAnalyzer.enabled": true,
  "accessibility.aiAnalyzer.scope": "visible",
  "accessibility.aiAnalyzer.promptStrategy": "direct-instruction",
  "accessibility.aiAnalyzer.recentFixSuppressionTTL": 300000,
  "accessibility.localLLM.endpoint": "http://127.0.0.1:1234",
  "accessibility.localLLM.model": "llama-3.1-8b-instruct",
  "accessibility.githubCopilot.model": "gpt-4o",
  "accessibility.customAPI.endpoint": "https://openrouter.ai/api/v1",
  "accessibility.customAPI.model": "anthropic/claude-3.5-sonnet"
}
```

### Environment Variables (Tests)

```bash
# OpenRouter API für Tests
OPENROUTER_API_KEY=sk-or-v1-...

# Multi-Model Testing
AI_MODELS="openai/gpt-4o-mini,anthropic/claude-3.5-sonnet"
AI_RUNS=5
AI_STRUCTURED=1
AI_CACHE=1

# Test Output
TEST_OUTPUT_DIR=./test/results
GROUND_TRUTH_DIR=./test/expected
```

## Forschungskontext

### Theoretische Grundlagen

**WCAG 2.2 Compliance:**
- 13 Level A Kriterien, 20 Level AA Kriterien
- Focus on programmatic determinability
- Assistive Technology compatibility

**LLM Code Analysis:**
- Semantic understanding vs. syntactic pattern matching
- Few-shot learning for domain-specific tasks
- Prompt engineering for structured outputs

**Developer Tool Integration:**
- Language Server Protocol adoption
- Real-time feedback vs. batch processing
- User experience in professional workflows

### Evaluationsmetriken für Bachelorarbeit

**Quantitative Metriken:**
- **Coverage Delta**: (AI Additional TP) / (Total Expected) - Anteil zusätzlicher semantischer Findings
- **Precision AI**: AI True Positives / (AI TP + AI False Positives) - Genauigkeit der AI-Meldungen
- **Quick Fix Acceptance**: (User Positive Feedback) / (Total Quick Fix Attempts) - Nutzerakzeptanz
- **Latency**: Zeit von Analyse-Start bis Diagnostic-Anzeige - Performance Impact

**Qualitative Aspekte:**
- Error Type Classification (Semantic vs. Syntactic)
- User Experience durch Feedback-Kommentare
- Integration Quality in Developer Workflow

### Wissenschaftliche Beiträge

1. **Erste systematische Evaluation** von Multi-Strategy Prompting für Accessibility-Code-Analyse
2. **Ground Truth Dataset** mit Line-Level Annotations für WCAG-Violations
3. **Multi-Provider LLM Integration** in produktiver IDE-Umgebung
4. **Quantitative Analyse** des Mehrwerts von AI vs. regelbasierter Analyse

## Technische Anforderungen

### Entwicklung
- Node.js 18+, TypeScript 5.0+
- VS Code Extension API 1.74+
- JSDOM 22+, axe-core 4.8+

### Runtime Dependencies
- Optionale LLM-Provider (Local/Cloud)
- Internet-Zugang für Remote APIs
- 50MB RAM für Extension Base + JSDOM

### Test Environment
- OpenRouter API Key für Multi-Model Tests
- Docker für reproduzierbare CI/CD
- 2GB RAM für große Test-Suiten

## Zusammenfassung

Diese VS Code Extension repräsentiert eine innovative Kombination aus etablierter regelbasierter Analyse (axe-core) und moderner KI-gestützter semantischer Erkennung. Die umfassende Test-Suite mit Ground Truth, Multi-Model-Support und wissenschaftlich fundierten Metriken bietet eine solide empirische Grundlage für die Evaluation verschiedener Prompt-Strategien und LLM-Provider im Kontext der Web-Accessibility-Analyse.

Die Architektur folgt etablierten Software-Engineering-Prinzipien (Separation of Concerns, Provider Pattern, Observer Pattern) und integriert sich nahtlos in den VS Code Developer Workflow. Das Projekt adressiert eine reale Problemstellung (96% der Websites haben Accessibility-Violations) mit einer praktischen, wissenschaftlich evaluierbaren Lösung.