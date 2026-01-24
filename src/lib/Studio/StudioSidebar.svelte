<script lang="ts">
    import {
    CharEmotion,
    selectedCharID,
    settingsOpen,
    sideBarClosing,
    sideBarStore,
    OpenRealmStore,
    PlaygroundStore,
    DBState
  } from "../../ts/stores.svelte";
    import {
    Settings,
    FolderIcon,
    FolderOpenIcon,
    HomeIcon,
    LayoutDashboard,
    MessageSquare,
    SearchIcon,
    MoreHorizontal,
    BotIcon,
    Plus,
    FolderPlus,
    CodeIcon,
    BookIcon,
    ChevronDown,
    ChevronRight,
    PanelLeftClose,
    FileCog
  } from "@lucide/svelte";
    import {
    changeChar,
    getCharImage,
  } from "../../ts/characters";
    import { language } from "../../lang";
    import isEqual from "lodash/isEqual";
    import SidebarAvatar from "../SideBars/SidebarAvatar.svelte";
    import { getCharacterIndexObject } from "src/ts/util";
    import SidebarIndicator from "../SideBars/SidebarIndicator.svelte";
    import { v4 } from "uuid";
  import { changeChatTo } from "src/ts/globalApi.svelte";
  import { openStudioTab } from "./studioStore.svelte";
  import type { character, customscript, loreBook } from "src/ts/storage/database.svelte";

  let charImages: any[] = $state([]);
  let openFolders:string[] = $state([])

  let activeSidebarTab: 'characters' | 'chats' | 'search' | 'explorer' | null = $state('characters'); 
  let isMobile = $state(false);

  // Bot Settings (Explorer) State
  let expandedBasic = $state(true);
  let expandedLore = $state(true);
  let expandedRegex = $state(true);
  let explorerFolders = $state<Set<string>>(new Set());

  // Derived char for Explorer
  let char = $derived(
      $selectedCharID !== -1 && DBState.db?.characters?.length > $selectedCharID 
      ? DBState.db.characters[$selectedCharID] as character 
      : null
  );

  // Mobile detection
  $effect(() => {
      const checkMobile = () => {
          isMobile = window.innerWidth <= 640;
      };
      
      checkMobile();
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
  }); 
  // 'characters' is default as requested "Bot list separated"

  // let currentDrag: DragData = $state(null)

  function reseter() {
    settingsOpen.set(false);
    CharEmotion.set({});
  }

  $effect(() => {
    (async () => {
        let newCharImages: any[] = [];
        const idObject = getCharacterIndexObject()
        for (const id of DBState.db.characterOrder) {
          if(typeof(id) === 'string'){
            const index = idObject[id] ?? -1
            if(index !== -1){
              const cha = DBState.db.characters[index]
              newCharImages.push({
                img: await getCharImage(cha.image ?? "", "plain"),
                index:index,
                type: "normal",
                name: cha.name
              });
            }
          }
          else{
            const folder = id
            let folderCharImages: any[] = []
            for(const id of folder.data){
              const index = idObject[id] ?? -1
              if(index !== -1){
                const cha = DBState.db.characters[index]
                folderCharImages.push({
                  img: await getCharImage(cha.image ?? "", "plain"),
                  index:index,
                  type: "normal",
                  name: cha.name
                });
              }
            }
            newCharImages.push({
              folder: folderCharImages,
              type: "folder",
              id: folder.id,
              name: folder.name,
              color: folder.color,
              img: folder.imgFile,
            });
          }
        }
        if (!isEqual(charImages, newCharImages)) {
          charImages = newCharImages;
        }
    })();
  })

  function toggleFolder(id: string) {
      if(openFolders.includes(id)){
          openFolders = openFolders.filter(f => f !== id);
      } else {
          openFolders = [...openFolders, id];
      }
  }

  function onSelectChar(index: number) {
      changeChar(index, {reseter});
      // Switch to chats tab automatically when character selected?
      // User might prefer staying on list. Let's keep it manual or auto?
      // User said "Chat list separated". Maybe switch?
      // Let's stick to manual tab switching for now to avoid confusion.
      activeSidebarTab = 'chats'; 
      window.dispatchEvent(new CustomEvent('studio-open-chat'));
  }

  function createNewChat() {
      if ($selectedCharID === -1) return;
      
      const newChatId = v4();
      const newChat = {
          message: [],
          note: "",
          name: "New Chat",
          id: newChatId,
          localLore: [],
          fmIndex: -1
      };
      
      // Ensure chats array exists
      if (!DBState.db.characters[$selectedCharID].chats) {
          DBState.db.characters[$selectedCharID].chats = [];
      }
      
      // Push new chat to the beginning or end? Usually beginning (unshift) for "Newest first"?
      // Or end? RisuAI usually appends.
      DBState.db.characters[$selectedCharID].chats.unshift(newChat);
      
      // Switch to this new chat
      changeChatTo(0);
      window.dispatchEvent(new CustomEvent('studio-open-chat'));
  }

  function createNewFolder() {
      if ($selectedCharID === -1) return;
      const newFolderId = v4();
      const newFolder = {
          id: newFolderId,
          name: "New Folder",
          color: "blue", // Default color
          folded: false
      };
      
      if (!DBState.db.characters[$selectedCharID].chatFolders) {
          DBState.db.characters[$selectedCharID].chatFolders = [];
      }
      DBState.db.characters[$selectedCharID].chatFolders.push(newFolder);
  }

  // Explorer Functions
  function toggleExplorerFolder(key: string) {
        const newSet = new Set(explorerFolders);
        if (newSet.has(key)) {
            newSet.delete(key);
        } else {
            newSet.add(key);
        }
        explorerFolders = newSet;
    }

    function addRegex() {
        if (!char) return;
        const newScript: customscript = {
            comment: 'New Script',
            in: '',
            out: '',
            type: 'regex',
            flag: 'gm'
        };
        if(!char.customscript) char.customscript = [];
        char.customscript.push(newScript);
        openStudioTab(`regex:${char.customscript.length - 1}`, newScript.comment || 'New Script', CodeIcon);
    }

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
        
        // Auto open
        openStudioTab(`lore:${char.globalLore.length - 1}`, newBook.comment || 'New Entry', BookIcon);

        if (folderKey) {
            const newSet = new Set(explorerFolders);
            newSet.add(folderKey);
            explorerFolders = newSet;
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

    function getLoreItems(items: loreBook[], folderKey?: string, depth: number = 0): any[] {
        let result: any[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if ((!folderKey && !item.folder) || (item.folder === folderKey)) {
                result.push({ item, depth, index: i });
                if (item.mode === 'folder' && explorerFolders.has(item.key)) {
                    result = result.concat(getLoreItems(items, item.key, depth + 1));
                }
            }
        }
        return result;
    }


</script>

{#if isMobile && !activeSidebarTab}
    <!-- Floating Hamburger for Mobile -->
    <button 
        class="fixed top-2 left-2 z-[60] p-2 bg-[#1e1e1e] text-[#cccccc] rounded-lg shadow-lg border border-[#3e3e42] hover:bg-[#2d2d2d]"
        onclick={() => activeSidebarTab = 'characters'}
    >
        <BotIcon size="20" />
    </button>
{/if}

<div class="{isMobile ? 'fixed inset-y-0 left-0 z-50 flex shadow-2xl transition-transform duration-300' : 'flex h-full select-none border-r border-[#252526]'} {isMobile && !activeSidebarTab ? '-translate-x-full' : 'translate-x-0'} bg-[#333333]">
    <!-- Activity Bar (Far Left) -->
    <div class="w-12 flex flex-col items-center py-2 gap-4 text-[#858585] z-50 bg-[#333333] shrink-0">
        <button 
            class="p-2 hover:text-white relative group {$selectedCharID === -1 ? 'text-white' : ''}" 
            title="Dashboard"
            onclick={() => {
                $selectedCharID = -1;
                // Don't close sidebar on dashboard click, maybe? Or close if mobile.
                if (isMobile) activeSidebarTab = null;
            }}
        >
            {#if $selectedCharID === -1}
                <div class="absolute left-0 top-2 bottom-2 w-0.5 bg-white"></div>
            {/if}
            <LayoutDashboard size="24" />
        </button>

        <!-- Characters Tab -->
        <button 
            class="p-2 hover:text-white relative group {activeSidebarTab === 'characters' ? 'text-white' : ''}" 
            title="Characters"
            onclick={() => activeSidebarTab = activeSidebarTab === 'characters' ? null : 'characters'}
        >
            {#if activeSidebarTab === 'characters'}
                <div class="absolute left-0 top-2 bottom-2 w-0.5 bg-white"></div>
            {/if}
            <BotIcon size="24" />
        </button>

        {#if $selectedCharID >= 0}
        {#if $selectedCharID >= 0}
            <button 
                class="p-2 hover:text-white relative group {activeSidebarTab === 'explorer' ? 'text-white' : ''}" 
                title="Bot Settings"
                onclick={() => activeSidebarTab = activeSidebarTab === 'explorer' ? null : 'explorer'}
            >
                {#if activeSidebarTab === 'explorer'}
                    <div class="absolute left-0 top-2 bottom-2 w-0.5 bg-white"></div>
                {/if}
                <FileCog size="24" />
            </button>
        {/if}
        {/if}

        <!-- Chats Tab -->
        <button 
            class="p-2 hover:text-white relative group {activeSidebarTab === 'chats' ? 'text-white' : ''}" 
            title="Chats"
            onclick={() => activeSidebarTab = activeSidebarTab === 'chats' ? null : 'chats'}
        >
            {#if activeSidebarTab === 'chats'}
                <div class="absolute left-0 top-2 bottom-2 w-0.5 bg-white"></div>
            {/if}
            <MessageSquare size="24" />
        </button>

        <button class="p-2 hover:text-white" title="Search" onclick={() => activeSidebarTab = activeSidebarTab === 'search' ? null : 'search'}>
            <SearchIcon size="24" />
        </button>
        <div class="grow"></div>
        <button class="p-2 hover:text-white" title="Settings" onclick={() => settingsOpen.update(v => !v)}>
            <Settings size="24" />
        </button>
    </div>

    <!-- Side Bar (Explorer View) -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    {#if activeSidebarTab}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="w-64 bg-[#252526] flex flex-col text-[#cccccc] text-xs {isMobile ? 'border-r border-[#3e3e42] h-full shadow-2xl' : ''}">
            <div class="px-4 py-2 text-xs font-bold uppercase tracking-wider flex justify-between items-center bg-[#252526] h-9 shrink-0">
                <span class="truncate">{activeSidebarTab === 'characters' ? 'CHARACTERS' : (activeSidebarTab === 'chats' ? 'CHATS' : (activeSidebarTab === 'explorer' ? 'BOT SETTINGS' : 'SEARCH'))}</span>
                
                <div class="flex items-center">
                    {#if activeSidebarTab === 'chats' && $selectedCharID >= 0}
                        <div class="flex gap-1 mr-2">
                            <button class="hover:bg-[#3e3e42] p-1 rounded" title="New Chat" onclick={createNewChat}>
                                <Plus size="14" />
                            </button>
                            <button class="hover:bg-[#3e3e42] p-1 rounded" title="New Folder" onclick={createNewFolder}>
                                <FolderPlus size="14" />
                            </button>
                        </div>
                    {/if}
                    
                    <button class="hover:bg-[#3e3e42] p-1 rounded" onclick={() => activeSidebarTab = null} title="Close Sidebar">
                        <PanelLeftClose size="14" />
                    </button>
                </div>
            </div>
            
            <div class="flex flex-col overflow-y-auto grow">
            
            <!-- CHARACTERS View -->
            {#if activeSidebarTab === 'characters'}
                <div class="flex flex-col py-1">
                    {#each charImages as item}
                        {#if item.type === 'folder'}
                             <!-- Folder Rendering -->
                             <div>
                                <button
                                    class="w-full flex items-center px-2 py-0.5 hover:bg-[#2a2d2e] cursor-pointer gap-1 text-[#cccccc] select-none text-left"
                                    onclick={() => toggleFolder(item.id)}
                                >
                                    <div class="flex items-center justify-center w-4 h-4 text-gray-400">
                                         {#if openFolders.includes(item.id)}
                                            <ChevronDown size="14" />
                                         {:else}
                                            <ChevronRight size="14" />
                                         {/if}
                                    </div>
                                    <span class="font-bold truncate text-xs text-[#cccccc]">{item.name}</span>
                                </button>
                                {#if openFolders.includes(item.id)}
                                    <div class="flex flex-col transition-all duration-200">
                                        {#each item.folder as char}
                                            <div
                                                class="flex items-center pl-7 pr-4 py-1 hover:bg-[#2a2d2e] cursor-pointer gap-2 {char.index === $selectedCharID ? 'bg-[#37373d] text-white' : 'text-[#cccccc]'}"
                                                onclick={() => onSelectChar(char.index)}
                                                role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && onSelectChar(char.index)}
                                            >
                                                <SidebarAvatar src={char.img} name={char.name} size="20" rounded={true} />
                                                <span class="truncate text-xs">{char.name}</span>
                                            </div>
                                        {/each}
                                    </div>
                                {/if}
                             </div>
                        {:else}
                             <!-- Normal Character Rendering -->
                             <div
                                class="flex items-center px-4 py-1 hover:bg-[#2a2d2e] cursor-pointer gap-2 {item.index === $selectedCharID ? 'bg-[#37373d] text-white' : 'text-[#cccccc]'}"
                                onclick={() => onSelectChar(item.index)}
                                role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && onSelectChar(item.index)}
                             >
                                <SidebarAvatar src={item.img} name={item.name} size="20" rounded={true} />
                                <span class="truncate text-xs">{item.name}</span>
                             </div>
                        {/if}
                    {/each}
                    {#if charImages.length === 0}
                        <div class="p-4 text-center text-[#858585] text-xs">
                            No characters found.
                        </div>
                    {/if}
                </div>
            {/if}

            <!-- CHATS View -->
            {#if activeSidebarTab === 'chats'}
                {#if $selectedCharID >= 0}
                    <!-- TODO: Implement folder logic properly. For now showing flat list + folders if structure exists -->
                    {#each DBState.db.characters[$selectedCharID].chats as chat, i}
                        <div 
                            class="flex items-center px-4 py-1 hover:bg-[#2a2d2e] cursor-pointer gap-2 {DBState.db.characters[$selectedCharID].chatPage === i ? 'bg-[#37373d] text-white' : ''}"
                            onclick={() => {
                                changeChatTo(i);
                                window.dispatchEvent(new CustomEvent('studio-open-chat'));
                            }}
                            role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && changeChatTo(i)}
                        >
                             <MessageSquare size="14" class="shrink-0" />
                             <span class="truncate">{chat.name}</span>
                        </div>
                    {/each}
                {:else}
                    <div class="p-4 text-center text-[#858585]">Base Character Not Selected</div>
                {/if}
            {/if}

            <!-- BOT SETTINGS View -->
            {#if activeSidebarTab === 'explorer'}
                {#if char}
                    <div class="flex flex-col">
                        <!-- Basic Info -->
                        <div>
                            <button class="w-full flex items-center gap-1 p-1 hover:bg-[#2a2d2e] text-[#cccccc] font-bold text-xs" onclick={() => expandedBasic = !expandedBasic}>
                                {#if expandedBasic}<ChevronDown size="14"/>{:else}<ChevronRight size="14"/>{/if}
                                <span>Basic Info</span>
                            </button>
                            {#if expandedBasic}
                            <div class="flex flex-col gap-0.5 mt-0.5">
                                <button class="w-full text-left pl-6 py-1 hover:bg-[#2a2d2e] focus:bg-[#094771] focus:text-white text-[#cccccc] flex items-center gap-2 text-xs" onclick={() => openStudioTab('basic:all', language.characterSettings, Settings)}>
                                    <Settings size="12" class="text-gray-400" /> {language.characterSettings}
                                </button>
                            </div>
                            {/if}
                        </div>

                        <!-- Lorebook -->
                        <div class="mt-1">
                            <div role="button" tabindex="0" class="w-full flex items-center justify-between p-1 hover:bg-[#2a2d2e] text-[#cccccc] font-bold text-xs cursor-pointer group" onclick={() => expandedLore = !expandedLore} onkeydown={(e) => e.key === 'Enter' && (expandedLore = !expandedLore)}>
                                <div class="flex items-center gap-1">
                                    {#if expandedLore}<ChevronDown size="14"/>{:else}<ChevronRight size="14"/>{/if}
                                    <span>{language.loreBook}</span>
                                </div>
                                <div class="flex gap-1 mr-1 opacity-0 group-hover:opacity-100">
                                    <button class="p-0.5 hover:bg-[#3e3e42] rounded" title="Add Folder" onclick={(e) => { e.stopPropagation(); addLoreFolder(); }}>
                                        <FolderIcon size="12" />
                                    </button>
                                    <button class="p-0.5 hover:bg-[#3e3e42] rounded" title="Add Entry" onclick={(e) => { e.stopPropagation(); addLorebook(); }}>
                                        <Plus size="12" />
                                    </button>
                                </div>
                            </div>
                            {#if expandedLore}
                                <div class="flex flex-col gap-0.5 mt-0.5">
                                    {#each getLoreItems(char.globalLore) as { item, depth, index }}
                                        <div style="padding-left: {depth * 12 + 24}px">
                                            <div 
                                                role="button" tabindex="0"
                                                class="w-full text-left py-1 hover:bg-[#2a2d2e] focus:bg-[#094771] focus:text-white flex items-center gap-1.5 truncate cursor-pointer text-[#cccccc] text-xs group" 
                                                onclick={() => {
                                                    if (item.mode === 'folder') {
                                                        toggleExplorerFolder(item.key);
                                                    } else {
                                                        openStudioTab(`lore:${index}`, item.comment || 'Unnamed Entry', BookIcon);
                                                    }
                                                }}
                                                onkeydown={(e) => e.key === 'Enter' && (item.mode === 'folder' ? toggleExplorerFolder(item.key) : openStudioTab(`lore:${index}`, item.comment || 'Unnamed Entry', BookIcon))}
                                            >
                                                {#if item.mode === 'folder'}
                                                    {#if explorerFolders.has(item.key)}<ChevronDown size="12"/>{:else}<ChevronRight size="12"/>{/if}
                                                    <FolderIcon size="12" class="text-[#c69a5a] shrink-0" />
                                                    <span class="truncate font-normal">{item.comment || 'Unnamed Folder'}</span>
                                                    <button class="ml-auto p-0.5 hover:bg-[#3e3e42] rounded opacity-0 group-hover:opacity-100 mr-1" onclick={(e) => { e.stopPropagation(); addLorebook(item.key); }}>
                                                        <Plus size="10" />
                                                    </button>
                                                {:else}
                                                    <BookIcon size="12" class="shrink-0 text-blue-300 opacity-80" />
                                                    <span class="truncate">{item.comment || 'Unnamed Entry'}</span>
                                                {/if}
                                            </div>
                                        </div>
                                    {/each}
                                    {#if char.globalLore.length === 0}
                                        <div class="text-[#666666] text-xs p-2 text-center">Empty</div>
                                    {/if}
                                </div>
                            {/if}
                        </div>

                        <!-- Regex Scripts -->
                        <div class="mt-1">
                            <div role="button" tabindex="0" class="w-full flex items-center justify-between p-1 hover:bg-[#2a2d2e] text-[#cccccc] font-bold text-xs cursor-pointer group" onclick={() => expandedRegex = !expandedRegex} onkeydown={(e) => e.key === 'Enter' && (expandedRegex = !expandedRegex)}>
                                <div class="flex items-center gap-1">
                                    {#if expandedRegex}<ChevronDown size="14"/>{:else}<ChevronRight size="14"/>{/if}
                                    <span>Regex Scripts</span>
                                </div>
                                <div class="flex gap-1 mr-1 opacity-0 group-hover:opacity-100">
                                    <button class="p-0.5 hover:bg-[#3e3e42] rounded" title="Add Script" onclick={(e) => { e.stopPropagation(); addRegex(); }}>
                                        <Plus size="12" />
                                    </button>
                                </div>
                            </div>
                            {#if expandedRegex && char.customscript}
                                 <div class="flex flex-col gap-0.5 mt-0.5">
                                    {#each char.customscript as script, i}
                                        <button class="w-full text-left pl-6 py-1 hover:bg-[#2a2d2e] focus:bg-[#094771] focus:text-white text-[#cccccc] flex items-center gap-2 text-xs truncate" onclick={() => openStudioTab(`regex:${i}`, script.comment || 'New Script', CodeIcon)}>
                                            <CodeIcon size="12" class="text-pink-400 shrink-0" /> <span class="truncate">{script.comment || 'New Script'}</span>
                                        </button>
                                    {/each}
                                     {#if char.customscript.length === 0}
                                        <div class="text-[#666666] text-xs p-2 text-center">Empty</div>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    </div>
                {:else}
                    <div class="p-4 text-center text-[#858585]">
                        <div class="mb-2">No Character Selected</div>
                        <div class="text-xs opacity-70">Please select a character from the list or dashboard.</div>
                    </div>
                {/if}
            {/if}
        </div>
        </div>
    {/if}
</div>

{#if isMobile && activeSidebarTab}
    <!-- Backdrop for mobile -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div 
        class="fixed inset-0 bg-black/50 z-40 transition-opacity duration-300"
        onclick={() => activeSidebarTab = null}
    ></div>
{/if}

<style>
    /* Add any specific scrollbar styling if needed to match VSCode */
    :global(::-webkit-scrollbar) {
        width: 10px;
        height: 10px;
    }
    :global(::-webkit-scrollbar-thumb) {
        background: #424242;
    }
    :global(::-webkit-scrollbar-track) {
        background: transparent;
    }
</style>
