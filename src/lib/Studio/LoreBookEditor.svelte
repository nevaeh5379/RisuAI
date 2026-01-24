<script lang="ts">
    import { language } from "src/lang";
    import type { loreBook } from "src/ts/storage/database.svelte";
    import TextAreaInput from "../UI/GUI/TextAreaInput.svelte";
    import { tokenizeAccurate } from "src/ts/tokenizer";
    import { getCurrentChat } from "src/ts/storage/database.svelte";

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

<div class="flex flex-col w-full h-full p-4 gap-2 overflow-hidden">
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