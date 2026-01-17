<script lang="ts">
    import { exportModalStore, DBState, selectedCharID } from "src/ts/stores.svelte";
    import { language } from "src/lang";
    import { toBlob } from 'html-to-image';
    import { downloadFile, getFileSrc } from "src/ts/globalApi.svelte";
    import Chat from "./Chat.svelte";
    import Button from "src/lib/UI/GUI/Button.svelte";
    import NumberInput from "src/lib/UI/GUI/NumberInput.svelte";
    import CheckInput from "src/lib/UI/GUI/CheckInput.svelte";
    import { XIcon, SettingsIcon, ListFilterIcon, ImageDownIcon, LayersIcon, PaletteIcon, ScanSearchIcon, MousePointerClickIcon, ChevronRightIcon, ChevronDownIcon, FolderIcon, FolderOpenIcon, SlidersIcon, EyeIcon, SparklesIcon } from "@lucide/svelte";
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
    let uiScale = $state(1.0);
    
    // Header/Footer Options
    let showHeader = $state(true);
    let showFooter = $state(true);
    let footerText = $state("Exported from RisuAI");
    let useModernDesign = $state(true);
    
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
<div class="export-modal-overlay" onclick={close}>
    <div class="export-modal-container" onclick={e => e.stopPropagation()}>
        
        <!-- Sidebar (Left) -->
        <div class="export-sidebar">
            <!-- Sidebar Header -->
            <div class="export-sidebar-header">
                <div class="export-title-row">
                    <div class="export-title-icon">
                        <ImageDownIcon size={24} />
                    </div>
                    <div class="export-title-text">
                        <h2>Export Logs</h2>
                        <p>Capture your conversation</p>
                    </div>
                </div>

                <!-- Modern Tabs -->
                <div class="export-tabs">
                    <button 
                        class="export-tab"
                        class:export-tab-active={currentTab === 'settings'}
                        onclick={() => currentTab = 'settings'}
                    >
                        <SlidersIcon size={15} />
                        <span>Settings</span>
                    </button>
                    <button 
                        class="export-tab"
                        class:export-tab-active={currentTab === 'filters'}
                        onclick={() => currentTab = 'filters'}
                    >
                        <LayersIcon size={15} />
                        <span>Filters</span>
                    </button>
                </div>
            </div>

            <!-- Sidebar Content -->
            <div class="export-sidebar-content">
                
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
                            <div class="flex justify-between items-center">
                                <span class="text-xs text-textcolor2">UI Scale</span>
                                <div class="flex items-center gap-2">
                                    <input 
                                        type="range" 
                                        min="0.5" 
                                        max="2" 
                                        step="0.1" 
                                        bind:value={uiScale}
                                        class="w-16 h-1 bg-darkborderc rounded-full appearance-none cursor-pointer"
                                    />
                                    <span class="text-xs text-textcolor font-mono w-10">{uiScale.toFixed(1)}x</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Section: Header & Footer -->
                    <div class="flex flex-col gap-3">
                        <div class="flex items-center gap-2 text-textcolor/90 font-semibold text-sm">
                            <SparklesIcon size={16} />
                            <span>Header & Footer</span>
                        </div>

                        <div class="bg-darkinput/30 p-3 rounded-md border border-darkborderc/50 flex flex-col gap-3">
                            <CheckInput name="Show Header" bind:check={showHeader}>
                                <p class="text-[10px] text-textcolor2 mt-0.5 ml-7">Display character info at top.</p>
                            </CheckInput>
                            <CheckInput name="Show Footer" bind:check={showFooter}>
                                <p class="text-[10px] text-textcolor2 mt-0.5 ml-7">Display watermark at bottom.</p>
                            </CheckInput>
                            {#if showFooter}
                                <div class="flex flex-col gap-1 ml-7">
                                    <span class="text-[10px] text-textcolor2">Footer Text</span>
                                    <input 
                                        type="text" 
                                        class="w-full bg-darkinput border border-darkborderc rounded px-2 py-1 text-xs text-textcolor"
                                        bind:value={footerText}
                                        placeholder="Exported from RisuAI"
                                    />
                            </div>
                            {/if}
                            <div class="w-full h-px bg-darkborderc/30 my-1"></div>
                            <div class="flex flex-col gap-2">
                                <span class="text-xs text-textcolor2">Message Theme</span>
                                <div class="grid grid-cols-2 gap-2">
                                    <button 
                                        class="px-3 py-2 rounded-md text-xs font-medium transition-all border {!useModernDesign ? 'bg-primary/20 border-primary text-primary' : 'bg-darkinput border-darkborderc text-textcolor2 hover:border-textcolor2'}"
                                        onclick={() => useModernDesign = false}
                                    >
                                        📝 일반 (Original)
                                    </button>
                                    <button 
                                        class="px-3 py-2 rounded-md text-xs font-medium transition-all border {useModernDesign ? 'bg-primary/20 border-primary text-primary' : 'bg-darkinput border-darkborderc text-textcolor2 hover:border-textcolor2'}"
                                        onclick={() => useModernDesign = true}
                                    >
                                        ✨ 모던 (Bubble)
                                    </button>
                                </div>
                                <p class="text-[10px] text-textcolor2">
                                    {useModernDesign ? 'Glassmorphism bubble style with gradients.' : 'Uses the original RisuAI message rendering.'}
                                </p>
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
            <div class="export-sidebar-footer">
                <button class="export-btn export-btn-secondary" onclick={close}>Cancel</button>
                <button class="export-btn export-btn-primary" onclick={exportImage} disabled={loading}>
                    {#if loading}
                        <span class="export-btn-loading"></span>
                        {loadingMessage}
                    {:else}
                        <ImageDownIcon size={16} />
                        Export PNG
                    {/if}
                </button>
            </div>
        </div>

        <!-- Preview Area (Right) -->
        <div class="export-preview-area">
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
                     class="flex flex-col shrink-0 transition-all duration-200 overflow-hidden"
                     class:export-modern={useModernDesign}
                     class:export-classic={!useModernDesign}
                     style="width: {exportWidth}px;"
                     onmouseover={handleMouseOver}
                     onmouseout={handleMouseOut}
                     onclick={handleClick}>
                     
                     <!-- Inner Content Wrapper with zoom -->
                     <div class="export-content-wrapper" style="font-size: {fontSize}px; zoom: {uiScale};">
                     
                     <!-- Header Section -->
                     {#if showHeader && char}
                         <div class="export-header">
                             <div class="export-header-content">
                                 {#await getFileSrc(char.image)}
                                     <div class="export-header-avatar"></div>
                                 {:then imgSrc}
                                     <div class="export-header-avatar" style="background-image: url('{imgSrc}');"></div>
                                 {/await}
                                 <div class="export-header-info">
                                     <h2 class="export-header-name">{char.name}</h2>
                                     <p class="export-header-meta">
                                         {chat?.name || new Date().toLocaleDateString()}
                                         <span class="export-header-count">• {displayMessages.length} messages</span>
                                     </p>
                                 </div>
                             </div>
                         </div>
                     {/if}
                     
                     <!-- Messages Container -->
                     <div class="export-messages" style="font-size: {fontSize}px;">
                         {#each displayMessages as msg, i}
                             <div class="export-message" class:export-message-user={msg.role === 'user'}>
                                 {#if useModernDesign}
                                     <!-- Modern Design: Custom message bubble -->
                                     <div class="export-bubble-wrapper" class:export-bubble-right={msg.role === 'user'}>
                                         {#if msg.role !== 'user'}
                                             {#await getFileSrc(char.image)}
                                                 <div class="export-avatar"></div>
                                             {:then imgSrc}
                                                 <div class="export-avatar" style="background-image: url('{imgSrc}');"></div>
                                             {/await}
                                         {/if}
                                         <div class="export-bubble" class:export-bubble-char={msg.role === 'char'} class:export-bubble-user-style={msg.role === 'user'}>
                                             <div class="export-bubble-name">{msg.name}</div>
                                             <div class="export-bubble-content">{@html cleanMessage(msg.data)}</div>
                                         </div>
                                         {#if msg.role === 'user'}
                                             {#await getFileSrc(DBState.db.userIcon || '')}
                                                 <div class="export-avatar export-avatar-user"></div>
                                             {:then imgSrc}
                                                 {#if imgSrc}
                                                     <div class="export-avatar export-avatar-user" style="background-image: url('{imgSrc}');"></div>
                                                 {:else}
                                                     <div class="export-avatar export-avatar-user export-avatar-placeholder">👤</div>
                                                 {/if}
                                             {/await}
                                         {/if}
                                     </div>
                                 {:else}
                                     <!-- Classic Design: Use Chat component -->
                                     <Chat 
                                         message={cleanMessage(msg.data)}
                                         name={msg.name}
                                         role={msg.role}
                                         idx={i + startIndex}
                                         isLastMemory={false} 
                                         disabled={msg.disabled}
                                         character={createSimpleCharacter(char)}
                                         img={getFileSrc(msg.role === 'char' ? char.image : DBState.db.userIcon).then(url => 
                                             url ? `background-image: url('${url}');background-size: cover;background-position: center;` : ''
                                         )}
                                       
                                     />
                                 {/if}
                             </div>
                         {/each}
                     </div>
                     
                     <!-- Footer Section -->
                     {#if showFooter}
                         <div class="export-footer">
                             <span class="export-footer-text">{footerText}</span>
                             <span class="export-footer-date">{new Date().toLocaleDateString()}</span>
                         </div>
                     {/if}
                     
                     </div><!-- end export-content-wrapper -->
                </div>
            </div>
        </div>
    </div>
</div>
{/if}

<style>
    /* ========================================
       MODAL OVERLAY & CONTAINER
       ======================================== */
    
    :global(.export-modal-overlay) {
        position: fixed;
        inset: 0;
        z-index: 100;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(8px);
    }

    :global(.export-modal-container) {
        width: 95vw;
        height: 90vh;
        display: flex;
        border-radius: 20px;
        overflow: hidden;
        background: linear-gradient(145deg, #12121a 0%, #1a1a28 100%);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 
            0 25px 80px rgba(0, 0, 0, 0.6),
            0 0 0 1px rgba(255, 255, 255, 0.05),
            inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }

    /* ========================================
       SIDEBAR
       ======================================== */
    
    :global(.export-sidebar) {
        width: 380px;
        min-width: 380px;
        display: flex;
        flex-direction: column;
        background: linear-gradient(180deg, rgba(139, 92, 246, 0.03) 0%, transparent 30%);
        border-right: 1px solid rgba(255, 255, 255, 0.06);
    }

    :global(.export-sidebar-header) {
        padding: 1.5rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
    }

    :global(.export-title-row) {
        display: flex;
        align-items: center;
        gap: 1rem;
    }

    :global(.export-title-icon) {
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 14px;
        color: white;
        box-shadow: 
            0 8px 20px rgba(102, 126, 234, 0.35),
            inset 0 1px 0 rgba(255, 255, 255, 0.2);
    }

    :global(.export-title-text h2) {
        font-size: 1.25rem;
        font-weight: 700;
        color: #ffffff;
        margin: 0;
        letter-spacing: -0.02em;
    }

    :global(.export-title-text p) {
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.4);
        margin: 0.15rem 0 0 0;
    }

    /* ========================================
       TABS
       ======================================== */
    
    :global(.export-tabs) {
        display: flex;
        gap: 0.5rem;
        background: rgba(255, 255, 255, 0.03);
        padding: 0.375rem;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.05);
    }

    :global(.export-tab) {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.625rem 1rem;
        border-radius: 9px;
        font-size: 0.8rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.5);
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    :global(.export-tab:hover) {
        color: rgba(255, 255, 255, 0.75);
        background: rgba(255, 255, 255, 0.03);
    }

    :global(.export-tab-active) {
        color: #ffffff !important;
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.4) 0%, rgba(118, 75, 162, 0.4) 100%) !important;
        box-shadow: 
            0 4px 12px rgba(102, 126, 234, 0.25),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
    }

    /* ========================================
       SIDEBAR CONTENT
       ======================================== */
    
    :global(.export-sidebar-content) {
        flex-grow: 1;
        overflow-y: auto;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    :global(.export-sidebar-content::-webkit-scrollbar) {
        width: 6px;
    }

    :global(.export-sidebar-content::-webkit-scrollbar-track) {
        background: transparent;
    }

    :global(.export-sidebar-content::-webkit-scrollbar-thumb) {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
    }

    :global(.export-sidebar-content::-webkit-scrollbar-thumb:hover) {
        background: rgba(255, 255, 255, 0.2);
    }

    /* ========================================
       SIDEBAR FOOTER
       ======================================== */
    
    :global(.export-sidebar-footer) {
        padding: 1.25rem;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        display: flex;
        gap: 0.75rem;
        background: rgba(0, 0, 0, 0.2);
    }

    :global(.export-btn) {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.75rem 1.25rem;
        border-radius: 10px;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        border: none;
    }

    :global(.export-btn-secondary) {
        flex: 1;
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    :global(.export-btn-secondary:hover) {
        background: rgba(255, 255, 255, 0.1);
        color: #ffffff;
    }

    :global(.export-btn-primary) {
        flex: 2;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: #ffffff;
        box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
    }

    :global(.export-btn-primary:hover) {
        box-shadow: 0 6px 28px rgba(102, 126, 234, 0.55);
        transform: translateY(-1px);
    }

    :global(.export-btn-primary:disabled) {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
    }

    :global(.export-btn-loading) {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: #ffffff;
        border-radius: 50%;
        animation: btn-spin 0.8s linear infinite;
    }

    @keyframes btn-spin {
        to { transform: rotate(360deg); }
    }

    /* ========================================
       PREVIEW AREA
       ======================================== */
    
    :global(.export-preview-area) {
        flex-grow: 1;
        overflow: auto;
        position: relative;
        display: flex;
        flex-direction: column;
        cursor: default;
        background: 
            radial-gradient(ellipse at 20% 0%, rgba(139, 92, 246, 0.08) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 100%, rgba(59, 130, 246, 0.06) 0%, transparent 50%),
            #0c0c12;
    }

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

    /* ========================================
       MODERN DESIGN STYLES
       ======================================== */
    
    /* Modern Container */
    :global(.export-modern) {
        background: linear-gradient(135deg, #0f0f1a 0%, #1a1b2e 50%, #0d0d15 100%);
        border-radius: 24px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 
            0 25px 50px -12px rgba(0, 0, 0, 0.5),
            0 0 100px rgba(139, 92, 246, 0.1);
    }

    /* Classic Container */
    :global(.export-classic) {
        background: var(--bgcolor, #1a1b1e);
        border-radius: 8px;
        padding: 2rem;
        gap: 1rem;
    }

    /* Content wrapper for zoom scaling */
    :global(.export-content-wrapper) {
        display: flex;
        flex-direction: column;
    }

    /* ========================================
       HEADER STYLES
       ======================================== */
    
    :global(.export-header) {
        padding: 1.5rem 2rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    
    :global(.export-header-content) {
        display: flex;
        align-items: center;
        gap: 1rem;
    }
    
    :global(.export-header-avatar) {
        width: 56px;
        height: 56px;
        min-width: 56px;
        border-radius: 16px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        background-size: cover;
        background-position: center;
        box-shadow: 
            0 8px 16px rgba(102, 126, 234, 0.3),
            inset 0 0 0 2px rgba(255, 255, 255, 0.1);
    }
    
    :global(.export-header-info) {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }
    
    :global(.export-header-name) {
        font-size: 1.25em;
        font-weight: 700;
        color: #ffffff;
        margin: 0;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    }
    
    :global(.export-header-meta) {
        font-size: 0.85em;
        color: rgba(255, 255, 255, 0.5);
        margin: 0;
    }
    
    :global(.export-header-count) {
        color: rgba(139, 92, 246, 0.8);
        margin-left: 0.5rem;
    }

    /* ========================================
       MESSAGES CONTAINER
       ======================================== */
    
    :global(.export-messages) {
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
    }

    :global(.export-classic .export-messages) {
        padding: 0;
        gap: 1rem;
    }

    /* Force font-size inheritance for all text elements inside export-messages */
    :global(.export-messages *) {
        font-size: inherit !important;
    }
    
    :global(.export-messages p),
    :global(.export-messages span),
    :global(.export-messages div),
    :global(.export-messages em),
    :global(.export-messages strong),
    :global(.export-messages i),
    :global(.export-messages b) {
        font-size: inherit !important;
    }

    /* ========================================
       MESSAGE BUBBLE STYLES (Modern)
       ======================================== */
    
    :global(.export-bubble-wrapper) {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
    }
    
    :global(.export-bubble-right) {
        flex-direction: row-reverse;
    }
    
    :global(.export-avatar) {
        width: 44px;
        height: 44px;
        min-width: 44px;
        border-radius: 14px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        background-size: cover;
        background-position: center;
        box-shadow: 
            0 4px 12px rgba(0, 0, 0, 0.3),
            inset 0 0 0 2px rgba(255, 255, 255, 0.1);
    }
    
    :global(.export-avatar-user) {
        background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
    }
    
    :global(.export-avatar-placeholder) {
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.25rem;
    }
    
    :global(.export-bubble) {
        max-width: 80%;
        padding: 1rem 1.25rem;
        border-radius: 18px;
        position: relative;
    }
    
    :global(.export-bubble-char) {
        background: rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-top-left-radius: 4px;
        box-shadow: 
            0 8px 32px rgba(0, 0, 0, 0.2),
            inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }
    
    :global(.export-bubble-user-style) {
        background: linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(29, 78, 216, 0.4) 100%);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(59, 130, 246, 0.3);
        border-top-right-radius: 4px;
        box-shadow: 
            0 8px 32px rgba(59, 130, 246, 0.15),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
    }
    
    :global(.export-bubble-name) {
        font-size: 0.8em;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.6);
        margin-bottom: 0.5rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    
    :global(.export-bubble-char .export-bubble-name) {
        color: rgba(139, 92, 246, 0.9);
    }
    
    :global(.export-bubble-user-style .export-bubble-name) {
        color: rgba(147, 197, 253, 0.9);
    }
    
    :global(.export-bubble-content) {
        color: rgba(255, 255, 255, 0.9);
        line-height: 1.6;
    }
    
    :global(.export-bubble-content p) {
        margin: 0 0 0.75em 0;
    }
    
    :global(.export-bubble-content p:last-child) {
        margin-bottom: 0;
    }

    :global(.export-bubble-content em) {
        color: rgba(196, 181, 253, 0.9);
        font-style: italic;
    }

    :global(.export-bubble-content strong) {
        color: #ffffff;
        font-weight: 600;
    }

    /* ========================================
       FOOTER STYLES
       ======================================== */
    
    :global(.export-footer) {
        padding: 1.25rem 2rem;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: linear-gradient(180deg, transparent 0%, rgba(139, 92, 246, 0.05) 100%);
    }
    
    :global(.export-footer-text) {
        font-size: 0.85em;
        color: rgba(255, 255, 255, 0.4);
        font-weight: 500;
    }
    
    :global(.export-footer-date) {
        font-size: 0.75em;
        color: rgba(255, 255, 255, 0.3);
        font-family: monospace;
    }

    /* Classic mode footer */
    :global(.export-classic .export-footer) {
        background: rgba(0, 0, 0, 0.2);
        border-radius: 8px;
        margin-top: 1rem;
        padding: 1rem;
    }
</style>