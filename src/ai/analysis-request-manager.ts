import * as vscode from 'vscode';

export interface AnalysisRequest {
    id: string;
    document: vscode.TextDocument;
    timestamp: number;
    cancellationToken: vscode.CancellationToken;
}

export interface ProviderState {
    isLocked: boolean;
    currentOperation?: string;
    lastConnectionTest?: Date;
    connectionStatus: 'connected' | 'error' | 'testing' | 'unknown';
}

/**
 * Manages AI analysis requests with debouncing and cancellation support
 */
export class AnalysisRequestManager {
    private pendingRequests: Map<string, AnalysisRequest> = new Map();
    private debounceTimer: NodeJS.Timeout | undefined;
    private providerState: ProviderState = {
        isLocked: false,
        connectionStatus: 'unknown'
    };
    private onStateChangeEmitter = new vscode.EventEmitter<ProviderState>();
    
    public readonly onStateChange = this.onStateChangeEmitter.event;
    
    constructor(private debounceMs: number = 2000) {}

    /**
     * Schedules an analysis request with debouncing
     */
    public scheduleAnalysis(
        document: vscode.TextDocument,
        analysisFunction: (doc: vscode.TextDocument, token: vscode.CancellationToken) => Promise<void>
    ): void {
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
            const request: AnalysisRequest = {
                id: `${documentId}-${Date.now()}`,
                document,
                timestamp: Date.now(),
                cancellationToken: cancellationSource.token
            };
            
            this.pendingRequests.set(documentId, request);
            
            try {
                await analysisFunction(document, request.cancellationToken);
            } catch (error) {
                if (!request.cancellationToken.isCancellationRequested) {
                    console.error('Analysis request failed:', error);
                }
            } finally {
                this.pendingRequests.delete(documentId);
                cancellationSource.dispose();
            }
        }, this.debounceMs);
    }

    /**
     * Cancels a pending request for a specific document
     */
    public cancelPendingRequest(documentId: string): void {
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
    public cancelAllRequests(): void {
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
    public lockProvider(operation: string): void {
        this.providerState.isLocked = true;
        this.providerState.currentOperation = operation;
        this.onStateChangeEmitter.fire(this.providerState);
    }

    /**
     * Unlocks the provider after operations complete
     */
    public unlockProvider(): void {
        this.providerState.isLocked = false;
        this.providerState.currentOperation = undefined;
        this.onStateChangeEmitter.fire(this.providerState);
    }

    /**
     * Updates connection status
     */
    public updateConnectionStatus(status: ProviderState['connectionStatus']): void {
        this.providerState.connectionStatus = status;
        this.providerState.lastConnectionTest = new Date();
        this.onStateChangeEmitter.fire(this.providerState);
    }

    /**
     * Gets current provider state
     */
    public getProviderState(): ProviderState {
        return { ...this.providerState };
    }

    /**
     * Checks if provider is available for operations
     */
    public isProviderAvailable(): boolean {
        return !this.providerState.isLocked;
    }

    /**
     * Updates debounce delay
     */
    public setDebounceDelay(ms: number): void {
        this.debounceMs = ms;
    }

    /**
     * Cleanup
     */
    public dispose(): void {
        this.cancelAllRequests();
        this.onStateChangeEmitter.dispose();
    }
}
