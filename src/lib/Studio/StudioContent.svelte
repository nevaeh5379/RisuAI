<script lang="ts">
    import { language } from "src/lang";
    import { XIcon, PlusIcon } from '@lucide/svelte';
    import Button from "../UI/GUI/Button.svelte";
    import TextInput from "../UI/GUI/TextInput.svelte";
    import TextAreaInput from "../UI/GUI/TextAreaInput.svelte";
    import LoreBookEditor from "./LoreBookEditor.svelte";
    import AdvancedSettings from "./AdvancedSettings.svelte";
    import type { character } from "src/ts/storage/database.svelte";

    let { 
        char = $bindable(), 
        tabKey,
        onClose = () => {}
    } = $props<{
        char: character,
        tabKey: string,
        onClose?: () => void
    }>();

    $effect(() => {
        if (char) {
            if (char.desc === undefined || char.desc === null) char.desc = '';
            if (char.firstMessage === undefined || char.firstMessage === null) char.firstMessage = '';
            if (char.creatorNotes === undefined || char.creatorNotes === null) char.creatorNotes = '';
        }
    });

</script>

<div class="w-full h-full flex flex-col p-4 overflow-hidden">
    {#if tabKey === 'basic:name'}
            <div class="flex flex-col gap-4 max-w-2xl mx-auto w-full mt-20">
            <h2 class="text-2xl font-bold">{language.name}</h2>
            <TextInput bind:value={char.name} size="lg" />
            </div>
    {:else if tabKey === 'basic:desc'}
        <div class="flex flex-col h-full gap-2">
            <h2 class="text-xl font-bold shrink-0">{language.description}</h2>
            <div class="flex-1 min-h-0">
                <TextAreaInput bind:value={char.desc} height="full" />
            </div>
        </div>
    {:else if tabKey === 'basic:first'}
        <div class="flex flex-col h-full gap-2">
            <h2 class="text-xl font-bold shrink-0">{language.firstMessage}</h2>
            <div class="flex-1 min-h-0">
                <TextAreaInput bind:value={char.firstMessage} height="full" />
            </div>
        </div>
    {:else if tabKey === 'basic:note'}
        <div class="flex flex-col h-full gap-2">
            <h2 class="text-xl font-bold shrink-0">{language.creatorNotes}</h2>
            <div class="flex-1 min-h-0">
                <TextAreaInput bind:value={char.creatorNotes} height="full" />
            </div>
        </div>
    {:else if tabKey === 'advanced'}
        <div class="h-full overflow-hidden">
            <AdvancedSettings bind:char={char} />
        </div>
    {:else if tabKey.startsWith('alt:')}
        {@const index = parseInt(tabKey.split(':')[1])}
        {#if char.alternateGreetings[index] !== undefined}
            <div class="flex flex-col h-full gap-2">
                <div class="flex justify-between items-center shrink-0">
                    <h2 class="text-xl font-bold">{language.alternateGreetings} #{index + 1}</h2>
                    <Button styled="danger" size="sm" onclick={() => {
                        char.alternateGreetings.splice(index, 1);
                        onClose();
                    }}>
                        <XIcon size="16" class="mr-1" />
                        {language.remove}
                    </Button>
                </div>
                <div class="flex-1 min-h-0">
                    {#key tabKey}
                        <TextAreaInput bind:value={char.alternateGreetings[index]} height="full" />
                    {/key}
                </div>
            </div>
        {:else}
            <div class="flex justify-center items-center h-full text-textcolor2">
                Item not found or deleted.
            </div>
        {/if}
    {:else if tabKey.startsWith('lore:')}
        {@const index = parseInt(tabKey.split(':')[1])}
        {#if char.globalLore[index]}
            <div class="flex flex-col h-full gap-2">
                <div class="flex justify-between items-center shrink-0">
                    <h2 class="text-xl font-bold">{language.loreBook}: {char.globalLore[index].comment || 'Unnamed'}</h2>
                    <Button styled="danger" size="sm" onclick={() => {
                        char.globalLore.splice(index, 1);
                        onClose();
                    }}>
                        <XIcon size="16" class="mr-1" />
                        {language.remove}
                    </Button>
                </div>
                <div class="flex-1 min-h-0 overflow-y-auto pr-2">
                    {#key tabKey}
                        <LoreBookEditor bind:value={char.globalLore[index]} />
                    {/key}
                </div>
            </div>
        {:else}
            <div class="flex justify-center items-center h-full text-textcolor2">
                Lorebook entry not found or deleted.
            </div>
        {/if}
    {/if}
</div>