import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type FeedbackType = 'positive' | 'negative';


export interface SimpleMetrics {
   
    currentAxeCoreViolations: number;
    currentAIAnalyzerViolations: number; 
    totalCurrentViolations: number;
    
 
    correctDetections: number;
    falsePositives: number;
    detectionAccuracy: number; 
    
   
    quickFixesAttempted: number;
    quickFixesGoodFeedback: number;
    quickFixesBadFeedback: number;
    quickFixSuccessRate: number;
    
   
    lastAIAnalysisTimeMs: number;
    lastQuickFixTimeMs: number;
    avgAIAnalysisTimeMs: number;
    avgQuickFixTimeMs: number;
    
    
    sessionStart: number;
    lastUpdated: number;
}

export class MetricsService {
    private static instance: MetricsService;
    private metrics!: SimpleMetrics;
    private isEnabled: boolean = true;
    private dataFilePath: string;
    private eventEmitter = new vscode.EventEmitter<void>();
    private analysisStartTimes: Map<string, number> = new Map();
    private quickFixStartTimes: Map<string, number> = new Map();

    public readonly onMetricsUpdated = this.eventEmitter.event;

    private constructor(private context: vscode.ExtensionContext) {
        this.dataFilePath = path.join(context.globalStorageUri.fsPath, 'simple-metrics.json');
        this.initializeMetrics();
        this.loadMetrics();
    }

    public static getInstance(context?: vscode.ExtensionContext): MetricsService {
        if (!MetricsService.instance && context) {
            MetricsService.instance = new MetricsService(context);
        }
        return MetricsService.instance;
    }

    private initializeMetrics(): void {
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
            sessionStart: Date.now(),
            lastUpdated: Date.now()
        };
    }

    // Grundlegende Methoden für Violation Tracking (Active Document-basiert)
    public updateAxeCoreViolations(count: number): void {
        if (!this.isEnabled) return;
        
        // Aktueller Count direkt setzen (nicht akkumulierend)
        this.metrics.currentAxeCoreViolations = count;
        this.updateTotalCurrentViolations();
        this.saveAndNotify();
    }

    public updateAIAnalyzerViolations(count: number): void {
        if (!this.isEnabled) return;
        
        // Aktueller Count direkt setzen (nicht akkumulierend) 
        this.metrics.currentAIAnalyzerViolations = count;
        this.updateTotalCurrentViolations();
        this.saveAndNotify();
    }

    // Neue Methode: Update Violations basierend auf allen offenen Dokumenten
    public updateCurrentViolationsFromDiagnostics(
        axeDiagnosticCollection: vscode.DiagnosticCollection,
        aiDiagnosticCollection: vscode.DiagnosticCollection
    ): void {
        if (!this.isEnabled) return;

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

    public recordViolationFeedback(isCorrect: boolean): void {
        if (!this.isEnabled) return;
        
        if (isCorrect) {
            this.metrics.correctDetections++;
        } else {
            this.metrics.falsePositives++;
        }
        this.calculateDetectionAccuracy();
        this.saveAndNotify();
    }

    // QuickFix Tracking
    public recordQuickFixAttempt(): string {
        if (!this.isEnabled) return '';
        
        this.metrics.quickFixesAttempted++;
        const fixId = 'fix_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        this.quickFixStartTimes.set(fixId, performance.now());
        this.saveAndNotify();
        return fixId;
    }

    public recordQuickFixFeedback(fixId: string, feedback: 'positive' | 'negative'): void {
        if (!this.isEnabled) return;

        if (feedback === 'positive') {
            this.metrics.quickFixesGoodFeedback++;
        } else {
            this.metrics.quickFixesBadFeedback++;
        }
        
        // Performance Zeit berechnen falls verfügbar
        const startTime = this.quickFixStartTimes.get(fixId);
        if (startTime) {
            const duration = performance.now() - startTime;
            this.metrics.lastQuickFixTimeMs = duration;
            this.updateAvgQuickFixTime(duration);
            this.quickFixStartTimes.delete(fixId);
        }
        
        this.calculateQuickFixSuccessRate();
        this.saveAndNotify();
    }

    // AI Analysis Performance Tracking
    public startAIAnalysis(): string {
        if (!this.isEnabled) return '';
        
        const analysisId = 'analysis_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        this.analysisStartTimes.set(analysisId, performance.now());
        return analysisId;
    }

    public endAIAnalysis(analysisId: string): void {
        if (!this.isEnabled) return;

        const startTime = this.analysisStartTimes.get(analysisId);
        if (startTime) {
            const duration = performance.now() - startTime;
            this.metrics.lastAIAnalysisTimeMs = duration;
            this.updateAvgAIAnalysisTime(duration);
            this.analysisStartTimes.delete(analysisId);
            this.saveAndNotify();
        }
    }

    // Berechnungen
    private updateTotalCurrentViolations(): void {
        this.metrics.totalCurrentViolations = this.metrics.currentAxeCoreViolations + this.metrics.currentAIAnalyzerViolations;
    }

    private calculateDetectionAccuracy(): void {
        const total = this.metrics.correctDetections + this.metrics.falsePositives;
        this.metrics.detectionAccuracy = total > 0 ? (this.metrics.correctDetections / total) * 100 : 0;
    }

    private calculateQuickFixSuccessRate(): void {
        const total = this.metrics.quickFixesGoodFeedback + this.metrics.quickFixesBadFeedback;
        this.metrics.quickFixSuccessRate = total > 0 ? (this.metrics.quickFixesGoodFeedback / total) * 100 : 0;
    }

    private updateAvgAIAnalysisTime(newTime: number): void {
        if (this.metrics.avgAIAnalysisTimeMs === 0) {
            this.metrics.avgAIAnalysisTimeMs = newTime;
        } else {
            this.metrics.avgAIAnalysisTimeMs = (this.metrics.avgAIAnalysisTimeMs + newTime) / 2;
        }
    }

    private updateAvgQuickFixTime(newTime: number): void {
        if (this.metrics.avgQuickFixTimeMs === 0) {
            this.metrics.avgQuickFixTimeMs = newTime;
        } else {
            this.metrics.avgQuickFixTimeMs = (this.metrics.avgQuickFixTimeMs + newTime) / 2;
        }
    }

    // Getter für Dashboard
    public getSimpleMetrics(): SimpleMetrics {
        return { ...this.metrics };
    }

    public getDashboardData(): SimpleMetrics {
        return this.getSimpleMetrics();
    }

    // Persistence
    private async loadMetrics(): Promise<void> {
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
        } catch (error) {
            console.error('Failed to load metrics:', error);
        }
    }

    private async saveMetrics(): Promise<void> {
        try {
            this.metrics.lastUpdated = Date.now();
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(this.dataFilePath),
                Buffer.from(JSON.stringify(this.metrics, null, 2))
            );
        } catch (error) {
            console.error('Failed to save metrics:', error);
        }
    }

    private async saveAndNotify(): Promise<void> {
        await this.saveMetrics();
        this.eventEmitter.fire();
    }

    // Utility Methoden
    public clearData(): void {
        this.initializeMetrics();
        this.saveAndNotify();
        console.log('📊 Metrics data cleared');
    }

    public clearDataAndRefresh(
        axeDiagnosticCollection?: vscode.DiagnosticCollection,
        aiDiagnosticCollection?: vscode.DiagnosticCollection
    ): void {
        this.initializeMetrics();
        
        // Lade aktuelle Violations aus DiagnosticCollections neu
        if (axeDiagnosticCollection && aiDiagnosticCollection) {
            this.updateCurrentViolationsFromDiagnostics(axeDiagnosticCollection, aiDiagnosticCollection);
        }
        
        this.saveAndNotify();
        
    }

    public setEnabled(enabled: boolean): void {
        this.isEnabled = enabled;
        const config = vscode.workspace.getConfiguration('accessibility');
        config.update('metrics.enabled', enabled, vscode.ConfigurationTarget.Global);
        console.log(`📊 Metrics tracking ${enabled ? 'enabled' : 'disabled'}`);
    }

    public getEnabled(): boolean {
        return this.isEnabled;
    }

    // Kompatibilität mit bestehendem Code
   public recordViolation(
        source: 'ai-analyzer' | 'axe-core',
        ruleId?: string,
        severity?: string
    ): string {
        return `violation_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    }
  

    public dispose(): void {
        this.eventEmitter.dispose();
        console.log('📊 MetricsService disposed');
    }
}
