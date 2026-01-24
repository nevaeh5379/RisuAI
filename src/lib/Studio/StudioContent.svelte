<script lang="ts">
    import { language } from "src/lang";
    import { XIcon, PlusIcon, CodeIcon } from '@lucide/svelte';
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
    {#if tabKey === 'basic:all'}
        <div class="flex flex-col h-full overflow-y-auto p-4 gap-8">
             <!-- Name -->
            <div class="flex flex-col gap-2">
                <h2 class="text-xl font-bold border-b border-[#3e3e42] pb-1">{language.name}</h2>
                <TextInput bind:value={char.name} size="lg" />
            </div>

            <!-- Description -->
            <div class="flex flex-col gap-2 h-96 shrink-0">
                <h2 class="text-xl font-bold border-b border-[#3e3e42] pb-1">{language.description}</h2>
                <TextAreaInput bind:value={char.desc} height="full" />
            </div>

            <!-- First Message -->
            <div class="flex flex-col gap-2 h-96 shrink-0">
                <h2 class="text-xl font-bold border-b border-[#3e3e42] pb-1">{language.firstMessage}</h2>
                <TextAreaInput bind:value={char.firstMessage} height="full" />
            </div>

            <!-- Creator Notes -->
            <div class="flex flex-col gap-2 h-64 shrink-0">
                <h2 class="text-xl font-bold border-b border-[#3e3e42] pb-1">{language.creatorNotes}</h2>
                <TextAreaInput bind:value={char.creatorNotes} height="full" />
            </div>

            <!-- Advanced Settings -->
            <div class="flex flex-col gap-2">
                 <h2 class="text-xl font-bold border-b border-[#3e3e42] pb-1">{language.advancedSettings}</h2>
                 <AdvancedSettings bind:char={char} />
            </div>
        </div>
    {:else if tabKey === 'basic:name'}
            <div class="flex flex-col gap-4 max-w-2xl mx-auto w-full mt-20">
            <h2 class="text-2xl font-bold">{language.name}</h2>
            <TextInput bind:value={char.name} size="lg" />
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
    {:else if tabKey.startsWith('regex:')}
        {@const index = parseInt(tabKey.split(':')[1])}
        {#if char.customscript && char.customscript[index]}
            <div class="flex flex-col h-full gap-2">
                 <div class="flex justify-between items-center shrink-0">
                     <div class="flex items-center gap-2">
                         <CodeIcon size="20" class="text-pink-400" />
                        <h2 class="text-xl font-bold">Regex Script #{index + 1}</h2>
                     </div>
                    <Button styled="danger" size="sm" onclick={() => {
                        char.customscript.splice(index, 1);
                        onClose();
                    }}>
                        <XIcon size="16" class="mr-1" />
                        {language.remove}
                    </Button>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="flex flex-col gap-1">
                        <span class="font-bold">Comment</span>
                        <TextInput bind:value={char.customscript[index].comment} placeholder="Comment" />
                    </div>
                     <div class="flex flex-col gap-1">
                        <span class="font-bold">Flag</span>
                        <TextInput bind:value={char.customscript[index].flag} placeholder="gm" />
                    </div>
                </div>

                <div class="flex-1 min-h-0 flex flex-col gap-2">
                    <div class="flex-1 flex flex-col gap-1 min-h-0">
                         <span class="font-bold">Regex Pattern (In)</span>
                         <TextAreaInput bind:value={char.customscript[index].in} height="full" />
                    </div>
                     <div class="flex-1 flex flex-col gap-1 min-h-0">
                         <span class="font-bold">Replacement (Out)</span>
                         <TextAreaInput bind:value={char.customscript[index].out} height="full" />
                    </div>
                </div>
            </div>
        {:else}
             <div class="flex justify-center items-center h-full text-textcolor2">
                Script not found or deleted.
            </div>
        {/if}
    {:else if tabKey.startsWith('field:')}
        {@const field = tabKey.split(':')[1]}
        <div class="flex flex-col h-full gap-2">
            <h2 class="text-xl font-bold capitalize">{language[field as keyof typeof language] || field}</h2>
            <div class="flex-1 min-h-0">
                {#if field === 'description'}
                    <TextAreaInput bind:value={(char as character).desc} height="full" />
                {:else if field === 'firstMessage'}
                    <TextAreaInput bind:value={char.firstMessage} height="full" />
                {:else if field === 'creatorNotes'}
                    <TextAreaInput bind:value={char.creatorNotes} height="full" />
                {:else if field === 'exampleMessage'}
                    <TextAreaInput bind:value={char.exampleMessage} height="full" />
                {:else if field === 'systemPrompt'}
                    <TextAreaInput bind:value={char.systemPrompt} height="full" />
                {:else if field === 'backgroundHTML'}
                    <TextAreaInput bind:value={char.backgroundHTML} height="full" />
                {:else if field === 'name'}
                    <TextInput bind:value={char.name} size="lg" />
                {:else}
                    <div class="text-red-500">Unknown field: {field}</div>
                {/if}
            </div>
        </div>
    {/if}
</div>