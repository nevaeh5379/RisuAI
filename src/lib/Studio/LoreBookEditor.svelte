<script lang="ts">
    import { language } from "src/lang";
    import type { loreBook } from "src/ts/storage/database.svelte";
    import { DBState, selectedCharID } from "src/ts/stores.svelte";
    import TextInput from "../UI/GUI/TextInput.svelte";
    import TextAreaInput from "../UI/GUI/TextAreaInput.svelte";
    import NumberInput from "../UI/GUI/NumberInput.svelte";
    import Check from "../UI/GUI/CheckInput.svelte";
    import Help from "../Others/Help.svelte";
    import { tokenizeAccurate } from "src/ts/tokenizer";
    import { getCurrentChat, getCurrentCharacter } from "src/ts/storage/database.svelte";

    interface Props {
        value: loreBook;
        lorePlus?: boolean;
    }

    let { value = $bindable(), lorePlus = false }: Props = $props();

    let tokens = $state(0);

    async function getTokens(data: string) {
        tokens = await tokenizeAccurate(data);
        return tokens;
    }

    function isLocallyActivated(book: loreBook) {
        return book.id ? getCurrentChat()?.localLore.some(e => e.id === book.id) : false;
    }
</script>

<div class="flex flex-row w-full h-full overflow-hidden">
    <!-- Main Area: Prompt -->
    <div class="flex-1 h-full flex flex-col p-4 gap-2 min-w-0">
        <div class="flex justify-between items-center shrink-0">
             <span class="text-xl font-bold">{language.prompt}</span>
             {#await getTokens(value.content)}
                <span class="text-textcolor2 text-sm">{tokens} {language.tokens}</span>
            {:then e}
                <span class="text-textcolor2 text-sm">{e} {language.tokens}</span>
            {/await}
        </div>
        <div class="flex-1 min-h-0 border border-darkborderc rounded-md overflow-hidden bg-darkbg">
            <TextAreaInput highlight autocomplete="off" bind:value={value.content} height="full" margin="none" className="border-0" />
        </div>
    </div>

    <!-- Right Sidebar: Settings -->
    <div class="w-80 h-full border-l border-selected bg-darkbg overflow-y-auto p-4 flex flex-col gap-6 shrink-0">
        <!-- Name -->
        <div class="flex flex-col gap-2">
            <span class="font-bold text-textcolor">{language.name} <Help key="loreName"/></span>
            <TextInput size="md" bind:value={value.comment} />
        </div>

        <!-- Flags -->
        <div class="flex flex-col gap-2 p-3 bg-bgcolor rounded-lg border border-darkborderc">
             <div class="flex items-center justify-between">
                <span class="text-sm">{language.alwaysActive}</span>
                <Check bind:check={value.alwaysActive} name=""/>
            </div>
            
            {#if !lorePlus && !value.useRegex}
                 <div class="flex items-center justify-between">
                    <div class="flex items-center gap-1">
                        <span class="text-sm">{language.selective}</span>
                        <Help key="loreSelective" name=""/>
                    </div>
                    <Check bind:check={value.selective} name=""/>
                </div>
            {/if}

            {#if !lorePlus && !value.alwaysActive}
                <div class="flex items-center justify-between">
                     <div class="flex items-center gap-1">
                        <span class="text-sm">{language.useRegexLorebook}</span>
                        <Help key="useRegexLorebook" name=""/>
                    </div>
                    <Check bind:check={value.useRegex} name=""/>
                </div>
            {/if}
        </div>

        {#if !lorePlus}
            {#if !value.alwaysActive}
                <div class="flex flex-col gap-2">
                    <span class="font-bold text-textcolor">{language.activationKeys} <Help key="loreActivationKey"/></span>
                    <span class="text-xs text-textcolor2">{language.activationKeysInfo}</span>
                    <TextInput size="md" bind:value={value.key} />
                </div>

                {#if value.selective}
                    <div class="flex flex-col gap-2">
                        <span class="font-bold text-textcolor">{language.SecondaryKeys}</span>
                        <span class="text-xs text-textcolor2">{language.activationKeysInfo}</span>
                        <TextInput size="md" bind:value={value.secondkey} />
                    </div>
                {/if}
            {/if}

            {#if !(value.activationPercent === undefined || value.activationPercent === null)}
                <div class="flex flex-col gap-2">
                    <span class="font-bold text-textcolor">{language.activationProbability}</span>
                    <NumberInput size="md" bind:value={value.activationPercent} onChange={() => {
                        if(isNaN(value.activationPercent) || !value.activationPercent || value.activationPercent < 0){
                            value.activationPercent = 0
                        }
                        if(value.activationPercent > 100){
                            value.activationPercent = 100
                        }
                    }} />
                </div>
            {/if}

            <div class="flex flex-col gap-2">
                <span class="font-bold text-textcolor">{language.insertOrder} <Help key="loreorder"/></span>
                <NumberInput size="md" bind:value={value.insertorder} min={0} max={1000} />
            </div>
        {/if}
    </div>
</div>