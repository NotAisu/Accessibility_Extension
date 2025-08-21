<div align="center">

# Accessibility Extension (VS Code)

WCAG 2.2 AA Auditing + Semantische AI-Analyse + Quick Fixes + Lernunterstützung – direkt im Editor.

</div>

---

## Inhaltsverzeichnis
1. Überblick
2. Kern-Features
3. Architektur & Module
4. Funktionsweise (Pipeline)
5. Installation & Setup
6. Einstellungen (Settings) & Konfiguration
7. Prompt Strategien (AI Semantic Analyzer)
8. Unterstützte AI Provider
9. Commands & Webviews
10. Metrics & Feedback Loop
11. Code Tutor (Inline Lernhilfe)
12. Testing / CLI Suiten
13. Entwicklungs-Setup
14. Qualität & Modularity Assessment
15. Bekannte Einschränkungen
16. Roadmap / Verbesserungen
17. Lizenz / Hinweise

---

## 1. Überblick
Die Erweiterung kombiniert klassische statische Accessibility Analyse (axe-core) mit einer semantischen KI-Schicht, um auch nicht-triviale WCAG-Verstöße (z.B. schlechte Struktur, fehlende Landmark-Semantik, unklare Labels) zu erkennen. Dazu kommen:
- AI Quick Fixes pro Diagnostic (kontextbezogene Code-Ersetzung)
- Prompt-Strategien (One-Shot, Few-Shot, Chain-of-Thought, Role-Based)
- Metrik-Dashboard (Erkennungsqualität, Performance, Quick-Fix-Feedback)
- Feedback-Loops zur kontinuierlichen Qualitätsbewertung
- Code Tutor mit Inline-Anmerkungen (Lernorientiert, Copilot Language Model API)

Ziel: Schnelleres, zuverlässigeres und lehrreiches Herstellen barrierefreier Frontend-Komponenten in HTML / React (JSX/TSX) / Vue / Svelte.

---
## 2. Kern-Features
| Kategorie | Feature | Beschreibung |
|-----------|---------|--------------|
| Analyse | axe-core Integration | Automatische WCAG 2.2 (AA) Basis-Regeln (mit Farbkontrast-Ausnahme) |
| Semantik KI | AI Semantic Analyzer | Manuelle Auslösung, analysiert sichtbaren oder gesamten Code mit wählbarer Prompt-Strategie |
| Quick Fix | AI Fix Command | Kontextbezogener Prompt, minimaler Code-Patch pro Diagnostic |
| Provider | Local / GitHub Copilot / Custom API | Austauschbar via Settings-Webview |
| Lernhilfe | Code Tutor | Streaming von JSON Annotationen mit Verbesserungsvorschlägen (Decorations) |
| Feedback | Quick Fix & Violation Feedback | Thumbs Up/Down + Sammlung in Metrics |
| Metrics | Dashboard Webview | Aktuelle Violations, Genauigkeit, Performance, Quick-Fix Erfolgsrate |
| Sicherheit | Secret Storage | API Key Speicherung für Custom Provider |

---
## 3. Architektur & Module
```
src/
	extension.ts                # Einstieg & Registrierungen
	ai/
		ai-semantic-analyzer.ts   # Semantische Analyse + Prompt Strategie Integration
		prompt-strategies.ts      # Strategien (one-shot, few-shot, chain-of-thought, role-based)
	llm/llm-service.ts          # Provider Orchestrierung (local, copilot, custom)
	code-tutor/                 # Code Tutor Service (LM API Nutzung)
	metrics/metrics-service.ts  # Metrik Aggregation & Persistenz
	feedback/feedback-service.ts# Benutzerfeedback zu Fixes / Violations
	views/
		llm-settings-provider.ts  # Webview: AI Settings (Provider, Scope, Strategy, Keys)
		metrics-dashboard-provider.ts # Webview: Metrics Dashboard
test/                         # Zwei Test-Suiten (standalone & erweiterte AI-Kombi)
```

Design-Prinzipien:
- Lose Kopplung: AI Analyzer konsumiert nur `LLMService` & Callback für axe Diagnostics
- Metriken zentral (Singleton) – alle anderen Services melden Events
- Provider öffnen keine UI; UI-Konzepte liegen bei Webview Providern / Commands
- Minimierte Business Logik in Webviews – dort vor allem State-Sync & Message Passing

---
## 4. Funktionsweise (Pipeline)
1. Benutzer öffnet Datei → axe-core läuft (event-getriggert) → Diagnostics (Warnungen)
2. Optional: Benutzer startet AI Semantic Analysis → Code (Sichtbar / Dokument) wird mit Zeilennummern + Prompt Strategie an LLM geschickt → Response wird geparst → Neue AI Diagnostics (Informations-Level) hinzugefügt
3. Quick Fix: Auswahl einer Diagnostic → Prompt generiert → LLM Antwort (nur korrigierte Zeile) → Editor Patch → Feedback Dialog
4. Code Tutor: Streaming Annotationen → JSON Parsing → Decorations (after text)
5. Metrics: Jede Analyse / Fix / Feedback aktualisiert Kennzahlen → Dashboard aktualisiert via EventEmitter

---
## 5. Installation & Setup
Voraussetzungen:
- VS Code ≥ 1.85
- Node.js ≥ 18 (für Entwicklung / Tests)
- (Optional) Laufender lokaler OpenAI-kompatibler Endpoint (z.B. LM Studio, Ollama) oder aktiver GitHub Copilot Zugang.

Schritte Entwicklung:
```
git clone <repo>
cd Accessibility_Extension
npm install
npm run compile
F5 (VS Code Extension Host starten)
```

Erstkonfiguration im Activity Bar Icon „AI Accessibility“ → AI Settings Webview:
1. Provider wählen (Local / GitHub Copilot / Custom)
2. Modell & Endpoint setzen (falls nötig)
3. (Optional) API Key speichern (Custom API)
4. AI Semantic Analyzer aktivieren & Scope + Prompt-Strategie wählen

---
## 6. Einstellungen (Wesentliche Settings Keys)
| Key | Typ | Default | Beschreibung |
|-----|-----|---------|--------------|
| accessibility.fixVerbosity | string | minimal | Ausführlichkeit bei Fix (optional Erklärung) |
| accessibility.aiProvider | string | local | Aktiver Provider (local / github-copilot / custom-api) |
| accessibility.aiAnalyzer.enabled | boolean | false | Aktiviert semantische AI Analyse |
| accessibility.aiAnalyzer.scope | string | visible | Analysebereich (sichtbar / document) |
| accessibility.aiAnalyzer.promptStrategy | string | one-shot | Prompt Strategie Auswahl |
| accessibility.localLLM.endpoint | string | http://127.0.0.1:1234 | Basis-URL lokaler Server |
| accessibility.localLLM.model | string | mistralai/devstral-small-2507 | Local Modell-ID |
| accessibility.githubCopilot.model | string | gpt-4o | Modell für Copilot API |
| accessibility.customAPI.endpoint | string | https://api.openai.com/v1/chat/completions | Custom Endpoint |
| accessibility.customAPI.model | string | gpt-4o-mini | Custom Modell |
| accessibility.customAPI.headers | object | {} | Zusätzliche Header (z.B. Org IDs) |

> API Key für Custom API wird sicher via SecretStorage gespeichert.

---
## 7. Prompt Strategien (Kurzfassung)
| Name | Use Case | Trade-Off |
|------|----------|-----------|
| one-shot | Schnell, wenig Token | Evtl. oberflächlich |
| few-shot | Bessere Mustererkennung | Mehr Tokens, langsamer |
| chain-of-thought | Komplexere Ableitungen | Risiko Halluzinationen / Länger |
| role-based | Multi-Perspektive (AT, Nutzergruppen) | Höhere Antwortlänge |

Fallback: Bei Fehler Rückfall auf Default Strategie.

---
## 8. Unterstützte AI Provider
| Provider | Erkennung | Anforderung |
|----------|-----------|-------------|
| Local LLM | OpenAI kompatibles Chat Completions | Endpoint + Modell |
| GitHub Copilot | VS Code Language Model API | Copilot Extension aktiv & Login |
| Custom API | Beliebige OpenAI-kompatible REST API | Endpoint + Key + Modell |

Gemeinsame Rückgabe wird normalisiert durch `extractTextFromResponse` + Code Extraktion (Entfernung von Markdown-Fences & extrahierter Zeile).

---
## 9. Commands & Webviews
| Command | Zweck |
|---------|-------|
| accessibility-extension.fixWithAI | Quick Fix anwenden |
| accessibility-extension.startAIAnalysis | AI Semantic Analyse starten |
| accessibility-extension.testConnection | Provider Verbindung testen |
| accessibility-extension.openSettings | AI Settings Webview fokussieren |
| accessibility-extension.openDashboard | Metrics Dashboard fokussieren |
| accessibility-extension.codeTutorAnnotate | Code Tutor Annotationen toggeln |
| accessibility-extension.codeTutorClear | Annotationen entfernen |
| accessibility-extension.clearMetrics | Metriken zurücksetzen |

Webviews:
- AI Settings (Provider + Analyzer + Strategy + Code Tutor)
- Metrics Dashboard (Live Kennzahlen)

---
## 10. Metrics & Feedback Loop
Erfasste Kennzahlen (Auszug):
- currentAxeCoreViolations / currentAIAnalyzerViolations / totalCurrentViolations
- detectionAccuracy (basis auf Feedback Correct vs False Positive)
- quickFixSuccessRate (positives vs negatives Feedback)
- Performance: last & avg AI Analysis Time, Quick Fix Zeit

Feedbackfluss:
1. Nach Quick Fix – Dialog (👍 / 👎)
2. Hover bei AI Diagnostic – (✅ / ❌) zur Validierung
3. Speicherung → Metrik Aktualisierung → Dashboard Event → Webview Update

Persistenz: `globalStorage/simple-metrics.json`.

---
## 11. Code Tutor
Nutzt Copilot LM Streaming API → JSON Objekte `{ line, suggestion }` → Inline Decoration (after). Toggle via Settings oder Command. Kein Persistenz-State (flüchtig). Fokus: Lernhinweise zu semantischer Verbesserung.

---
## 12. Testing / CLI
Zwei Suiten:
1. `test/standalone-test-suite.ts` + `standalone-cli.ts` – Rein axe-core / minimal, ohne VS Code Mock.
2. `test/accessibility-test-suite.ts` + `cli.ts` – Kombinierte Messung (axe + AI + Combined, Performance + Improvement).

Aktueller Build-Konflikt: `tsconfig.json` kompiliert nur `src/**/*`, nicht `test/**/*.ts`, daher fehlen `out/test/*.js` → NPM Script `npm test` schlägt fehl. (Siehe Verbesserungen.)

Empfohlene Ausführung (bis Fix):
```
ts-node test/standalone-cli.ts   # oder ts-node/register
```
oder tsconfig anpassen (siehe Roadmap).

---
## 13. Entwicklungs-Setup
Wichtige Scripts:
| Script | Zweck |
|--------|-------|
| npm run compile | TypeScript Build (nur src) |
| npm run watch | Watch Mode |
| npm run lint | ESLint (src + test) |
| npm test | (momentan fehlerhaft – fehlende test/out Artefakte) |

Debug: F5 → Extension Host → Activity Bar Icon „AI Accessibility“.

---
## 14. Qualität & Modularität (Assessment)
| Kriterium | Bewertung | Begründung |
|-----------|-----------|-----------|
| Verständlichkeit | Gut | Klare Servicetrennung, sprechende Namen, Kommentare |
| Minimierung | Mittel | Einige Duplikate (Code Tutor Toggle Listener doppelt, Code Extraktionslogik mehrfach) |
| Modularität | Gut | LLM Provider abstrahiert, Analyzer entkoppelt, Metrics isoliert |
| Testbarkeit | Mittel | Tests vorhanden, aber Build Pipeline integriert sie nicht; AI Teile schwer wegen externer Abhängigkeit |
| Robustheit Parsing | Mittel | JSON Extraktion via Regex, anfällig für komplexe Antworten |
| Fehlerbehandlung | Basis | Meist try/catch + Info Messages; begrenztes Logging-Konzept |
| Internationalisierung | Niedrig | UI/Prompts gemischt Deutsch/Englisch |

Funktionalität: Grundlegende Extension-Aktivierung + axe Diagnostics + Analyzer + Quick Fixes + Webviews sind logisch konsistent; reale Laufzeit hängt von LLM Verfügbarkeit ab. Tests schlagen derzeit wegen Build-Konfiguration fehl.

---
## 15. Bekannte Einschränkungen
- Test-Skripte bauen nicht (tsconfig rootDir = src)
- Kein Rate Limiting / Retry Backoff bei LLM Fehlern
- Fehlende Telemetrie für Prompt Token / Kostenabschätzung
- Parsing der AI Antworten nutzt Regex → empfindlich für Formatabweichungen
- Keine Differenzierung von Regel-Schwere in Metriken (nur Count)
- Farbe-Kontrast Regeln bewusst deaktiviert (JSDOM Limitation) → Hinweis in Doku
- Keine caching / Debounce für wiederholte identische Analysen

---
## 16. Roadmap / Verbesserungen (Vorschläge)
Kurzfristig:
1. tsconfig erweitern: `"include": ["src/**/*", "test/**/*.ts"]` ODER separaten `tsconfig.test.json` + Build-Step anpassen
2. Duplicate Listener entfernen (`code-tutor-enabled` doppelt)
3. Gemeinsame Hilfsfunktion für `extractCodeFromText` & `extractTextFromResponse` extrahieren
4. Robustere JSON Extraktion: Streaming Parser / Versuch komplette JSON Liste zu parsen (statt Regex Splits)
5. Unit Tests für Prompt Strategy Auswahl & Parsing Logik
6. Option: Silent Mode für Feedback popups (nur Status Bar)

Mittelfristig:
7. Token & Latenz Metrics (Prompt Größe, Response Zeit pro Provider)
8. Caching identischer Prompts (Hash über Kontext + Diagnostic)
9. Multi-line Quick Fix Support (Range heuristisch erweitern oder AI diff Format akzeptieren)
10. Konfigurierbare Severity Mapping (Information vs Warning für AI Findings)
11. Internationalisierung (i18n) – durchgängige Sprache / Lokalisierung
12. Telemetrie-Opt-In anonymisiert (Trends, Erfolgsquote)
13. Integration Contrast-Checks serverseitig (Headless Browser) statt JSDOM



---
## 17. Lizenz / Hinweise
Dieses Projekt kann interne oder externe LLMs ansprechen; sicherstellen, dass ggf. sensible Inhalte nicht ungefiltert gesendet werden. Nutzung externer Dienste unterliegt deren Nutzungsbedingungen.

---
## Changelog (Initial)
- v0.0.1: Basisfunktionen (axe, AI Analyzer, Quick Fix, Metrics, Code Tutor, Multi-Provider)

---
## Support / Beiträge
Pull Requests & Issues willkommen: Bitte reproduzierbare Schritte, erwartetes Verhalten & Logs angeben. Für größere Feature-Vorschläge zuerst diskutieren.

---
Viel Erfolg beim Verbessern der Barrierefreiheit! 💙
