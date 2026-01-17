<script lang="ts">
    import { exportModalStore, DBState, selectedCharID } from "src/ts/stores.svelte";
    import { language } from "src/lang";
    import { toBlob } from 'html-to-image';
    import { downloadFile } from "src/ts/globalApi.svelte";
    import Chat from "./Chat.svelte";
    import Button from "src/lib/UI/GUI/Button.svelte";
    import NumberInput from "src/lib/UI/GUI/NumberInput.svelte";
    import CheckInput from "src/lib/UI/GUI/CheckInput.svelte";
    import { XIcon, SettingsIcon, ListFilterIcon, ImageDownIcon, LayersIcon, PaletteIcon, ScanSearchIcon, MousePointerClickIcon, ChevronRightIcon, ChevronDownIcon, FolderIcon, FolderOpenIcon, SlidersIcon, EyeIcon } from "@lucide/svelte";
    import { createSimpleCharacter } from "src/ts/stores.svelte";
    import { tick } from "svelte";
    import { sleep } from "src/ts/util";
    import { mergePngs } from "./pngMerge";

    // --- Types ---
    type ClassNode = {
        name: string;
        fullName: string;
        count: number;
        children: ClassNode[];
        isCustom: boolean; // is a bot-specific style (x-risu-)
        hasCustomDescendant: boolean;
        expanded: boolean;
    };

    type Tab = 'settings' | 'filters';

    // --- State ---
    let exportContainer = $state<HTMLElement>();
    let loading = $state(false);
    let loadingMessage = $state('Processing...');
    let currentTab = $state<Tab>('settings');

    let char = $derived(DBState.db.characters?.[$selectedCharID]);
    let chat = $derived(char?.chats[char.chatPage]);
    let messages = $derived(chat?.message || []);

    let startIndex = $state(0);
    let endIndex = $state(0);
    
    // Style Options
    let fontSize = $state(16);
    let exportWidth = $state(800);
    
    // Filter Options
    let stripHtml = $state(false);
    let showAdvanced = $state(false);
    
    // Inspector & Filtering
    let classTree = $state<ClassNode[]>([]);
    let hiddenClasses = $state(new Set<string>());
    
    let inspectorMode = $state(false);
    let highlightedElement = $state<HTMLElement | null>(null);

    // --- Effects ---
    
    let observer: MutationObserver | null = null;

    function setupObserver() {
        if (!exportContainer) return;
        if (observer) observer.disconnect();

        observer = new MutationObserver(() => {
            scanClassHierarchy();
            applyVisualFilters(); 
        });

        observer.observe(exportContainer, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
    }

    $effect(() => {
        if ($exportModalStore.open) {
            startIndex = $exportModalStore.startIndex;
            endIndex = $exportModalStore.endIndex;
            inspectorMode = false;
        }
    });
    
    let displayMessages = $derived(messages.slice(startIndex, endIndex + 1));

    $effect(() => {
        displayMessages;
        if (!exportContainer) return;

        tick().then(() => {
            scanClassHierarchy();
            applyVisualFilters();
            setupObserver();
        });

        return () => {
            if (observer) observer.disconnect();
        };
    });

    $effect(() => {
        hiddenClasses;
        applyVisualFilters();
    });

    $effect(() => {
        showAdvanced;
        scanClassHierarchy();
    });

    // --- Logic ---

    function getRepresentativeClass(el: Element): string | null {
        if (el.classList.length === 0) return null;
        
        const classes = Array.from(el.classList);
        
        // RisuAI logic: Bot styles usually get 'x-risu-' prefix.
        // We prioritize these as they are what the user wants to filter.
        const custom = classes.find(c => c.startsWith('x-risu-'));
        const risuInternal = classes.find(c => c.startsWith('risu-') || c.includes('char-'));

        // Ignore internal inspector classes
        const validClasses = classes.filter(c => !c.startsWith('inspector-') && !c.startsWith('auto-hidden-'));
        if (validClasses.length === 0) return null;

        return custom || risuInternal || validClasses[0];
    }

    function scanClassHierarchy() {
        if (!exportContainer) return;

        type TempNode = {
            name: string;
            fullName: string;
            count: number;
            children: Map<string, TempNode>;
            isCustom: boolean;
        };

        const rootNodes = new Map<string, TempNode>();
        const simpleRootNodes = new Map<string, TempNode>();

        function traverse(el: Element, advancedParentMap: Map<string, TempNode>, simpleParentMap: Map<string, TempNode>) {
            const repClass = getRepresentativeClass(el);
            
            let nextAdvancedMap = advancedParentMap;
            let nextSimpleMap = simpleParentMap;

            if (repClass) {
                const isCustom = repClass.startsWith('x-risu-');

                // 1. Build Tree (Advanced Mode)
                if (!nextAdvancedMap.has(repClass)) {
                    nextAdvancedMap.set(repClass, {
                        name: repClass,
                        fullName: repClass, 
                        count: 0,
                        children: new Map(),
                        isCustom
                    });
                }
                const advNode = nextAdvancedMap.get(repClass)!;
                advNode.count++;
                nextAdvancedMap = advNode.children;

                // 2. Build Tree (Simple Mode) - Hierarchy of ONLY x-risu classes
                if (isCustom) {
                    if (!nextSimpleMap.has(repClass)) {
                        nextSimpleMap.set(repClass, {
                            name: repClass,
                            fullName: repClass,
                            count: 0,
                            children: new Map(),
                            isCustom: true
                        });
                    }
                    const simpleNode = nextSimpleMap.get(repClass)!;
                    simpleNode.count++;
                    nextSimpleMap = simpleNode.children;
                } 
                // If not custom, we just pass the CURRENT simpleParentMap down, 
                // effectively skipping this node in the simple tree structure.
            }

            for (const child of Array.from(el.children)) {
                traverse(child, nextAdvancedMap, nextSimpleMap);
            }
        }

        for (const child of Array.from(exportContainer.children)) {
            traverse(child, rootNodes, simpleRootNodes);
        }

        function mapToArray(map: Map<string, TempNode>): ClassNode[] {
            return Array.from(map.values())
                .map(node => {
                    const children = mapToArray(node.children);
                    const hasCustomDescendant = children.some(c => c.isCustom || c.hasCustomDescendant);
                    return {
                        name: node.name,
                        fullName: node.fullName,
                        count: node.count,
                        isCustom: node.isCustom,
                        children,
                        hasCustomDescendant,
                        expanded: true
                    };
                })
                .sort((a, b) => {
                    // Custom 'x-risu-' classes ALWAYS first in tree view
                    if (a.isCustom && !b.isCustom) return -1;
                    if (!a.isCustom && b.isCustom) return 1;
                    return a.name.localeCompare(b.name);
                });
        }

        if (showAdvanced) {
            classTree = mapToArray(rootNodes);
        } else {
            // Simple mode: Tree of x-risu- classes
            classTree = mapToArray(simpleRootNodes);
        }
    }

    function applyVisualFilters() {
        if (!exportContainer) return;
        
        if (observer) observer.disconnect();

        try {
            const previouslyHidden = exportContainer.querySelectorAll('.auto-hidden-target');
            previouslyHidden.forEach(el => el.classList.remove('auto-hidden-target'));

            if (hiddenClasses.size > 0) {
                hiddenClasses.forEach(cls => {
                    try {
                        const elements = exportContainer!.querySelectorAll(`.${CSS.escape(cls)}`);
                        elements.forEach(el => el.classList.add('auto-hidden-target'));
                    } catch (e) {
                        console.warn(`Invalid class selector: ${cls}`);
                    }
                });
            }
        } finally {
            setupObserver();
        }
    }

    function toggleClassFilter(cls: string, checked: boolean) {
        const newSet = new Set(hiddenClasses);
        if (checked) {
            newSet.add(cls);
        } else {
            newSet.delete(cls);
        }
        hiddenClasses = newSet;
    }

    // --- Inspector ---

    function toggleInspector() {
        inspectorMode = !inspectorMode;
        if (!inspectorMode) {
            highlightedElement = null;
        }
    }

    function handleMouseOver(e: MouseEvent) {
        if (!inspectorMode) return;
        e.stopPropagation();
        const target = e.target as HTMLElement;
        if (target === exportContainer) return;
        highlightedElement = target;
        target.classList.add('inspector-highlight');
    }

    function handleMouseOut(e: MouseEvent) {
        if (!inspectorMode) return;
        const target = e.target as HTMLElement;
        target.classList.remove('inspector-highlight');
        if (highlightedElement === target) highlightedElement = null;
    }

    function handleClick(e: MouseEvent) {
        if (!inspectorMode) return;
        e.preventDefault();
        e.stopPropagation();
        
        let target = e.target as HTMLElement;
        let repClass: string | null = null;

        // Traverse up to find the nearest element with a representative class
        while (target && target !== exportContainer) {
            repClass = getRepresentativeClass(target);
            if (repClass) break;
            target = target.parentElement as HTMLElement;
        }

        if (repClass) {
            const currentlyHidden = hiddenClasses.has(repClass);
            toggleClassFilter(repClass, !currentlyHidden);
        }
    }

    // import { mergePngs } from "./pngMerge"; // Removed in favor of worker

    // ... (rest of imports)

    async function exportImage() {
        if (!exportContainer) return;
        loading = true;
        loadingMessage = 'Preparing...';
        
        const currentInspectorMode = inspectorMode;
        inspectorMode = false;
        if (highlightedElement) highlightedElement.classList.remove('inspector-highlight');

        const filter = (node: Node) => {
            if (node instanceof Element) {
                if (node.classList.contains('inspector-hidden-target') || 
                    node.classList.contains('auto-hidden-target')) {
                    return false;
                }
            }
            return true;
        };

        try {
            const width = exportContainer.offsetWidth;
            const height = exportContainer.scrollHeight;
            const CHUNK_SIZE = 8000;
            let finalBytes: Uint8Array;

            if (height <= CHUNK_SIZE) {
                loadingMessage = 'Capturing...';
                await sleep(50);
                const blob = await toBlob(exportContainer, {
                    backgroundColor: '#1a1b1e', 
                    style: { transform: 'scale(1)' },
                    filter,
                    cacheBust: false
                });
                if (!blob) throw new Error("Image capture failed");
                finalBytes = new Uint8Array(await blob.arrayBuffer());
            } else {
                // Chunking strategy using binary merge
                const chunkBytes: Uint8Array[] = [];
                const totalChunks = Math.ceil(height / CHUNK_SIZE);
                let currentChunk = 0;

                for (let y = 0; y < height; y += CHUNK_SIZE) {
                    currentChunk++;
                    loadingMessage = `Capturing part ${currentChunk}/${totalChunks}...`;
                    await sleep(100); // Allow UI to update

                    const chunkHeight = Math.min(CHUNK_SIZE, height - y);
                    const blob = await toBlob(exportContainer, {
                        backgroundColor: '#1a1b1e',
                        width: width,
                        height: chunkHeight,
                        style: {
                            transform: `translateY(-${y}px) scale(1)`,
                            height: `${height}px`,
                        },
                        filter,
                        cacheBust: false
                    });
                    
                    if (!blob) throw new Error("Chunk capture failed");
                    const bytes = new Uint8Array(await blob.arrayBuffer());
                    chunkBytes.push(bytes);
                }

                loadingMessage = 'Merging images... (This may take a while)';
                await sleep(100);
                
                // Use Worker
                const worker = new Worker(new URL('./pngMerge.worker.ts', import.meta.url), { type: 'module' });
                finalBytes = await new Promise((resolve, reject) => {
                    worker.onmessage = (e) => {
                        if (e.data.error) reject(new Error(e.data.error));
                        else resolve(e.data.result);
                        worker.terminate();
                    };
                    worker.onerror = (err) => {
                        reject(err);
                        worker.terminate();
                    };
                    // Transfer buffers
                    worker.postMessage({ chunks: chunkBytes }, chunkBytes.map(c => c.buffer));
                });
            }
            
            loadingMessage = 'Downloading...';
            await downloadFile(`log-export-${Date.now()}.png`, finalBytes);
        } catch (error) {
            console.error('Export failed', error);
            alert('Export failed: ' + error);
        } finally {
            loading = false;
            loadingMessage = 'Processing...';
            inspectorMode = currentInspectorMode;
        }
    }
    
    function close() {
        $exportModalStore.open = false;
    }

    function cleanMessage(text: string) {
        if (!stripHtml) return text;
        return text.replace(/<[^>]*>/g, '');
    }

</script>

{#snippet treeNode(node: ClassNode)}
    {#if showAdvanced || node.isCustom || node.hasCustomDescendant}
    <div class="ml-2 border-l border-darkborderc/50 pl-2">
        <div class="flex items-center gap-2 py-1">
             <CheckInput 
                name={node.name}
                check={hiddenClasses.has(node.fullName)} 
                onChange={(checked) => toggleClassFilter(node.fullName, checked)}
                className="text-xs"
            >
                <div class="flex items-center gap-1.5 ml-1">
                    {#if node.children && node.children.length > 0}
                        <button class="text-textcolor2 hover:text-textcolor" onclick={(e) => { e.preventDefault(); e.stopPropagation(); node.expanded = !node.expanded; }}>
                            {#if node.expanded}
                                <ChevronDownIcon size={12} />
                            {:else}
                                <ChevronRightIcon size={12} />
                            {/if}
                        </button>
                    {:else}
                         <div class="w-3"></div>
                    {/if}
                    <!-- Highlight bot styles -->
                    <span class:text-primary={node.isCustom} class:font-bold={node.isCustom}>
                        .{node.name}
                    </span>
                    <span class="text-[10px] text-textcolor2 bg-darkinput px-1 rounded-full">
                        {node.count}
                    </span>
                    {#if node.isCustom}
                        <span class="text-[9px] bg-primary/20 text-primary px-1 rounded-sm ml-1">Bot Style</span>
                    {/if}
                </div>
            </CheckInput>
        </div>
        
        {#if node.children && node.children.length > 0 && node.expanded}
            <div class="flex flex-col">
                {#each node.children as child}
                    {@render treeNode(child)}
                {/each}
            </div>
        {/if}
    </div>
    {/if}
{/snippet}

{#if $exportModalStore.open && chat}
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onclick={close}>
    <div class="bg-darkbg text-textcolor w-[95vw] h-[90vh] flex rounded-lg overflow-hidden border border-darkborderc shadow-2xl" onclick={e => e.stopPropagation()}>
        
        <!-- Sidebar (Left) -->
        <div class="w-96 flex flex-col border-r border-darkborderc bg-darkbg h-full shrink-0">
            <!-- Sidebar Header -->
            <div class="p-4 border-b border-darkborderc flex flex-col gap-4 bg-darkbutton">
                <div class="flex justify-between items-center">
                    <div class="flex items-center gap-2">
                        <ImageDownIcon size={20} class="text-primary" />
                        <h2 class="text-lg font-bold">Export Logs</h2>
                    </div>
                </div>

                <!-- Tabs -->
                <div class="flex p-1 bg-darkinput rounded-md gap-1">
                    <button 
                        class="flex-1 py-1.5 text-xs font-medium rounded-sm transition-colors flex items-center justify-center gap-2 {currentTab === 'settings' ? 'bg-darkbg text-white shadow-xs' : 'text-textcolor2 hover:text-textcolor'}"
                        onclick={() => currentTab = 'settings'}
                    >
                        <SlidersIcon size={14} />
                        Settings
                    </button>
                    <button 
                        class="flex-1 py-1.5 text-xs font-medium rounded-sm transition-colors flex items-center justify-center gap-2 {currentTab === 'filters' ? 'bg-darkbg text-white shadow-xs' : 'text-textcolor2 hover:text-textcolor'}"
                        onclick={() => currentTab = 'filters'}
                    >
                        <LayersIcon size={14} />
                        Elements & Filters
                    </button>
                </div>
            </div>

            <!-- Sidebar Content -->
            <div class="flex-grow overflow-y-auto p-4 flex flex-col gap-6">
                
                {#if currentTab === 'settings'}
                    <!-- Section: Range -->
                    <div class="flex flex-col gap-3">
                        <div class="flex items-center gap-2 text-textcolor/90 font-semibold text-sm">
                            <ListFilterIcon size={16} />
                            <span>Message Range</span>
                        </div>
                        
                        <div class="bg-darkinput/30 p-3 rounded-md border border-darkborderc/50 flex flex-col gap-3">
                            <div class="flex justify-between items-center text-xs">
                                <span class="text-textcolor2">Start Index</span>
                                <NumberInput size="sm" min={0} max={messages.length - 1} bind:value={startIndex} />
                            </div>
                            <div class="flex justify-between items-center text-xs">
                                <span class="text-textcolor2">End Index</span>
                                <NumberInput size="sm" min={0} max={messages.length - 1} bind:value={endIndex} />
                            </div>
                            
                            <div class="grid grid-cols-3 gap-1 mt-1">
                                <Button size="sm" styled="outlined" className="w-full" onclick={() => {
                                    startIndex = $exportModalStore.initialIndex;
                                    endIndex = $exportModalStore.initialIndex;
                                }}>Current</Button>
                                <Button size="sm" styled="outlined" className="w-full" onclick={() => endIndex = messages.length - 1}>To End</Button>
                                <Button size="sm" styled="outlined" className="w-full" onclick={() => { startIndex = 0; endIndex = messages.length - 1; }}>All</Button>
                            </div>
                            <div class="text-center text-[10px] text-textcolor2">
                                Selected: {displayMessages.length} messages
                            </div>
                        </div>
                    </div>

                    <!-- Section: Appearance -->
                    <div class="flex flex-col gap-3">
                        <div class="flex items-center gap-2 text-textcolor/90 font-semibold text-sm">
                            <PaletteIcon size={16} />
                            <span>Image Settings</span>
                        </div>

                        <div class="bg-darkinput/30 p-3 rounded-md border border-darkborderc/50 flex flex-col gap-3">
                            <div class="flex justify-between items-center">
                                <span class="text-xs text-textcolor2">Image Width (px)</span>
                                <div class="w-24">
                                    <NumberInput size="sm" min={400} max={3000} bind:value={exportWidth} />
                                </div>
                            </div>
                            <div class="flex justify-between items-center">
                                <span class="text-xs text-textcolor2">Font Size (px)</span>
                                <div class="w-24">
                                    <NumberInput size="sm" min={10} max={64} bind:value={fontSize} />
                                </div>
                            </div>
                        </div>
                    </div>

                {:else if currentTab === 'filters'}
                    <!-- Section: Inspector -->
                    <div class="flex flex-col gap-3">
                        <div class="flex items-center gap-2 text-textcolor/90 font-semibold text-sm">
                            <EyeIcon size={16} />
                            <span>Visual Inspector</span>
                        </div>
                         <div class="bg-darkinput/30 p-3 rounded-md border border-darkborderc/50">
                            <Button 
                                styled={inspectorMode ? "primary" : "outlined"} 
                                className="w-full flex items-center justify-center gap-2" 
                                onclick={toggleInspector}
                            >
                                <MousePointerClickIcon size={16} />
                                {inspectorMode ? 'Inspector Active' : 'Enable Inspector'}
                            </Button>
                            <p class="text-[10px] text-textcolor2 mt-2 text-center">
                                {inspectorMode ? 'Click elements in the preview to hide them.' : 'Click to visually select and hide elements.'}
                            </p>
                         </div>
                    </div>

                    <!-- Section: Class Tree -->
                    <div class="flex flex-col gap-3 h-full overflow-hidden">
                        <div class="flex items-center gap-2 text-textcolor/90 font-semibold text-sm">
                            <LayersIcon size={16} />
                            <span>Element Tree</span>
                        </div>

                        <div class="bg-darkinput/30 p-3 rounded-md border border-darkborderc/50 flex flex-col gap-3 h-full overflow-hidden">
                            <CheckInput name="Text Only (Strip HTML)" bind:check={stripHtml}>
                                <p class="text-[10px] text-textcolor2 mt-0.5 ml-7">Removes all formatting/styles.</p>
                            </CheckInput>
                            
                            <CheckInput name="Show Advanced (Non-Bot Styles)" bind:check={showAdvanced}>
                                <p class="text-[10px] text-textcolor2 mt-0.5 ml-7">Show all HTML elements/classes.</p>
                            </CheckInput>
                            
                            <div class="w-full h-px bg-darkborderc/30 my-1 shrink-0"></div>

                            <div class="flex flex-col gap-1 overflow-y-auto pr-1 flex-grow">
                                {#if classTree.length === 0}
                                    <span class="text-xs text-textcolor2/50 italic p-2">No elements found...</span>
                                {:else}
                                    {#each classTree as node}
                                        {@render treeNode(node)}
                                    {/each}
                                {/if}
                            </div>
                        </div>
                    </div>
                {/if}

            </div>

            <!-- Sidebar Footer -->
            <div class="p-4 border-t border-darkborderc bg-darkbg mt-auto flex gap-2">
                <Button styled="outlined" className="flex-1" onclick={close}>Cancel</Button>
                <Button styled="primary" className="flex-[2]" onclick={exportImage} disabled={loading}>
                    {loading ? loadingMessage : 'Export PNG'}
                </Button>
            </div>
        </div>

        <!-- Preview Area (Right) -->
        <div class="flex-grow bg-bgcolor overflow-auto relative flex flex-col cursor-default">
            {#if inspectorMode}
                <div class="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-red-500/80 text-white px-4 py-2 rounded-full shadow-lg backdrop-blur-md border border-white/10 flex items-center gap-2 animate-bounce pointer-events-none">
                    <MousePointerClickIcon size={16} />
                    <span class="text-sm font-bold">Inspector Active</span>
                </div>
            {/if}

            <div class="absolute top-4 right-4 z-10 bg-black/50 px-3 py-1 rounded-full backdrop-blur-md border border-white/10 pointer-events-none">
                <span class="text-xs font-mono text-white/80">Preview Mode</span>
            </div>

            <div class="p-8 min-h-full flex justify-center items-start"
                 class:cursor-crosshair={inspectorMode}>
                <!-- Export Target Container -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- svelte-ignore a11y_mouse_events_have_key_events -->
                <div id="export-preview" 
                     bind:this={exportContainer} 
                     class="flex flex-col gap-4 bg-bgcolor p-8 rounded-md shrink-0 border border-transparent transition-all duration-200"
                     style="width: {exportWidth}px; font-size: {fontSize}px;"
                     onmouseover={handleMouseOver}
                     onmouseout={handleMouseOut}
                     onclick={handleClick}>
                     
                     {#each displayMessages as msg, i}
                        <Chat 
                            message={cleanMessage(msg.data)}
                            name={msg.name}
                            role={msg.role}
                            idx={i + startIndex}
                            isLastMemory={false} 
                            disabled={msg.disabled}
                            character={createSimpleCharacter(char)}
                            img={msg.role === 'char' ? char.image : DBState.db.userIcon}
                        />
                     {/each}
                </div>
            </div>
        </div>
    </div>
</div>
{/if}

<style>
    :global(#export-preview button) {
        display: none !important;
    }
    
    /* Inspector Styles */
    :global(.inspector-highlight) {
        outline: 2px solid #ef4444 !important;
        outline-offset: -2px;
        background-color: rgba(239, 68, 68, 0.1) !important;
        cursor: pointer !important;
    }

    /* Manually hidden or Auto-hidden classes */
    :global(.inspector-hidden-target),
    :global(.auto-hidden-target) {
        opacity: 0.15 !important;
        filter: grayscale(100%) opacity(30%) !important;
        position: relative;
    }
    
    :global(.inspector-hidden-target::after),
    :global(.auto-hidden-target::after) {
        content: "HIDDEN";
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0,0,0,0.8);
        color: white;
        font-size: 9px;
        padding: 1px 4px;
        border-radius: 3px;
        pointer-events: none;
        z-index: 10;
        white-space: nowrap;
    }
</style>