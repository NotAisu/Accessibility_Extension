import * as vscode from 'vscode';

// Type interfaces for LLM responses
interface LLMMessage {
    content?: string;
    role?: string;
}

interface LLMChoice {
    message?: LLMMessage;
    text?: string;
    content?: string;
    delta?: { content?: string };
}

interface LLMResponse {
    choices?: LLMChoice[];
    message?: LLMMessage;
    text?: string;
    content?: string;
    answer?: string;
    response?: string;
    result?: string;
    output?: string;
    completion?: string;
    generated_text?: string;
    [key: string]: unknown; // Index signature for dynamic properties
}

export interface LLMProvider {
    name: string;
    isConfigured(): Promise<boolean>;
    testConnection(): Promise<boolean>;
    getAccessibilityFix(prompt: string): Promise<string>;
    getAvailableModels?(): Promise<string[]>;
}

export class LLMService {
    private providers: Map<string, LLMProvider> = new Map();
    // Simple in-memory cache (prompt -> result)
    private cache: Map<string, { value: string; ts: number }> = new Map();
    private readonly CACHE_TTL_MS = 1000 * 60 * 2; // 2 Minuten sinnvoll ohne Overengineering
    
    constructor() {
        this.providers.set('local', new LocalLLMProvider());
        this.providers.set('github-copilot', new GitHubCopilotProvider());
    }
    
    public async getCurrentProvider(): Promise<LLMProvider> {
        const config = vscode.workspace.getConfiguration('accessibility');
        const providerName = config.get<string>('aiProvider', 'local');
        const provider = this.providers.get(providerName);
        
        if (!provider) {
            throw new Error(`Unknown provider: ${providerName}`);
        }
        
        return provider;
    }
    
    public async getAccessibilityFix(prompt: string): Promise<string> {
        const provider = await this.getCurrentProvider();
        
        if (!(await provider.isConfigured())) {
            throw new Error(`${provider.name} is not properly configured. Please check your settings.`);
        }

    // Cache check (only if prompt is not empty)
        const cacheKey = 'fix:' + prompt;
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const result = await provider.getAccessibilityFix(prompt);
            this.storeInCache(cacheKey, result);
            return result;
        } catch (error) {
            console.error(`LLM Provider ${provider.name} failed:`, error);
            
            // Try fallback strategies
            const fallbackResult = await this.tryFallbackStrategies(prompt, provider.name);
            if (fallbackResult) {
                this.storeInCache(cacheKey, fallbackResult);
                return fallbackResult;
            }
            
            throw error;
        }
    }

    // Separate method for AI analysis 
    public async getAIAnalysis(prompt: string): Promise<string> {
        const provider = await this.getCurrentProvider();
        
        if (!(await provider.isConfigured())) {
            throw new Error(`${provider.name} is not properly configured. Please check your settings.`);
        }

        const cacheKey = 'analysis:' + prompt;
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const result = await provider.getAccessibilityFix(prompt);
            this.storeInCache(cacheKey, result);
            return result;
        } catch (error) {
            console.error(`AI Analysis failed with ${provider.name}:`, error);
            
            // Try fallback for analysis
            const fallbackResult = await this.tryFallbackStrategies(prompt, provider.name);
            if (fallbackResult) {
                this.storeInCache(cacheKey, fallbackResult);
                return fallbackResult;
            }
            
            throw error;
        }
    }

    // --- Simple cache helpers ---
    private getFromCache(key: string): string | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;
        if (Date.now() - entry.ts > this.CACHE_TTL_MS) {
            this.cache.delete(key);
            return undefined;
        }
        return entry.value;
    }

    private storeInCache(key: string, value: string): void {
        this.cache.set(key, { value, ts: Date.now() });
    // Small LRU-style pruning (hard limit 50 entries)
        if (this.cache.size > 50) {
            const oldestKey = [...this.cache.entries()].sort((a,b)=>a[1].ts - b[1].ts)[0][0];
            this.cache.delete(oldestKey);
        }
    }

    /**
     * Tries fallback strategies when primary provider fails
     */
    private async tryFallbackStrategies(prompt: string, failedProvider: string): Promise<string | null> {
        const availableProviders = this.getAvailableProviders().filter(p => p !== failedProvider);
        
        for (const providerName of availableProviders) {
            try {
                console.log(`Trying fallback provider: ${providerName}`);
                const fallbackProvider = this.providers.get(providerName);
                
                if (fallbackProvider && await fallbackProvider.isConfigured()) {
                    const result = await fallbackProvider.getAccessibilityFix(prompt);
                    console.log(`Fallback successful with ${providerName}`);
                    return result;
                }
            } catch (fallbackError) {
                console.warn(`Fallback provider ${providerName} also failed:`, fallbackError);
                continue;
            }
        }
        
        // If all providers fail, try basic rule-based fallback
        return this.generateBasicFallback(prompt);
    }

    /**
     * Generates a basic rule-based fix when all LLM providers fail
     */
    private generateBasicFallback(prompt: string): string | null {
        const basicRules = {
            'missing alt': 'Add alt attribute: alt="Descriptive text"',
            'missing label': 'Add label: <label for="id">Label text</label>',
            'div role="button"': 'Use semantic button: <button>Button text</button>',
            'color contrast': 'Increase color contrast to meet WCAG AA standards',
            'heading hierarchy': 'Use proper heading hierarchy (h1→h2→h3)',
            'missing aria-label': 'Add aria-label="Descriptive text"'
        };

        const lowerPrompt = prompt.toLowerCase();
        for (const [pattern, fix] of Object.entries(basicRules)) {
            if (lowerPrompt.includes(pattern)) {
                console.log(`Using basic rule-based fallback for: ${pattern}`);
                return fix;
            }
        }
        
        return null;
    }

    public async testConnection(): Promise<boolean> {
        try {
            const provider = await this.getCurrentProvider();
            return await provider.testConnection();
        } catch (error) {
            console.error('Connection test failed:', error);
            return false;
        }
    }
    
    public getAvailableProviders(): string[] {
        return Array.from(this.providers.keys());
    }

    public async getAvailableModels(): Promise<string[]> {
        try {
            const provider = await this.getCurrentProvider();
            if (provider.getAvailableModels) {
                return await provider.getAvailableModels();
            }
            return [];
        } catch (error) {
            console.error('Failed to get available models:', error);
            return [];
        }
    }
}

class LocalLLMProvider implements LLMProvider {
    name = 'Local LLM';
    
    async isConfigured(): Promise<boolean> {
        const config = vscode.workspace.getConfiguration('accessibility');
        const endpoint = config.get<string>('localLLM.endpoint', '');
        const model = config.get<string>('localLLM.model', '');
        return !!endpoint && !!model;
    }
    
    async testConnection(): Promise<boolean> {
        try {
            const config = vscode.workspace.getConfiguration('accessibility');
            const endpoint = config.get<string>('localLLM.endpoint', '') + '/v1/models';
            
            const response = await fetch(endpoint, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    async getAccessibilityFix(prompt: string): Promise<string> {
        const config = vscode.workspace.getConfiguration('accessibility');
        const endpoint = config.get<string>('localLLM.endpoint', '') + '/v1/chat/completions';
        const model = config.get<string>('localLLM.model', '');
        
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: model,
                    messages: [
                        {
                            role: "system",
                            content: "You are an expert WCAG 2.2 AA accessibility consultant. When fixing code:\n\n1. ONLY return the corrected line of code, no explanations or markdown\n2. Maintain all existing styling, classes, and IDs\n3. Preserve functionality while adding accessibility\n4. Use semantic HTML5 elements when appropriate\n5. Add proper ARIA attributes only when necessary\n6. Ensure keyboard navigation works\n7. Include proper labels and descriptions\n\nExamples:\n- Input: <div onclick='submit()'>Submit</div>\n- Output: <button onclick='submit()'>Submit</button>\n\n- Input: <img src='chart.jpg'>\n- Output: <img src='chart.jpg' alt='Monthly sales chart showing 20% growth'>\n\n- Input: <input type='email' placeholder='Email'>\n- Output: <input type='email' id='email' placeholder='Email' aria-label='Email address'>"
                        },
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 512
                })
            });

            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
            }
            
            let data;
            const contentType = response.headers.get('content-type');
            
            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                data = await response.text();
            }
            
            const extractedText = this.extractTextFromResponse(data);
            
            if (!extractedText) {
                throw new Error('No valid text content found in LLM response');
            }
            
            return this.extractCodeFromText(extractedText);
        } catch (error) {
            throw new Error(`Local LLM request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    
    private extractTextFromResponse(data: LLMResponse | string): string | undefined {
        if (typeof data === 'string') {
            return data;
        }
        
        if (!data) {
            return undefined;
        }
        
    // Check common API fields
        const possibleFields: (keyof LLMResponse)[] = [
            'text', 'content', 'answer', 'response', 'result', 'output', 'completion', 'generated_text'
        ];
        
        for (const field of possibleFields) {
            const value = data[field];
            if (value && typeof value === 'string') {
                return value;
            }
        }
        
    // Check nested structures
        if (data.message) {
            if (typeof data.message === 'string') {
                return data.message;
            } else if (data.message.content) {
                return data.message.content;
            }
        }
        
    // Check OpenAI-like format
        if (data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
            const choice = data.choices[0];
            
            if (choice.text) return choice.text;
            if (choice.content) return choice.content;
            if (choice.message?.content) return choice.message.content;
            if (choice.delta?.content) return choice.delta.content;
        }
        
    // Fallback: scan all string properties
        for (const key in data) {
            const val: unknown = (data as any)[key];
            if (typeof val === 'string' && val.trim().length > 0) {
                return val;
            }
        }
        
        return undefined;
    }
    
    private extractCodeFromText(text: string): string {
        // HTML-Code zwischen ```html und ``` extrahieren
        const htmlCodeBlockRegex = /```html\s*([\s\S]*?)\s*```/;
        const htmlMatch = text.match(htmlCodeBlockRegex);
        
        if (htmlMatch && htmlMatch[1]) {
            return htmlMatch[1].trim();
        }
        
        // Generischen Code zwischen ``` und ``` extrahieren
        const codeBlockRegex = /```\s*([\s\S]*?)\s*```/;
        const genericMatch = text.match(codeBlockRegex);
        
        if (genericMatch && genericMatch[1]) {
            return genericMatch[1].trim();
        }
        
    // Check if the text looks like valid HTML
        if (text.includes('<') && text.includes('>')) {
            // Simplified validation for HTML tags
            const htmlTagRegex = /<[^>]+>[\s\S]*<\/[^>]+>/;
            const tagMatch = text.match(htmlTagRegex);
            
            if (tagMatch) {
                return text.trim();
            }
        }
        
       
        return text.trim();
    }
}

class GitHubCopilotProvider implements LLMProvider {
    name = 'GitHub Copilot';
    
    async isConfigured(): Promise<boolean> {
        // GitHub Copilot wird durch die Extension verwaltet
        return vscode.extensions.getExtension('GitHub.copilot') !== undefined;
    }
    
    async testConnection(): Promise<boolean> {
        try {
            const lm: any = (vscode as any).lm;
            if (!lm || typeof lm.selectChatModels !== 'function') return false;
            const models: any[] = await lm.selectChatModels({ vendor: 'copilot' });
            return models.length > 0;
        } catch {
            return false;
        }
    }

    async getAvailableModels(): Promise<string[]> {
        try {
            const lm: any = (vscode as any).lm;
            if (!lm || typeof lm.selectChatModels !== 'function') return [];
            const models: any[] = await lm.selectChatModels({ vendor: 'copilot' });
            const availableModels = models.map((model: any) => model.family || model.id || 'unknown');
            
            // Erweiterte Modellliste mit gefilterten verfügbaren Modellen
            const targetModels = [
                'gpt-4.1',
                'gpt-4o', 
                'claude-3.5-sonnet',
                'claude-3.7-sonnet',
                'claude-3.7-sonnet-thinking',
                'claude-4-sonnet',
                'gemini-2.0-flash',
                'gemini-2.5-pro',
                'o3-mini',
                'o4-mini'
            ];
            
            // Nur verfügbare Modelle zurückgeben, fallback auf alle verfügbaren
            const intersection = targetModels.filter(model => 
                availableModels.some((available: string) => 
                    available.toLowerCase().includes(model.toLowerCase()) ||
                    model.toLowerCase().includes(available.toLowerCase())
                )
            );
            
            return intersection.length > 0 ? intersection : availableModels;
        } catch (error) {
            // Fallback: Standard-Modelle zurückgeben
            return [
                'gpt-4o',
                'gpt-4.1', 
                'claude-3.5-sonnet',
                'claude-3.7-sonnet',
                'gemini-2.0-flash',
                'o3-mini',
            ];
        }
    }

    async getAccessibilityFix(prompt: string): Promise<string> {
        try {
            const lm: any = (vscode as any).lm;
            const config = vscode.workspace.getConfiguration('accessibility');
            const selectedModel = config.get<string>('githubCopilot.model', 'gpt-4o');
            if (!lm || typeof lm.selectChatModels !== 'function') {
                throw new Error('Language Model API not available in this VS Code version.');
            }
            const selectors = [
                { vendor: 'copilot', family: selectedModel },
                { vendor: 'copilot', id: selectedModel },
                { vendor: 'copilot', family: selectedModel.replace('-', '') },
                { vendor: 'copilot' }
            ];
            let models: any[] = [];
            for (const selector of selectors) {
                try {
                    models = await lm.selectChatModels(selector);
                    if (models.length > 0) break;
                } catch { /* ignore and try next */ }
            }
            if (!models.length) {
                throw new Error('No GitHub Copilot models available or accessible.');
            }
            const model = models[0];
            const lmMsg: any = (vscode as any).LanguageModelChatMessage;
            const messages = lmMsg ? [ lmMsg.User("You are an accessibility expert. Fix HTML code to be WCAG compliant. Return ONLY the corrected HTML code without any explanations, markdown formatting, or additional text. " + prompt) ] : [ { role: 'user', content: prompt } ];
            const response: any = await model.sendRequest(messages, { justification: 'Fixing HTML code for accessibility compliance according to WCAG standards' });
            let result = '';
            for await (const fragment of response.text) { result += fragment; }
            return this.extractCodeFromText(result.trim());
        } catch (error: any) {
            const lmError: any = (vscode as any).LanguageModelError;
            if (lmError && error instanceof lmError) {
                const code = (error as any).code || 'unknown';
                const msg = (error as any).message || 'Unknown';
                throw new Error(`GitHub Copilot request failed: ${msg} (Code: ${code})`);
            }
            throw new Error(`GitHub Copilot request failed: ${error?.message || 'Unknown error'}`);
        }
    }
    
    private extractCodeFromText(text: string): string {
    // Extract HTML code between ```html fences
        const htmlCodeBlockRegex = /```html\s*([\s\S]*?)\s*```/;
        const htmlMatch = text.match(htmlCodeBlockRegex);
        
        if (htmlMatch && htmlMatch[1]) {
            return htmlMatch[1].trim();
        }
        
    // Extract generic code between ``` fences
        const codeBlockRegex = /```\s*([\s\S]*?)\s*```/;
        const genericMatch = text.match(codeBlockRegex);
        
        if (genericMatch && genericMatch[1]) {
            return genericMatch[1].trim();
        }
        
    // Check if the text itself is valid-looking HTML
        if (text.includes('<') && text.includes('>')) {
            return text.trim();
        }
        
        return text.trim();
    }
}
