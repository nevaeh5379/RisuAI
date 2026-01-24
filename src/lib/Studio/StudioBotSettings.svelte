<script lang="ts">
    import { language } from "../../lang";
    import { DBState } from "src/ts/stores.svelte";
    import { selectedCharID, ShowRealmFrameStore, hypaV3ModalOpen } from "src/ts/stores.svelte";
    import { openStudioTab } from "./studioStore.svelte";
    import Sortable from "sortablejs/modular/sortable.core.esm.js";



    import { v4 } from "uuid";
    import { 
        getElevenTTSVoices, 
        getWebSpeechTTSVoices, 
        getVOICEVOXVoices, 
        oaiVoices,
        getNovelAIVoices 
    } from "src/ts/process/tts";
    import { exportChar } from "src/ts/characterCards";
    import { 
        addCharEmotion, 
        rmCharEmotion, 
        getCharImage, 
        changeCharImage,
        removeChar,
        addingEmotion,
        selectCharImg
    } from "src/ts/characters";
    import { updateInlayScreen } from "src/ts/process/inlayScreen";
    import { exportRegex, importRegex } from "src/ts/process/scripts";
    import { alertTOS, showHypaV2Alert } from "src/ts/alert";
    import { selectMultipleFile, selectSingleFile, getAuthorNoteDefaultText } from "src/ts/util";
    import { registerOnnxModel } from "src/ts/process/transformers";
    import { applyModule } from "src/ts/process/modules";
    import SliderInput from "../UI/GUI/SliderInput.svelte";
    import { getFileSrc } from "src/ts/globalApi.svelte";
    import type { character, groupChat, loreBook, customscript } from "src/ts/storage/database.svelte";
    import { saveImage as saveAsset } from "src/ts/storage/database.svelte";
    import { 
        UserIcon, 
        SmileIcon, 
        ActivityIcon, 
        BookIcon, 
        Volume2Icon, 
        Share2Icon,
        PlusIcon,
        TrashIcon,
        DownloadIcon,
        HardDriveUploadIcon,
        ArrowUp,
        ArrowDown,
        ImageIcon,
        ImageOffIcon,
        ExternalLinkIcon,
        FolderIcon,
        ChevronDown,
        ChevronRight,
        FileTextIcon
    } from "@lucide/svelte";
    import TextInput from "../UI/GUI/TextInput.svelte";
    import TextAreaInput from "../UI/GUI/TextAreaInput.svelte";
    import NumberInput from "../UI/GUI/NumberInput.svelte";
    import SelectInput from "../UI/GUI/SelectInput.svelte";
    import OptionInput from "../UI/GUI/OptionInput.svelte";
    import CheckInput from "../UI/GUI/CheckInput.svelte";
    import Button from "../UI/GUI/Button.svelte";
    import Help from "../Others/Help.svelte";
    import MultiLangInput from "../UI/GUI/MultiLangInput.svelte";
    import TriggerList from "../SideBars/Scripts/TriggerList.svelte";
    import RegexList from "../SideBars/Scripts/RegexList.svelte";
    import Toggles from "../SideBars/Toggles.svelte";
    import { tokenizeAccurate } from "src/ts/tokenizer";

    let activeTab = $state(0);
    // 0: General, 1: Display, 2: Scripts, 3: Lorebook, 4: TTS, 5: Advanced, 6: Management

    let char = $derived(DBState.db.characters[$selectedCharID]);
    let charType = $derived(char?.type);
    let licensed = $derived(charType === 'character' ? (char as character).license : '');

    // Token counting
    let tokens = $state({
        desc: 0,
        firstMsg: 0,
        localNote: 0
    });
    
    let lastTokensCheck = {
        desc: "",
        firstMsg: "",
        localNote: ""
    };

    let isTokenizing = false;
    async function loadTokenize() {
        if (!char || isTokenizing) return;
        isTokenizing = true;
        try {
            if (charType !== "group") {
                const c = char as character;
                if (c.desc !== lastTokensCheck.desc) {
                    lastTokensCheck.desc = c.desc;
                    if (c.desc) tokens.desc = await tokenizeAccurate(c.desc);
                }
                if (c.firstMessage !== lastTokensCheck.firstMsg) {
                    lastTokensCheck.firstMsg = c.firstMessage;
                    if (c.firstMessage) tokens.firstMsg = await tokenizeAccurate(c.firstMessage);
                }
            }
            const currentChat = char.chats[char.chatPage];
            if (currentChat?.note && currentChat.note !== lastTokensCheck.localNote) {
                lastTokensCheck.localNote = currentChat.note;
                tokens.localNote = await tokenizeAccurate(currentChat.note);
            }
        } finally {
            isTokenizing = false;
        }
    }

    $effect(() => {
        if (char) loadTokenize();
    });

    // Emotion Images State
    let emos: [string, string][] = $state([]);
    $effect.pre(() => {
       if (char && char.emotionImages) {
           emos = char.emotionImages;
       }
    });

    // Asset Preview State
    let assetFileExtensions: string[] = $state([]);
    let assetFilePath: string[] = $state([]);

    $effect.pre(() => {
        if (char && charType === 'character' && DBState.db.useAdditionalAssetsPreview) {
             const c = char as character;
             if (c.additionalAssets) {
                // Determine if we actually need to update to avoid loop
                const newLen = c.additionalAssets.length;
                if (newLen !== assetFileExtensions.length) { 
                    assetFileExtensions = new Array(newLen);
                    assetFilePath = new Array(newLen);
                    c.additionalAssets.forEach((asset, i) => {
                        if (asset.length > 2 && asset[2]) {
                            assetFileExtensions[i] = asset[2];
                        } else {
                            assetFileExtensions[i] = asset[1].split('.').pop() || "";
                        }
                        getFileSrc(asset[1]).then(path => assetFilePath[i] = path);
                    });
                }
             }
        }
    });

    // Fish Speech State
    let fishSpeechModels: any[] = $state([]);
    async function getFishSpeechModels() {
        try {
            const res = await fetch(`https://api.fish.audio/model?self=true`, {
                headers: { Authorization: `Bearer ${DBState.db.fishSpeechKey}` }
            });
            const data = await res.json();
            if (Array.isArray(data.items)) {
                fishSpeechModels = data.items.map((item: any) => ({
                    _id: item._id || "",
                    title: item.title || "",
                    description: item.description || ""
                }));
            }
        } catch (e) {
            console.error(e);
        }
    }

    let iconRemoveMode = $state(false);

    function moveAlternateGreetingUp(index: number) {
        if (index === 0 || charType !== 'character') return;
        const c = char as character;
        const temp = c.alternateGreetings[index];
        c.alternateGreetings[index] = c.alternateGreetings[index - 1];
        c.alternateGreetings[index - 1] = temp;
    }

    function moveAlternateGreetingDown(index: number) {
        const c = char as character;
        if (index === c.alternateGreetings.length - 1 || charType !== 'character') return;
        const temp = c.alternateGreetings[index];
        c.alternateGreetings[index] = c.alternateGreetings[index + 1];
        c.alternateGreetings[index + 1] = temp;
    }

    // Lorebook Logic
    let expandedLore = $state<Set<string>>(new Set());
    let expandedEntries = $state<Set<string>>(new Set());

    function addLorebook(folderKey?: string) {
        if (!char) return;
        const newBook: loreBook = {
            id: v4(),
            key: '',
            secondkey: '',
            comment: 'New Entry',
            content: '',
            mode: 'normal',
            insertorder: 100,
            alwaysActive: true,
            selective: false,
            folder: folderKey
        };
        char.globalLore.push(newBook);
        
        // Use ID for entry expansion
        const newSet = new Set(expandedEntries);
        newSet.add(newBook.id);
        expandedEntries = newSet;

        if (folderKey) {
            const newSet = new Set(expandedLore);
            newSet.add(folderKey);
            expandedLore = newSet;
        }
    }

    function addLoreFolder() {
        if (!char) return;
        const newBook: loreBook = {
            id: v4(),
            key: v4(),
            secondkey: '',
            comment: 'New Folder',
            content: '',
            mode: 'folder',
            insertorder: 100,
            alwaysActive: true,
            selective: false
        };
        char.globalLore.push(newBook);
    }

    function toggleLoreFolder(key: string) {
        const newSet = new Set(expandedLore);
        if (newSet.has(key)) {
            newSet.delete(key);
        } else {
            newSet.add(key);
        }
        expandedLore = newSet;
    }

    function toggleEntry(id: string) {
        const newSet = new Set(expandedEntries);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        expandedEntries = newSet;
    }

    function getLoreItems(items: loreBook[], folderKey?: string, depth: number = 0): any[] {
        let result: any[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            
            if ((!folderKey && !item.folder) || (item.folder === folderKey)) {
                result.push({ item, depth, index: i });
                if (item.mode === 'folder' && expandedLore.has(item.key)) {
                    result = result.concat(getLoreItems(items, item.key, depth + 1));
                }
            }
        }
        return result;
    }

    function sortable(node: HTMLElement, { folderKey }: { folderKey: string | undefined }) {
        const sortableInstance = Sortable.create(node, {
            group: 'lorebook',
            animation: 150,
            handle: '.drag-handle', 
            filter: 'input, textarea, button, .no-drag',
            preventOnFilter: false,
            onEnd: (evt) => {
                const { newIndex, oldIndex, to, from, item } = evt;
                if (newIndex === undefined || oldIndex === undefined) return;
                
                const fromFolder = from.dataset.folder || undefined;
                const toFolder = to.dataset.folder || undefined;
                
                if (!char) return;

                const itemId = item.dataset.id;
                if (!itemId) return;

                const globalIndex = char.globalLore.findIndex(i => i.id === itemId);
                if (globalIndex === -1) return;
                const movedItem = char.globalLore[globalIndex];

                const newGlobalLore = [...char.globalLore];
                newGlobalLore.splice(globalIndex, 1);

                if (toFolder !== fromFolder) {
                    if (toFolder) movedItem.folder = toFolder;
                    else delete movedItem.folder;
                }

                const targetSubset = newGlobalLore.filter(i => (i.folder || undefined) === toFolder);
                
                let insertBeforeIndex = -1;
                
                if (newIndex < targetSubset.length) {
                    const targetItem = targetSubset[newIndex];
                    insertBeforeIndex = newGlobalLore.indexOf(targetItem);
                } else {
                    if (targetSubset.length > 0) {
                        const lastItem = targetSubset[targetSubset.length - 1];
                        insertBeforeIndex = newGlobalLore.indexOf(lastItem) + 1;
                    } else {
                        insertBeforeIndex = newGlobalLore.length;
                    }
                }

                if (insertBeforeIndex === -1) insertBeforeIndex = newGlobalLore.length;
                newGlobalLore.splice(insertBeforeIndex, 0, movedItem);

                char.globalLore = newGlobalLore;
            }
        });

        return {
            destroy() {
                sortableInstance.destroy();
            }
        };
    }

</script>

{#snippet loreTree(folderKey: string | undefined)}
    <div 
        class="flex flex-col gap-0.5 min-h-2 p-0.5 rounded {folderKey ? 'ml-3 border-l-2 border-[#3e3e42] pl-1' : ''}" 
        use:sortable={{ folderKey }}
        data-folder={folderKey}
    >
        {#each char?.globalLore.filter(i => (i.folder || undefined) === folderKey) as item (item.id)}
             <div data-id={item.id} class="rounded bg-[#2a2d2e]/50 mb-1 border border-transparent hover:border-[#3e3e42] flex flex-col">
                 <!-- Header - Clickable -->
                 <div 
                     class="w-full text-left py-1 px-2 hover:bg-[#353839] flex items-center gap-1.5 cursor-pointer text-[#cccccc] text-xs group rounded"
                     role="button" 
                     tabindex="0"
                     onclick={() => {
                         if (item.mode === 'folder') {
                             toggleLoreFolder(item.key);
                         } else {
                             toggleEntry(item.id);
                         }
                     }}
                     onkeydown={(e) => e.key === 'Enter' && (item.mode === 'folder' ? toggleLoreFolder(item.key) : toggleEntry(item.id))}
                 >
                    {#if item.mode === 'folder'}
                        {#if expandedLore.has(item.key)}<ChevronDown size="12"/>{:else}<ChevronRight size="12"/>{/if}
                        <FolderIcon size="12" class="text-[#c69a5a] shrink-0" />
                        <span class="truncate font-normal flex-1">{item.comment || 'Unnamed Folder'}</span>
                        <button class="p-0.5 hover:bg-[#3e3e42] rounded opacity-0 group-hover:opacity-100" onclick={(e) => { e.stopPropagation(); addLorebook(item.key); }}>
                            <PlusIcon size="10" />
                        </button>
                        <button class="p-0.5 hover:text-red-500 rounded opacity-0 group-hover:opacity-100" onclick={(e) => { e.stopPropagation(); char.globalLore = char.globalLore.filter(i => i !== item && i.folder !== item.key); }}>
                            <TrashIcon size="10" />
                        </button>
                    {:else}
                        {#if expandedEntries.has(item.id)}<ChevronDown size="12"/>{:else}<ChevronRight size="12"/>{/if}
                        <BookIcon size="12" class="shrink-0 text-blue-300 opacity-80" />
                        <span class="truncate flex-1">{item.comment || 'Unnamed Entry'}</span>
                        <button class="p-0.5 hover:text-red-500 rounded opacity-0 group-hover:opacity-100" onclick={(e) => { e.stopPropagation(); char.globalLore = char.globalLore.filter(i => i !== item); }}>
                            <TrashIcon size="10" />
                        </button>
                    {/if}
                </div>

                <!-- Inline Settings (Content) - Interactive Sibling -->
                {#if item.mode !== 'folder' && expandedEntries.has(item.id)}
                    <div 
                        class="pl-4 pb-2 pr-2 flex flex-col gap-2 cursor-default bg-[#1e1e1e] rounded-b border-t border-[#3e3e42] mt-0.5" 
                    >
                        <div class="flex flex-col gap-1 mt-2">
                            <span class="font-bold text-[#858585]">Title</span>
                            <TextInput size="sm" bind:value={item.comment} />
                        </div>
                        
                        {#if !item.alwaysActive}
                            <div class="flex flex-col gap-1">
                                <span class="font-bold text-[#858585]">Keys</span>
                                <TextInput size="sm" bind:value={item.key} placeholder="primary, keys" />
                                {#if item.selective}
                                    <span class="font-bold text-[#858585] mt-1">Secondary Keys</span>
                                    <TextInput size="sm" bind:value={item.secondkey} placeholder="secondary, keys" />
                                {/if}
                            </div>
                        {/if}
                        
                        <div class="flex flex-col gap-1">
                            <div class="flex justify-between items-center">
                                <span class="font-bold text-textcolor">Content</span>
                                <button 
                                    class="text-[#858585] hover:text-white" 
                                    title="Maximize"
                                    onclick={() => {
                                        const idx = char.globalLore.indexOf(item);
                                        openStudioTab(`lore:${idx}`, item.comment || 'Unnamed Entry', BookIcon);
                                    }}
                                >
                                    <ExternalLinkIcon size="14" />
                                </button>
                            </div>
                            <TextAreaInput size="sm" bind:value={item.content} />
                        </div>

                        <div class="flex flex-col gap-1">
                                <span class="font-bold text-[#858585]">Order</span>
                                <NumberInput size="sm" bind:value={item.insertorder} />
                        </div>

                        <div class="flex flex-col gap-1">
                            <CheckInput bind:check={item.alwaysActive} name={language.alwaysActive} />
                            <CheckInput bind:check={item.selective} name={language.selective} />
                        </div>
                    </div>
                {/if}

                <!-- Nested Folder Content -->
                {#if item.mode === 'folder' && expandedLore.has(item.key)}
                    <div class="pl-2 pb-1">
                         {@render loreTree(item.key)}
                    </div>
                {/if}
             </div>
        {/each}
        {#if (char?.globalLore.filter(i => (i.folder || undefined) === folderKey).length || 0) === 0}
            <div class="text-[#444] text-[10px] italic p-1 text-center select-none no-drag">
                {folderKey ? 'Empty Folder' : 'No Lorebooks'}
            </div>
        {/if}
    </div>
{/snippet}

<div class="flex flex-col h-full text-[#cccccc] text-xs">
    <!-- Tab Navigation -->
    <div class="flex border-b border-[#3e3e42] bg-[#252526] overflow-x-auto n-scroll">
        <button class="p-2 hover:bg-[#3e3e42] flex-1 min-w-8 flex justify-center {activeTab === 0 ? 'text-white border-b-2 border-blue-500' : 'text-[#858585]'}" onclick={() => activeTab = 0} title={language.character}>
            <UserIcon size={16} />
        </button>
        <button class="p-2 hover:bg-[#3e3e42] flex-1 min-w-8 flex justify-center {activeTab === 1 ? 'text-white border-b-2 border-blue-500' : 'text-[#858585]'}" onclick={() => activeTab = 1} title={language.characterDisplay}>
            <SmileIcon size={16} />
        </button>
        <button class="p-2 hover:bg-[#3e3e42] flex-1 min-w-8 flex justify-center {activeTab === 2 ? 'text-white border-b-2 border-blue-500' : 'text-[#858585]'}" onclick={() => activeTab = 2} title={language.scripts}>
            <ActivityIcon size={16} />
        </button>
        <button class="p-2 hover:bg-[#3e3e42] flex-1 min-w-8 flex justify-center {activeTab === 3 ? 'text-white border-b-2 border-blue-500' : 'text-[#858585]'}" onclick={() => activeTab = 3} title={language.loreBook}>
            <BookIcon size={16} />
        </button>
        {#if charType === 'character'}
            <button class="p-2 hover:bg-[#3e3e42] flex-1 min-w-8 flex justify-center {activeTab === 4 ? 'text-white border-b-2 border-blue-500' : 'text-[#858585]'}" onclick={() => activeTab = 4} title="TTS">
                <Volume2Icon size={16} />
            </button>
            <button class="p-2 hover:bg-[#3e3e42] flex-1 min-w-8 flex justify-center {activeTab === 5 ? 'text-white border-b-2 border-blue-500' : 'text-[#858585]'}" onclick={() => activeTab = 5} title={language.advancedSettings}>
                <Share2Icon size={16} class="rotate-90"/> <!-- Using versatile icon -->
            </button>
        {/if}
        <button class="p-2 hover:bg-[#3e3e42] flex-1 min-w-8 flex justify-center {activeTab === 6 ? 'text-white border-b-2 border-blue-500' : 'text-[#858585]'}" onclick={() => activeTab = 6} title="Management">
            <Share2Icon size={16} />
        </button>
    </div>

    <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {#if !char}
            <div class="text-center text-[#858585]">No character selected</div>
        {:else}
            <!-- General Tab -->
            {#if activeTab === 0}
                <div class="flex flex-col gap-2">
                    <span class="font-bold text-textcolor">Name</span>
                    <TextInput size="sm" bind:value={char.name} />
                </div>

                {#if charType === 'character'}
                    <div class="flex flex-col gap-2">
                        <div class="flex justify-between items-center">
                            <span class="font-bold text-textcolor">{language.description}</span>
                            <button class="p-1 hover:text-white text-[#858585]" title="Open in Editor" onclick={() => openStudioTab('field:description', language.description, FileTextIcon)}>
                                <ExternalLinkIcon size={12} />
                            </button>
                        </div>
                        <TextAreaInput size="sm" bind:value={(char as character).desc} />
                        <span class="text-[#858585]">{tokens.desc} {language.tokens}</span>
                    </div>

                    <div class="flex flex-col gap-2">
                        <div class="flex justify-between items-center">
                            <span class="font-bold text-textcolor">{language.firstMessage}</span>
                            <button class="p-1 hover:text-white text-[#858585]" title="Open in Editor" onclick={() => openStudioTab('field:firstMessage', language.firstMessage, FileTextIcon)}>
                                <ExternalLinkIcon size={12} />
                            </button>
                        </div>
                        <TextAreaInput size="sm" bind:value={char.firstMessage} />
                        <span class="text-[#858585]">{tokens.firstMsg} {language.tokens}</span>
                    </div>
                {/if}

                <div class="flex flex-col gap-2">
                    <div class="flex justify-between items-center">
                        <span class="font-bold text-textcolor">{language.authorNote}</span>
                        <!-- Local note is special, usually per chat, handling it might be complex efficiently in tabs if chat changes? 
                             Actually StudioContent binds to 'char' not 'chat'. So let's skip for now or bind carefully. -->
                    </div>
                    <TextAreaInput size="sm" bind:value={char.chats[char.chatPage].note} placeholder={getAuthorNoteDefaultText()} />
                    <span class="text-[#858585]">{tokens.localNote} {language.tokens}</span>
                </div>
                
                <Toggles bind:chara={DBState.db.characters[$selectedCharID]} noContainer />

            <!-- Display Tab -->
            {:else if activeTab === 1}
                 <!-- Same Display Tab Content -->
                 <div class="flex flex-col gap-4">
                    <!-- Avatar Selection -->
                    <div class="p-2 border border-[#3e3e42] rounded flex flex-wrap gap-2">
                         {#if char.image}
                            <button class="relative group" onclick={() => {
                                if (iconRemoveMode) {
                                    char.image = "";
                                    if ((char as character).ccAssets?.length > 0) changeCharImage($selectedCharID, 0);
                                    iconRemoveMode = false;
                                }
                            }}>
                                {#await getCharImage(char.image, (char as character).largePortrait ? "lgcss" : "css") then im}
                                    <div class="w-16 h-16 rounded bg-cover bg-center border border-[#3e3e42] {iconRemoveMode ? 'ring-2 ring-red-500' : ''}" style={im}></div>
                                {/await}
                            </button>
                         {/if}
                         {#if (char as character).ccAssets}
                            {#each (char as character).ccAssets as asset, i}
                                <button onclick={() => {
                                    if (!iconRemoveMode) changeCharImage($selectedCharID, i);
                                    else {
                                        (char as character).ccAssets.splice(i, 1);
                                        iconRemoveMode = false;
                                    }
                                }}>
                                    {#await getCharImage(asset.uri, (char as character).largePortrait ? "lgcss" : "css") then im}
                                        <div class="w-16 h-16 rounded bg-cover bg-center border border-[#3e3e42] hover:ring-2 ring-blue-500 {iconRemoveMode ? 'ring-2 ring-red-500' : ''}" style={im}></div>
                                    {/await}
                                </button>
                            {/each}
                         {/if}
                         <button class="w-16 h-16 rounded border border-dashed border-[#666] flex items-center justify-center hover:border-blue-500 text-[#858585] hover:text-white" onclick={() => selectCharImg($selectedCharID)}>
                            <PlusIcon size={20} />
                         </button>
                    </div>
                    <div class="flex justify-end">
                        <button class="{iconRemoveMode ? 'text-red-500' : 'text-[#858585] hover:text-white'}" onclick={() => iconRemoveMode = !iconRemoveMode}>
                            <TrashIcon size={16} />
                        </button>
                    </div>

                    {#if charType === 'character' && char.image}
                         <CheckInput bind:check={(char as character).largePortrait} name={language.largePortrait} />
                    {/if}

                    <div class="h-px bg-[#3e3e42]"></div>

                    <!-- View Screen -->
                    <div class="flex flex-col gap-2">
                        <span class="font-bold text-textcolor">{language.viewScreen}</span>
                        <SelectInput size="sm" bind:value={char.viewScreen} onchange={() => {
                             if (charType === 'character') DBState.db.characters[$selectedCharID] = updateInlayScreen(char as character);
                        }}>
                             <OptionInput value="none">{language.none}</OptionInput>
                             <OptionInput value="emotion">{language.emotionImage}</OptionInput>
                             <OptionInput value="imggen">{language.imageGeneration}</OptionInput>
                             {#if DBState.db.tpo}<OptionInput value="vn">VN test</OptionInput>{/if}
                        </SelectInput>
                    </div>

                    {#if char.viewScreen === "emotion"}
                        <div class="flex flex-col gap-2 p-2 border border-[#3e3e42] rounded">
                             {#if char.emotionImages}
                                 {#each char.emotionImages as emo, i}
                                    <div class="flex items-center gap-2">
                                         <div class="w-8 h-8 bg-[#333] rounded"></div> <!-- Placeholder for optimization -->
                                         <TextInput size="sm" bind:value={char.emotionImages[i][0]} placeholder="Emotion Name" />
                                         <button class="hover:text-red-500" onclick={() => rmCharEmotion($selectedCharID, i)}><TrashIcon size={14}/></button>
                                    </div>
                                 {/each}
                                 <button class="text-[#858585] hover:text-white flex justify-center" onclick={() => addCharEmotion($selectedCharID)}><PlusIcon size={16}/></button>
                             {/if}
                        </div>
                        <CheckInput bind:check={(char as character).inlayViewScreen} name={language.inlayViewScreen} />
                    {/if}
                 </div>

            <!-- Scripts Tab -->
            {:else if activeTab === 2}
                 {#if charType === 'character'}
                    <div class="flex flex-col gap-4">
                        <div class="flex flex-col gap-2">
                             <div class="flex justify-between items-center">
                                <span class="font-bold text-textcolor">{language.backgroundHTML}</span>
                                <button class="p-1 hover:text-white text-[#858585]" title="Open in Editor" onclick={() => openStudioTab('field:backgroundHTML', language.backgroundHTML, FileTextIcon)}>
                                    <ExternalLinkIcon size={12} />
                                </button>
                             </div>
                             <TextAreaInput size="sm" bind:value={char.backgroundHTML} />
                        </div>
                        
                        <div class="flex flex-col gap-2">
                            <div class="flex justify-between items-center">
                                <span class="font-bold text-textcolor">{language.regexScript}</span>
                                <div class="flex gap-2">
                                    <button class="hover:text-blue-500" onclick={() => (char as character).customscript.push({comment: "", in: "", out: "", type: "editinput"})}><PlusIcon size={14}/></button>
                                    <button class="hover:text-blue-500" onclick={() => exportRegex(char.customscript)}><DownloadIcon size={14}/></button>
                                    <button class="hover:text-blue-500" onclick={async () => char.customscript = await importRegex(char.customscript)}><HardDriveUploadIcon size={14}/></button>
                                </div>
                            </div>
                            <RegexList bind:value={char.customscript} />
                        </div>

                        <div class="flex flex-col gap-2">
                             <span class="font-bold text-textcolor">{language.triggerScript}</span>
                             <TriggerList bind:value={(char as character).triggerscript} lowLevelAble={char.lowLevelAccess} />
                        </div>
                    </div>
                 {/if}

            <!-- Lorebook Tab (New) -->
            {:else if activeTab === 3}
                <div class="flex flex-col gap-2 h-full">
                    <div class="flex justify-between items-center">
                        <span class="font-bold text-textcolor">{language.loreBook}</span>
                        <div class="flex gap-1">
                            <button class="p-1 hover:text-white text-[#858585]" title="Add Folder" onclick={() => addLoreFolder()}>
                                <FolderIcon size="14" />
                            </button>
                            <button class="p-1 hover:text-white text-[#858585]" title="Add Entry" onclick={() => addLorebook()}>
                                <PlusIcon size="14" />
                            </button>
                        </div>
                    </div>

                    <div class="flex flex-col gap-0.5 mt-0.5 flex-1 overflow-y-auto min-h-0">
                        {@render loreTree(undefined)}
                        {#if char.globalLore.length === 0}
                             <div class="text-[#666666] text-xs p-4 text-center">Empty Lorebook</div>
                        {/if}
                    </div>
                </div>

            <!-- TTS Tab -->
            {:else if activeTab === 4}
                 <div class="flex flex-col gap-4">
                     <div class="flex flex-col gap-2">
                        <span class="font-bold text-textcolor">{language.provider}</span>
                        <SelectInput size="sm" bind:value={char.ttsMode}>
                            <OptionInput value="">{language.disabled}</OptionInput>
                            <OptionInput value="elevenlab">ElevenLabs</OptionInput>
                            <OptionInput value="webspeech">Web Speech</OptionInput>
                            <OptionInput value="VOICEVOX">VOICEVOX</OptionInput>
                            <OptionInput value="openai">OpenAI</OptionInput>
                            <OptionInput value="novelai">NovelAI</OptionInput>
                            <OptionInput value="huggingface">Huggingface</OptionInput>
                            <OptionInput value="vits">VITS</OptionInput>
                            <OptionInput value="gptsovits">GPT-SoVITS</OptionInput>
                            <OptionInput value="fishspeech">fish-speech</OptionInput>
                        </SelectInput>
                     </div>

                     {#if char.ttsMode === 'elevenlab'}
                        {#await getElevenTTSVoices() then voices}
                            <SelectInput size="sm" bind:value={(char as character).ttsSpeech}>
                                <OptionInput value="">Unset</OptionInput>
                                {#each voices as voice}
                                    <OptionInput value={voice.voice_id}>{voice.name}</OptionInput>
                                {/each}
                            </SelectInput>
                        {/await}
                     {/if}
                 </div>

            <!-- Advanced Tab -->
            {:else if activeTab === 5}
                 <div class="flex flex-col gap-4">
                     <div class="flex flex-col gap-2">
                        <div class="flex justify-between">
                            <span class="font-bold text-textcolor">Bias</span>
                            <button class="hover:text-blue-500" onclick={() => (char as character).bias.push(["", 0])}><PlusIcon size={14}/></button>
                        </div>
                        {#each (char as character).bias as bias, i}
                            <div class="flex gap-2">
                                <TextInput size="sm" bind:value={bias[0]} placeholder="Word" />
                                <NumberInput size="sm" bind:value={bias[1]} placeholder="0" className="w-20" />
                                <button class="hover:text-red-500" onclick={() => (char as character).bias.splice(i, 1)}><TrashIcon size={14}/></button>
                            </div>
                        {/each}
                     </div>

                     <div class="flex flex-col gap-2">
                        <div class="flex justify-between items-center">
                            <span class="font-bold text-textcolor">{language.exampleMessage}</span>
                            <button class="p-1 hover:text-white text-[#858585]" title="Open in Editor" onclick={() => openStudioTab('field:exampleMessage', language.exampleMessage, FileTextIcon)}>
                                <ExternalLinkIcon size={12} />
                            </button>
                        </div>
                        <TextAreaInput size="sm" bind:value={char.exampleMessage} />
                     </div>

                     <div class="flex flex-col gap-2">
                        <div class="flex justify-between items-center">
                            <span class="font-bold text-textcolor">{language.creatorNotes}</span>
                             <button class="p-1 hover:text-white text-[#858585]" title="Open in Editor" onclick={() => openStudioTab('field:creatorNotes', language.creatorNotes, FileTextIcon)}>
                                <ExternalLinkIcon size={12} />
                            </button>
                        </div>
                        <MultiLangInput bind:value={char.creatorNotes} />
                     </div>

                     <div class="flex flex-col gap-2">
                         <div class="flex justify-between items-center">
                            <span class="font-bold text-textcolor">{language.systemPrompt}</span>
                             <button class="p-1 hover:text-white text-[#858585]" title="Open in Editor" onclick={() => openStudioTab('field:systemPrompt', language.systemPrompt, FileTextIcon)}>
                                <ExternalLinkIcon size={12} />
                            </button>
                        </div>
                        <TextAreaInput size="sm" bind:value={char.systemPrompt} />
                     </div>
                     
                     <div class="flex flex-col gap-2">
                        <span class="font-bold text-textcolor">{language.depthPrompt}</span>
                        <div class="flex gap-2">
                            <NumberInput size="sm" bind:value={char.depth_prompt.depth} className="w-16" />
                            <TextInput size="sm" bind:value={char.depth_prompt.prompt} className="flex-1" />
                        </div>
                     </div>
                 </div>

            <!-- Management Tab -->
            {:else if activeTab === 6}
                 <div class="flex flex-col gap-4">
                     {#if licensed !== "CC BY-NC-SA 4.0" && licensed !== "CC BY-SA 4.0"}
                        <Button size="sm" onclick={async () => {
                            if (await alertTOS()) $ShowRealmFrameStore = "character";
                        }}>
                             {char.realmId ? language.updateRealm : language.shareCloud}
                        </Button>
                     {/if}

                     <Button size="sm" onclick={() => exportChar($selectedCharID)}>
                         {language.exportCharacter}
                     </Button>

                     <Button size="sm" className="bg-red-900/50 hover:bg-red-800/50 text-red-100" onclick={() => removeChar($selectedCharID, char.name)}>
                         {charType === 'group' ? language.removeGroup : language.removeCharacter}
                     </Button>
                 </div>
            {/if}
        {/if}
    </div>
</div>
