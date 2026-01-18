/**
 * LoreBook+ - Embedding-based Lorebook Activation
 * 
 * This module provides semantic similarity matching for lorebook entries
 * using vector embeddings, replacing keyword-based activation.
 */

import { get } from "svelte/store";
import { selectedCharID } from '../stores.svelte';
import { type Message, type loreBook, getDatabase } from "../storage/database.svelte";
import { DBState } from '../stores.svelte';
import { HypaProcessorV2, type EmbeddingText, type EmbeddingResult } from "./memory/hypamemoryv2";
import { findCharacterbyId } from "../util";
import { rerank, type RerankResult } from "./reranker";

// Default settings
const DEFAULT_SIMILARITY_THRESHOLD = 0.4;
const DEFAULT_MAX_RESULTS = 30;

export interface LorebookPlusSettings {
    embeddingThreshold: number;
    maxEmbeddingResults: number;
    maxTokens?: number; // Maximum tokens for embedding input
}

export interface LorebookActivationResult {
    loreIndex: number;
    lore: loreBook;
    similarityScore: number;
    rerankScore?: number;
    matchedQuery: string;
}

export interface LorebookPlusDebugResult {
    activatedLorebooks: LorebookActivationResult[];
    totalLorebooks: number;
    queryTexts: string[];
    embeddingTime: number;
    rerankTime: number;
    rerankerUsed: boolean;
}

interface LorebookMetadata {
    index: number;
    lore: loreBook;
}

/**
 * Get LoreBook+ settings from database or use defaults
 */
export function getLorebookPlusSettings(): LorebookPlusSettings {
    const db = getDatabase();
    return {
        embeddingThreshold: db.lorebookPlusSettings?.embeddingThreshold ?? DEFAULT_SIMILARITY_THRESHOLD,
        maxEmbeddingResults: db.lorebookPlusSettings?.maxEmbeddingResults ?? DEFAULT_MAX_RESULTS,
        maxTokens: db.lorebookPlusSettings?.maxTokens ?? 2000, // Default 2000 tokens
    };
}

/**
 * Estimate token count (rough: ~3 chars per token average)
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 3);
}

/**
 * Truncate text to fit within token limit
 */
function truncateToTokens(text: string, maxTokens: number): string {
    const estimatedChars = maxTokens * 3;
    if (text.length <= estimatedChars) {
        return text;
    }
    return text.substring(0, estimatedChars) + '...';
}

/**
 * Extract query text from recent messages for similarity matching
 */
function extractQueryFromMessages(messages: Message[], scanDepth: number, charName: string): string[] {
    const recentMessages = messages.slice(-scanDepth);
    const db = getDatabase();
    
    return recentMessages.map(msg => {
        const name = msg.role === 'user' 
            ? db.username 
            : (msg.name ?? (msg.saying ? findCharacterbyId(msg.saying)?.name : null) ?? charName);
        return `${name}: ${msg.data}`;
    });
}

/**
 * Perform keyword matching on lorebooks (same logic as original lorebook system)
 * Returns lorebooks that match based on their key field
 */
function matchLorebooksByKeyword(
    lorebooks: loreBook[],
    searchText: string,
    fullWordMatching: boolean = false
): { index: number; lore: loreBook }[] {
    const results: { index: number; lore: loreBook }[] = [];
    const lowerSearchText = searchText.toLowerCase();
    
    lorebooks.forEach((lore, index) => {
        // Skip folders, child lores, and already active
        if (lore.mode === 'folder' || lore.mode === 'child' || lore.alwaysActive) {
            return;
        }
        
        // Skip lorebooks with empty keys (manual only)
        if (!lore.key || !lore.key.trim()) {
            return;
        }
        
        // Check if using regex
        if (lore.useRegex) {
            try {
                const regex = new RegExp(lore.key, 'gi');
                if (regex.test(searchText)) {
                    results.push({ index, lore });
                }
            } catch (e) {
                // Invalid regex, skip
            }
            return;
        }
        
        // Normal keyword matching
        const keys = lore.key.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
        
        for (const key of keys) {
            if (!key) continue;
            
            let matched = false;
            if (fullWordMatching) {
                // Full word matching using word boundaries
                const wordRegex = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
                matched = wordRegex.test(searchText);
            } else {
                // Simple substring match
                matched = lowerSearchText.includes(key);
            }
            
            if (matched) {
                // Check selective mode (secondary keys)
                if (lore.selective && lore.secondkey) {
                    const secondKeys = lore.secondkey.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
                    const hasSecondKey = secondKeys.some(sk => 
                        fullWordMatching 
                            ? new RegExp(`\\b${sk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(searchText)
                            : lowerSearchText.includes(sk)
                    );
                    
                    if (!hasSecondKey) {
                        continue; // Secondary key not found, skip
                    }
                }
                
                results.push({ index, lore });
                break; // Found a match, no need to check other keys
            }
        }
    });
    
    return results;
}

/**
 * Create embedding texts from lorebook entries
 * Note: Lorebooks with empty keys are excluded (manual only)
 */
function createLorebookEmbeddingTexts(lorebooks: loreBook[]): EmbeddingText<LorebookMetadata>[] {
    return lorebooks
        .map((lore, index) => {
            // Skip folders and child lores
            if (lore.mode === 'folder' || lore.mode === 'child') {
                return null;
            }
            
            // Skip lorebooks with empty keys (manual only - user must enable via Always Active)
            const hasKey = lore.key && lore.key.trim().length > 0;
            if (!hasKey) {
                return null;
            }
            
            // Create searchable text combining comment/name and content
            const searchText = [
                lore.comment || '',
                lore.content || '',
                lore.key || '', // Include activation keys for better matching
            ].filter(Boolean).join(' ');
            
            if (!searchText.trim()) {
                return null;
            }
            
            return {
                id: lore.id || `lore-${index}`,
                content: searchText,
                metadata: {
                    index,
                    lore
                }
            };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
}

/**
 * Activate lorebooks using embedding similarity
 * 
 * @param messages - Recent chat messages
 * @param lorebooks - All lorebook entries
 * @param settings - LoreBook+ settings
 * @returns Debug result with activated lorebooks and scores
 */
export async function activateLorebooksByEmbedding(
    messages: Message[],
    lorebooks: loreBook[],
    scanDepth: number,
    charName: string,
    settings?: LorebookPlusSettings
): Promise<LorebookPlusDebugResult> {
    const startTime = performance.now();
    const effectiveSettings = settings ?? getLorebookPlusSettings();
    const db = getDatabase();
    const maxTokens = effectiveSettings.maxTokens ?? 2000;
    
    // Extract query texts from recent messages
    const queryTexts = extractQueryFromMessages(messages, scanDepth, charName);
    let combinedQuery = queryTexts.join('\n');
    
    // Truncate query to fit within token limit (use 30% of tokens for query)
    const maxQueryTokens = Math.floor(maxTokens * 0.3);
    combinedQuery = truncateToTokens(combinedQuery, maxQueryTokens);
    
    // Create embedding texts for lorebooks
    const lorebookTexts = createLorebookEmbeddingTexts(lorebooks);
    
    // Calculate tokens per lorebook text (remaining 70% divided by number of lorebooks)
    const tokensPerLorebook = Math.floor((maxTokens * 0.7) / Math.max(lorebookTexts.length, 1));
    
    // Truncate each lorebook text
    const truncatedLorebookTexts = lorebookTexts.map(text => ({
        ...text,
        content: truncateToTokens(text.content, Math.max(tokensPerLorebook, 100))
    }));
    
    console.log(`[LoreBook+] Embedding with maxTokens=${maxTokens}, queryTokens≈${maxQueryTokens}, tokensPerLore≈${tokensPerLorebook}`);
    
    // ========== Step 1: Keyword Matching (Priority) ==========
    const keywordMatches = matchLorebooksByKeyword(lorebooks, combinedQuery, false);
    const keywordActivated: LorebookActivationResult[] = keywordMatches.map(match => ({
        loreIndex: match.index,
        lore: match.lore,
        similarityScore: 1.0, // Keyword matches get max score
        matchedQuery: `[Keyword: ${match.lore.key?.substring(0, 30)}...]`,
    }));
    
    const keywordIndexes = new Set(keywordMatches.map(m => m.index));
    console.log(`[LoreBook+] Keyword matched: ${keywordActivated.length} lorebooks`);
    
    // ========== Step 2: Embedding Similarity (Supplementary) ==========
    let embeddingActivated: LorebookActivationResult[] = [];
    let embeddingTime = 0;
    
    if (truncatedLorebookTexts.length > 0 && combinedQuery.trim()) {
        // Initialize embedding processor
        const processor = new HypaProcessorV2<LorebookMetadata>();
        
        // Add lorebook texts to processor
        await processor.addTexts(truncatedLorebookTexts);
        
        // Search for similar lorebooks
        const searchResults = await processor.similaritySearchScored(combinedQuery);
        
        embeddingTime = performance.now() - startTime;
        
        // Filter by similarity threshold
        const filtered = searchResults.filter(
            ([_, score]) => score >= effectiveSettings.embeddingThreshold
        );
        
        // Limit results
        const limited = filtered.slice(0, effectiveSettings.maxEmbeddingResults);
        
        // Convert to activation results (excluding keyword matches to avoid duplicates)
        embeddingActivated = limited
            .filter(([result]) => !keywordIndexes.has(result.metadata.index))
            .map(([result, score]) => ({
                loreIndex: result.metadata.index,
                lore: result.metadata.lore,
                similarityScore: score,
                matchedQuery: combinedQuery,
            }));
        
        console.log(`[LoreBook+] Embedding matched: ${embeddingActivated.length} additional lorebooks`);
    }
    
    // ========== Step 3: Merge Results ==========
    // Keyword matches come first (higher priority), then embedding matches
    let activatedLorebooks: LorebookActivationResult[] = [...keywordActivated, ...embeddingActivated];
    
    // Apply reranker if enabled
    let rerankTime = 0;
    let rerankerUsed = false;
    
    if (db.rerankerConfig?.enabled && activatedLorebooks.length > 0) {
        const rerankStart = performance.now();
        
        try {
            const documents = activatedLorebooks.map(item => ({
                id: item.lore.id || `lore-${item.loreIndex}`,
                text: item.lore.content || item.lore.comment || '',
            }));
            
            const rerankResults = await rerank(combinedQuery, documents);
            
            // Merge rerank scores and reorder
            const rerankedMap = new Map<string, RerankResult>();
            rerankResults.forEach(r => rerankedMap.set(r.id, r));
            
            activatedLorebooks = activatedLorebooks
                .map(item => ({
                    ...item,
                    rerankScore: rerankedMap.get(item.lore.id || `lore-${item.loreIndex}`)?.score,
                }))
                .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));
            
            rerankerUsed = true;
        } catch (error) {
            console.error('[LoreBook+] Reranker error:', error);
            // Continue without reranking
        }
        
        rerankTime = performance.now() - rerankStart;
    }
    
    // Also include always-active lorebooks
    const alwaysActiveIndexes = new Set(activatedLorebooks.map(a => a.loreIndex));
    
    lorebooks.forEach((lore, index) => {
        if (lore.alwaysActive && !alwaysActiveIndexes.has(index) && lore.mode !== 'folder') {
            activatedLorebooks.push({
                loreIndex: index,
                lore,
                similarityScore: 1.0, // Always active gets max score
                matchedQuery: '[Always Active]',
            });
        }
    });
    
    return {
        activatedLorebooks,
        totalLorebooks: lorebooks.length,
        queryTexts,
        embeddingTime,
        rerankTime,
        rerankerUsed,
    };
}

/**
 * Run a debug test of LoreBook+ activation
 * This is used by the test button in the UI
 */
export async function runLorebookPlusTest(): Promise<LorebookPlusDebugResult | null> {
    const selectedID = get(selectedCharID);
    const char = DBState.db.characters[selectedID];
    
    if (!char) {
        return null;
    }
    
    const page = char.chatPage;
    const characterLore = char.globalLore ?? [];
    const chatLore = char.chats[page]?.localLore ?? [];
    const fullLore = [...characterLore, ...chatLore];
    const currentChat = char.chats[page]?.message ?? [];
    const loreDepth = char.loreSettings?.scanDepth ?? DBState.db.loreBookDepth ?? 5;
    
    return await activateLorebooksByEmbedding(
        currentChat,
        fullLore,
        loreDepth,
        char.name
    );
}
