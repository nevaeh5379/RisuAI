/**
 * Reranker API Integration
 * 
 * Supports various reranker APIs including Qwen3-VL-Reranker
 * for improved lorebook relevance ordering.
 */

import { getDatabase } from "../storage/database.svelte";
import { globalFetch } from "../globalApi.svelte";

export interface RerankerConfig {
    enabled: boolean;
    url: string;
    key?: string;
    model?: string;
    topK?: number;
    maxTokens?: number; // Maximum tokens for reranker input
}

export interface RerankDocument {
    id: string;
    text: string;
}

export interface RerankResult {
    id: string;
    score: number;
    index: number;
}

/**
 * Get reranker configuration from database
 */
export function getRerankerConfig(): RerankerConfig {
    const db = getDatabase();
    return {
        enabled: db.rerankerConfig?.enabled ?? false,
        url: db.rerankerConfig?.url ?? '',
        key: db.rerankerConfig?.key,
        model: db.rerankerConfig?.model,
        topK: db.rerankerConfig?.topK ?? 10,
        maxTokens: db.rerankerConfig?.maxTokens ?? 2000, // Default 2000 tokens (~8000 chars)
    };
}

/**
 * Estimate token count (rough: 1 token ≈ 4 chars for English, 1.5 chars for Korean)
 */
function estimateTokens(text: string): number {
    // Rough estimation: average ~3 chars per token
    return Math.ceil(text.length / 3);
}

/**
 * Truncate text to fit within token limit
 */
function truncateToTokens(text: string, maxTokens: number): string {
    const estimatedChars = maxTokens * 3; // ~3 chars per token
    if (text.length <= estimatedChars) {
        return text;
    }
    return text.substring(0, estimatedChars) + '...';
}

/**
 * Rerank documents by relevance to query using external API
 * 
 * Supports multiple API formats:
 * - Qwen3-VL-Reranker (via vLLM or similar)
 * - Cohere Rerank API
 * - Jina Reranker API
 * - OpenAI-compatible rerank endpoints
 * 
 * @param query - The query text
 * @param documents - Documents to rerank
 * @returns Reranked results with scores
 */
export async function rerank(
    query: string,
    documents: RerankDocument[]
): Promise<RerankResult[]> {
    const config = getRerankerConfig();
    
    if (!config.enabled || !config.url) {
        throw new Error('Reranker is not configured');
    }
    
    if (documents.length === 0) {
        return [];
    }
    
    // Limit documents to topK
    const limitedDocs = documents.slice(0, config.topK ?? documents.length);
    
    // Truncate to max tokens limit
    const maxTokens = config.maxTokens ?? 2000;
    const queryTokens = estimateTokens(query);
    const tokensPerDoc = Math.floor((maxTokens - queryTokens) / limitedDocs.length);
    
    // Truncate each document to fit within token budget
    const truncatedDocs = limitedDocs.map(doc => ({
        ...doc,
        text: truncateToTokens(doc.text, Math.max(tokensPerDoc, 100)) // At least 100 tokens per doc
    }));
    
    const truncatedQuery = truncateToTokens(query, Math.min(queryTokens, Math.floor(maxTokens * 0.3)));
    
    console.log(`[Reranker] Processing ${truncatedDocs.length} docs, maxTokens=${maxTokens}, tokensPerDoc≈${tokensPerDoc}`);
    
    // Detect API format based on URL patterns
    const apiFormat = detectApiFormat(config.url);
    
    try {
        switch (apiFormat) {
            case 'cohere':
                return await rerankCohere(truncatedQuery, truncatedDocs, config);
            case 'jina':
                return await rerankJina(truncatedQuery, truncatedDocs, config);
            case 'qwen':
            case 'openai':
            default:
                return await rerankGeneric(truncatedQuery, truncatedDocs, config);
        }
    } catch (error) {
        console.error('[Reranker] API call failed:', error);
        throw error;
    }
}

type ApiFormat = 'cohere' | 'jina' | 'qwen' | 'openai';

function detectApiFormat(url: string): ApiFormat {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('cohere')) return 'cohere';
    if (lowerUrl.includes('jina')) return 'jina';
    if (lowerUrl.includes('qwen')) return 'qwen';
    return 'openai';
}

/**
 * Generic reranker API call (vLLM / Jina / Cohere compatible)
 * vLLM's /v1/rerank endpoint is compatible with Jina AI and Cohere rerank APIs
 */
async function rerankGeneric(
    query: string,
    documents: RerankDocument[],
    config: RerankerConfig
): Promise<RerankResult[]> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    
    if (config.key) {
        headers['Authorization'] = `Bearer ${config.key}`;
    }
    
    // vLLM-compatible format (works with Jina/Cohere style)
    const body: {
        model?: string;
        query: string;
        documents: string[];
        top_n?: number;
    } = {
        query: query,
        documents: documents.map(doc => doc.text),
    };
    
    // Add model if specified
    if (config.model) {
        body.model = config.model;
    }
    
    // Add top_n if specified
    if (config.topK) {
        body.top_n = config.topK;
    }
    
    console.log('[Reranker] Sending request:', JSON.stringify(body, null, 2));
    
    const response = await globalFetch(config.url, {
        headers,
        body,
    });
    
    if (!response.ok) {
        console.error('[Reranker] API error response:', response.data);
        throw new Error(`Reranker API error: ${JSON.stringify(response.data)}`);
    }
    
    console.log('[Reranker] Response:', JSON.stringify(response.data, null, 2));
    
    // Handle different response formats
    const data = response.data;
    
    // Format 1: Array of scores directly
    if (Array.isArray(data)) {
        return documents.map((doc, index) => ({
            id: doc.id,
            score: data[index] ?? 0,
            index,
        })).sort((a, b) => b.score - a.score);
    }
    
    // Format 2: { results: [{ index, relevance_score }, ...] } (Jina/Cohere/vLLM style)
    if (data.results && Array.isArray(data.results)) {
        return data.results.map((r: { index: number; relevance_score?: number; score?: number; document?: { text: string } }) => ({
            id: documents[r.index]?.id ?? `doc-${r.index}`,
            score: r.relevance_score ?? r.score ?? 0,
            index: r.index,
        })).sort((a: RerankResult, b: RerankResult) => b.score - a.score);
    }
    
    // Format 3: { scores: [...] }
    if (data.scores && Array.isArray(data.scores)) {
        return documents.map((doc, index) => ({
            id: doc.id,
            score: data.scores[index] ?? 0,
            index,
        })).sort((a, b) => b.score - a.score);
    }
    
    throw new Error('Unexpected reranker response format: ' + JSON.stringify(data));
}

/**
 * Cohere Rerank API
 */
async function rerankCohere(
    query: string,
    documents: RerankDocument[],
    config: RerankerConfig
): Promise<RerankResult[]> {
    const response = await globalFetch(config.url, {
        headers: {
            'Authorization': `Bearer ${config.key}`,
            'Content-Type': 'application/json',
        },
        body: {
            model: config.model || 'rerank-english-v3.0',
            query,
            documents: documents.map(d => d.text),
            top_n: config.topK,
        },
    });
    
    if (!response.ok) {
        throw new Error(`Cohere Rerank error: ${JSON.stringify(response.data)}`);
    }
    
    const results = response.data.results || [];
    
    return results.map((r: { index: number; relevance_score: number }) => ({
        id: documents[r.index].id,
        score: r.relevance_score,
        index: r.index,
    }));
}

/**
 * Jina Reranker API
 */
async function rerankJina(
    query: string,
    documents: RerankDocument[],
    config: RerankerConfig
): Promise<RerankResult[]> {
    const response = await globalFetch(config.url, {
        headers: {
            'Authorization': `Bearer ${config.key}`,
            'Content-Type': 'application/json',
        },
        body: {
            model: config.model || 'jina-reranker-v2-base-multilingual',
            query,
            documents: documents.map(d => d.text),
            top_n: config.topK,
        },
    });
    
    if (!response.ok) {
        throw new Error(`Jina Rerank error: ${JSON.stringify(response.data)}`);
    }
    
    const results = response.data.results || [];
    
    return results.map((r: { index: number; relevance_score: number }) => ({
        id: documents[r.index].id,
        score: r.relevance_score,
        index: r.index,
    }));
}
