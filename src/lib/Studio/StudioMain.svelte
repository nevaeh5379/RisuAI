<script lang="ts">
    import { DBState, studioModeOpen, selectedCharID } from "src/ts/stores.svelte";
    import { language } from "src/lang";
    import { XIcon, PlusIcon, MenuIcon, ChevronRight, ChevronDown, FolderIcon, BookIcon, ExternalLinkIcon, FileTextIcon, MessageSquareIcon, InfoIcon, Settings } from '@lucide/svelte';
    import Button from "../UI/GUI/Button.svelte";
    import StudioWindow from "./StudioWindow.svelte";
    import StudioContent from "./StudioContent.svelte";
    import type { character, loreBook } from "src/ts/storage/database.svelte";
    import { v4 } from "uuid";

    let char = $derived(DBState.db.characters[$selectedCharID] as character);

    interface StudioTab {
        id: string;
        key: string;
        title: string;
        icon?: any;
    }

    interface FloatingWindowData {
        id: string;
        tab: StudioTab;
        x: number;
        y: number;
        width: number;
        height: number;
        zIndex: number;
    }
    
    // State
    let tabs = $state<StudioTab[]>([]);
    let activeTabId = $state<string | null>(null);
    let floatingWindows = $state<FloatingWindowData[]>([]);

    // Z-Index Management
    let globalZIndex = $state(100);
    let mainZIndex = $state(100);

    // Initial Main Window State
    let mainX = $state(50);
    let mainY = $state(50);
    let mainWidth = $state(1000);
    let mainHeight = $state(700);

    // Sidebar State
    let expandedBasic = $state(true);
    let expandedLore = $state(true);
    let expandedAlt = $state(true);
    let openFolders = $state<Set<string>>(new Set());

    function close() {
        $studioModeOpen = false;
    }

    function toggleFolder(key: string) {
        const newSet = new Set(openFolders);
        if (newSet.has(key)) {
            newSet.delete(key);
        } else {
            newSet.add(key);
        }
        openFolders = newSet;
    }

    function bringToFront(type: 'main' | string) {
        globalZIndex++;
        if (type === 'main') {
            mainZIndex = globalZIndex;
        } else {
            const win = floatingWindows.find(w => w.id === type);
            if (win) win.zIndex = globalZIndex;
        }
    }

    function openTab(key: string, title: string, icon?: any) {
        // Check if already in floating windows
        const fw = floatingWindows.find(w => w.tab.key === key);
        if (fw) {
            bringToFront(fw.id);
            return;
        }

        // Check if already in tabs
        const existingTab = tabs.find(t => t.key === key);
        if (existingTab) {
            activeTabId = existingTab.id;
            bringToFront('main');
            return;
        }

        // Add new tab
        const newTab: StudioTab = {
            id: v4(),
            key,
            title,
            icon
        };
        tabs.push(newTab);
        activeTabId = newTab.id;
        bringToFront('main');
    }

    function closeTab(id: string) {
        const index = tabs.findIndex(t => t.id === id);
        if (index === -1) return;

        tabs.splice(index, 1);
        if (activeTabId === id) {
            // Select new active tab
            if (tabs.length > 0) {
                // Try to select previous one, or the one at the same index
                const newIndex = Math.max(0, index - 1);
                activeTabId = tabs[newIndex].id;
            } else {
                activeTabId = null;
            }
        }
    }

    function popOutTab(id: string) {
        const tab = tabs.find(t => t.id === id);
        if (!tab) return;
        
        closeTab(id);
        
        globalZIndex++;
        const fw: FloatingWindowData = {
            id: v4(),
            tab: {...tab}, // Clone to be safe
            x: mainX + 50,
            y: mainY + 50,
            width: 600,
            height: 500,
            zIndex: globalZIndex
        };
        floatingWindows.push(fw);
    }

    function closeFloatingWindow(id: string) {
        const index = floatingWindows.findIndex(w => w.id === id);
        if (index !== -1) {
            floatingWindows.splice(index, 1);
        }
    }

    // Add Functions
    function addLorebook(folderKey?: string) {
        if (!char) return;
        const newBook: loreBook = {
            id: v4(),
            key: '',
            comment: 'New Entry',
            content: '',
            mode: 'normal',
            insertorder: 100,
            alwaysActive: true,
            selective: false,
            folder: folderKey
        };
        char.globalLore.push(newBook);
        
        // Auto open
        openTab(`lore:${char.globalLore.length - 1}`, newBook.comment || 'New Entry', BookIcon);

        if (folderKey) {
            const newSet = new Set(openFolders);
            newSet.add(folderKey);
            openFolders = newSet;
        }
    }

    function addFolder() {
        if (!char) return;
        const newBook: loreBook = {
            id: v4(),
            key: v4(),
            comment: 'New Folder',
            content: '',
            mode: 'folder',
            insertorder: 100,
            alwaysActive: true,
            selective: false
        };
        char.globalLore.push(newBook);
    }

    function getLoreItems(items: loreBook[], folderKey?: string, depth: number = 0): any[] {
        let result: any[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if ((!folderKey && !item.folder) || (item.folder === folderKey)) {
                result.push({ item, depth, index: i });
                if (item.mode === 'folder' && openFolders.has(item.key)) {
                    result = result.concat(getLoreItems(items, item.key, depth + 1));
                }
            }
        }
        return result;
    }

    // Initialize with Description tab if empty
    $effect(() => {
        if (tabs.length === 0 && floatingWindows.length === 0 && char) {
            openTab('basic:desc', language.description, FileTextIcon);
        }
    });

</script>

<!-- Main Studio Window -->
{#if char}
    <StudioWindow 
        title={`${language.studioMode} - ${char.name}`}
        bind:x={mainX}
        bind:y={mainY}
        bind:width={mainWidth}
        bind:height={mainHeight}
        zIndex={mainZIndex}
        onFocus={() => bringToFront('main')}
        onClose={close}
    >
        <div class="flex h-full w-full bg-bgcolor">
            <!-- Left Sidebar -->
            <div class="w-64 border-r border-selected bg-darkbg flex flex-col shrink-0 overflow-y-auto select-none">
                <div class="flex flex-col p-2 gap-1">
                    <!-- Basic Info -->
                    <div>
                        <button class="w-full flex items-center gap-2 p-2 hover:bg-darkbutton rounded-md text-textcolor font-bold" onclick={() => expandedBasic = !expandedBasic}>
                            {#if expandedBasic}<ChevronDown size="16"/>{:else}<ChevronRight size="16"/>{/if}
                            {language.basicInfo}
                        </button>
                        {#if expandedBasic}
                            <div class="pl-4 flex flex-col gap-1 mt-1">
                                <button class="w-full text-left p-2 rounded-md hover:bg-darkbutton text-textcolor2 flex items-center gap-2" onclick={() => openTab('basic:name', language.name, InfoIcon)}>
                                    <InfoIcon size="14" /> {language.name}
                                </button>
                                <button class="w-full text-left p-2 rounded-md hover:bg-darkbutton text-textcolor2 flex items-center gap-2" onclick={() => openTab('basic:desc', language.description, FileTextIcon)}>
                                    <FileTextIcon size="14" /> {language.description}
                                </button>
                                <button class="w-full text-left p-2 rounded-md hover:bg-darkbutton text-textcolor2 flex items-center gap-2" onclick={() => openTab('basic:first', language.firstMessage, MessageSquareIcon)}>
                                    <MessageSquareIcon size="14" /> {language.firstMessage}
                                </button>
                                <button class="w-full text-left p-2 rounded-md hover:bg-darkbutton text-textcolor2 flex items-center gap-2" onclick={() => openTab('basic:note', language.creatorNotes, InfoIcon)}>
                                    <InfoIcon size="14" /> {language.creatorNotes}
                                </button>
                                <button class="w-full text-left p-2 rounded-md hover:bg-darkbutton text-textcolor2 flex items-center gap-2" onclick={() => openTab('advanced', language.advancedSettings, Settings)}>
                                    <Settings size="14" /> {language.advancedSettings}
                                </button>

                                <!-- Alternate Greetings -->
                                <div>
                                    <div role="button" tabindex="0" class="w-full flex items-center justify-between p-2 hover:bg-darkbutton rounded-md text-textcolor font-bold text-sm cursor-pointer" onclick={() => expandedAlt = !expandedAlt} onkeydown={(e) => e.key === 'Enter' && (expandedAlt = !expandedAlt)}>
                                        <div class="flex items-center gap-2">
                                            {#if expandedAlt}<ChevronDown size="14"/>{:else}<ChevronRight size="14"/>{/if}
                                            {language.alternateGreetings}
                                        </div>
                                        <button class="p-1 hover:text-white" onclick={(e) => { e.stopPropagation(); char.alternateGreetings.push(""); openTab(`alt:${char.alternateGreetings.length - 1}`, `Greeting #${char.alternateGreetings.length}`, MessageSquareIcon); }}>
                                            <PlusIcon size="14" />
                                        </button>
                                    </div>
                                    {#if expandedAlt}
                                        <div class="pl-4 flex flex-col gap-1 mt-1 border-l border-darkborderc ml-2">
                                            {#each char.alternateGreetings as _, i}
                                                <button class="w-full text-left p-2 rounded-md hover:bg-darkbutton text-sm truncate text-textcolor2" onclick={() => openTab(`alt:${i}`, `Greeting #${i + 1}`, MessageSquareIcon)}>
                                                    {char.alternateGreetings[i] || `Greeting #${i + 1}`}
                                                </button>
                                            {/each}
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        {/if}
                    </div>

                    <!-- Lorebook -->
                    <div class="mt-2">
                        <div role="button" tabindex="0" class="w-full flex items-center justify-between p-2 hover:bg-darkbutton rounded-md text-textcolor font-bold cursor-pointer" onclick={() => expandedLore = !expandedLore} onkeydown={(e) => e.key === 'Enter' && (expandedLore = !expandedLore)}>
                            <div class="flex items-center gap-2">
                                {#if expandedLore}<ChevronDown size="16"/>{:else}<ChevronRight size="16"/>{/if}
                                {language.loreBook}
                            </div>
                            <div class="flex gap-1">
                                <button class="p-1 hover:text-white" title="Add Folder" onclick={(e) => { e.stopPropagation(); addFolder(); }}>
                                    <FolderIcon size="14" />
                                </button>
                                <button class="p-1 hover:text-white" title="Add Entry" onclick={(e) => { e.stopPropagation(); addLorebook(); }}>
                                    <PlusIcon size="14" />
                                </button>
                            </div>
                        </div>
                        {#if expandedLore}
                            <div class="pl-2 flex flex-col gap-1 mt-1">
                                {#each getLoreItems(char.globalLore) as { item, depth, index }}
                                    <div style="padding-left: {depth * 12}px">
                                        <div 
                                            role="button" tabindex="0"
                                            class="w-full text-left p-2 rounded-md hover:bg-darkbutton flex items-center gap-2 truncate cursor-pointer text-textcolor2" 
                                            onclick={() => {
                                                if (item.mode === 'folder') {
                                                    toggleFolder(item.key);
                                                } else {
                                                    openTab(`lore:${index}`, item.comment || 'Unnamed Entry', BookIcon);
                                                }
                                            }}
                                            onkeydown={(e) => e.key === 'Enter' && (item.mode === 'folder' ? toggleFolder(item.key) : openTab(`lore:${index}`, item.comment || 'Unnamed Entry', BookIcon))}
                                        >
                                            {#if item.mode === 'folder'}
                                                {#if openFolders.has(item.key)}<ChevronDown size="14"/>{:else}<ChevronRight size="14"/>{/if}
                                                <FolderIcon size="14" class="text-yellow-500 shrink-0" />
                                                <span class="truncate font-bold">{item.comment || 'Unnamed Folder'}</span>
                                                <button class="ml-auto p-1 hover:text-white z-20" onclick={(e) => { e.stopPropagation(); addLorebook(item.key); }}>
                                                    <PlusIcon size="12" />
                                                </button>
                                            {:else}
                                                <BookIcon size="14" class="shrink-0 opacity-70" />
                                                <span class="truncate">{item.comment || 'Unnamed Entry'}</span>
                                            {/if}
                                        </div>
                                    </div>
                                {/each}
                                {#if char.globalLore.length === 0}
                                    <div class="text-textcolor2 text-xs p-2 text-center">Empty</div>
                                {/if}
                            </div>
                        {/if}
                    </div>
                </div>
            </div>

            <!-- Right Content Area with Tabs -->
            <div class="flex-1 flex flex-col min-w-0 bg-bgcolor">
                {#if tabs.length > 0}
                    <!-- Tab Bar -->
                    <div class="flex bg-darkbg border-b border-selected overflow-x-auto n-scroll shrink-0">
                        {#each tabs as tab (tab.id)}
                            <div 
                                class="flex items-center gap-2 px-3 py-2 border-r border-selected cursor-pointer select-none max-w-48 group shrink-0 {activeTabId === tab.id ? 'bg-bgcolor text-white border-b-2 border-b-blue-500' : 'text-textcolor2 hover:bg-darkbutton hover:text-textcolor'}"
                                onclick={() => activeTabId = tab.id}
                                role="button" tabindex="0"
                                onkeydown={(e) => e.key === 'Enter' && (activeTabId = tab.id)}
                            >
                                {#if tab.icon}
                                    <tab.icon size="14" class="shrink-0" />
                                {/if}
                                <span class="truncate text-xs">{tab.title}</span>
                                <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                     <button class="p-0.5 hover:text-white hover:bg-gray-700 rounded-sm" title="Pop out" onclick={(e) => { e.stopPropagation(); popOutTab(tab.id); }}>
                                        <ExternalLinkIcon size="12" />
                                    </button>
                                    <button class="p-0.5 hover:text-red-400 hover:bg-gray-700 rounded-sm" title="Close" onclick={(e) => { e.stopPropagation(); closeTab(tab.id); }}>
                                        <XIcon size="12" />
                                    </button>
                                </div>
                            </div>
                        {/each}
                    </div>

                    <!-- Tab Content -->
                    <div class="flex-1 overflow-hidden relative">
                         {#each tabs as tab (tab.id)}
                            <div class="absolute inset-0 w-full h-full {activeTabId === tab.id ? 'block' : 'hidden'}">
                                <StudioContent 
                                    char={char} 
                                    tabKey={tab.key} 
                                    onClose={() => closeTab(tab.id)} 
                                />
                            </div>
                         {/each}
                    </div>
                {:else}
                    <div class="flex-1 flex justify-center items-center text-textcolor2 flex-col gap-2">
                        <MenuIcon size="48" class="opacity-20" />
                        <span>Select an item from the sidebar</span>
                    </div>
                {/if}
            </div>
        </div>
    </StudioWindow>
{/if}

<!-- Floating Windows -->
{#each floatingWindows as win (win.id)}
    <StudioWindow
        title={`${win.tab.title} - ${char.name}`}
        bind:x={win.x}
        bind:y={win.y}
        bind:width={win.width}
        bind:height={win.height}
        zIndex={win.zIndex}
        onFocus={() => bringToFront(win.id)}
        onClose={() => closeFloatingWindow(win.id)}
    >
        <StudioContent 
            char={char} 
            tabKey={win.tab.key} 
            onClose={() => closeFloatingWindow(win.id)}
        />
    </StudioWindow>
{/each}