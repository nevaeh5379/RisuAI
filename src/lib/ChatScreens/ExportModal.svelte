<script lang="ts">
    import { exportModalStore, DBState, selectedCharID } from "src/ts/stores.svelte";
    import { language } from "src/lang";
    import { toBlob } from 'html-to-image';
    import { downloadFile, getFileSrc } from "src/ts/globalApi.svelte";
    import Chat from "./Chat.svelte";
    import Button from "src/lib/UI/GUI/Button.svelte";
    import NumberInput from "src/lib/UI/GUI/NumberInput.svelte";
    import CheckInput from "src/lib/UI/GUI/CheckInput.svelte";
    import ChatBody from "./ChatBody.svelte";
    import { risuChatParser } from "src/ts/process/scripts";
    import { XIcon, SettingsIcon, ListFilterIcon, ImageDownIcon, LayersIcon, PaletteIcon, ScanSearchIcon, MousePointerClickIcon, ChevronRightIcon, ChevronDownIcon, FolderIcon, FolderOpenIcon, SlidersIcon, EyeIcon, SparklesIcon, SmartphoneIcon, MonitorIcon, ScalingIcon, MaximizeIcon, MinimizeIcon } from "@lucide/svelte";
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

    type Theme = 'modern' | 'classic' | 'neon' | 'paper' | 'console' | 'fluent' | 'cupertino';

    // --- State ---
    let exportContainer = $state<HTMLElement>();
    let loading = $state(false);
    let loadingMessage = $state('Processing...');
    
    let currentTab = $state<Tab>('settings');
    let mobileView = $state<'settings' | 'preview'>('settings');

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
    let selectedTheme = $state<Theme>('modern');
    
    // Filter Options
    let stripHtml = $state(false);
    let showAdvanced = $state(false);
    
    // Inspector & Filtering
    let classTree = $state<ClassNode[]>([]);
    let _dummyBool = $state(false);
    let hiddenClasses = $state(new Set<string>());
    
    let inspectorMode = $state(false);
    let highlightedElement = $state<HTMLElement | null>(null);

    // Auto-fit Logic
    let messageElements = $state<HTMLElement[]>([]);
    let previewAreaWidth = $state(0);
    let contentHeight = $state(0);
    let autoFit = $state(true);
    let fitScale = $derived.by(() => {
        if (!autoFit || !previewAreaWidth || previewAreaWidth <= 0) return 1;
        const padding = 36; // 32px (1rem*2) + safety buffer
        const available = previewAreaWidth - padding;
        if (available >= exportWidth) return 1;
        return Math.max(0.1, available / exportWidth);
    });

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
                // Skip images that failed to load
                if (node instanceof HTMLImageElement) {
                    if (!node.complete || node.naturalWidth === 0) {
                        return false;
                    }
                }
            }
            return true;
        };

        try {
            const width = exportContainer.offsetWidth;
            const height = exportContainer.scrollHeight;
            const CHUNK_SIZE = 8000;
            let finalBytes: Uint8Array;
            
            // Transparent 1x1 PNG placeholder for failed images
            const transparentPlaceholder = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

            if (height <= CHUNK_SIZE) {
                loadingMessage = 'Capturing...';
                await sleep(50);
                const blob = await toBlob(exportContainer, {
                    backgroundColor: '#1a1b1e', 
                    style: { transform: 'scale(1)' },
                    filter,
                    cacheBust: false,
                    skipAutoScale: true,
                    skipFonts: true,
                    imagePlaceholder: transparentPlaceholder
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
                        cacheBust: false,
                        skipAutoScale: true,
                        skipFonts: true,
                        imagePlaceholder: transparentPlaceholder
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
<div class="export-modal-overlay" onclick={close} role="dialog" aria-modal="true" tabindex="-1">
    <div class="export-modal-container" onclick={e => e.stopPropagation()}>
        
        <!-- Mobile View Toggler (Only visible on mobile) -->
        <div class="mobile-nav">
            <button 
                class="mobile-nav-btn" 
                class:active={mobileView === 'settings'}
                onclick={() => mobileView = 'settings'}
            >
                <SlidersIcon size={16} />
                <span>Settings ⚙️</span>
            </button>
            <button 
                class="mobile-nav-btn" 
                class:active={mobileView === 'preview'}
                onclick={() => mobileView = 'preview'}
            >
                <EyeIcon size={16} />
                <span>Preview 🖼️</span>
            </button>
        </div>

        <!-- Sidebar (Left) -->
        <div class="export-sidebar" class:hidden-mobile={mobileView === 'preview'}>
            <!-- Sidebar Header -->
            <div class="export-sidebar-header">
                <div class="export-title-row">
                    <div class="export-title-icon">
                        <ImageDownIcon size={24} />
                    </div>
                    <div class="export-title-text">
                        <h2>Export Logs 📤</h2>
                        <p>Share your story!</p>
                    </div>
                </div>

                <!-- Tabs -->
                <div class="export-tabs">
                    <button 
                        class="export-tab"
                        class:export-tab-active={currentTab === 'settings'}
                        onclick={() => currentTab = 'settings'}
                    >
                        <SlidersIcon size={15} />
                        <span>Config 🛠️</span>
                    </button>
                    <button 
                        class="export-tab"
                        class:export-tab-active={currentTab === 'filters'}
                        onclick={() => currentTab = 'filters'}
                    >
                        <LayersIcon size={15} />
                        <span>Filters 🧹</span>
                    </button>
                </div>
            </div>

            <!-- Sidebar Content -->
            <div class="export-sidebar-content">
                
                {#if currentTab === 'settings'}
                    <!-- Section: Range -->
                    <div class="setting-group">
                        <div class="setting-header">
                            <ListFilterIcon size={16} />
                            <span>Message Range 📏</span>
                        </div>
                        
                        <div class="setting-card">
                            <div class="setting-row">
                                <span class="label">Start Index</span>
                                <NumberInput size="sm" min={0} max={messages.length - 1} bind:value={startIndex} />
                            </div>
                            <div class="setting-row">
                                <span class="label">End Index</span>
                                <NumberInput size="sm" min={0} max={messages.length - 1} bind:value={endIndex} />
                            </div>
                            
                            <div class="grid grid-cols-3 gap-2 mt-2">
                                <Button size="sm" styled="outlined" className="w-full text-xs" onclick={() => {
                                    startIndex = $exportModalStore.initialIndex;
                                    endIndex = $exportModalStore.initialIndex;
                                }}>Current 📍</Button>
                                <Button size="sm" styled="outlined" className="w-full text-xs" onclick={() => endIndex = messages.length - 1}>To End ⏩</Button>
                                <Button size="sm" styled="outlined" className="w-full text-xs" onclick={() => { startIndex = 0; endIndex = messages.length - 1; }}>All 📚</Button>
                            </div>
                            <div class="text-center text-[10px] text-textcolor2 mt-1">
                                Selected: <span class="text-primary font-bold">{displayMessages.length}</span> messages
                            </div>
                        </div>
                    </div>

                    <!-- Section: Appearance -->
                    <div class="setting-group">
                        <div class="setting-header">
                            <PaletteIcon size={16} />
                            <span>Appearance 🎨</span>
                        </div>

                        <div class="setting-card">
                            <div class="setting-row">
                                <span class="label">Width (px)</span>
                                <div class="w-24">
                                    <NumberInput size="sm" min={400} max={3000} bind:value={exportWidth} />
                                </div>
                            </div>
                            <div class="setting-row">
                                <span class="label">Font Size</span>
                                <div class="w-24">
                                    <NumberInput size="sm" min={10} max={64} bind:value={fontSize} />
                                </div>
                            </div>
                            <div class="setting-row">
                                <span class="label">UI Scale 🔍</span>
                                <div class="flex items-center gap-2">
                                    <input 
                                        type="range" 
                                        min="0.5" 
                                        max="2" 
                                        step="0.1" 
                                        bind:value={uiScale}
                                        class="scale-slider"
                                    />
                                    <span class="scale-value">{uiScale.toFixed(1)}x</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Section: Header & Footer -->
                    <div class="setting-group">
                        <div class="setting-header">
                            <SparklesIcon size={16} />
                            <span>Extras ✨</span>
                        </div>

                        <div class="setting-card">
                            <CheckInput name="Show Header 👤" bind:check={showHeader} />
                            <CheckInput name="Show Footer 📝" bind:check={showFooter} />
                            
                            {#if showFooter}
                                <div class="pl-7 pt-1">
                                    <input 
                                        type="text" 
                                        class="fancy-input"
                                        bind:value={footerText}
                                        placeholder="Exported from RisuAI"
                                    />
                                </div>
                            {/if}

                            <div class="divider"></div>

                            <div class="flex flex-col gap-2">
                                <span class="label">Design Style 🎭</span>
                                <div class="grid grid-cols-3 gap-2">
                                     <button 
                                        class="style-btn"
                                        class:selected={selectedTheme === 'modern'}
                                        onclick={() => selectedTheme = 'modern'}
                                    >
                                        Modern 💎
                                    </button>
                                     <button 
                                        class="style-btn"
                                        class:selected={selectedTheme === 'fluent'}
                                        onclick={() => selectedTheme = 'fluent'}
                                    >
                                        Fluent 🪟
                                    </button>
                                    <button 
                                        class="style-btn"
                                        class:selected={selectedTheme === 'cupertino'}
                                        onclick={() => selectedTheme = 'cupertino'}
                                    >
                                        MacOS 🍎
                                    </button>
                                    <button 
                                        class="style-btn"
                                        class:selected={selectedTheme === 'neon'}
                                        onclick={() => selectedTheme = 'neon'}
                                    >
                                        Neon 🌃
                                    </button>
                                    <button 
                                        class="style-btn"
                                        class:selected={selectedTheme === 'paper'}
                                        onclick={() => selectedTheme = 'paper'}
                                    >
                                        Paper 📜
                                    </button>
                                    <button 
                                        class="style-btn"
                                        class:selected={selectedTheme === 'console'}
                                        onclick={() => selectedTheme = 'console'}
                                    >
                                        Console 📟
                                    </button>
                                    <button 
                                        class="style-btn"
                                        class:selected={selectedTheme === 'classic'}
                                        onclick={() => selectedTheme = 'classic'}
                                    >
                                        Classic 👴
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                {:else if currentTab === 'filters'}
                    <!-- Section: Inspector -->
                    <div class="setting-group">
                        <div class="setting-header">
                            <EyeIcon size={16} />
                            <span>Inspector 🕵️</span>
                        </div>
                         <div class="setting-card">
                            <Button 
                                styled={inspectorMode ? "primary" : "outlined"} 
                                className="w-full flex items-center justify-center gap-2" 
                                onclick={toggleInspector}
                            >
                                <MousePointerClickIcon size={16} />
                                {inspectorMode ? 'Inspector Active! Click UI' : 'Start Selecting mode'}
                            </Button>
                            <p class="text-[10px] text-textcolor2 mt-2 text-center">
                                {inspectorMode ? 'Click any element in preview to hide it!' : 'Toggle to click-and-hide unwanted elements.'}
                            </p>
                         </div>
                    </div>

                    <!-- Section: Class Tree -->
                    <div class="setting-group flex-grow overflow-hidden">
                        <div class="setting-header">
                            <LayersIcon size={16} />
                            <span>Elements 🌳</span>
                        </div>

                        <div class="setting-card h-full flex flex-col overflow-hidden">
                            <CheckInput name="Text Only (No Styles) 📄" bind:check={stripHtml} />
                            <CheckInput name="Show All Classes 🧩" bind:check={showAdvanced} />
                            
                            <div class="divider"></div>

                            <div class="tree-container">
                                {#if classTree.length === 0}
                                    <span class="empty-tree">No elements found...</span>
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
                <button class="export-btn-cancel" onclick={close}>Close ❌</button>
                <button class="export-btn-action" onclick={exportImage} disabled={loading}>
                    {#if loading}
                        <span class="export-btn-loading"></span>
                        {loadingMessage}
                    {:else}
                        <ImageDownIcon size={16} />
                        Export PNG 📸
                    {/if}
                </button>
            </div>
        </div>

        <!-- Preview Area (Right) -->
        <div class="export-preview-area" class:hidden-mobile={mobileView === 'settings'}>
            {#if inspectorMode}
                <div class="inspector-badge">
                    <MousePointerClickIcon size={16} />
                    <span>Click to Hide!</span>
                </div>
            {/if}
            <div class="absolute top-4 left-4 z-10 flex gap-2 pointer-events-none">
                <button 
                    class="bg-black/50 px-3 py-1 rounded-full backdrop-blur-md border border-white/10 pointer-events-auto flex items-center gap-1.5 transition-colors hover:bg-black/70"
                    onclick={() => autoFit = !autoFit}
                >
                    {#if autoFit}
                        <MinimizeIcon size={12} class="text-white/80" />
                        <span class="text-xs font-mono text-white/80">Fit: ON</span>
                    {:else}
                        <MaximizeIcon size={12} class="text-white/80" />
                        <span class="text-xs font-mono text-white/80">Fit: OFF</span>
                    {/if}
                </button>
            </div>

            <div class="preview-badge">
                <span class="text-xs font-mono text-white/80">PREVIEW MODE</span>
            </div>

            <div class="preview-scroller"
                 bind:clientWidth={previewAreaWidth}
                 class:cursor-crosshair={inspectorMode}>
                
                <!-- Wrapper to enforce layout bounds on scaled content -->
                <div class="export-wrapper" style="width: {exportWidth * fitScale}px; height: {contentHeight * fitScale}px; margin: 0 auto;">
                    <!-- Export Target Container -->
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <!-- svelte-ignore a11y_mouse_events_have_key_events -->
                    <div id="export-preview" 
                        bind:this={exportContainer} 
                        bind:clientHeight={contentHeight}
                        class="flex flex-col shrink-0 transition-all duration-200 overflow-hidden"
                        class:export-modern={selectedTheme === 'modern'}
                        class:export-classic={selectedTheme === 'classic'}
                        class:export-neon={selectedTheme === 'neon'}
                        class:export-paper={selectedTheme === 'paper'}
                        class:export-console={selectedTheme === 'console'}
                        class:export-fluent={selectedTheme === 'fluent'}
                        class:export-cupertino={selectedTheme === 'cupertino'}
                        style="width: {exportWidth}px; transform: scale({fitScale}); transform-origin: top left;"
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
                                            <span class="export-header-count">• {displayMessages.length} msgs</span>
                                        </p>
                                    </div>
                                </div>
                            </div>
                        {/if}
                        
                        <!-- Messages Container -->
                        <div class="export-messages" style="font-size: {fontSize}px;">
                            {#each displayMessages as msg, i}
                                <div class="export-message" class:export-message-user={msg.role === 'user'}>
                                    {#if selectedTheme !== 'classic'}
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
                                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                                            <div 
                                                class="export-bubble-content chattext prose max-w-none"
                                                class:prose-invert={(selectedTheme === 'cupertino' && msg.role === 'user') || ['modern', 'neon', 'console'].includes(selectedTheme)}
                                                bind:this={messageElements[i]}
                                            >
                                                <ChatBody 
                                                    character={createSimpleCharacter(char)}
                                                    idx={i + startIndex}
                                                    firstMessage={i + startIndex === 0}
                                                    msgDisplay={risuChatParser(msg.data, {
                                                        chara: char.name,
                                                        chatID: i + startIndex,
                                                        rmVar: true,
                                                        visualize: true,
                                                        cbsConditions: {
                                                            firstmsg: i + startIndex === 0,
                                                            chatRole: msg.role
                                                        }
                                                    })}
                                                    name={msg.name}
                                                    role={msg.role}
                                                    bind:translated={_dummyBool}
                                                    bind:translating={_dummyBool}
                                                    bind:retranslate={_dummyBool}
                                                    bodyRoot={messageElements[i]}
                                                    modelShortName=""
                                                />
                                            </div>
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
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(5px);
    }

    :global(.export-modal-container) {
        width: 95vw;
        height: 95vh;
        display: flex;
        border-radius: 16px;
        overflow: hidden;
        background: #18181b; /* zinc-950 */
        border: 1px solid #27272a;
        box-shadow: 0 0 50px rgba(0,0,0,0.5);
    }

    @media (max-width: 768px) {
        :global(.export-modal-container) {
            flex-direction: column;
            width: 100%;
            height: 100%;
            border-radius: 0;
            border: none;
        }
    }

    /* ========================================
       MOBILE NAVIGATION (New)
       ======================================== */
    
    .mobile-nav {
        display: none; /* Hidden on desktop */
        background: #09090b;
        border-bottom: 1px solid #27272a;
        padding: 0.5rem;
        gap: 0.5rem;
        flex-shrink: 0;
    }

    @media (max-width: 768px) {
        .mobile-nav {
            display: flex;
        }
    }

    .mobile-nav-btn {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.75rem;
        border-radius: 8px;
        background: transparent;
        color: #71717a;
        border: 2px solid transparent;
        font-weight: 600;
        font-size: 0.9rem;
        transition: all 0.2s;
    }

    .mobile-nav-btn.active {
        color: white;
        background: #27272a;
        border-color: #3f3f46;
    }

    /* ========================================
       SIDEBAR
       ======================================== */
    
    :global(.export-sidebar) {
        width: 380px;
        min-width: 380px;
        display: flex;
        flex-direction: column;
        background: #18181b;
        border-right: 1px solid #27272a;
        z-index: 20;
    }
    
    @media (max-width: 768px) {
        :global(.export-sidebar) {
            width: 100%;
            min-width: unset;
            flex: 1; /* Use flex instead of fixed height */
            height: auto;
            min-height: 0; /* Crucial for scrolling inside flex container */
            border-right: none;
            overflow: hidden; /* Ensure only content scrolls */
        }
        
        :global(.export-sidebar.hidden-mobile) {
            display: none;
        }
    }

    :global(.export-sidebar-header) {
        padding: 1.5rem;
        border-bottom: 1px solid #27272a;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        background: #18181b;
    }

    :global(.export-title-row) {
        display: flex;
        align-items: center;
        gap: 1rem;
    }

    :global(.export-title-icon) {
        width: 42px;
        height: 42px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #27272a;
        border-radius: 10px;
        color: white;
        border: 1px solid #3f3f46;
    }

    :global(.export-title-text h2) {
        font-size: 1.1rem;
        font-weight: 700;
        color: #f4f4f5;
        margin: 0;
    }

    :global(.export-title-text p) {
        font-size: 0.8rem;
        color: #71717a;
        margin: 0;
    }

    /* Tabs */
    :global(.export-tabs) {
        display: flex;
        background: #09090b;
        padding: 0.25rem;
        border-radius: 8px;
        border: 1px solid #27272a;
    }

    :global(.export-tab) {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
        padding: 0.5rem;
        border-radius: 6px;
        font-size: 0.8rem;
        font-weight: 500;
        color: #71717a;
        background: transparent;
        border: none;
        cursor: pointer;
    }

    :global(.export-tab:hover) {
        color: #d4d4d8;
    }

    :global(.export-tab-active) {
        color: #ffffff !important;
        background: #27272a !important;
        font-weight: 600;
    }

    /* Sidebar Content */
    :global(.export-sidebar-content) {
        flex-grow: 1;
        overflow-y: auto;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
    }

    /* Settings Components */
    .setting-group {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .setting-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.85rem;
        font-weight: 600;
        color: #d4d4d8;
        background: #27272a; /* Label accent */
        padding: 0.4rem 0.75rem;
        border-radius: 6px;
        align-self: flex-start;
    }

    .setting-card {
        background: #09090b;
        border: 1px solid #27272a;
        border-radius: 10px;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .setting-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .label {
        font-size: 0.8rem;
        color: #a1a1aa;
    }

    .divider {
        height: 1px;
        background: #27272a;
        width: 100%;
    }

    /* Custom Inputs/Buttons Styles */
    .scale-slider {
        width: 5rem;
        height: 4px;
        border-radius: 4px;
        background: #3f3f46;
        accent-color: #6366f1;
    }

    .scale-value {
        font-size: 0.75rem;
        font-weight: 600;
        color: white;
        min-width: 2rem;
        text-align: right;
    }

    .fancy-input {
        width: 100%;
        background: #18181b;
        border: 1px solid #3f3f46;
        color: white;
        padding: 0.4rem 0.6rem;
        border-radius: 6px;
        font-size: 0.8rem;
        transition: border-color 0.2s;
    }

    .fancy-input:focus {
        border-color: #6366f1;
        outline: none;
    }

    .style-btn {
        padding: 0.6rem;
        border-radius: 8px;
        font-size: 0.8rem;
        background: #18181b;
        border: 2px solid #27272a;
        color: #a1a1aa;
        cursor: pointer;
        transition: all 0.2s;
        text-align: center;
    }

    .style-btn:hover {
        border-color: #3f3f46;
    }

    .style-btn.selected {
        border-color: #6366f1;
        background: rgba(99, 102, 241, 0.1);
        color: #818cf8;
        font-weight: 600;
    }

    /* Sidebar Footer */
    :global(.export-sidebar-footer) {
        padding: 1rem;
        border-top: 1px solid #27272a;
        display: flex;
        gap: 0.75rem;
        background: #18181b;
    }

    .export-btn-cancel {
        flex: 1;
        background: transparent;
        border: 1px solid #3f3f46;
        color: #a1a1aa;
        padding: 0.75rem;
        border-radius: 8px;
        font-size: 0.85rem;
        font-weight: 500;
        cursor: pointer;
    }
    
    .export-btn-cancel:hover {
        background: #27272a;
        color: white;
    }

    .export-btn-action {
        flex: 2;
        background: #ffffff;
        color: #000000;
        border: none;
        padding: 0.75rem;
        border-radius: 8px;
        font-size: 0.85rem;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
    }

    .export-btn-action:hover {
        background: #e4e4e7;
    }
    
    .export-btn-action:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* ========================================
       PREVIEW AREA
       ======================================== */
    
    :global(.export-preview-area) {
        flex-grow: 1;
        background: #0c0c0e; /* Even darker */
        position: relative;
        overflow: hidden; /* Scroller handles scroll */
        display: flex;
        flex-direction: column;
    }

    @media (max-width: 768px) {
        :global(.export-preview-area.hidden-mobile) {
            display: none;
        }
    }

    .preview-scroller {
        flex: 1;
        overflow: auto;
        padding: 1rem;
        display: flex;
        align-items: flex-start;
    }

    /* Media query removed as we use 1rem globally now */

    .inspector-badge, .preview-badge {
        position: absolute;
        z-index: 50;
        pointer-events: none;
    }

    .inspector-badge {
        top: 1rem;
        left: 50%;
        transform: translateX(-50%);
        background: #ef4444;
        color: white;
        padding: 0.4rem 1rem;
        border-radius: 20px;
        font-weight: 600;
        font-size: 0.8rem;
        display: flex;
        gap: 0.5rem;
        align-items: center;
        box-shadow: 0 4px 10px rgba(239, 68, 68, 0.4);
    }

    .preview-badge {
        top: 1rem;
        right: 1rem;
        background: rgba(255, 255, 255, 0.1);
        padding: 0.25rem 0.6rem;
        border-radius: 4px;
    }

    /* Inspector Overlay Highlights */
    :global(.inspector-highlight) {
        outline: 2px dashed #ef4444 !important;
        background: rgba(239, 68, 68, 0.2) !important;
        cursor: pointer !important;
    }

    :global(.auto-hidden-target) {
        opacity: 0.3 !important;
        filter: grayscale(1) !important;
    }

    /* ========================================
       EXPORT STYLES
       ======================================== */

    /* The actual exported part */
    :global(#export-preview) {
        /* No fixed width here, width is controlled via style attr */
    }

    :global(.export-header) {
        padding: 2rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    :global(.export-header-content) {
        display: flex;
        align-items: center;
        gap: 1.5rem;
    }

    :global(.export-header-avatar) {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background-color: #27272a;
        background-size: cover;
        background-position: center; 
    }

    :global(.export-header-name) {
        font-size: 2em;
        font-weight: 700;
        color: white;
        margin: 0;
    }
    
    :global(.export-header-meta) {
        font-size: 1em;
        color: rgba(255, 255, 255, 0.6);
        margin: 0.25em 0 0 0;
    }

    :global(.export-messages) {
        padding: 2rem;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    /* Footer */
    :global(.export-footer) {
        padding: 2rem;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        justify-content: space-between;
        color: rgba(255, 255, 255, 0.4);
    }
    
    /* === MODERN THEME === */
    :global(.export-modern) {
        background: #1e1e24; /* Nice gray-blue dark */
        color: #f4f4f5;
        font-family: 'Inter', sans-serif;
    }

    :global(.export-modern .export-bubble-wrapper) {
        display: flex;
        gap: 1rem;
        align-items: flex-start;
    }

    :global(.export-modern .export-bubble-right) {
        flex-direction: row-reverse;
    }

    :global(.export-modern .export-avatar) {
        width: 50px;
        height: 50px;
        border-radius: 12px;
        background-color: #3f3f46;
        background-size: cover;
        background-position: center;
        flex-shrink: 0;
    }

    :global(.export-modern .export-bubble) {
        background: #27272a;
        padding: 1rem 1.25rem;
        border-radius: 16px;
        border-top-left-radius: 0;
        max-width: 85%;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    }

    :global(.export-modern .export-bubble-user-style) {
        background: #3b82f6; /* Blue 500 */
        color: white;
        border-top-left-radius: 16px;
        border-top-right-radius: 0;
    }
    
    :global(.export-modern .export-bubble-name) {
        font-size: 0.75em;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 0.5rem;
        opacity: 0.7;
        font-weight: 700;
    }

    :global(.export-modern .export-bubble-content) {
        line-height: 1.6;
    }

    /* === CLASSIC THEME === */
    :global(.export-classic) {
        background: #1a1b1e;
        color: #c1c2c5;
        font-family: sans-serif;
    }
    
    :global(.export-classic .export-messages) {
        padding: 0 2rem;
        gap: 0;
    }

    /* === NEON THEME (Subtle) === */
    :global(.export-neon) {
        background: #0f1014; /* Very Dark Blue-Black */
        color: #e2e8f0;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
    }

    :global(.export-neon .export-header-name) {
        color: #e0e0e0;
        text-shadow: 0 0 10px rgba(139, 92, 246, 0.5); /* Subtle purple glow */
    }

    :global(.export-neon .export-bubble-wrapper) {
        display: flex;
        gap: 1rem;
        align-items: flex-start;
    }

    :global(.export-neon .export-bubble-right) {
        flex-direction: row-reverse;
    }

    :global(.export-neon .export-avatar) {
        width: 50px;
        height: 50px;
        border-radius: 8px; /* Slightly sharper */
        background-color: #1e1e24;
        background-size: cover;
        background-position: center;
        flex-shrink: 0;
        border: 1px solid rgba(139, 92, 246, 0.3);
        box-shadow: 0 0 8px rgba(139, 92, 246, 0.1);
    }

    :global(.export-neon .export-bubble) {
        background: #15151a;
        padding: 1rem 1.25rem;
        border-radius: 4px;
        border: 1px solid #2d2d35;
        max-width: 85%;
        border-left: 2px solid #8b5cf6; /* Purple accent */
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    }

    :global(.export-neon .export-bubble-user-style) {
        background: #1a1a20;
        border-left: 1px solid #2d2d35;
        border-right: 2px solid #06b6d4; /* Cyan accent */
        color: #e2e8f0;
    }

    :global(.export-neon .export-bubble-name) {
        font-size: 0.75em;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-bottom: 0.5rem;
        color: #8b5cf6;
        font-weight: 700;
        text-shadow: 0 0 5px rgba(139, 92, 246, 0.3);
    }

    :global(.export-neon .export-bubble-user-style .export-bubble-name) {
        color: #06b6d4;
        text-shadow: 0 0 5px rgba(6, 182, 212, 0.3);
        text-align: right;
    }

    /* === PAPER THEME (Novel Style) === */
    :global(.export-paper) {
        background: #fdfbf7; /* Cream white */
        color: #000000;
        font-family: 'Merriweather', 'Georgia', serif;
    }

    /* Force black text for light themes - Aggressive Override */
    :global(.export-paper .prose),
    :global(.export-fluent .prose),
    :global(.export-cupertino .prose) {
        --tw-prose-body: #000000;
        --tw-prose-headings: #000000;
        --tw-prose-lead: #000000;
        --tw-prose-links: #000000;
        --tw-prose-bold: #000000;
        --tw-prose-counters: #000000;
        --tw-prose-bullets: #000000;
        --tw-prose-hr: #000000;
        --tw-prose-quotes: #000000;
        --tw-prose-quote-borders: #000000;
        --tw-prose-captions: #000000;
        --tw-prose-code: #000000;
        --tw-prose-pre-code: #000000;
        --tw-prose-pre-bg: #f5f5f5;
        --tw-prose-th-borders: #000000;
        --tw-prose-td-borders: #000000;
        color: #000000 !important;
    }

    /* Override global chattext styles */
    :global(.export-paper .chattext p),
    :global(.export-paper .chattext span),
    :global(.export-paper .chattext strong),
    :global(.export-paper .chattext em),
    :global(.export-fluent .chattext p),
    :global(.export-fluent .chattext span),
    :global(.export-fluent .chattext strong),
    :global(.export-fluent .chattext em),
    :global(.export-cupertino .chattext p),
    :global(.export-cupertino .chattext span),
    :global(.export-cupertino .chattext strong),
    :global(.export-cupertino .chattext em) {
        color: #000000 !important;
    }

    /* Exception for Cupertino User Bubble (Blue bg, White text) */
    :global(.export-cupertino .export-bubble-user-style .prose) {
        --tw-prose-body: #ffffff;
        --tw-prose-headings: #ffffff;
        /* ... */
        color: #ffffff !important;
    }
    :global(.export-cupertino .export-bubble-user-style .chattext p),
    :global(.export-cupertino .export-bubble-user-style .chattext span),
    :global(.export-cupertino .export-bubble-user-style .chattext strong),
    :global(.export-cupertino .export-bubble-user-style .chattext em) {
        color: #ffffff !important;
    }

    :global(.export-paper .export-header-name) {
        color: #000000;
        font-family: 'Playfair Display', serif;
        border-bottom: 2px solid #000;
        padding-bottom: 0.5rem;
        display: inline-block;
    }

    :global(.export-paper .export-header-meta) {
        color: #444;
        font-style: italic;
    }

    :global(.export-paper .export-footer) {
        border-top: 2px solid #000;
        color: #000;
    }

    :global(.export-paper .export-bubble-wrapper) {
        display: block; /* No flex, standard block flow */
        margin-bottom: 1.5rem;
    }

    :global(.export-paper .export-bubble-right) {
        /* No row-reverse */
    }

    :global(.export-paper .export-avatar) {
        display: none; /* No avatars in novel mode */
    }

    :global(.export-paper .export-bubble) {
        background: transparent;
        padding: 0;
        border-radius: 0;
        max-width: 100%;
        box-shadow: none;
        border: none;
        line-height: 1.8;
    }

    :global(.export-paper .export-bubble-user-style) {
        background: transparent;
        border: none;
    }

    :global(.export-paper .export-bubble-name) {
        font-size: 1rem;
        font-weight: 700;
        color: #000;
        margin-bottom: 0.25rem;
        font-family: sans-serif;
        display: block;
    }
    
    /* Novel style formatting for name */
    :global(.export-paper .export-bubble-name::after) {
        content: ": ";
    }

    /* === CONSOLE THEME === */
    :global(.export-console) {
        background: #000000;
        color: #00ff00; /* Bright Green */
        font-family: 'Courier New', Courier, monospace;
    }

    /* Force green console text over prose defaults */
    :global(.export-console .prose) {
        --tw-prose-body: #00ff00;
        --tw-prose-headings: #00ff00;
        --tw-prose-lead: #00ff00;
        --tw-prose-links: #00ff00;
        --tw-prose-bold: #00ff00;
        --tw-prose-counters: #00ff00;
        --tw-prose-bullets: #00ff00;
        --tw-prose-hr: #00ff00;
        --tw-prose-quotes: #00ff00;
        --tw-prose-quote-borders: #00ff00;
        --tw-prose-captions: #00ff00;
        --tw-prose-code: #00ff00;
        --tw-prose-pre-code: #00ff00;
        --tw-prose-pre-bg: #000000;
        --tw-prose-th-borders: #00ff00;
        --tw-prose-td-borders: #00ff00;
        color: #00ff00 !important;
    }
    :global(.export-console .prose *) {
        color: #00ff00 !important;
        border-color: #00ff00 !important;
    }

    :global(.export-console .export-header) {
        border-bottom: 1px dashed #00ff00;
    }

    :global(.export-console .export-footer) {
        border-top: 1px dashed #00ff00;
        color: #00aa00;
    }

    :global(.export-console .export-header-name) {
        color: #00ff00;
        text-transform: uppercase;
    }

    :global(.export-console .export-header-meta) {
        color: #00aa00;
    }

    :global(.export-console .export-bubble-wrapper) {
        display: flex;
        gap: 1rem;
        align-items: flex-start;
        margin-bottom: 0.5rem;
    }

    :global(.export-console .export-bubble-right) {
        flex-direction: row-reverse;
    }

    :global(.export-console .export-avatar) {
        display: none; /* No avatars in console */
    }

    :global(.export-console .export-bubble) {
        background: transparent;
        padding: 0;
        max-width: 100%;
        border-left: 2px solid #00ff00;
        padding-left: 1rem;
    }

    :global(.export-console .export-bubble-user-style) {
        border-left: none;
        border-right: 2px solid #00ff00; /* User on right */
        padding-left: 0;
        padding-right: 1rem;
        text-align: right;
    }

    :global(.export-console .export-bubble-name) {
        font-size: 0.8em;
        margin-bottom: 0.2rem;
        opacity: 0.8;
    }

    :global(.export-console .export-bubble-name::before) {
        content: '<';
    }
    :global(.export-console .export-bubble-name::after) {
        content: '>';
    }

    /* === FLUENT THEME (Microsoft) === */
    :global(.export-fluent) {
        background: #f3f3f3; /* Windows Light Gray */
        color: #000000;
        font-family: 'Segoe UI', sans-serif;
    }

    :global(.export-fluent .export-header-name) {
        color: #1a1a1a;
        font-weight: 600;
    }
    
    :global(.export-fluent .export-header-meta) {
        color: #666;
    }

    :global(.export-fluent .export-footer) {
        border-top: 1px solid #e5e5e5;
        color: #666;
    }

    :global(.export-fluent .export-bubble-wrapper) {
        display: flex;
        gap: 0.75rem;
        align-items: flex-end; /* Bottom align like Teams/Skype often do, or top? Standard is top */
        align-items: flex-start;
    }

    :global(.export-fluent .export-bubble-right) {
        flex-direction: row-reverse;
    }

    :global(.export-fluent .export-avatar) {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background-color: #ddd;
        background-size: cover;
        background-position: center;
        flex-shrink: 0;
    }

    :global(.export-fluent .export-bubble) {
        background: #ffffff;
        padding: 0.6rem 1rem;
        border-radius: 8px; /* Fluent rounded corners */
        max-width: 80%;
        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        border: 1px solid #e5e5e5;
    }

    :global(.export-fluent .export-bubble-user-style) {
        background: #d1e7ff; /* Fluent Blue Light */
        border: 1px solid #bae6ff;
        color: #000;
    }

    :global(.export-fluent .export-bubble-name) {
        font-size: 0.75em;
        margin-bottom: 0.2rem;
        color: #555;
        font-weight: 600;
    }

    /* === CUPERTINO THEME (macOS) === */
    :global(.export-cupertino) {
        background: #ffffff;
        color: #000000;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
    }

    :global(.export-cupertino .export-header) {
        background: rgba(245, 245, 247, 0.8);
        -webkit-backdrop-filter: blur(20px);
        backdrop-filter: blur(20px);
        border-bottom: 1px solid #d1d1d6;
    }

    :global(.export-cupertino .export-header-name) {
        color: #000;
        font-weight: 600;
    }

    :global(.export-cupertino .export-header-meta) {
        color: #8e8e93;
    }

    :global(.export-cupertino .export-footer) {
        border-top: 1px solid #d1d1d6;
        color: #8e8e93;
        background: #f5f5f7;
    }

    :global(.export-cupertino .export-bubble-wrapper) {
        display: flex;
        gap: 0.5rem;
        align-items: flex-end; /* iMessage style is bottom aligned */
    }

    :global(.export-cupertino .export-bubble-right) {
        flex-direction: row-reverse;
    }

    :global(.export-cupertino .export-avatar) {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        background-color: #e5e5ea;
        background-size: cover;
        background-position: center;
        flex-shrink: 0;
        margin-bottom: 2px;
    }

    :global(.export-cupertino .export-bubble) {
        background: #e5e5ea; /* iMessage Gray */
        padding: 0.5rem 1rem;
        border-radius: 18px; /* High rounding */
        max-width: 75%;
        color: #000;
        position: relative;
    }

    :global(.export-cupertino .export-bubble-user-style) {
        background: #007aff; /* iMessage Blue */
        color: white;
    }

    :global(.export-cupertino .export-bubble-name) {
        display: none; /* Usually hidden in iMessage unless group chat, but we keep it simple or make it small above? */
    }

    /* Add back name for clarity but outside bubble */
    :global(.export-cupertino .export-bubble-wrapper) {
        position: relative;
        padding-top: 15px; /* Space for name */
    }
    
    :global(.export-cupertino .export-bubble-name) {
        display: block;
        position: absolute;
        top: 0;
        left: 3.5rem; /* avatar + gap */
        font-size: 0.7rem;
        color: #8e8e93;
        font-weight: 500;
    }

    :global(.export-cupertino .export-bubble-right .export-bubble-name) {
        left: auto;
        right: 3.5rem;
        text-align: right;
    }

    /* === FONT SIZE INHERITANCE === */
    /* Force prose to inherit font-size from export-messages */
    :global(.export-messages .prose) {
        font-size: inherit !important;
    }
    :global(.export-messages .prose p),
    :global(.export-messages .prose li),
    :global(.export-messages .prose span) {
        font-size: inherit !important;
    }

</style>