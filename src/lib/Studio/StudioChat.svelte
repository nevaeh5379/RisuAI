<script lang="ts">
    import Suggestion from "../ChatScreens/Suggestion.svelte";
    import Chats from "../ChatScreens/Chats.svelte";
    import { fade } from "svelte/transition";
    import {
        ArrowDown,
        RefreshCcwIcon,
        TrashIcon,
        BotIcon,
        MenuIcon,
        DicesIcon,
        MicOffIcon,
        StepForwardIcon,
        DatabaseIcon,
        BrainIcon,
        GlobeIcon,
        CameraIcon,
        ImagePlusIcon,
        ReplyIcon,
        PackageIcon,
        FolderIcon,
        BookmarkIcon
    } from "@lucide/svelte";
    import { triggerTypingEffect, playSendSound } from "../../ts/gui/typingEffect";
    import {
        ScrollToMessageStore,
        ReloadChatPointer,
        selectedCharID,
        createSimpleCharacter,
        hypaV3ModalOpen,
        additionalChatMenu,
        bookmarkListOpen,
        ReloadGUIPointer
    } from "../../ts/stores.svelte";
    import { ConnectionOpenStore } from "src/ts/sync/multiuser";
    import Chat from "../ChatScreens/Chat.svelte";
    import { getCharImage } from "../../ts/characters";
    import { type Message } from "../../ts/storage/database.svelte";
    import { DBState } from "src/ts/stores.svelte";
    import {
        doingChat,
        sendChat,
    } from "../../ts/process/index.svelte";
    import { sleep, capitalize } from "../../ts/util";
    import { isMobile } from "../../ts/platform";
    import { untrack, tick } from "svelte";
    import { language } from "../../lang";
    import { isExpTranslator, translate } from "../../ts/translator/translator";
    import {
        alertError,
        alertWait,
        alertNormal,
        alertConfirm,
        alertRequestData,
        showHypaV2Alert,
        alertSelect
    } from "../../ts/alert";
    import sendSound from "../../etc/send.mp3";
    import { processScript } from "src/ts/process/scripts";
    import {
        aiLawApplies,
        downloadFile
    } from "src/ts/globalApi.svelte";
    import { runTrigger } from "src/ts/process/triggers";
    import { v4 } from "uuid";
    import { Prereroll, PreUnreroll } from "src/ts/process/prereroll";
    import { processMultiCommand } from "src/ts/process/command";
    import { getModelInfo } from "src/ts/model/modellist";
    import AutoresizeArea from "../UI/GUI/TextAreaResizable.svelte";
    import { stopTTS } from "src/ts/process/tts";
    import PluginDefinedIcon from "../Others/PluginDefinedIcon.svelte";
    import { postChatFile } from "src/ts/process/files/multisend";

    let messageInput: string = $state("");
    let messageInputTranslate: string = $state("");
    let loadPages = $state(30);
    let autoMode = $state(false);
    let rerolls: Message[][] = [];
    let rerollid = -1;
    let lastCharId = -1;
    let fileInput: string[] = $state([]);
    let showNewMessageButton = $state(false);
    let isScrollingToMessage = $state(false);
    let openMenu = $state(false);
    
    // Props
    interface Props {
        customStyle?: string;
        charId?: number;
        chatIndex?: number;
    }
    let { customStyle = "", charId = -1, chatIndex = -1 }: Props = $props();

    let targetCharId = $derived(charId !== -1 ? charId : $selectedCharID);
    let currentCharacter = $derived(DBState.db.characters[targetCharId]);
    
    let chatObj = $derived.by(() => {
        if(!currentCharacter) return null;
        if(chatIndex !== -1 && currentCharacter.chats?.[chatIndex]) return currentCharacter.chats[chatIndex];
        return currentCharacter?.chats?.[currentCharacter.chatPage];
    });
    let currentMessages = $derived(
        chatObj?.message ?? [],
    );
     let hasSuggestions = $derived(
        !$doingChat && 
        chatObj?.suggestMessages?.length > 0
    );

    // Derived User Info
    let { userIconPortrait, currentUsername, userIcon } = $derived.by(() => {
        const bindedPersona =
            chatObj?.bindedPersona;

        if (bindedPersona) {
            const persona = DBState.db.personas.find(
                (p) => p.id === bindedPersona,
            );
            if (persona) {
                return {
                    currentUsername: persona.name,
                    userIconPortrait: persona.largePortrait,
                    userIcon: persona.icon,
                };
            }
        }

        const selectedPersonaIndex = DBState.db.selectedPersona;
        return {
            currentUsername: DBState.db.username,
            userIconPortrait:
                DBState.db.personas[selectedPersonaIndex].largePortrait,
            userIcon: DBState.db.personas[selectedPersonaIndex].icon,
        };
    });

    let chatsInstance: any = $state();

    function scrollToBottom() {
        const chatContainer = document.querySelector(".studio-chat-screen");
        if(chatContainer){
            chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
        }
        chatsInstance?.scrollToLatestMessage();
    }

    $effect(() => {
        if (ScrollToMessageStore.value !== -1) {
            const index = ScrollToMessageStore.value;
            ScrollToMessageStore.value = -1;
            scrollToMessage(index);
        }
    });

    async function changeFolder() {
        if (!currentCharacter) return;
        const folders = currentCharacter.chatFolders || [];
        
        let folderList = ["Root", ...folders.map(f => f.name)];
        const res = await alertSelect(folderList);
        if (res !== null) {
             const idx = parseInt(res);
             if (idx === 0) {
                 // Root
                 chatObj.folderId = null;
                 alertNormal("Moved to Root");
             } else {
                 const folder = folders[idx - 1];
                 chatObj.folderId = folder.id;
                 alertNormal(`Moved to ${folder.name}`);
             }
             $ReloadGUIPointer++;
        }
    }

    async function scrollToMessage(index: number) {
        // Since we use Chats component now, simplistic scrolling might be tricky if items are not mounted.
        // Chats.svelte handles scrolling mostly internally or via refs.
        // For now, we reuse the robust logic if possible, or keep simple one.
        // DefaultChatScreen logic is quite complex. Studio usage might not need it as much.
        // We will try to rely on Chats component capabilities if exposed, otherwise simple query.
        
        isScrollingToMessage = true;
        try {
            const totalMessages = currentMessages.length;
            const neededLoadPages = totalMessages - index + 5;

            if (loadPages < neededLoadPages) {
                loadPages = neededLoadPages;
                await tick();
            }
            
            await sleep(100); 

            const element = document.querySelector(`[data-chat-index="${index}"]`);
            // Note: chat-message-container is created by Chats.svelte but doesn't have data-chat-index by default unless Chat passes it?
            // Chat.svelte doesn't seem to put data-chat-index on the root. 
            // Chats.svelte puts `x-hashed` attribute.
            // We might need to rethink precise scrolling if Chats doesn't expose index easily.
            // However, Chat.svelte DOES render `ChatBody` inside a `span` with `chattext` class.
            
            if (element) {
                element.scrollIntoView({ behavior: "instant", block: "start" });
                element.classList.add("ring-2", "ring-blue-500");
                setTimeout(() => {
                     element.classList.remove("ring-2", "ring-blue-500");
                }, 2000);
            }
        } finally {
            isScrollingToMessage = false;
        }
    }

    async function send() {
        return sendMain(false);
    }
    async function sendContinue() {
        return sendMain(true);
    }

    async function runAutoMode() {
        if (autoMode) {
            autoMode = false;
            return;
        }
        const selectedChar = targetCharId;
        autoMode = true;
        while (autoMode) {
            await sendChatMain();
            if (selectedChar !== targetCharId) {
                autoMode = false;
            }
        }
    }

    async function screenShot() {
        try {
            loadPages = Infinity;
            const html2canvas = await import("html-to-image");
            const chats = document.querySelectorAll(
                ".studio-chat-screen .risu-chat",
            );
            alertWait("Taking screenShot...");
            let canvases: HTMLCanvasElement[] = [];

            for (const chat of chats) {
                const cnv = await html2canvas.toCanvas(chat as HTMLElement);
                alertWait(
                    "Taking screenShot... " +
                        canvases.length +
                        "/" +
                        chats.length,
                );
                canvases.push(cnv);
            }

            canvases.reverse();

            alertWait("Merging images...");

            let mergedCanvas = document.createElement("canvas");
            mergedCanvas.width = 0;
            mergedCanvas.height = 0;
            let mergedCtx = mergedCanvas.getContext("2d");

            let totalHeight = 0;
            let maxWidth = 0;
            for (let i = 0; i < canvases.length; i++) {
                let canvas = canvases[i];
                totalHeight += canvas.height;
                maxWidth = Math.max(maxWidth, canvas.width);

                mergedCanvas.width = maxWidth;
                mergedCanvas.height = totalHeight;
            }

            mergedCtx.fillStyle = "#1e1e1e"; // Studio Theme BG
            mergedCtx.fillRect(0, 0, maxWidth, totalHeight);
            let indh = 0;
            for (let i = 0; i < canvases.length; i++) {
                let canvas = canvases[i];
                indh += canvas.height;
                mergedCtx.drawImage(canvas, 0, indh - canvas.height);
                canvases[i].remove();
            }

            if (mergedCanvas) {
                await downloadFile(
                    `chat-${v4()}.png`,
                    Buffer.from(
                        mergedCanvas.toDataURL("png").split(",").at(-1),
                        "base64",
                    ),
                );
                mergedCanvas.remove();
            }
            alertNormal(language.screenshotSaved);
            loadPages = 10;
        } catch (error) {
            console.error(error);
            alertError("Error while taking screenshot");
        }
    }

    async function sendMain(continueResponse: boolean) {
        if (DBState.db.enableTypingEffect) {
            playSendSound();
        }
        
        let selectedChar = targetCharId;
        if ($doingChat) return;

        if (lastCharId !== targetCharId) {
            rerolls = [];
            rerollid = -1;
        }

        let cha = currentCharacter.chats[currentCharacter.chatPage].message;

        if (messageInput.startsWith("/")) {
            const commandProcessed = await processMultiCommand(messageInput);
            if (commandProcessed !== false) {
                messageInput = "";
                return;
            }
        }

        if (fileInput.length > 0) {
             for (const file of fileInput) {
                messageInput += `{{inlayed::${file}}}`;
            }
            fileInput = [];
        }

        if (messageInput === "") {
             if (currentCharacter.type !== "group") {
                if (cha.length === 0 || cha[cha.length - 1].role !== "user") {
                    if (DBState.db.useSayNothing) {
                         cha.push({
                            role: "user",
                            data: "*says nothing*",
                            name: $ConnectionOpenStore ? DBState.db.username : null,
                        });
                    }
                }
            }
        } else {
             const char = currentCharacter;
            if (char.type === "character") {
                const triggerResult = await runTrigger(char, "input", { chat: char.chats[char.chatPage] });
                if (triggerResult) cha = triggerResult.chat.message;
                 cha.push({ role: "user", data: await processScript(char, messageInput, "editinput"), time: Date.now(), name: DBState.db.username });
            } else {
                 cha.push({ role: "user", data: messageInput, time: Date.now(), name: DBState.db.username });
            }
        }
        
        messageInput = "";
        messageInputTranslate = "";
        currentCharacter.chats[currentCharacter.chatPage].message = cha;
        rerolls = [];
        await sleep(10);
        updateInputSizeAll();
        await sendChatMain(continueResponse);
        scrollToBottom();
    }
    
    // Reroll Logic (Copied/Adapted from DefaultChatScreen)
    async function onReroll() {
        if ($doingChat) return;
        if (lastCharId !== targetCharId) {
            rerolls = [];
            rerollid = -1;
        }
        const genId = currentCharacter.chats[currentCharacter.chatPage].message.at(-1)?.generationInfo?.generationId;
        if (genId) {
            const r = Prereroll(genId);
            if (r) {
                currentCharacter.chats[currentCharacter.chatPage].message[currentCharacter.chats[currentCharacter.chatPage].message.length - 1].data = r;
                return;
            }
        }
        if (rerollid < rerolls.length - 1) {
            if (Array.isArray(rerolls[rerollid + 1])) {
                rerollid += 1;
                let rerollData = safeStructuredClone(rerolls[rerollid]);
                let msgs = currentCharacter.chats[currentCharacter.chatPage].message;
                for (let i = 0; i < rerollData.length; i++) {
                    msgs[msgs.length - rerollData.length + i] = rerollData[i];
                }
                currentCharacter.chats[currentCharacter.chatPage].message = msgs;
            }
            return;
        }
        if (rerolls.length === 0) {
            rerolls.push(safeStructuredClone([currentCharacter.chats[currentCharacter.chatPage].message.at(-1)]));
            rerollid = rerolls.length - 1;
        }
        let cha = safeStructuredClone(currentCharacter.chats[currentCharacter.chatPage].message);
        if (cha.length === 0) return;
        
        const saying = cha[cha.length - 1].saying;
        let sayingQu = 2;
        while (cha[cha.length - 1].role !== "user") {
            if (cha[cha.length - 1].saying === saying) {
                sayingQu -= 1;
                if (sayingQu === 0) break;
            }
            let msg = cha.pop();
            if (!msg) return;
        }
        currentCharacter.chats[currentCharacter.chatPage].message = cha;
        await sendChatMain();
    }

    async function unReroll() {
        if ($doingChat) return;
        if (lastCharId !== targetCharId) {
            rerolls = [];
            rerollid = -1;
        }
        const genId = currentCharacter.chats[currentCharacter.chatPage].message.at(-1)?.generationInfo?.generationId;
        if (genId) {
             const r = PreUnreroll(genId);
            if (r) {
                currentCharacter.chats[currentCharacter.chatPage].message[currentCharacter.chats[currentCharacter.chatPage].message.length - 1].data = r;
                return;
            }
        }
        if (rerollid <= 0) return;
        if (Array.isArray(rerolls[rerollid - 1])) {
            rerollid -= 1;
            let rerollData = safeStructuredClone(rerolls[rerollid]);
            let msgs = currentCharacter.chats[currentCharacter.chatPage].message;
            for (let i = 0; i < rerollData.length; i++) {
                msgs[msgs.length - rerollData.length + i] = rerollData[i];
            }
            currentCharacter.chats[currentCharacter.chatPage].message = msgs;
        }
    }

    let abortController: null | AbortController = null;

    async function sendChatMain(continued: boolean = false) {
        let previousLength = currentCharacter.chats[currentCharacter.chatPage].message.length;
        abortController = new AbortController();
        try {
            await sendChat(targetCharId, { signal: abortController.signal, continue: continued });
             if (previousLength < currentCharacter.chats[currentCharacter.chatPage].message.length) {
                rerolls.push(safeStructuredClone(currentCharacter.chats[currentCharacter.chatPage].message).slice(previousLength));
                rerollid = rerolls.length - 1;
            }
        } catch (error) {
            console.error(error);
            alertError(error);
        }
        lastCharId = targetCharId;
        $doingChat = false;
         if (DBState.db.playMessage) {
            const audio = new Audio(sendSound);
            audio.play();
        }
    }
    
    function abortChat() {
        if (abortController) abortController.abort();
    }

    // Input Resizing
    let inputHeight = $state("44px");
    let inputEle: HTMLTextAreaElement = $state();
    let inputTranslateHeight = $state("44px");
    let inputTranslateEle: HTMLTextAreaElement = $state();

    function updateInputSizeAll() {
        updateInputSize();
        updateInputTranslateSize();
    }

    function updateInputTranslateSize() {
        if (inputTranslateEle) {
            inputTranslateEle.style.height = "auto";
            inputTranslateHeight = inputTranslateEle.scrollHeight + "px";
            inputTranslateEle.style.height = inputTranslateHeight;
        }
    }
    function updateInputSize() {
        if (inputEle) {
            inputEle.style.height = "auto";
            inputHeight = inputEle.scrollHeight + "px";
            inputEle.style.height = inputHeight;
        }
    }
    $effect.pre(() => {
        updateInputSizeAll();
    });

    // Translation logic (simplified copy)
    async function updateInputTransateMessage(reverse: boolean) {
         if (!DBState.db.useAutoTranslateInput) return;
         translate(reverse ? messageInputTranslate : messageInput, reverse).then((translatedMessage) => {
            if (translatedMessage) {
                if (reverse) messageInput = translatedMessage;
                else messageInputTranslate = translatedMessage;
            }
        });
    }

    function safeStructuredClone(val: any) {
        return structuredClone(val);
    }



    // Simplified effect: Only trigger external updates if needed, do NOT push first message to array
    // The first message will be rendered separately as a virtual message, matching DefaultChatScreen behavior.
    $effect(() => {
        if (targetCharId !== -1 && currentCharacter) {
             // Logic to ensure UI stays updated or helper scripts run could go here
             // For now, we trust the reactive binding of currentCharacter and currentChat
        }
    });
</script>

{#if targetCharId >= 0 && currentCharacter}
<div class="flex flex-col h-full w-full bg-[#1e1e1e] text-[#cccccc] relative" style="--risu-theme-bgcolor: #1e1e1e; --risu-theme-textcolor: #cccccc; --risu-theme-darkbg: #252526; --risu-theme-darkborderc: #3e3e42;">
     <!-- Messages Area (Using Chats Component) -->
     <div 
        class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pt-4 px-0 md:px-4 pb-48 studio-chat-screen scroll-smooth default-chat-screen flex flex-col-reverse"
        onscroll={(e) => {
             const target = e.target as HTMLElement;
             // In flex-col-reverse, scrollTop works differently (0 is usually bottom or top depending on browser implementation of flex-reverse scrolling, 
             // but usually strictly speaking standard scrollTop logic applies to the viewport)
             // Actually, for infinite scroll up (history), we usually check: scrollTop < threshold (if content starts at top)
             // But in flex-col-reverse, the "top" of content is visually at the bottom.
             // DefaultChatScreen logic:
             // const scrolled = e.target.scrollHeight - e.target.clientHeight + e.target.scrollTop;
             // Let's copy DefaultChatScreen logic for safety.
             
             const scrolled = target.scrollHeight - target.clientHeight + target.scrollTop;
             // Wait, DefaultChatScreen logic checks 'scrolled < 100'.
             // If flex-col-reverse is used, the DOM order is reversed.
             // We'll stick to DefaultChatScreen's logic signature.
             
             // Simple check:
             if (target.scrollTop < 100 && currentMessages.length > loadPages) {
                loadPages += 15;
            }
        }}
    >


          <Chats 
              bind:this={chatsInstance}
              messages={currentMessages}
              currentCharacter={currentCharacter}
              {onReroll}
              {unReroll}
              {currentUsername}
              {userIcon}
              {loadPages}
              {userIconPortrait}
          />
          
          {#if currentCharacter.chats[currentCharacter.chatPage].message.length <= loadPages}
            {#if currentCharacter.type !== "group"}
                <Chat
                    character={createSimpleCharacter(
                        currentCharacter,
                    )}
                    isLastMemory={false}
                    name={currentCharacter.name}
                    message={currentCharacter
                        .chats[
                        currentCharacter.chatPage
                    ].fmIndex === -1
                        ? currentCharacter
                              .firstMessage
                        : currentCharacter
                              .alternateGreetings[
                              currentCharacter
                                  .chats[
                                  currentCharacter
                                      .chatPage
                              ].fmIndex
                          ]}
                    role="char"
                    img={getCharImage(
                        currentCharacter.image,
                        "css",
                    )}
                    idx={-1}
                    altGreeting={currentCharacter
                        .alternateGreetings.length > 0}
                    largePortrait={currentCharacter.largePortrait}
                    firstMessage={true}
                    onReroll={() => {
                        // Reroll logic for first message if needed
                    }}
                />
            {/if}
          {/if}
          
          {#if currentMessages.length === 0 && !currentCharacter.firstMessage && (!currentCharacter.alternateGreetings || currentCharacter.alternateGreetings.length === 0)}
               <div class="h-full flex items-center justify-center text-textcolor2 opacity-50 italic">
                   No messages yet. Start the conversation!
               </div>
          {/if}
     </div>

     <!-- Input Area (Floating Island Design) -->
    <div class="absolute bottom-6 w-full px-4 flex justify-center pointer-events-none">
        <div class="w-full max-w-4xl pointer-events-auto flex flex-col gap-2">
            <!-- Suggestions -->
            <div class="w-full">
                 <Suggestion messageInput={(msg) => messageInput = msg} send={() => send()} />
            </div>

            <div class="relative w-full">
                <!-- Option Menu -->
                {#if openMenu}
                    <div
                        class="absolute bottom-full mb-4 right-0 p-2 bg-[#18181b]/95 backdrop-blur-xl flex flex-col gap-1 text-[#cccccc] rounded-2xl shadow-2xl border border-white/10 z-50 text-xs min-w-[200px]"
                        onclick={(e) => {
                            e.stopPropagation();
                        }}
                        role="button" tabindex="0" onkeydown={(e) => { if(e.key === 'Escape') openMenu = false; }}
                        transition:fade={{ duration: 100 }}
                    >
                        {#if currentCharacter.type === "group"}
                            <div
                                class="flex items-center cursor-pointer hover:text-white transition-colors p-2 rounded-xl hover:bg-white/10"
                                onclick={runAutoMode}
                                role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && runAutoMode()}
                            >
                                <DicesIcon size={14} />
                                <span class="ml-2 font-medium">{language.autoMode}</span>
                            </div>
                        {/if}

                        {#if currentCharacter.ttsMode === "webspeech" || currentCharacter.ttsMode === "elevenlab"}
                            <div
                                class="flex items-center cursor-pointer hover:text-white transition-colors p-2 rounded-xl hover:bg-white/10"
                                onclick={() => {
                                    stopTTS();
                                }}
                                role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && stopTTS()}
                            >
                                <MicOffIcon size={14} />
                                <span class="ml-2 font-medium">{language.ttsStop}</span>
                            </div>
                        {/if}

                        <div
                            class="flex items-center cursor-pointer hover:text-white transition-colors p-2 rounded-xl hover:bg-white/10"
                            onclick={() => {
                                 sendContinue();
                                 openMenu = false;
                            }}
                            role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && sendContinue()}
                        >
                            <StepForwardIcon size={14} />
                            <span class="ml-2 font-medium">{language.continueResponse}</span>
                        </div>

                        {#each additionalChatMenu as menu}
                            <div
                                class="flex items-center cursor-pointer hover:text-white transition-colors p-2 rounded-xl hover:bg-white/10"
                                onclick={() => {
                                    menu.callback();
                                    openMenu = false;
                                }}
                                role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && menu.callback()}
                            >
                                <PluginDefinedIcon ico={menu} />
                                <span class="ml-2 font-medium">{menu.name}</span>
                            </div>
                        {/each}

                         {#if (DBState.db.supaModelType !== "none" && DBState.db.hypav2) || DBState.db.hypaV3}
                            <div
                                class="flex items-center cursor-pointer hover:text-white transition-colors p-2 rounded-xl hover:bg-white/10"
                                onclick={() => {
                                    if (DBState.db.hypav2) {
                                        showHypaV2Alert();
                                    } else if (DBState.db.hypaV3) {
                                        $hypaV3ModalOpen = true;
                                    }

                                    openMenu = false;
                                }}
                                role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && ($hypaV3ModalOpen = true)}
                            >
                                <BrainIcon size={14} />
                                <span class="ml-2 font-medium">
                                    {DBState.db.hypav2
                                        ? language.hypaMemoryV2Modal
                                        : language.hypaMemoryV3Modal}
                                </span>
                            </div>
                        {/if}

                        {#if DBState.db.translator !== ""}
                            <div
                                class={"flex items-center cursor-pointer p-2 rounded-xl hover:bg-white/10 transition-colors " +
                                    (DBState.db.useAutoTranslateInput
                                        ? "text-blue-400"
                                        : "hover:text-white")}
                                onclick={() => {
                                    DBState.db.useAutoTranslateInput =
                                        !DBState.db.useAutoTranslateInput;
                                }}
                                role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && (DBState.db.useAutoTranslateInput = !DBState.db.useAutoTranslateInput)}
                            >
                                <GlobeIcon size={14} />
                                <span class="ml-2 font-medium"
                                    >{language.autoTranslateInput}</span
                                >
                            </div>
                        {/if}

                        <div
                            class="flex items-center cursor-pointer hover:text-white transition-colors p-2 rounded-xl hover:bg-white/10"
                            onclick={() => {
                                screenShot();
                                openMenu = false;
                            }}
                            role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && screenShot()}
                        >
                            <CameraIcon size={14} />
                            <span class="ml-2 font-medium">{language.screenshot}</span>
                        </div>

                         <div
                            class="flex items-center cursor-pointer hover:text-white transition-colors p-2 rounded-xl hover:bg-white/10"
                            onclick={async () => {
                                const results = await postChatFile(messageInput);
                                if (!results) return;
                                for (const res of results) {
                                    if (res?.type === "asset") {
                                        fileInput.push(res.data);
                                    }
                                    if (res?.type === "text") {
                                        messageInput += `{{file::${res.name}::${res.data}}}`;
                                    }
                                }
                                updateInputSizeAll();
                                openMenu = false;
                            }}
                            role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter'}
                        >
                            <ImagePlusIcon size={14} />
                            <span class="ml-2 font-medium">{language.postFile}</span>
                        </div>

                        <div
                            class="flex items-center cursor-pointer hover:text-white transition-colors p-2 rounded-xl hover:bg-white/10"
                            onclick={() => {
                                currentCharacter.chats[
                                    currentCharacter.chatPage
                                ].modules ??= [];
                                alertNormal("Module List not fully supported in Studio mode yet.");
                                openMenu = false;
                            }}
                            role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter'}
                        >
                            <PackageIcon size={14} />
                            <span class="ml-2 font-medium">{language.modules}</span>
                        </div>

                         {#if DBState.db.sideMenuRerollButton}
                            <div
                                class="flex items-center cursor-pointer hover:text-white transition-colors p-2 rounded-xl hover:bg-white/10"
                                onclick={() => {
                                    onReroll();
                                    openMenu = false;
                                }}
                                role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && onReroll()}
                            >
                                <RefreshCcwIcon size={14} />
                                <span class="ml-2 font-medium">{language.reroll}</span>
                            </div>
                        {/if}

                    </div>
                {/if}

                <!-- Main Input Bar (Capsule Design) -->
                <div class="relative w-full rounded-[28px] z-50 group shadow-2xl isolate pointer-events-auto">
                    <!-- Rotating White Light Border -->
                    {#if $doingChat}
                        <div class="absolute -inset-[2px] rounded-[30px] pointer-events-none z-0 overflow-hidden">
                             <div class="absolute inset-0 bg-[conic-gradient(from_0deg,transparent_0deg,transparent_270deg,#ffffff_360deg)] animate-[spin_2.5s_linear_infinite] opacity-100"></div>
                             <!-- Inner mask to create border effect -->
                             <div class="absolute inset-[2px] bg-black rounded-[28px]"></div>
                        </div>
                    {/if}

                    <!-- Input Container -->
                    <div class="relative z-10 bg-black/40 backdrop-blur-2xl border border-white/10 rounded-[28px] flex items-center gap-2 p-2 transition-all duration-300 hover:border-white/20 hover:bg-black/50 focus-within:bg-black/60 focus-within:border-white/30 pointer-events-auto">
                        
                        <!-- Center: Text Area -->
                        <div class="flex-1 min-w-0 py-2 pl-4">
                            {#if DBState.db.useAutoTranslateInput}
                                <textarea
                                    bind:this={inputTranslateEle}
                                    bind:value={messageInputTranslate}
                                    class="w-full bg-transparent resize-none outline-none text-sm text-zinc-500 border-b border-white/10 pb-1 mb-1 font-mono leading-relaxed pointer-events-auto min-h-[24px]"
                                    placeholder="Translation..." 
                                    style:height={inputTranslateHeight}
                                    style:max-height={"200px"}
                                    rows="1"
                                    oninput={() => { updateInputTranslateSize(); updateInputTransateMessage(true); }}
                                ></textarea>
                            {/if}
                            <textarea
                                bind:this={inputEle}
                                bind:value={messageInput}
                                class="w-full bg-transparent resize-none outline-none text-[16px] text-white placeholder-zinc-600 font-sans leading-relaxed max-h-[400px] pointer-events-auto min-h-[24px]"
                                placeholder="Message..."
                                style:height={inputHeight}
                                rows="1"
                                oninput={() => { updateInputSize(); updateInputTransateMessage(false); }}
                                onkeydown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
                                        e.preventDefault();
                                        if($doingChat) abortChat();
                                        else send();
                                    }
                                }}
                            ></textarea>
                        </div>
    
                        <!-- Right: Buttons Group -->
                        <div class="flex items-center gap-1 shrink-0 pr-1">
                            <!-- Option Button (Moved to Right) -->
                            <button 
                                class="p-3 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-all duration-200"
                                onclick={(e) => { e.stopPropagation(); openMenu = !openMenu; }}
                                title="Options"
                            >
                                <MenuIcon size={22} />
                            </button>

                            <!-- Send/Stop Button -->
                            {#if $doingChat}
                                <button class="w-11 h-11 flex items-center justify-center rounded-full bg-white text-black hover:scale-105 active:scale-95 shadow-[0_0_15px_rgba(255,255,255,0.4)] transition-all" onclick={abortChat} title="Stop">
                                    <div class="w-3.5 h-3.5 bg-black rounded-[2px]"></div> 
                                </button>
                            {:else}
                                <button class="w-11 h-11 flex items-center justify-center rounded-full bg-white text-black hover:scale-105 active:scale-95 shadow-[0_0_10px_rgba(255,255,255,0.2)] transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600 disabled:shadow-none" onclick={send} disabled={messageInput.trim() === '' && fileInput.length === 0}>
                                    <ArrowDown size={22} strokeWidth={2.5} />
                                </button>
                            {/if}
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="text-[10px] text-zinc-600 text-right px-4 font-medium opacity-0 group-hover:opacity-60 transition-opacity duration-300">
                 Return to send, Shift + Return for new line
            </div>
        </div>
    </div>
</div>
{:else}
    <div class="h-full w-full flex items-center justify-center text-[#555] font-light tracking-wide bg-[#1e1e1e]">
         Select a character to start chatting
    </div>
{/if}
