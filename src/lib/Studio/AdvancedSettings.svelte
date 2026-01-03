<script lang="ts">
    import { language } from "src/lang";
    import CheckInput from "../UI/GUI/CheckInput.svelte";
    import TextAreaInput from "../UI/GUI/TextAreaInput.svelte";
    import TextInput from "../UI/GUI/TextInput.svelte";
    import NumberInput from "../UI/GUI/NumberInput.svelte";
    import SelectInput from "../UI/GUI/SelectInput.svelte";
    import OptionInput from "../UI/GUI/OptionInput.svelte";
    import type { character } from "src/ts/storage/database.svelte";

    let { char = $bindable() } = $props<{ char: character }>();

    let currentChaId = $state(char.chaId);
    let tagsString = $state(char.tags.join(', '));

    $effect(() => {
        if (char.chaId !== currentChaId) {
            currentChaId = char.chaId;
            tagsString = char.tags.join(', ');
        }
    });

    function updateTags() {
        char.tags = tagsString.split(',').map(t => t.trim()).filter(t => t);
    }
</script>

<div class="flex flex-col gap-4 p-4 overflow-y-auto h-full">
    <h2 class="text-2xl font-bold">{language.advancedSettings}</h2>

    <!-- System Prompt -->
    <div class="flex flex-col gap-2">
        <span class="text-textcolor font-bold">{language.systemPrompt}</span>
        <span class="text-xs text-textcolor2">Overrides the global system prompt if set.</span>
        <TextAreaInput bind:value={char.systemPrompt} placeholder={language.systemPrompt} />
    </div>

    <!-- Post History Instructions (replaceGlobalNote) -->
    <div class="flex flex-col gap-2">
        <span class="text-textcolor font-bold">Post History Instructions</span>
        <span class="text-xs text-textcolor2">Instructions injected after chat history.</span>
        <TextAreaInput bind:value={char.replaceGlobalNote} placeholder="Instructions..." />
    </div>

    <!-- Metadata -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="flex flex-col gap-2">
            <span class="text-textcolor font-bold">Creator</span>
            <TextInput bind:value={char.creator} placeholder="Creator Name" />
        </div>
        <div class="flex flex-col gap-2">
            <span class="text-textcolor font-bold">Character Version</span>
            <TextInput bind:value={char.characterVersion} placeholder="v1.0" />
        </div>
    </div>

    <!-- Tags -->
    <div class="flex flex-col gap-2">
        <span class="text-textcolor font-bold">Tags</span>
        <TextInput 
            bind:value={tagsString} 
            oninput={updateTags}
            placeholder="tag1, tag2, tag3" 
        />
    </div>

    <div class="w-full h-px bg-darkborderc my-2"></div>

    <!-- RisuAI Extensions -->
    <div class="flex flex-col gap-4">
        <span class="text-lg font-bold">RisuAI Extensions</span>
        
        <div class="flex flex-col gap-2">
            <span class="text-textcolor font-bold">View Screen</span>
            <SelectInput bind:value={char.viewScreen}>
                <OptionInput value="none">None</OptionInput>
                <OptionInput value="emotion">Emotion Images</OptionInput>
                <OptionInput value="imggen">Image Generation</OptionInput>
                <OptionInput value="vn">Visual Novel</OptionInput>
            </SelectInput>
        </div>

        <div class="flex flex-col gap-1">
            <CheckInput bind:check={char.utilityBot} name="Utility Bot" />
            <span class="text-xs text-textcolor2 ml-7">If enabled, this character will not be counted in interaction stats.</span>
        </div>

        <div class="flex flex-col gap-1">
            <CheckInput bind:check={char.lorePlus} name="Lore+" />
            <span class="text-xs text-textcolor2 ml-7">Enable Lore+ extension features (Scan depth, Token budget, etc. per character).</span>
        </div>

        <div class="flex flex-col gap-1">
            <CheckInput bind:check={char.largePortrait} name="Large Portrait" />
            <span class="text-xs text-textcolor2 ml-7">Use larger portrait in chat.</span>
        </div>

        <div class="flex flex-col gap-1">
            <CheckInput bind:check={char.inlayViewScreen} name="Inlay View Screen" />
            <span class="text-xs text-textcolor2 ml-7">Show view screen inside the chat area.</span>
        </div>

        <div class="flex flex-col gap-2">
            <span class="text-textcolor font-bold">Background HTML</span>
            <span class="text-xs text-textcolor2">Custom HTML rendered behind the chat.</span>
            <TextAreaInput bind:value={char.backgroundHTML} placeholder="<div>...</div>" />
        </div>
        
        <div class="flex flex-col gap-2">
            <span class="text-textcolor font-bold">Additional Text</span>
            <span class="text-xs text-textcolor2">Text appended to the character definition (invisible to user usually, depends on formatter).</span>
            <TextAreaInput bind:value={char.additionalText} placeholder="" />
        </div>
    </div>

    <div class="w-full h-px bg-darkborderc my-2"></div>

    <!-- Depth Prompt -->
    <div class="flex flex-col gap-4">
        <span class="text-lg font-bold">Depth Prompt</span>
        <span class="text-xs text-textcolor2">Prompt inserted at a specific depth in the chat history.</span>
        
        {#if !char.depth_prompt}
            <button class="bg-darkbutton hover:bg-darkbutton-hover text-textcolor px-4 py-2 rounded-md self-start" onclick={() => char.depth_prompt = { depth: 4, prompt: "" }}>
                Enable Depth Prompt
            </button>
        {:else}
            <div class="flex flex-col gap-2">
                <span class="text-textcolor">Depth</span>
                <NumberInput bind:value={char.depth_prompt.depth} min={0} />
                <span class="text-textcolor">Prompt</span>
                <TextAreaInput bind:value={char.depth_prompt.prompt} />
                <button class="text-red-400 hover:text-red-300 text-sm self-start mt-2" onclick={() => char.depth_prompt = undefined}>
                    Remove Depth Prompt
                </button>
            </div>
        {/if}
    </div>
</div>
