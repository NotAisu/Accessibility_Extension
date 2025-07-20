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
exports.AnalysisRequestManager = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Manages AI analysis requests with debouncing and cancellation support
 */
class AnalysisRequestManager {
    constructor(debounceMs = 2000) {
        this.debounceMs = debounceMs;
        this.pendingRequests = new Map();
        this.providerState = {
            isLocked: false,
            connectionStatus: 'unknown'
        };
        this.onStateChangeEmitter = new vscode.EventEmitter();
        this.onStateChange = this.onStateChangeEmitter.event;
    }
    /**
     * Schedules an analysis request with debouncing
     */
    scheduleAnalysis(document, analysisFunction) {
        const documentId = document.uri.toString();
        // Cancel existing timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        // Cancel any pending request for this document
        this.cancelPendingRequest(documentId);
        // Set new debounced timer
        this.debounceTimer = setTimeout(async () => {
            if (this.providerState.isLocked) {
                console.log('Provider is locked, skipping analysis');
                return;
            }
            const cancellationSource = new vscode.CancellationTokenSource();
            const request = {
                id: `${documentId}-${Date.now()}`,
                document,
                timestamp: Date.now(),
                cancellationToken: cancellationSource.token
            };
            this.pendingRequests.set(documentId, request);
            try {
                await analysisFunction(document, request.cancellationToken);
            }
            catch (error) {
                if (!request.cancellationToken.isCancellationRequested) {
                    console.error('Analysis request failed:', error);
                }
            }
            finally {
                this.pendingRequests.delete(documentId);
                cancellationSource.dispose();
            }
        }, this.debounceMs);
    }
    /**
     * Cancels a pending request for a specific document
     */
    cancelPendingRequest(documentId) {
        const request = this.pendingRequests.get(documentId);
        if (request) {
            // Signal cancellation but don't dispose the source yet
            // The analysis function should check isCancellationRequested
            this.pendingRequests.delete(documentId);
        }
    }
    /**
     * Cancels all pending requests
     */
    cancelAllRequests() {
        for (const [documentId] of this.pendingRequests) {
            this.cancelPendingRequest(documentId);
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
    }
    /**
     * Locks the provider during active operations
     */
    lockProvider(operation) {
        this.providerState.isLocked = true;
        this.providerState.currentOperation = operation;
        this.onStateChangeEmitter.fire(this.providerState);
    }
    /**
     * Unlocks the provider after operations complete
     */
    unlockProvider() {
        this.providerState.isLocked = false;
        this.providerState.currentOperation = undefined;
        this.onStateChangeEmitter.fire(this.providerState);
    }
    /**
     * Updates connection status
     */
    updateConnectionStatus(status) {
        this.providerState.connectionStatus = status;
        this.providerState.lastConnectionTest = new Date();
        this.onStateChangeEmitter.fire(this.providerState);
    }
    /**
     * Gets current provider state
     */
    getProviderState() {
        return { ...this.providerState };
    }
    /**
     * Checks if provider is available for operations
     */
    isProviderAvailable() {
        return !this.providerState.isLocked;
    }
    /**
     * Updates debounce delay
     */
    setDebounceDelay(ms) {
        this.debounceMs = ms;
    }
    /**
     * Cleanup
     */
    dispose() {
        this.cancelAllRequests();
        this.onStateChangeEmitter.dispose();
    }
}
exports.AnalysisRequestManager = AnalysisRequestManager;
//# sourceMappingURL=analysis-request-manager.js.map