<script lang="ts">
    import { DBState, selectedCharID } from 'src/ts/stores.svelte';
    import { language } from "../../../lang";
    import { runLorebookPlusTest, type LorebookPlusDebugResult } from "../../../ts/process/lorebookPlus";
    import { getLastLorebookPlusResult } from "../../../ts/process/lorebook.svelte";
    import { FlaskConicalIcon, Loader2Icon, XIcon, CheckCircleIcon, AlertCircleIcon } from "@lucide/svelte";

    let isLoading = $state(false);
    let testResult = $state<LorebookPlusDebugResult | null>(null);
    let error = $state<string | null>(null);
    let showPanel = $state(false);

    async function runTest() {
        isLoading = true;
        error = null;
        try {
            testResult = await runLorebookPlusTest();
            if (!testResult) {
                error = 'No character or chat selected';
            }
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
            testResult = null;
        } finally {
            isLoading = false;
        }
    }

    function loadLastResult() {
        testResult = getLastLorebookPlusResult();
    }
</script>

<div class="mt-4">
    <button 
        onclick={() => { showPanel = !showPanel; }}
        class="flex items-center gap-2 px-3 py-2 bg-selected hover:bg-selected2 rounded-md text-sm text-textcolor"
    >
        <FlaskConicalIcon size={16} />
        <span>{language.lorebookPlusTest ?? 'Test Embedding'}</span>
    </button>
</div>

{#if showPanel}
<div class="mt-4 p-4 border border-selected rounded-lg bg-bgcolor2">
    <div class="flex justify-between items-center mb-4">
        <h3 class="text-textcolor font-semibold flex items-center gap-2">
            <FlaskConicalIcon size={18} />
            {language.lorebookPlusTestResults ?? 'LoreBook+ Test Results'}
        </h3>
        <button onclick={() => { showPanel = false; }} class="text-textcolor2 hover:text-textcolor">
            <XIcon size={18} />
        </button>
    </div>

    <div class="flex gap-2 mb-4">
        <button 
            onclick={runTest}
            disabled={isLoading}
            class="flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded text-white text-sm"
        >
            {#if isLoading}
                <Loader2Icon size={14} class="animate-spin" />
            {:else}
                <CheckCircleIcon size={14} />
            {/if}
            <span>Run Test</span>
        </button>
        <button 
            onclick={loadLastResult}
            class="px-3 py-1.5 bg-selected hover:bg-selected2 rounded text-textcolor text-sm"
        >
            Load Last Result
        </button>
    </div>

    {#if error}
        <div class="p-3 bg-red-500/20 border border-red-500/50 rounded-md flex items-start gap-2">
            <AlertCircleIcon size={18} class="text-red-400 mt-0.5" />
            <span class="text-red-300 text-sm">{error}</span>
        </div>
    {/if}

    {#if testResult}
        <div class="space-y-4">
            <!-- Stats -->
            <div class="grid grid-cols-2 gap-2 text-sm">
                <div class="p-2 bg-bgcolor rounded">
                    <span class="text-textcolor2">Total Lorebooks:</span>
                    <span class="text-textcolor ml-2">{testResult.totalLorebooks}</span>
                </div>
                <div class="p-2 bg-bgcolor rounded">
                    <span class="text-textcolor2">Activated:</span>
                    <span class="text-green-400 ml-2">{testResult.activatedLorebooks.length}</span>
                </div>
                <div class="p-2 bg-bgcolor rounded">
                    <span class="text-textcolor2">Embedding Time:</span>
                    <span class="text-textcolor ml-2">{testResult.embeddingTime.toFixed(0)}ms</span>
                </div>
                <div class="p-2 bg-bgcolor rounded">
                    <span class="text-textcolor2">Reranker:</span>
                    <span class="text-textcolor ml-2">
                        {#if testResult.rerankerUsed}
                            <span class="text-blue-400">{testResult.rerankTime.toFixed(0)}ms</span>
                        {:else}
                            <span class="text-textcolor2">Not used</span>
                        {/if}
                    </span>
                </div>
            </div>

            <!-- Query Context -->
            {#if testResult.queryTexts.length > 0}
                <div>
                    <h4 class="text-textcolor2 text-sm mb-2">Query Context (last {testResult.queryTexts.length} messages)</h4>
                    <div class="p-2 bg-bgcolor rounded text-xs text-textcolor max-h-24 overflow-y-auto">
                        {testResult.queryTexts.slice(-3).join('\n').substring(0, 300)}...
                    </div>
                </div>
            {/if}

            <!-- Activated Lorebooks -->
            <div>
                <h4 class="text-textcolor2 text-sm mb-2">Activated Lorebooks</h4>
                <div class="space-y-2 max-h-64 overflow-y-auto">
                    {#each testResult.activatedLorebooks as item, i}
                        <div class="p-2 bg-bgcolor rounded border-l-2 border-green-500">
                            <div class="flex justify-between items-start">
                                <span class="text-textcolor font-medium text-sm">
                                    #{i + 1} {item.lore.comment || `Lorebook ${item.loreIndex}`}
                                </span>
                                <div class="flex gap-2 text-xs">
                                    <span class="text-yellow-400" title="Similarity Score">
                                        {(item.similarityScore * 100).toFixed(1)}%
                                    </span>
                                    {#if item.rerankScore !== undefined}
                                        <span class="text-blue-400" title="Rerank Score">
                                            R:{(item.rerankScore * 100).toFixed(1)}%
                                        </span>
                                    {/if}
                                </div>
                            </div>
                            <div class="text-textcolor2 text-xs mt-1 line-clamp-2">
                                {item.lore.content?.substring(0, 150) || '[No content]'}...
                            </div>
                            {#if item.lore.key}
                                <div class="text-textcolor2 text-xs mt-1 opacity-60">
                                    Keys: {item.lore.key}
                                </div>
                            {/if}
                        </div>
                    {:else}
                        <div class="text-textcolor2 text-sm text-center py-4">
                            No lorebooks activated. Try adjusting the similarity threshold.
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    {:else if !isLoading && !error}
        <div class="text-textcolor2 text-sm text-center py-8">
            Click "Run Test" to see which lorebooks would be activated with embedding-based matching.
        </div>
    {/if}
</div>
{/if}
