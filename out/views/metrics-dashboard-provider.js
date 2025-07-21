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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsDashboardProvider = void 0;
const vscode = __importStar(require("vscode"));
class MetricsDashboardProvider {
    constructor(_extensionUri, metricsService) {
        this._extensionUri = _extensionUri;
        this.metricsService = metricsService;
        this.disposables = [];
        // Listen for metrics updates
        this.disposables.push(this.metricsService.onMetricsUpdated(() => {
            this.updateDashboard();
        }));
    }
    setDiagnosticCollections(axeDiagnosticCollection, aiDiagnosticCollection) {
        this.axeDiagnosticCollection = axeDiagnosticCollection;
        this.aiDiagnosticCollection = aiDiagnosticCollection;
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview();
        // Message Handler
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'clearData':
                    await this.handleClearData();
                    break;
                case 'toggleMetrics':
                    this.handleToggleMetrics(data.enabled);
                    break;
            }
        });
        // Send initial data
        setTimeout(() => {
            this.updateDashboard();
        }, 100);
    }
    async handleClearData() {
        const result = await vscode.window.showWarningMessage('Are you sure you want to clear all metrics data? This action cannot be undone.', { modal: true }, 'Clear Data', 'Cancel');
        if (result === 'Clear Data') {
            // Verwende clearDataAndRefresh wenn DiagnosticCollections verfügbar sind
            if (this.axeDiagnosticCollection && this.aiDiagnosticCollection) {
                this.metricsService.clearDataAndRefresh(this.axeDiagnosticCollection, this.aiDiagnosticCollection);
            }
            else {
                this.metricsService.clearData();
            }
            vscode.window.showInformationMessage('✅ Metrics data cleared successfully.');
            this.updateDashboard();
        }
    }
    handleToggleMetrics(enabled) {
        this.metricsService.setEnabled(enabled);
        vscode.window.showInformationMessage(`📊 Metrics tracking ${enabled ? 'enabled' : 'disabled'}.`);
        this.updateDashboard();
    }
    updateDashboard() {
        if (!this._view)
            return;
        try {
            const metrics = this.metricsService.getDashboardData();
            const enabled = this.metricsService.getEnabled();
            this.sendMessage({
                type: 'updateData',
                data: metrics,
                enabled: enabled
            });
        }
        catch (error) {
            console.error('Error updating dashboard:', error);
        }
    }
    sendMessage(message) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }
    _getHtmlForWebview() {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Accessibility Metrics</title>
            <style>
                body {
                    padding: 0;
                    margin: 0;
                    font-family: var(--vscode-font-family);
                    background: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    font-size: 13px;
                }

                .metrics-container {
                    padding: 16px;
                }

                .header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 16px;
                    padding-bottom: 12px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }

                .header-left {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .header h2 {
                    margin: 0;
                    font-size: 16px;
                    font-weight: 600;
                    color: var(--vscode-foreground);
                }

                .status-indicator {
                    display: flex;
                    align-items: center;
                    font-size: 12px;
                }

                .status-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    margin-right: 6px;
                }

                .status-enabled {
                    background-color: #22c55e;
                }

                .status-disabled {
                    background-color: #ef4444;
                }

                .header-actions {
                    display: flex;
                    gap: 8px;
                }

                .metrics-section {
                    margin-bottom: 16px;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    background: var(--vscode-sideBar-background);
                    overflow: hidden;
                }

                .section-header {
                    padding: 12px 16px;
                    background: var(--vscode-tab-inactiveBackground);
                    border-bottom: 1px solid var(--vscode-panel-border);
                    font-weight: 600;
                    font-size: 14px;
                    margin: 0;
                }

                .metrics-table {
                    width: 100%;
                    border-collapse: collapse;
                }

                .metrics-table td {
                    padding: 10px 16px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    line-height: 1.4;
                }

                .metrics-table tr:last-child td {
                    border-bottom: none;
                }

                .metrics-table td:first-child {
                    font-weight: 500;
                    color: var(--vscode-foreground);
                }

                .metrics-table td:last-child {
                    text-align: right;
                    font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Consolas', monospace;
                    font-weight: 600;
                    color: var(--vscode-charts-blue);
                }

                .actions-section {
                    margin-top: 20px;
                    padding-top: 16px;
                    border-top: 1px solid var(--vscode-panel-border);
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                }

                .btn {
                    padding: 6px 12px;
                    font-size: 12px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 3px;
                    cursor: pointer;
                    transition: background-color 0.2s;
                    font-family: var(--vscode-font-family);
                }

                .btn:hover {
                    background: var(--vscode-button-hoverBackground);
                }

                .btn-secondary {
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }

                .btn-secondary:hover {
                    background: var(--vscode-button-secondaryHoverBackground);
                }

                .empty-state {
                    text-align: center;
                    padding: 40px 20px;
                    color: var(--vscode-descriptionForeground);
                }

                .loading {
                    text-align: center;
                    padding: 20px;
                    color: var(--vscode-descriptionForeground);
                }
            </style>
        </head>
        <body>
            <div class="metrics-container">
                <div class="header">
                    <div class="header-left">
                        <h2>📊 Accessibility Metrics</h2>
                        <div class="status-indicator">
                            <div class="status-dot" id="status-dot"></div>
                            <span id="status-text">Loading...</span>
                        </div>
                    </div>
                    <div class="header-actions">
                        <button class="btn btn-secondary" onclick="toggleMetrics()" id="toggle-btn">⏸️ Disable</button>
                    </div>
                </div>
                
                <div id="content">
                    <div class="loading">Loading metrics data...</div>
                </div>

                <div class="actions-section">
                    <button class="btn btn-secondary" onclick="clearMetrics()">🗑️ Clear Data</button>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let isTrackingEnabled = true;

                window.addEventListener('message', event => {
                    const message = event.data;
                    
                    switch (message.type) {
                        case 'updateData':
                            updateMetricsDisplay(message.data, message.enabled);
                            updateStatus(message.enabled);
                            break;
                    }
                });

                function updateMetricsDisplay(metrics, enabled) {
                    isTrackingEnabled = enabled;
                    
                    if (!metrics) {
                        document.getElementById('content').innerHTML = '<div class="empty-state">No metrics data available</div>';
                        return;
                    }

                    const html = \`
                        <div class="metrics-section">
                            <h3 class="section-header">📊 Violation Detection</h3>
                            <table class="metrics-table">
                                <tr><td>Axe Core Violations</td><td>\${metrics.currentAxeCoreViolations || 0}</td></tr>
                                <tr><td>AI Analyzer Violations</td><td>\${metrics.currentAIAnalyzerViolations || 0}</td></tr>
                                <tr><td>Total Current Violations</td><td>\${metrics.totalCurrentViolations || 0}</td></tr>
                              
                            </table>
                        </div>

                        <div class="metrics-section">
                            <h3 class="section-header">🎯 Detection Accuracy</h3>
                            <table class="metrics-table">
                                <tr><td>Correct Detections</td><td>\${metrics.correctDetections || 0}</td></tr>
                                <tr><td>False Positives</td><td>\${metrics.falsePositives || 0}</td></tr>
                                <tr><td>Detection Accuracy</td><td>\${(metrics.detectionAccuracy || 0).toFixed(1)}%</td></tr>
                            </table>
                        </div>

                        <div class="metrics-section">
                            <h3 class="section-header">🔧 Quick Fix Performance</h3>
                            <table class="metrics-table">
                                <tr><td>Quick Fixes Attempted</td><td>\${metrics.quickFixesAttempted || 0}</td></tr>
                                <tr><td>Good Feedback</td><td>\${metrics.quickFixesGoodFeedback || 0}</td></tr>
                                <tr><td>Bad Feedback</td><td>\${metrics.quickFixesBadFeedback || 0}</td></tr>
                                <tr><td>Success Rate</td><td>\${(metrics.quickFixSuccessRate || 0).toFixed(1)}%</td></tr>
                            </table>
                        </div>

                        <div class="metrics-section">
                            <h3 class="section-header">⏱️ Performance Times</h3>
                            <table class="metrics-table">
                                <tr><td>Last AI Analysis</td><td>\${formatTime(metrics.lastAIAnalysisTimeMs)}</td></tr>
                                <tr><td>Average AI Analysis</td><td>\${formatTime(metrics.avgAIAnalysisTimeMs)}</td></tr>
                                <tr><td>Last Quick Fix</td><td>\${formatTime(metrics.lastQuickFixTimeMs)}</td></tr>
                                <tr><td>Average Quick Fix</td><td>\${formatTime(metrics.avgQuickFixTimeMs)}</td></tr>
                            </table>
                        </div>
                    \`;

                    document.getElementById('content').innerHTML = html;
                }

                function updateStatus(enabled) {
                    const statusDot = document.getElementById('status-dot');
                    const statusText = document.getElementById('status-text');
                    const toggleBtn = document.getElementById('toggle-btn');
                    
                    if (enabled) {
                        statusDot.className = 'status-dot status-enabled';
                        statusText.textContent = 'Tracking Enabled';
                        toggleBtn.textContent = '⏸️ Disable';
                    } else {
                        statusDot.className = 'status-dot status-disabled';
                        statusText.textContent = 'Tracking Disabled';
                        toggleBtn.textContent = '▶️ Enable';
                    }
                }

                function formatTime(ms) {
                    if (!ms || ms === 0) return '-';
                    if (ms < 1000) return Math.round(ms) + 'ms';
                    return (ms / 1000).toFixed(1) + 's';
                }

                function clearMetrics() {
                    vscode.postMessage({ type: 'clearData' });
                }

                function toggleMetrics() {
                    vscode.postMessage({ type: 'toggleMetrics', enabled: !isTrackingEnabled });
                }

                // Request initial data
                setTimeout(() => {
                    vscode.postMessage({ type: 'refreshData' });
                }, 100);
            </script>
        </body>
        </html>`;
    }
    dispose() {
        this.disposables.forEach(d => d.dispose());
    }
}
exports.MetricsDashboardProvider = MetricsDashboardProvider;
MetricsDashboardProvider.viewType = 'accessibilityMetricsDashboard';
//# sourceMappingURL=metrics-dashboard-provider.js.map