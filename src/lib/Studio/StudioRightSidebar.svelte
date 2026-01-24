<script lang="ts">
    import { DBState, selectedCharID } from "src/ts/stores.svelte";
    import Toggles from "../SideBars/Toggles.svelte";
    import type { character } from "src/ts/storage/database.svelte";
    import { PanelRightClose, RefreshCwIcon, SettingsIcon, InfoIcon } from "@lucide/svelte";
    import { getCharToken, getChatToken } from "src/ts/tokenizer";
    import { getModelInfo } from "src/ts/model/modellist";
    import { StudioState } from "./studioStore.svelte";
    import TextInput from "../UI/GUI/TextInput.svelte";
    import CheckInput from "../UI/GUI/CheckInput.svelte";
    import NumberInput from "../UI/GUI/NumberInput.svelte";
    import Help from "../Others/Help.svelte";
    import { language } from "src/lang";
    import StudioBotSettings from "./StudioBotSettings.svelte";

    let char = $derived(DBState.db.characters[$selectedCharID] as character);

    interface Props {
        onClose: () => void;
    }
    let { onClose }: Props = $props();

    // Mode State: 'details' | 'settings'
    let mode = $state<'details' | 'settings'>('details');

    // Technical Details State
    let chatTokens = $state(0);
    let charBaseTokens = $state(0);
    let isCalculating = $state(false);
    
    let modelName = $derived(getModelInfo(DBState.db.aiModel).name);
    let maxContext = $derived(DBState.db.maxContext);
    
    let currentChat = $derived(char ? char.chats[char.chatPage] : null);
    let msgCount = $derived(currentChat ? currentChat.message.length : 0);

    // Active Lorebook State - Removed to prevent sidebar switching
    // let activeTab = $derived(StudioState.tabs.find(t => t.id === StudioState.activeTabId));
    // let activeLoreBook = ...

    let isMobile = $state(false);

    $effect(() => {
        const checkMobile = () => {
            isMobile = window.innerWidth <= 640;
        };
        
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    });

    async function calculateTokens() {
        if (!char || !currentChat) return;
        isCalculating = true;
        try {
            chatTokens = await getChatToken(currentChat);
            const charT = await getCharToken(char);
            charBaseTokens = charT.persistant;
        } catch (e) {
            console.error("Token calculation error:", e);
        } finally {
            isCalculating = false;
        }
    }

    $effect(() => {
        if (currentChat && msgCount >= 0) {
           calculateTokens();
        }
    });

</script>

{#if isMobile}
    <!-- Backdrop for mobile -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div 
        class="fixed inset-0 bg-black/50 z-40 transition-opacity duration-300"
        onclick={onClose}
    ></div>
{/if}

<div class="{isMobile ? 'fixed inset-y-0 right-0 z-50 border-l border-[#3e3e42]' : 'border-l border-[#3e3e42] shadow-xl'} {isMobile ? 'w-full' : 'w-80'} h-full bg-[#252526] flex flex-col shadow-xl">
    <div class="px-4 py-2 text-xs font-bold uppercase tracking-wider flex justify-between items-center bg-[#252526] h-9 shrink-0 border-b border-[#3e3e42] text-[#cccccc]">
        <div class="flex gap-2 items-center">
             <button 
                class="hover:text-white flex items-center gap-1 {mode === 'details' ? 'text-white' : 'text-[#858585]'}" 
                onclick={() => mode = 'details'}
            >
                <InfoIcon size={14} />
                <span>Details</span>
             </button>
             <div class="w-px h-3 bg-[#3e3e42]"></div>
             <button 
                class="hover:text-white flex items-center gap-1 {mode === 'settings' ? 'text-white' : 'text-[#858585]'}" 
                onclick={() => mode = 'settings'}
            >
                <SettingsIcon size={14} />
                <span>Settings</span>
             </button>
        </div>
        <button class="hover:bg-[#3e3e42] p-1 rounded text-[#cccccc]" onclick={onClose} title="Close Sidebar">
             <PanelRightClose size="14" />
        </button>
    </div>

    <div class="flex-1 overflow-y-auto bg-[#1e1e1e] text-[#cccccc]">
        {#if mode === 'details'}
                <!-- Technical Details -->
                <div class="p-4 border-b border-[#3e3e42]">
                    <div class="text-xs text-[#999999] flex flex-col gap-2">
                         <div class="flex justify-between items-center">
                            <span>Model:</span>
                            <span class="text-[#cccccc] font-medium truncate ml-2">{modelName}</span>
                         </div>
                         <div class="flex justify-between items-center">
                            <span>Messages:</span>
                            <span class="text-[#cccccc] font-medium">{msgCount}</span>
                         </div>
                         
                         <div class="h-px bg-[#3e3e42] my-1"></div>

                         <div class="flex justify-between items-center">
                            <span>Context Limit:</span>
                            <span class="text-[#cccccc] font-medium">{maxContext}</span>
                         </div>
                         <div class="flex justify-between items-center">
                            <span>Char Base Tokens:</span>
                            <span class="text-[#cccccc] font-medium">{charBaseTokens}</span>
                         </div>
                         <div class="flex justify-between items-center">
                            <span>Chat History Tokens:</span>
                            <span class="text-[#cccccc] font-medium">{chatTokens}</span>
                         </div>
                         <div class="flex justify-between items-center">
                            <span class="font-bold text-[#cccccc]">Total Est. Tokens:</span>
                            <span class="font-bold {chatTokens + charBaseTokens > maxContext ? 'text-red-400' : 'text-green-400'}">
                                {chatTokens + charBaseTokens}
                            </span>
                         </div>
                         <div class="flex justify-between items-center">
                            <span>Remaining:</span>
                            <span class="text-[#cccccc] font-medium">{Math.max(0, maxContext - (chatTokens + charBaseTokens))}</span>
                         </div>

                         <button 
                            class="mt-2 w-full bg-[#3e3e42] hover:bg-[#4e4e52] text-white px-2 py-1.5 rounded text-xs flex items-center justify-center gap-2 transition-colors" 
                            onclick={calculateTokens}
                            disabled={isCalculating}
                        >
                            <RefreshCwIcon size="12" class={isCalculating ? 'animate-spin' : ''} />
                            {isCalculating ? 'Calculating...' : 'Refresh Token Count'}
                        </button>
                    </div>
                </div>
                
                <div class="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-[#252526] h-8 shrink-0 border-b border-[#3e3e42] text-[#cccccc] flex items-center">
                    <span>Quick Toggles</span>
                </div>

                <div class="p-4">
                    {#if char}
                         <Toggles bind:chara={DBState.db.characters[$selectedCharID]} />
                    {:else}
                        <div class="text-center text-[#858585] text-xs mt-4">No character selected</div>
                    {/if}
                </div>
            {:else}
                <!-- Settings Mode -->
                <StudioBotSettings />
            {/if}

    </div>
</div>