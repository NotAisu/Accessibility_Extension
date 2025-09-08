"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsService = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class MetricsService {
    constructor(context) {
        this.context = context;
        this.isEnabled = true;
        this.eventEmitter = new vscode.EventEmitter();
        this.analysisStartTimes = new Map();
        this.quickFixStartTimes = new Map();
        this.onMetricsUpdated = this.eventEmitter.event;
        this.dataFilePath = path.join(context.globalStorageUri.fsPath, 'simple-metrics.json');
        this.initializeMetrics();
        this.loadMetrics();
    }
    static getInstance(context) {
        if (!MetricsService.instance && context) {
            MetricsService.instance = new MetricsService(context);
        }
        return MetricsService.instance;
    }
    initializeMetrics() {
        this.metrics = {
            currentAxeCoreViolations: 0,
            currentAIAnalyzerViolations: 0,
            totalCurrentViolations: 0,
            correctDetections: 0,
            falsePositives: 0,
            detectionAccuracy: 0,
            quickFixesAttempted: 0,
            quickFixesGoodFeedback: 0,
            quickFixesBadFeedback: 0,
            quickFixSuccessRate: 0,
            lastAIAnalysisTimeMs: 0,
            lastQuickFixTimeMs: 0,
            avgAIAnalysisTimeMs: 0,
            avgQuickFixTimeMs: 0,
            aiAnalysisCount: 0,
            aiAnalysisTotalTimeMs: 0,
            quickFixCount: 0,
            quickFixTotalTimeMs: 0,
            sessionStart: Date.now(),
            lastUpdated: Date.now()
        };
    }
    // Grundlegende Methoden für Violation Tracking (Active Document-basiert)
    updateAxeCoreViolations(count) {
        if (!this.isEnabled)
            return;
        // Aktueller Count direkt setzen (nicht akkumulierend)
        this.metrics.currentAxeCoreViolations = count;
        this.updateTotalCurrentViolations();
        this.saveAndNotify();
    }
    updateAIAnalyzerViolations(count) {
        if (!this.isEnabled)
            return;
        // Aktueller Count direkt setzen (nicht akkumulierend) 
        this.metrics.currentAIAnalyzerViolations = count;
        this.updateTotalCurrentViolations();
        this.saveAndNotify();
    }
    // Neue Methode: Update Violations basierend auf allen offenen Dokumenten
    updateCurrentViolationsFromDiagnostics(axeDiagnosticCollection, aiDiagnosticCollection) {
        if (!this.isEnabled)
            return;
        let totalAxeViolations = 0;
        let totalAIViolations = 0;
        // Sammle alle Violations aus allen Dokumenten
        axeDiagnosticCollection.forEach((uri, diagnostics) => {
            totalAxeViolations += diagnostics.length;
        });
        // Sammle AI Violations falls verfügbar
        if (aiDiagnosticCollection) {
            aiDiagnosticCollection.forEach((uri, diagnostics) => {
                totalAIViolations += diagnostics.length;
            });
        }
        // Update Metrics
        const newMetrics = { ...this.metrics };
        newMetrics.currentAxeCoreViolations = totalAxeViolations;
        newMetrics.currentAIAnalyzerViolations = totalAIViolations;
        newMetrics.totalCurrentViolations = newMetrics.currentAxeCoreViolations + newMetrics.currentAIAnalyzerViolations;
        this.metrics = newMetrics;
        this.saveAndNotify();
    }
    recordViolationFeedback(isCorrect) {
        if (!this.isEnabled)
            return;
        if (isCorrect) {
            this.metrics.correctDetections++;
        }
        else {
            this.metrics.falsePositives++;
        }
        this.calculateDetectionAccuracy();
        this.saveAndNotify();
    }
    // QuickFix Tracking
    recordQuickFixAttempt() {
        if (!this.isEnabled)
            return '';
        this.metrics.quickFixesAttempted++;
        const fixId = 'fix_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        this.quickFixStartTimes.set(fixId, performance.now());
        this.saveAndNotify();
        return fixId;
    }
    recordQuickFixFeedback(fixId, feedback) {
        if (!this.isEnabled)
            return;
        if (feedback === 'positive') {
            this.metrics.quickFixesGoodFeedback++;
        }
        else {
            this.metrics.quickFixesBadFeedback++;
        }
        // Performance Zeit berechnen falls verfügbar
        const startTime = this.quickFixStartTimes.get(fixId);
        if (startTime) {
            const duration = performance.now() - startTime;
            this.metrics.lastQuickFixTimeMs = duration;
            this.metrics.quickFixCount++;
            this.metrics.quickFixTotalTimeMs += duration;
            this.updateAvgQuickFixTime();
            this.quickFixStartTimes.delete(fixId);
        }
        this.calculateQuickFixSuccessRate();
        this.saveAndNotify();
    }
    // AI Analysis Performance Tracking
    startAIAnalysis() {
        if (!this.isEnabled)
            return '';
        const analysisId = 'analysis_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        this.analysisStartTimes.set(analysisId, performance.now());
        return analysisId;
    }
    endAIAnalysis(analysisId) {
        if (!this.isEnabled)
            return;
        const startTime = this.analysisStartTimes.get(analysisId);
        if (startTime) {
            const duration = performance.now() - startTime;
            this.metrics.lastAIAnalysisTimeMs = duration;
            this.metrics.aiAnalysisCount++;
            this.metrics.aiAnalysisTotalTimeMs += duration;
            this.updateAvgAIAnalysisTime();
            this.analysisStartTimes.delete(analysisId);
            this.saveAndNotify();
        }
    }
    // Berechnungen
    updateTotalCurrentViolations() {
        this.metrics.totalCurrentViolations = this.metrics.currentAxeCoreViolations + this.metrics.currentAIAnalyzerViolations;
    }
    calculateDetectionAccuracy() {
        const total = this.metrics.correctDetections + this.metrics.falsePositives;
        this.metrics.detectionAccuracy = total > 0 ? (this.metrics.correctDetections / total) * 100 : 0;
    }
    calculateQuickFixSuccessRate() {
        const total = this.metrics.quickFixesGoodFeedback + this.metrics.quickFixesBadFeedback;
        this.metrics.quickFixSuccessRate = total > 0 ? (this.metrics.quickFixesGoodFeedback / total) * 100 : 0;
    }
    updateAvgAIAnalysisTime() {
        if (this.metrics.aiAnalysisCount > 0) {
            this.metrics.avgAIAnalysisTimeMs = this.metrics.aiAnalysisTotalTimeMs / this.metrics.aiAnalysisCount;
        }
    }
    updateAvgQuickFixTime() {
        if (this.metrics.quickFixCount > 0) {
            this.metrics.avgQuickFixTimeMs = this.metrics.quickFixTotalTimeMs / this.metrics.quickFixCount;
        }
    }
    // Getter für Dashboard
    getSimpleMetrics() {
        return { ...this.metrics };
    }
    getDashboardData() {
        return this.getSimpleMetrics();
    }
    // Persistence
    async loadMetrics() {
        try {
            if (!fs.existsSync(this.context.globalStorageUri.fsPath)) {
                await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
            }
            if (fs.existsSync(this.dataFilePath)) {
                const data = await vscode.workspace.fs.readFile(vscode.Uri.file(this.dataFilePath));
                const loaded = JSON.parse(Buffer.from(data).toString());
                // Backward-Kompatibilität für alte Property-Namen
                if (loaded.axeCoreViolations !== undefined) {
                    loaded.currentAxeCoreViolations = loaded.axeCoreViolations;
                    delete loaded.axeCoreViolations;
                }
                if (loaded.aiAnalyzerViolations !== undefined) {
                    loaded.currentAIAnalyzerViolations = loaded.aiAnalyzerViolations;
                    delete loaded.aiAnalyzerViolations;
                }
                if (loaded.totalViolations !== undefined) {
                    loaded.totalCurrentViolations = loaded.totalViolations;
                    // totalViolationsDetected auf totalViolations setzen wenn nicht vorhanden
                    if (loaded.totalViolationsDetected === undefined) {
                        loaded.totalViolationsDetected = loaded.totalViolations;
                    }
                    delete loaded.totalViolations;
                }
                // Merge with defaults für Kompatibilität
                this.metrics = { ...this.metrics, ...loaded };
            }
        }
        catch (error) {
            console.error('Failed to load metrics:', error);
        }
    }
    async saveMetrics() {
        try {
            this.metrics.lastUpdated = Date.now();
            await vscode.workspace.fs.writeFile(vscode.Uri.file(this.dataFilePath), new TextEncoder().encode(JSON.stringify(this.metrics, null, 2)));
        }
        catch (error) {
            console.error('Failed to save metrics:', error);
        }
    }
    async saveAndNotify() {
        await this.saveMetrics();
        this.eventEmitter.fire();
    }
    // Utility Methoden
    clearData() {
        this.initializeMetrics();
        this.saveAndNotify();
        console.log('📊 Metrics data cleared');
    }
    clearDataAndRefresh(axeDiagnosticCollection, aiDiagnosticCollection) {
        this.initializeMetrics();
        // Lade aktuelle Violations aus DiagnosticCollections neu
        if (axeDiagnosticCollection && aiDiagnosticCollection) {
            this.updateCurrentViolationsFromDiagnostics(axeDiagnosticCollection, aiDiagnosticCollection);
        }
        this.saveAndNotify();
    }
    setEnabled(enabled) {
        this.isEnabled = enabled;
        const config = vscode.workspace.getConfiguration('accessibility');
        config.update('metrics.enabled', enabled, vscode.ConfigurationTarget.Global);
        console.log(`📊 Metrics tracking ${enabled ? 'enabled' : 'disabled'}`);
    }
    getEnabled() {
        return this.isEnabled;
    }
    // Kompatibilität mit bestehendem Code
    recordViolation(source, ruleId, severity) {
        return `violation_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    }
    dispose() {
        this.eventEmitter.dispose();
        console.log('📊 MetricsService disposed');
    }
}
exports.MetricsService = MetricsService;
//# sourceMappingURL=metrics-service.js.map