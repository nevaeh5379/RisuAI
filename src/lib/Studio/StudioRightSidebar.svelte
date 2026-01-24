<script lang="ts">
    import { DBState, selectedCharID } from "src/ts/stores.svelte";
    import Toggles from "../SideBars/Toggles.svelte";
    import type { character } from "src/ts/storage/database.svelte";
    import { PanelRightClose } from "@lucide/svelte";

    let char = $derived(DBState.db.characters[$selectedCharID] as character);

    interface Props {
        onClose: () => void;
    }
    let { onClose }: Props = $props();

</script>

<div class="w-80 h-full bg-[#252526] flex flex-col border-l border-[#3e3e42] shadow-xl">
    <div class="px-4 py-2 text-xs font-bold uppercase tracking-wider flex justify-between items-center bg-[#252526] h-9 shrink-0 border-b border-[#3e3e42] text-[#cccccc]">
        <span>Quick Toggles</span>
        <button class="hover:bg-[#3e3e42] p-1 rounded text-[#cccccc]" onclick={onClose} title="Close Sidebar">
             <PanelRightClose size="14" />
        </button>
    </div>
    
    <div class="flex-1 overflow-y-auto p-4 text-[#cccccc]">
        {#if char}
             <Toggles bind:chara={DBState.db.characters[$selectedCharID]} />
        {:else}
            <div class="text-center text-[#858585] text-xs mt-4">No character selected</div>
        {/if}
    </div>
</div>