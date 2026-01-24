<script lang="ts">
    import { DBState, selectedCharID } from "../../ts/stores.svelte";
    import { getCharImage } from "../../ts/characters";
    import { Search, UserCircle, Globe, LayoutGrid, Plus } from "@lucide/svelte";
    import RealmMain from "../UI/Realm/RealmMain.svelte";
    import { createSimpleCharacter } from "../../ts/stores.svelte"; // Verify if needed, maybe not for just list

    let activeTab = $state<'local' | 'online'>('local');
    let searchQuery = $state("");

    // Filter characters
    let filteredChars = $derived.by(() => {
        if (!DBState.db.characterOrder) return [];
        
        let chars = [];
        const order = DBState.db.characterOrder;
        
        for (const id of order) {
             if (typeof id === 'string') {
                 // It's a character ID (or index if using legacy, but Risu uses index mapping usually or direct array?)
                 // Wait, characterOrder usually contains IDs. But sidebar logic uses `getCharacterIndexObject`.
                 // Let's use simpler approach: Iterate DBState.db.characters directly if order is complex, 
                 // but order is better.
                 // Let's check how Sidebar does it. Sidebar uses `getCharacterIndexObject`.
                 // For dashboard, maybe just list all characters is fine for now, or match order.
                 // Let's iterate all characters for simplicity first, or reuse sidebar logic if possible.
                 // Actually, let's just use DBState.db.characters mapping.
             }
        }
        
        // Simpler approach: Just filter the main array for now.
        return DBState.db.characters.map((char, index) => ({...char, index})).filter(char => {
            if (char.type === 'group' || char.type === 'folder') return false; // Hide groups/folders for now? Or show them?
            // Risu structure: folders are virtual in `characterOrder`, characters are flat in `characters` array?
            // Sidebar logic implies `characterOrder` contains folder structure.
            // For dashboard grid, flat list of characters is often easier for "My Characters".
            // Let's show flat list for now.
            return char.name.toLowerCase().includes(searchQuery.toLowerCase());
        });
    });

    function selectCharacter(index: number) {
        $selectedCharID = index;
    }

    function createNewCharacter() {
        // Trigger new character creation logic
        // Usually handled by Sidebar's + button or global function.
        // We can simulate it or leave it for sidebar.
        // For now, let's just have the grid.
    }
</script>

<div class="w-full h-full flex flex-col bg-[#1e1e1e] text-[#cccccc]">
    <!-- Top Bar / Tabs -->
    <div class="flex items-center gap-6 px-8 py-6 border-b border-[#3e3e42] bg-[#252526]">
        <h1 class="text-2xl font-bold text-white tracking-tight">Studio Dashboard</h1>
        
        <div class="flex bg-[#1e1e1e] rounded-lg p-1 gap-1">
            <button 
                class="px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 {activeTab === 'local' ? 'bg-[#007acc] text-white' : 'hover:bg-[#2a2d2e] text-[#888888]'}"
                onclick={() => activeTab = 'local'}
            >
                <LayoutGrid size={16} />
                My Characters
            </button>
            <button 
                class="px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 {activeTab === 'online' ? 'bg-[#007acc] text-white' : 'hover:bg-[#2a2d2e] text-[#888888]'}"
                onclick={() => activeTab = 'online'}
            >
                <Globe size={16} />
                RisuRealm
            </button>
        </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-hidden relative">
        {#if activeTab === 'local'}
            <div class="w-full h-full p-8 overflow-y-auto">
                <!-- Search Bar -->
                <div class="max-w-xl mb-8 relative">
                    <Search class="absolute left-3 top-1/2 -translate-y-1/2 text-[#888888]" size={18} />
                    <input 
                        type="text" 
                        bind:value={searchQuery}
                        placeholder="Search your characters..." 
                        class="w-full bg-[#252526] border border-[#3e3e42] rounded-lg py-3 pl-10 pr-4 text-white focus:outline-none focus:border-[#007acc] transition-colors"
                    />
                </div>

                <!-- Grid -->
                <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6">
                    {#each filteredChars as char}
                        <button 
                            class="group flex flex-col items-center gap-3 p-4 rounded-xl hover:bg-[#2a2d2e] transition-all border border-transparent hover:border-[#3e3e42] text-center"
                            onclick={() => selectCharacter(char.index)}
                        >
                            <div class="w-32 h-32 rounded-full shadow-lg group-hover:scale-105 transition-transform overflow-hidden bg-[#1e1e1e] relative">
                                {#if char.image}
                                    {#await getCharImage(char.image, 'css')}
                                        <div class="w-full h-full flex items-center justify-center bg-[#333]">...</div>
                                    {:then imgSrc} 
                                        <div class="w-full h-full bg-cover bg-center" style="{imgSrc}"></div>
                                    {/await}
                                {:else}
                                    <div class="w-full h-full flex items-center justify-center bg-[#333]">
                                        <UserCircle size={48} class="text-[#555]" />
                                    </div>
                                {/if}
                            </div>
                            <div class="flex flex-col gap-0.5 max-w-full">
                                <span class="font-semibold text-white truncate max-w-[160px]">{char.name}</span>
                                <span class="text-xs text-[#888888] truncate max-w-[160px]">{char.creator || 'Unknown Creator'}</span>
                            </div>
                        </button>
                    {/each}
                    
                    {#if filteredChars.length === 0}
                        <div class="col-span-full flex flex-col items-center justify-center py-20 text-[#555] opacity-50">
                            <UserCircle size={64} class="mb-4" />
                            <span>No characters found</span>
                        </div>
                    {/if}
                </div>
            </div>
        {:else}
            <div class="w-full h-full overflow-y-auto p-4 bg-bgcolor">
                <RealmMain />
            </div>
        {/if}
    </div>
</div>
