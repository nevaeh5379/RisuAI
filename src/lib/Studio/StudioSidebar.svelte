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
    PanelLeftClose
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
  import type { character } from "src/ts/storage/database.svelte";
  import { alertInput, alertSelect, alertNormal, alertConfirm, alertError } from "src/ts/alert";
  import { Pencil as PencilIcon, Trash2 as TrashIcon, MoreHorizontal as MenuIcon, Download as DownloadIcon } from "@lucide/svelte";
  import { ReloadGUIPointer } from "src/ts/stores.svelte";

  let charImages: any[] = $state([]);
  let openFolders:string[] = $state([])
  let editingId: string | null = $state(null);

  let activeSidebarTab: 'characters' | 'chats' | 'search' | null = $state('characters'); 
  let isMobile = $state(false);

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


</script>

{#if isMobile && !activeSidebarTab}
    <!-- Floating Hamburger for Mobile -->
    <button 
        class="fixed top-2 left-2 z-60 p-2 bg-[#1e1e1e] text-[#cccccc] rounded-lg shadow-lg border border-[#3e3e42] hover:bg-[#2d2d2d]"
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
                <span class="truncate">{activeSidebarTab === 'characters' ? 'CHARACTERS' : (activeSidebarTab === 'chats' ? 'CHATS' : 'SEARCH')}</span>
                
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
                    <!-- Folders -->
                    {#if DBState.db.characters[$selectedCharID].chatFolders}
                        {#each DBState.db.characters[$selectedCharID].chatFolders as folder, i}
                            <div>
                                <div
                                    class="w-full flex items-center px-2 py-0.5 hover:bg-[#2a2d2e] cursor-pointer gap-1 text-[#cccccc] select-none text-left group"
                                    onclick={() => {
                                        folder.folded = !folder.folded;
                                    }}
                                    role="button"
                                    tabindex="0"
                                    onkeydown={(e) => { if(e.key === 'Enter') folder.folded = !folder.folded; }}
                                >
                                    <div class="flex items-center justify-center w-4 h-4 text-gray-400">
                                         {#if !folder.folded}
                                            <ChevronDown size="14" />
                                         {:else}
                                            <ChevronRight size="14" />
                                         {/if}
                                    </div>
                                    {#if editingId === folder.id}
                                        <input
                                            bind:value={folder.name}
                                            class="bg-[#3e3e42] text-white px-1 py-0.5 rounded flex-1 min-w-0 border border-blue-500 focus:outline-none text-xs"
                                            autofocus
                                            onblur={() => editingId = null}
                                            onkeydown={(e) => {
                                                if(e.key === 'Enter') editingId = null;
                                                e.stopPropagation();
                                            }}
                                            onclick={(e) => e.stopPropagation()}
                                        />
                                    {:else}
                                        <span class="font-bold truncate text-xs text-[#cccccc] flex-1">{folder.name}</span>
                                    {/if}
                                    
                                    <!-- Folder Actions -->
                                    <div class="hidden group-hover:flex items-center gap-1">
                                        <button 
                                            class="p-0.5 hover:text-white" 
                                            title="Rename Folder"
                                            onclick={(e) => {
                                                e.stopPropagation();
                                                if (editingId === folder.id) {
                                                    editingId = null;
                                                } else {
                                                    editingId = folder.id;
                                                }
                                            }}
                                        >
                                            <PencilIcon size="12" />
                                        </button>
                                         <button 
                                            class="p-0.5 hover:text-red-400" 
                                            title="Delete Folder"
                                            onclick={async (e) => {
                                                e.stopPropagation();
                                                if(await alertConfirm(`Delete folder ${folder.name}? Chats inside will be moved to root.`)) {
                                                    // Move chats to root
                                                    const chats = DBState.db.characters[$selectedCharID].chats;
                                                    chats.forEach(c => {
                                                        if(c.folderId === folder.id) c.folderId = null;
                                                    });
                                                    DBState.db.characters[$selectedCharID].chatFolders.splice(i, 1);
                                                    $ReloadGUIPointer++; 
                                                }
                                            }}
                                        >
                                            <TrashIcon size="12" />
                                        </button>
                                    </div>
                                </div>
                                
                                {#if !folder.folded}
                                    <div class="flex flex-col ml-4 border-l border-[#3e3e42]">
                                        {#each DBState.db.characters[$selectedCharID].chats as chat, k}
                                            {#if chat.folderId === folder.id}
                                                 <div 
                                                    class="flex items-center px-2 py-1 hover:bg-[#2a2d2e] cursor-pointer gap-2 group {DBState.db.characters[$selectedCharID].chatPage === k ? 'bg-[#37373d] text-white' : ''}"
                                                    onclick={() => {
                                                        changeChatTo(k);
                                                        window.dispatchEvent(new CustomEvent('studio-open-chat'));
                                                    }}
                                                    role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && changeChatTo(k)}
                                                >
                                                     <MessageSquare size="14" class="shrink-0" />
                                                     {#if editingId === chat.id}
                                                         <input
                                                             bind:value={chat.name}
                                                             class="bg-[#3e3e42] text-white px-1 py-0.5 rounded flex-1 min-w-0 border border-blue-500 focus:outline-none text-xs"
                                                             autofocus
                                                             onblur={() => editingId = null}
                                                             onkeydown={(e) => {
                                                                 if(e.key === 'Enter') editingId = null;
                                                                 e.stopPropagation();
                                                             }}
                                                             onclick={(e) => e.stopPropagation()}
                                                         />
                                                     {:else}
                                                         <span class="truncate flex-1">{chat.name}</span>
                                                     {/if}
                                                     
                                                     <div class="hidden group-hover:flex items-center gap-1 text-[#cccccc]">
                                                         <button class="hover:text-white p-0.5" title="Rename" onclick={(e) => {
                                                             e.stopPropagation();
                                                             if (editingId === chat.id) {
                                                                 editingId = null;
                                                             } else {
                                                                 editingId = chat.id;
                                                             }
                                                         }}>
                                                             <PencilIcon size="12" />
                                                         </button>
                                                         <button class="hover:text-white p-0.5" title="Move" onclick={async (e) => {
                                                             e.stopPropagation();
                                                             const validFolders = ["Root", ...(DBState.db.characters[$selectedCharID].chatFolders?.map(f => f.name) || [])];
                                                             const selection = await alertSelect(validFolders);
                                                             if(selection){
                                                                 const idx = parseInt(selection);
                                                                 if(idx === 0) {
                                                                     chat.folderId = null;
                                                                     alertNormal("Moved to Root");
                                                                 } else {
                                                                     const targetFolder = DBState.db.characters[$selectedCharID].chatFolders[idx-1];
                                                                     chat.folderId = targetFolder.id;
                                                                     alertNormal(`Moved to ${targetFolder.name}`);
                                                                 }
                                                                 $ReloadGUIPointer++;
                                                             }
                                                         }}>
                                                             <FolderIcon size="12" />
                                                         </button>
                                                         <button class="hover:text-red-400 p-0.5" title="Delete" onclick={async (e) => {
                                                             e.stopPropagation();
                                                             if(await alertConfirm(`Delete chat ${chat.name}?`)) {
                                                                 if(DBState.db.characters[$selectedCharID].chats.length <= 1) {
                                                                     alertError("Cannot delete the last chat.");
                                                                     return;
                                                                 }
                                                                 changeChatTo(0);
                                                                 DBState.db.characters[$selectedCharID].chats.splice(k, 1);
                                                                 $ReloadGUIPointer++;
                                                             }
                                                         }}>
                                                             <TrashIcon size="12" />
                                                         </button>
                                                     </div>
                                                </div>
                                            {/if}
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    {/if}

                    <!-- Root Chats -->
                     {#each DBState.db.characters[$selectedCharID].chats as chat, i}
                        {#if !chat.folderId}
                             <div 
                                class="flex items-center px-4 py-1 hover:bg-[#2a2d2e] cursor-pointer gap-2 group {DBState.db.characters[$selectedCharID].chatPage === i ? 'bg-[#37373d] text-white' : ''}"
                                onclick={() => {
                                    changeChatTo(i);
                                    window.dispatchEvent(new CustomEvent('studio-open-chat'));
                                }}
                                role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && changeChatTo(i)}
                            >
                                 <MessageSquare size="14" class="shrink-0" />
                                 {#if editingId === chat.id}
                                     <input
                                         bind:value={chat.name}
                                         class="bg-[#3e3e42] text-white px-1 py-0.5 rounded flex-1 min-w-0 border border-blue-500 focus:outline-none text-xs"
                                         autofocus
                                         onblur={() => editingId = null}
                                         onkeydown={(e) => {
                                             if(e.key === 'Enter') editingId = null;
                                             e.stopPropagation();
                                         }}
                                         onclick={(e) => e.stopPropagation()}
                                     />
                                 {:else}
                                     <span class="truncate flex-1">{chat.name}</span>
                                 {/if}
                                 
                                  <div class="hidden group-hover:flex items-center gap-1 text-[#cccccc]">
                                     <button class="hover:text-white p-0.5" title="Rename" onclick={(e) => {
                                         e.stopPropagation();
                                         if (editingId === chat.id) {
                                             editingId = null;
                                         } else {
                                             editingId = chat.id;
                                         }
                                     }}>
                                         <PencilIcon size="12" />
                                     </button>
                                     <button class="hover:text-white p-0.5" title="Move" onclick={async (e) => {
                                         e.stopPropagation();
                                         const validFolders = ["Root", ...(DBState.db.characters[$selectedCharID].chatFolders?.map(f => f.name) || [])];
                                         const selection = await alertSelect(validFolders);
                                         if(selection){
                                             const idx = parseInt(selection);
                                             if(idx === 0) {
                                                 chat.folderId = null;
                                                 alertNormal("Moved to Root");
                                             } else {
                                                 const targetFolder = DBState.db.characters[$selectedCharID].chatFolders[idx-1];
                                                 chat.folderId = targetFolder.id;
                                                 alertNormal(`Moved to ${targetFolder.name}`);
                                             }
                                             $ReloadGUIPointer++;
                                         }
                                     }}>
                                         <FolderIcon size="12" />
                                     </button>
                                     <button class="hover:text-red-400 p-0.5" title="Delete" onclick={async (e) => {
                                         e.stopPropagation();
                                         if(await alertConfirm(`Delete chat ${chat.name}?`)) {
                                             if(DBState.db.characters[$selectedCharID].chats.length <= 1) {
                                                 alertError("Cannot delete the last chat.");
                                                 return;
                                             }
                                             changeChatTo(0);
                                             DBState.db.characters[$selectedCharID].chats.splice(i, 1);
                                             $ReloadGUIPointer++;
                                         }
                                     }}>
                                         <TrashIcon size="12" />
                                     </button>
                                 </div>
                            </div>
                        {/if}
                    {/each}
                {:else}
                    <div class="p-4 text-center text-[#858585]">Base Character Not Selected</div>
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
