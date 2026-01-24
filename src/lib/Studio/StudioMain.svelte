<script lang="ts">
    import { DBState, studioModeOpen, selectedCharID } from "src/ts/stores.svelte";
    import { language } from "src/lang";
    import { XIcon, PlusIcon, MenuIcon, ChevronRight, ChevronDown, FolderIcon, BookIcon, ExternalLinkIcon, FileTextIcon, MessageSquareIcon, InfoIcon, Settings, CodeIcon, PlayIcon, PanelRightOpen } from '@lucide/svelte';
    import ChatScreen from "src/lib/ChatScreens/ChatScreen.svelte";
    import StudioChat from "./StudioChat.svelte";
    import Button from "../UI/GUI/Button.svelte";
    import StudioWindow from "./StudioWindow.svelte";
    import StudioContent from "./StudioContent.svelte";
    import BackgroundDom from "../ChatScreens/BackgroundDom.svelte";
    import type { character, loreBook, customscript } from "src/ts/storage/database.svelte";
    import { v4 } from "uuid";
    import StudioDashboard from "./StudioDashboard.svelte";
    import StudioRightSidebar from "./StudioRightSidebar.svelte";

    let char = $derived(DBState.db.characters[$selectedCharID] as character);

    import { StudioState, openStudioTab, closeStudioTab, popOutStudioTab, closeFloatingWindow, bringStudioWindowToFront } from "./studioStore.svelte";

    // Re-expose local derived state for template usage if needed (or use StudioState directly)
    let tabs = $derived(StudioState.tabs);
    let activeTabId = $derived(StudioState.activeTabId);
    let floatingWindows = $derived(StudioState.floatingWindows);

    let rightSidebarOpen = $state(false);

    // Initialize with Chat and Settings
    $effect(() => {
        if (StudioState.tabs.length === 0 && StudioState.floatingWindows.length === 0 && char) {
            openStudioTab('chat', 'Chat', MessageSquareIcon);
            openStudioTab('basic:all', 'Character Settings', Settings);
        }
    });

    $effect(() => {
        if (typeof window !== 'undefined') {
            const handleOpenChat = () => {
                const chatTab = StudioState.tabs.find(t => t.key === 'chat');
                if (chatTab) {
                    StudioState.activeTabId = chatTab.id;
                } else {
                    openStudioTab('chat', 'Chat', MessageSquareIcon);
                }
            };
            window.addEventListener('studio-open-chat', handleOpenChat);
            return () => {
                window.removeEventListener('studio-open-chat', handleOpenChat);
            };
        }
    });

</script>

<!-- Main Studio Layout (VSCode Style) -->
{#if char}
    <div class="flex h-full w-full bg-[#1e1e1e] text-[#cccccc] font-sans overflow-hidden">
        
        <!-- Center Content Area with Tabs -->
        <div class="flex-1 flex flex-col min-w-0 bg-[#1e1e1e]">
            {#if tabs.length > 0}
                <!-- Tab Bar -->
                <div class="flex bg-[#252526] border-b border-[#3e3e42] overflow-x-auto n-scroll shrink-0 h-9 items-end">
                    {#each tabs as tab (tab.id)}
                        <div 
                            class="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none max-w-48 group shrink-0 border-r border-[#3e3e42] h-full relative {activeTabId === tab.id ? 'bg-[#1e1e1e] text-white border-t-2 border-t-[#007acc]' : 'bg-[#2d2d2d] text-[#969696] hover:bg-[#2a2d2e]'}"
                            onclick={() => StudioState.activeTabId = tab.id}
                            role="button" tabindex="0"
                            onkeydown={(e) => e.key === 'Enter' && (StudioState.activeTabId = tab.id)}
                        >
                            {#if tab.icon}
                                <tab.icon size="14" class="shrink-0 {activeTabId === tab.id ? 'text-[#007acc]' : ''}" />
                            {/if}
                            <span class="truncate text-xs">{tab.title}</span>
                            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                                 <button class="p-0.5 hover:text-white hover:bg-[#4a4a4a] rounded-sm" title="Pop out" onclick={(e) => { e.stopPropagation(); popOutStudioTab(tab.id); }}>
                                    <ExternalLinkIcon size="12" />
                                </button>
                                <button class="p-0.5 hover:text-white hover:bg-[#4a4a4a] rounded-sm" title="Close" onclick={(e) => { e.stopPropagation(); closeStudioTab(tab.id); }}>
                                    <XIcon size="12" />
                                </button>
                            </div>
                        </div>
                    {/each}
                    <div class="grow h-full border-b border-[#3e3e42]"></div>
                    <button 
                        class="px-3 h-full flex items-center justify-center hover:bg-[#3e3e42] text-[#cccccc] border-b border-[#3e3e42] {rightSidebarOpen ? 'bg-[#3e3e42] text-white' : ''}" 
                        onclick={() => rightSidebarOpen = !rightSidebarOpen}
                        title="Toggle Right Sidebar"
                    >
                        <PanelRightOpen size="16" />
                    </button>
                </div>

                <!-- Tab Content -->
                <div class="flex-1 overflow-hidden relative">
                     {#each tabs as tab (tab.id)}
                        <div class="absolute inset-0 w-full h-full {activeTabId === tab.id ? 'block' : 'hidden'}">
                            {#if tab.key === 'chat'}
                                <div class="w-full h-full bg-bgcolor relative">
                                     <BackgroundDom />
                                     <StudioChat />
                                </div>
                            {:else}
                                <StudioContent 
                                    char={char} 
                                    tabKey={tab.key} 
                                    onClose={() => closeStudioTab(tab.id)} 
                                />
                            {/if}
                        </div>
                     {/each}
                </div>
            {:else}
                <div class="flex-1 flex justify-center items-center text-[#5a5a5a] flex-col gap-4">
                    <div class="w-32 h-32 opacity-20 bg-no-repeat bg-center bg-contain" style="background-image: url('logo.png'); /* Placeholder if needed */">
                         <MenuIcon size="64" />
                    </div>
                    <span class="text-sm">Select a file from the explorer to edit</span>
                    
                    <div class="flex flex-col gap-2 mt-4 text-xs">
                        <div class="flex items-center gap-2">
                            <span class="text-[#858585]">Show All Commands</span>
                            <span class="bg-[#333] px-1.5 py-0.5 rounded text-[#ccc]">Ctrl+Shift+P</span>
                        </div>
                         <div class="flex items-center gap-2">
                            <span class="text-[#858585]">Go to File</span>
                            <span class="bg-[#333] px-1.5 py-0.5 rounded text-[#ccc]">Ctrl+P</span>
                        </div>
                    </div>
                </div>
            {/if}
        </div>

        {#if rightSidebarOpen}
            <StudioRightSidebar onClose={() => rightSidebarOpen = false} />
        {/if}
    </div>
{:else}
    <StudioDashboard />
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
        onFocus={() => bringStudioWindowToFront(win.id)}
        onClose={() => closeFloatingWindow(win.id)}
    >
        <StudioContent 
            char={char} 
            tabKey={win.tab.key} 
            onClose={() => closeFloatingWindow(win.id)}
        />
    </StudioWindow>
{/each}