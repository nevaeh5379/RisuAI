<script lang="ts">
    import { language } from "src/lang";
    import { DBState } from 'src/ts/stores.svelte';
    import { findCharacterbyId } from "src/ts/util";

    function formatTime(ms: number) {
        if (!ms) return "0s";
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    function sortUsage(usage: {[key: string]: number} | undefined) {
        if (!usage) return [];
        return Object.entries(usage).sort((a, b) => b[1] - a[1]);
    }
    
    function getBotName(id: string) {
        const char = findCharacterbyId(id);
        return char ? char.name : id;
    }

    // Chart Utilities
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);

    function getHeatmapData() {
        if (!DBState.db.statics.daily) return [];
        const data = [];
        const options: Intl.DateTimeFormatOptions = {  year: 'numeric', month: '2-digit', day: '2-digit' };
        
        let currentDate = new Date(oneYearAgo);
        
        // Generate last 365 days
        for (let i = 0; i < 365; i++) {
             // Correctly format YYYY-MM-DD manually to avoid timezone issues or locale inconsistencies
            const year = currentDate.getFullYear();
            const month = String(currentDate.getMonth() + 1).padStart(2, '0');
            const day = String(currentDate.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;

            const stat = DBState.db.statics.daily[dateStr];
            data.push({
                date: dateStr,
                count: stat ? stat.messages : 0,
                intensity: stat ? Math.min(4, Math.ceil(stat.messages / 20)) : 0 // Scale 0-4
            });
            currentDate.setDate(currentDate.getDate() + 1);
        }
        return data;
    }

    function getMaxTokensDaily() {
        if (!DBState.db.statics.daily) return 100;
        let max = 0;
        for (const key in DBState.db.statics.daily) {
            const v = DBState.db.statics.daily[key];
            if (v.inputTokens + v.outputTokens > max) max = v.inputTokens + v.outputTokens;
        }
        return max || 100;
    }

    function getLast30DaysTokenData() {
         if (!DBState.db.statics.daily) return [];
         const data = [];
         let currentDate = new Date();
         currentDate.setDate(currentDate.getDate() - 29); // Start 30 days ago

         for (let i = 0; i < 30; i++) {
            const year = currentDate.getFullYear();
            const month = String(currentDate.getMonth() + 1).padStart(2, '0');
            const day = String(currentDate.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            
            const stat = DBState.db.statics.daily[dateStr];
            data.push({
                date: `${month}/${day}`,
                input: stat ? stat.inputTokens : 0,
                output: stat ? stat.outputTokens : 0
            });
            currentDate.setDate(currentDate.getDate() + 1);
         }
         return data;
    }

    const heatmapData = $derived(getHeatmapData());
    const tokenData = $derived(getLast30DaysTokenData());
    const maxTokens = $derived(getMaxTokensDaily());

</script>

<h2 class="mb-2 text-2xl font-bold mt-2">{language.statistics}</h2>

<div class="flex flex-col gap-4 text-textcolor h-full overflow-y-auto pr-2 pb-10">
    <div class="border border-darkborderc rounded-md p-4">
        <h3 class="text-xl font-bold mb-2">{language.general}</h3>
        <p>{language.totalMessages}: {DBState.db.statics.messages.toLocaleString()}</p>
        {#if DBState.db.statics.inputTokens}
        <p>{language.totalInputTokens}: {DBState.db.statics.inputTokens.toLocaleString()}</p>
        <p>{language.totalOutputTokens}: {DBState.db.statics.outputTokens.toLocaleString()}</p>
        <p>{language.totalTokens}: {(DBState.db.statics.inputTokens + DBState.db.statics.outputTokens).toLocaleString()}</p>
        {/if}
        {#if DBState.db.statics.totalTime}
        <p>{language.timeSpent}: {formatTime(DBState.db.statics.totalTime)}</p>
        {/if}
    </div>

     <!-- Heatmap (GitHub Style) -->
     <div class="border border-darkborderc rounded-md p-4">
        <h3 class="text-xl font-bold mb-2">Message Activity</h3>
        <div class="flex flex-wrap gap-1">
            {#each heatmapData as day}
                <div 
                    title={`${day.date}: ${day.count} messages`}
                    class="w-3 h-3 rounded-sm"
                    style="background-color: {
                        day.intensity === 0 ? 'var(--dark-button)' :
                        day.intensity === 1 ? '#0e4429' :
                        day.intensity === 2 ? '#006d32' :
                        day.intensity === 3 ? '#26a641' :
                        '#39d353'
                    }"
                ></div>
            {/each}
        </div>
    </div>


    <!-- Token Usage Chart (Simple Bar) -->
    <div class="border border-darkborderc rounded-md p-4 h-64 flex flex-col">
        <h3 class="text-xl font-bold mb-2">Token Usage (Last 30 Days)</h3>
        <div class="flex items-end gap-1 grow w-full border-b border-gray-600 pb-1">
            {#each tokenData as day}
                <div class="flex flex-col items-center flex-1 h-full justify-end group relative">
                    <!-- Tooltip -->
                     <div class="absolute bottom-full mb-1 hidden group-hover:block bg-black text-white text-xs p-1 rounded z-10 whitespace-nowrap">
                        {day.date}<br>In: {day.input}<br>Out: {day.output}
                     </div>
                    <!-- Bars -->
                     <div class="w-full flex items-end justify-center gap-0.5 h-full"> 
                        <div class="bg-blue-500 w-1/2" style="height: {(day.input / maxTokens) * 100}%"></div>
                        <div class="bg-green-500 w-1/2" style="height: {(day.output / maxTokens) * 100}%"></div>
                     </div>
                </div>
            {/each}
        </div>
         <div class="flex justify-between text-xs text-gray-400 mt-1">
            <span>30 days ago</span>
            <span>Today</span>
        </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 grow min-h-0 h-96">
        {#if DBState.db.statics.modelUsage}
        <div class="border border-darkborderc rounded-md p-4 flex flex-col h-full min-h-0">
            <h3 class="text-xl font-bold mb-2 shrink-0">{language.modelUsage}</h3>
            <div class="flex flex-col gap-1 overflow-y-auto grow min-h-0">
                {#each sortUsage(DBState.db.statics.modelUsage) as [model, count]}
                <div class="flex justify-between mr-2">
                    <span class="truncate pr-2" title={model}>{model}</span>
                    <span class="shrink-0">{count.toLocaleString()}</span>
                </div>
                {/each}
            </div>
        </div>
        {/if}

        {#if DBState.db.statics.botUsage}
        <div class="border border-darkborderc rounded-md p-4 flex flex-col h-full min-h-0">
            <h3 class="text-xl font-bold mb-2 shrink-0">{language.botUsage}</h3>
            <div class="flex flex-col gap-1 overflow-y-auto grow min-h-0">
                {#each sortUsage(DBState.db.statics.botUsage) as [botId, count]}
                <div class="flex justify-between mr-2">
                    <span class="truncate pr-2" title={getBotName(botId)}>{getBotName(botId)}</span>
                    <span class="shrink-0">{count.toLocaleString()}</span>
                </div>
                {/each}
            </div>
        </div>
        {/if}
    </div>
</div>
