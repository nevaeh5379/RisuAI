<script lang="ts">
    
    import { DBState } from 'src/ts/stores.svelte';
    import { language } from "../../../lang";
    import { DownloadIcon, HardDriveUploadIcon, PlusIcon, SunIcon, LinkIcon, FolderPlusIcon } from "@lucide/svelte";
    import { addLorebook, addLorebookFolder, exportLoreBook, importLoreBook } from "../../../ts/process/lorebook.svelte";
    import Check from "../../UI/GUI/CheckInput.svelte";
    import NumberInput from "../../UI/GUI/NumberInput.svelte";
    import LoreBookList from "./LoreBookList.svelte";
    import Help from "src/lib/Others/Help.svelte";
    import { selectedCharID } from "src/ts/stores.svelte";
    import LoreBookPlusTest from "./LoreBookPlusTest.svelte";
    import TextInput from "../../UI/GUI/TextInput.svelte";

    let submenu = $state(0)
    interface Props {
        globalMode?: boolean;
    }

    let { globalMode = $bindable(false) }: Props = $props();

    // Initialize lorebookPlusSettings and rerankerConfig if not present
    function ensureLorebookPlusSettings() {
        if (!DBState.db.lorebookPlusSettings) {
            DBState.db.lorebookPlusSettings = { embeddingThreshold: 0.4, maxEmbeddingResults: 30 };
        }
    }
    function ensureRerankerConfig() {
        if (!DBState.db.rerankerConfig) {
            DBState.db.rerankerConfig = { enabled: false, url: '' };
        }
    }

    function isAllCharacterLoreAlwaysActive() {
        const globalLore = DBState.db.characters[$selectedCharID].globalLore;
        return globalLore && globalLore.every((book) => book.alwaysActive);
    }

    function isAllChatLoreAlwaysActive() {
        const localLore = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].localLore;
        return localLore && localLore.every((book) => book.alwaysActive);
    }

    function toggleCharacterLoreAlwaysActive() {
        const globalLore = DBState.db.characters[$selectedCharID].globalLore;

        if (!globalLore) return;
        
        const allActive = globalLore.every((book) => book.alwaysActive);
        
        globalLore.forEach((book) => {
            book.alwaysActive = !allActive;
        });
    }

    function toggleChatLoreAlwaysActive() {
        const localLore = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].localLore;

        if (!localLore) return;

        const allActive = localLore.every((book) => book.alwaysActive);

        localLore.forEach((book) => {
            book.alwaysActive = !allActive;
        });
    }
</script>

{#if !globalMode}
    <div class="flex w-full rounded-md border border-selected">
        <button onclick={() => {
            submenu = 0
        }} class="p-2 flex-1" class:bg-selected={submenu === 0}>
            <span>{DBState.db.characters[$selectedCharID].type === 'group' ? language.group : language.character}</span>
        </button>
        <button onclick={() => {
            submenu = 1
        }} class="p2 flex-1 border-r border-l border-selected" class:bg-selected={submenu === 1}>
            <span>{language.Chat}</span>
        </button>
        <button onclick={() => {
            submenu = 2
        }} class="p-2 flex-1" class:bg-selected={submenu === 2}>
            <span>{language.settings}</span>
        </button>
    </div>
{/if}
{#if submenu !== 2}
    {#if !globalMode}
        <span class="text-textcolor2 mt-2 mb-6 text-sm">{submenu === 0 ? DBState.db.characters[$selectedCharID].type === 'group' ? language.groupLoreInfo : language.globalLoreInfo : language.localLoreInfo}</span>
    {/if}
    <LoreBookList globalMode={globalMode} submenu={submenu} lorePlus={(!globalMode) && DBState.db.characters[$selectedCharID]?.lorePlus} />
{:else}
    {#if DBState.db.characters[$selectedCharID].loreSettings}
        <div class="flex items-center mt-4">
            <Check check={false} onChange={() => {
                DBState.db.characters[$selectedCharID].loreSettings = undefined
            }}
            name={language.useGlobalSettings}
            />
        </div>
        <div class="flex items-center mt-4">
            <Check bind:check={DBState.db.characters[$selectedCharID].loreSettings.recursiveScanning} name={language.recursiveScanning}/>
        </div>
        <div class="flex items-center mt-4">
            <Check bind:check={DBState.db.characters[$selectedCharID].loreSettings.fullWordMatching} name={language.fullWordMatching}/>
        </div>
        <span class="text-textcolor mt-4 mb-2">{language.loreBookDepth}</span>
        <NumberInput size="sm" min={0} max={20} bind:value={DBState.db.characters[$selectedCharID].loreSettings.scanDepth} />
        <span class="text-textcolor">{language.loreBookToken}</span>
        <NumberInput size="sm" min={0} max={4096} bind:value={DBState.db.characters[$selectedCharID].loreSettings.tokenBudget} />
    {:else}
        <div class="flex items-center mt-4">
            <Check check={true} onChange={() => {
                DBState.db.characters[$selectedCharID].loreSettings = {
                    tokenBudget: DBState.db.loreBookToken,
                    scanDepth:DBState.db.loreBookDepth,
                    recursiveScanning: false
                }
            }}
            name={language.useGlobalSettings}
            />
        </div>
    {/if}
    <div class="flex items-center mt-4">
        {#if DBState.db.useExperimental}
            <Check bind:check={DBState.db.characters[$selectedCharID].lorePlus}
                name={language.lorePlus}
            ><Help key="lorePlus"></Help><Help key="experimental"></Help></Check>
        {/if}
    </div>
    
    {#if DBState.db.useExperimental && DBState.db.characters[$selectedCharID].lorePlus}
        <!-- LoreBook+ Settings -->
        <div class="mt-4 p-3 border border-selected rounded-lg bg-bgcolor2">
            <h4 class="text-textcolor font-medium mb-3">{language.lorePlus} {language.settings}</h4>
            
            <!-- Similarity Threshold -->
            <div class="mb-3">
                <span class="text-textcolor2 text-sm">{language.lorebookPlusThreshold ?? 'Similarity Threshold'}</span>
                <NumberInput 
                    size="sm" 
                    min={0} 
                    max={100} 
                    value={(DBState.db.lorebookPlusSettings?.embeddingThreshold ?? 0.4) * 100}
                    onChange={(e) => {
                        ensureLorebookPlusSettings();
                        DBState.db.lorebookPlusSettings.embeddingThreshold = e.currentTarget.valueAsNumber / 100;
                    }}
                />
                <span class="text-textcolor2 text-xs ml-2">%</span>
            </div>
            
            <!-- Max Embedding Results -->
            <div class="mb-3">
                <span class="text-textcolor2 text-sm">{language.lorebookPlusMaxResults ?? 'Max Embedding Results'}</span>
                <NumberInput 
                    size="sm" 
                    min={1} 
                    max={100} 
                    value={DBState.db.lorebookPlusSettings?.maxEmbeddingResults ?? 30}
                    onChange={(e) => {
                        ensureLorebookPlusSettings();
                        DBState.db.lorebookPlusSettings.maxEmbeddingResults = e.currentTarget.valueAsNumber;
                    }}
                />
            </div>
            
            <!-- Max Tokens for Embedding -->
            <div class="mb-3">
                <span class="text-textcolor2 text-sm">{language.lorebookPlusMaxTokens ?? 'Max Tokens (Embedding)'}</span>
                <NumberInput 
                    size="sm" 
                    min={500} 
                    max={10000} 
                    value={DBState.db.lorebookPlusSettings?.maxTokens ?? 2000}
                    onChange={(e) => {
                        ensureLorebookPlusSettings();
                        DBState.db.lorebookPlusSettings.maxTokens = e.currentTarget.valueAsNumber;
                    }}
                />
                <span class="text-textcolor2 text-xs ml-1">tokens</span>
            </div>
            
            <LoreBookPlusTest />
        </div>
        
        <!-- Reranker Settings -->
        <div class="mt-4 p-3 border border-selected rounded-lg bg-bgcolor2">
            <div class="flex items-center justify-between mb-3">
                <h4 class="text-textcolor font-medium">{language.rerankerSettings ?? 'Reranker Settings'}</h4>
                <Check 
                    check={DBState.db.rerankerConfig?.enabled ?? false}
                    onChange={(v) => {
                        if (!DBState.db.rerankerConfig) {
                            DBState.db.rerankerConfig = { enabled: false, url: '' };
                        }
                        DBState.db.rerankerConfig.enabled = v;
                    }}
                    name={language.rerankerEnabled ?? 'Enable Reranker'}
                />
            </div>
            
            {#if DBState.db.rerankerConfig?.enabled}
                <!-- Reranker URL -->
                <div class="mb-3">
                    <span class="text-textcolor2 text-sm block mb-1">{language.rerankerUrl ?? 'Reranker API URL'}</span>
                    <TextInput 
                        size="sm" 
                        fullwidth
                        placeholder="https://api.example.com/rerank"
                        value={DBState.db.rerankerConfig?.url ?? ''}
                        oninput={(e) => {
                            if (!DBState.db.rerankerConfig) {
                                DBState.db.rerankerConfig = { enabled: true, url: '' };
                            }
                            DBState.db.rerankerConfig.url = e.currentTarget.value;
                        }}
                    />
                </div>
                
                <!-- Reranker API Key -->
                <div class="mb-3">
                    <span class="text-textcolor2 text-sm block mb-1">{language.rerankerKey ?? 'Reranker API Key'}</span>
                    <TextInput 
                        size="sm" 
                        fullwidth
                        hideText
                        placeholder="sk-..."
                        value={DBState.db.rerankerConfig?.key ?? ''}
                        oninput={(e) => {
                            if (!DBState.db.rerankerConfig) {
                                DBState.db.rerankerConfig = { enabled: true, url: '' };
                            }
                            DBState.db.rerankerConfig.key = e.currentTarget.value;
                        }}
                    />
                </div>
                
                <!-- Reranker Model -->
                <div class="mb-3">
                    <span class="text-textcolor2 text-sm block mb-1">{language.rerankerModel ?? 'Reranker Model'}</span>
                    <TextInput 
                        size="sm" 
                        fullwidth
                        placeholder="Qwen/Qwen3-VL-Reranker-2B"
                        value={DBState.db.rerankerConfig?.model ?? ''}
                        oninput={(e) => {
                            if (!DBState.db.rerankerConfig) {
                                DBState.db.rerankerConfig = { enabled: true, url: '' };
                            }
                            DBState.db.rerankerConfig.model = e.currentTarget.value;
                        }}
                    />
                </div>
                
                <!-- Reranker Top K -->
                <div class="mb-1">
                    <span class="text-textcolor2 text-sm">{language.rerankerTopK ?? 'Reranker Top K'}</span>
                    <NumberInput 
                        size="sm" 
                        min={1} 
                        max={50} 
                        value={DBState.db.rerankerConfig?.topK ?? 10}
                        onChange={(e) => {
                            ensureRerankerConfig();
                            DBState.db.rerankerConfig.topK = e.currentTarget.valueAsNumber;
                        }}
                    />
                </div>
                
                <!-- Max Tokens for Reranker -->
                <div class="mb-1">
                    <span class="text-textcolor2 text-sm">{language.rerankerMaxTokens ?? 'Max Tokens (Reranker)'}</span>
                    <NumberInput 
                        size="sm" 
                        min={500} 
                        max={10000} 
                        value={DBState.db.rerankerConfig?.maxTokens ?? 2000}
                        onChange={(e) => {
                            ensureRerankerConfig();
                            DBState.db.rerankerConfig.maxTokens = e.currentTarget.valueAsNumber;
                        }}
                    />
                    <span class="text-textcolor2 text-xs ml-1">tokens</span>
                </div>
            {/if}
        </div>
    {/if}
{/if}
{#if submenu !== 2}

<div class="text-textcolor2 mt-2 flex">
    <button onclick={() => {addLorebook(globalMode ? -1 : submenu)}} class="hover:text-textcolor cursor-pointer">
        <PlusIcon />
    </button>
    <button onclick={() => {
        exportLoreBook(globalMode ? 'sglobal' : submenu === 0 ? 'global' : 'local')
    }} class="hover:text-textcolor ml-1  cursor-pointer">
        <DownloadIcon />
    </button>
    <button onclick={() => {
        addLorebookFolder(globalMode ? -1 : submenu)
    }} class="hover:text-textcolor ml-2  cursor-pointer">
        <FolderPlusIcon />
    </button>
    <button onclick={() => {
        importLoreBook(globalMode ? 'sglobal' : submenu === 0 ? 'global' : 'local')
    }} class="hover:text-textcolor ml-2  cursor-pointer">
        <HardDriveUploadIcon />
    </button>
    {#if DBState.db.bulkEnabling}
        <button onclick={() => {
            toggleCharacterLoreAlwaysActive()
        }} class="hover:text-textcolor ml-2 cursor-pointer flex items-center gap-1">
            {#if isAllCharacterLoreAlwaysActive()}
                <SunIcon />
            {:else}
                <LinkIcon />
            {/if}
            <span class="text-xs">CHAR</span>
        </button>
        <button onclick={() => {
            toggleChatLoreAlwaysActive()
        }} class="hover:text-textcolor ml-2 cursor-pointer flex items-center gap-1">
            {#if isAllChatLoreAlwaysActive()}
                <SunIcon />
            {:else}
                <LinkIcon />
            {/if}
            <span class="text-xs">CHAT</span>
        </button>
    {/if}
</div>
{/if}