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
        PackageIcon
    } from "@lucide/svelte";
    import { triggerTypingEffect, playSendSound } from "../../ts/gui/typingEffect";
    import {
        ScrollToMessageStore,
        ReloadChatPointer,
        selectedCharID,
        createSimpleCharacter,
        hypaV3ModalOpen,
        additionalChatMenu
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
    import { untrack, tick } from "svelte";
    import { language } from "../../lang";
    import { isExpTranslator, translate } from "../../ts/translator/translator";
    import {
        alertError,
        alertWait,
        alertNormal,
        alertConfirm,
        alertRequestData,
        showHypaV2Alert
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
    }
    let { customStyle = "" }: Props = $props();

    let currentCharacter = $derived(DBState.db.characters[$selectedCharID]);
    let currentChat = $derived(
        currentCharacter?.chats[currentCharacter.chatPage]?.message ?? [],
    );
     let hasSuggestions = $derived(
        !$doingChat && 
        currentCharacter?.chats?.[currentCharacter.chatPage]?.suggestMessages?.length > 0
    );

    // Derived User Info
    let { userIconPortrait, currentUsername, userIcon } = $derived.by(() => {
        const bindedPersona =
            DBState?.db?.characters?.[$selectedCharID]?.chats?.[
                DBState?.db?.characters?.[$selectedCharID]?.chatPage
            ]?.bindedPersona;

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

    async function scrollToMessage(index: number) {
        // Since we use Chats component now, simplistic scrolling might be tricky if items are not mounted.
        // Chats.svelte handles scrolling mostly internally or via refs.
        // For now, we reuse the robust logic if possible, or keep simple one.
        // DefaultChatScreen logic is quite complex. Studio usage might not need it as much.
        // We will try to rely on Chats component capabilities if exposed, otherwise simple query.
        
        isScrollingToMessage = true;
        try {
            const totalMessages = currentChat.length;
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
        const selectedChar = $selectedCharID;
        autoMode = true;
        while (autoMode) {
            await sendChatMain();
            if (selectedChar !== $selectedCharID) {
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
        
        let selectedChar = $selectedCharID;
        if ($doingChat) return;

        if (lastCharId !== $selectedCharID) {
            rerolls = [];
            rerollid = -1;
        }

        let cha = DBState.db.characters[selectedChar].chats[DBState.db.characters[selectedChar].chatPage].message;

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
             if (DBState.db.characters[selectedChar].type !== "group") {
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
             const char = DBState.db.characters[selectedChar];
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
        DBState.db.characters[selectedChar].chats[DBState.db.characters[selectedChar].chatPage].message = cha;
        rerolls = [];
        await sleep(10);
        updateInputSizeAll();
        await sendChatMain(continueResponse);
        scrollToBottom();
    }
    
    // Reroll Logic (Copied/Adapted from DefaultChatScreen)
    async function onReroll() {
        if ($doingChat) return;
        if (lastCharId !== $selectedCharID) {
            rerolls = [];
            rerollid = -1;
        }
        const genId = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.at(-1)?.generationInfo?.generationId;
        if (genId) {
            const r = Prereroll(genId);
            if (r) {
                DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length - 1].data = r;
                return;
            }
        }
        if (rerollid < rerolls.length - 1) {
            if (Array.isArray(rerolls[rerollid + 1])) {
                rerollid += 1;
                let rerollData = safeStructuredClone(rerolls[rerollid]);
                let msgs = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message;
                for (let i = 0; i < rerollData.length; i++) {
                    msgs[msgs.length - rerollData.length + i] = rerollData[i];
                }
                DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message = msgs;
            }
            return;
        }
        if (rerolls.length === 0) {
            rerolls.push(safeStructuredClone([DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.at(-1)]));
            rerollid = rerolls.length - 1;
        }
        let cha = safeStructuredClone(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message);
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
        DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message = cha;
        await sendChatMain();
    }

    async function unReroll() {
        if ($doingChat) return;
        if (lastCharId !== $selectedCharID) {
            rerolls = [];
            rerollid = -1;
        }
        const genId = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.at(-1)?.generationInfo?.generationId;
        if (genId) {
             const r = PreUnreroll(genId);
            if (r) {
                DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length - 1].data = r;
                return;
            }
        }
        if (rerollid <= 0) return;
        if (Array.isArray(rerolls[rerollid - 1])) {
            rerollid -= 1;
            let rerollData = safeStructuredClone(rerolls[rerollid]);
            let msgs = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message;
            for (let i = 0; i < rerollData.length; i++) {
                msgs[msgs.length - rerollData.length + i] = rerollData[i];
            }
            DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message = msgs;
        }
    }

    let abortController: null | AbortController = null;

    async function sendChatMain(continued: boolean = false) {
        let previousLength = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length;
        abortController = new AbortController();
        try {
            await sendChat(-1, { signal: abortController.signal, continue: continued });
             if (previousLength < DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length) {
                rerolls.push(safeStructuredClone(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message).slice(previousLength));
                rerollid = rerolls.length - 1;
            }
        } catch (error) {
            console.error(error);
            alertError(error);
        }
        lastCharId = $selectedCharID;
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
            inputTranslateEle.style.height = "0";
            inputTranslateHeight = inputTranslateEle.scrollHeight + "px";
            inputTranslateEle.style.height = inputTranslateHeight;
        }
    }
    function updateInputSize() {
        if (inputEle) {
            inputEle.style.height = "0";
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
        if ($selectedCharID !== -1 && currentCharacter) {
             // Logic to ensure UI stays updated or helper scripts run could go here
             // For now, we trust the reactive binding of currentCharacter and currentChat
        }
    });
</script>

{#if $selectedCharID >= 0 && currentCharacter}
<div class="flex flex-col h-full w-full bg-[#1e1e1e] text-[#cccccc] relative" style="--risu-theme-bgcolor: #1e1e1e; --risu-theme-textcolor: #cccccc; --risu-theme-darkbg: #252526; --risu-theme-darkborderc: #3e3e42;">
     <!-- Messages Area (Using Chats Component) -->
     <div 
        class="flex-1 overflow-y-auto overflow-x-hidden p-4 pb-48 studio-chat-screen scroll-smooth default-chat-screen flex flex-col-reverse"
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
             if (target.scrollTop < 100 && currentChat.length > loadPages) {
                loadPages += 15;
            }
        }}
     >
          <Chats 
              bind:this={chatsInstance}
              messages={currentChat}
              currentCharacter={currentCharacter}
              {onReroll}
              {unReroll}
              {currentUsername}
              {userIcon}
              {loadPages}
              {userIconPortrait}
          />
          
          {#if DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length <= loadPages}
            {#if DBState.db.characters[$selectedCharID].type !== "group"}
                <Chat
                    character={createSimpleCharacter(
                        DBState.db.characters[$selectedCharID],
                    )}
                    name={DBState.db.characters[$selectedCharID].name}
                    message={DBState.db.characters[$selectedCharID]
                        .chats[
                        DBState.db.characters[$selectedCharID].chatPage
                    ].fmIndex === -1
                        ? DBState.db.characters[$selectedCharID]
                              .firstMessage
                        : DBState.db.characters[$selectedCharID]
                              .alternateGreetings[
                              DBState.db.characters[$selectedCharID]
                                  .chats[
                                  DBState.db.characters[$selectedCharID]
                                      .chatPage
                              ].fmIndex
                          ]}
                    role="char"
                    img={getCharImage(
                        DBState.db.characters[$selectedCharID].image,
                        "css",
                    )}
                    idx={-1}
                    altGreeting={DBState.db.characters[$selectedCharID]
                        .alternateGreetings.length > 0}
                    largePortrait={DBState.db.characters[
                        $selectedCharID
                    ].largePortrait}
                    firstMessage={true}
                    onReroll={() => {
                        // Reroll logic for first message if needed
                    }}
                />
            {/if}
          {/if}
          
          {#if currentChat.length === 0 && !currentCharacter.firstMessage && (!currentCharacter.alternateGreetings || currentCharacter.alternateGreetings.length === 0)}
               <div class="h-full flex items-center justify-center text-textcolor2 opacity-50 italic">
                   No messages yet. Start the conversation!
               </div>
          {/if}
     </div>

     <!-- Input Area (Floating Island Design) -->
    <div class="absolute bottom-6 w-full px-4 flex justify-center z-10 pointer-events-none">
        <div class="w-full max-w-4xl pointer-events-auto flex flex-col gap-2">
            <!-- Suggestions -->
            <div class="w-full">
                 <Suggestion messageInput={(msg) => messageInput = msg} send={() => send()} />
            </div>

            <div class="relative w-full">
                <!-- Option Menu -->
                {#if openMenu}
                    <div
                        class="absolute bottom-full mb-2 right-0 p-2 bg-[#252526]/90 backdrop-blur-xl flex flex-col gap-1 text-[#cccccc] rounded-2xl shadow-2xl border border-[#3e3e42]/50 z-50 text-xs min-w-[200px]"
                        onclick={(e) => {
                            e.stopPropagation();
                        }}
                        role="button" tabindex="0" onkeydown={(e) => { if(e.key === 'Escape') openMenu = false; }}
                        transition:fade={{ duration: 100 }}
                    >
                        {#if DBState.db.characters[$selectedCharID].type === "group"}
                            <div
                                class="flex items-center cursor-pointer hover:text-white transition-colors p-2 rounded-xl hover:bg-white/10"
                                onclick={runAutoMode}
                                role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && runAutoMode()}
                            >
                                <DicesIcon size={14} />
                                <span class="ml-2 font-medium">{language.autoMode}</span>
                            </div>
                        {/if}

                        {#if DBState.db.characters[$selectedCharID].ttsMode === "webspeech" || DBState.db.characters[$selectedCharID].ttsMode === "elevenlab"}
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
                                DBState.db.characters[$selectedCharID].chats[
                                    DBState.db.characters[$selectedCharID].chatPage
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

                <!-- Main Input Box -->
                <div class="backdrop-blur-2xl bg-black/40 border border-white/10 rounded-3xl shadow-2xl p-3 flex flex-col gap-2 transition-all duration-300 focus-within:ring-1 focus-within:ring-white/20 focus-within:bg-black/50 hover:bg-black/50">
                    <div class="flex items-center gap-3 px-2">
                        <div class="flex-1 flex flex-col min-w-0">
                             {#if DBState.db.useAutoTranslateInput}
                                <textarea
                                    bind:this={inputTranslateEle}
                                    bind:value={messageInputTranslate}
                                    class="w-full bg-transparent resize-none outline-none text-sm text-gray-400 border-b border-white/10 pb-2 mb-2 font-mono leading-relaxed"
                                    placeholder="Translation Input" 
                                     style:height={inputTranslateHeight}
                                     style:max-height={"200px"}
                                     rows="1"
                                     oninput={() => { updateInputTranslateSize(); updateInputTransateMessage(true); }}
                                ></textarea>
                            {/if}
                             <textarea
                                bind:this={inputEle}
                                bind:value={messageInput}
                                 class="w-full bg-transparent resize-none outline-none text-base text-[#e0e0e0] placeholder-[#808080] font-sans leading-relaxed max-h-[400px]"
                                 placeholder="Send a message..."
                                 style:height={inputHeight}
                                 rows="1"
                                 oninput={() => { updateInputSize(); updateInputTransateMessage(false); }}
                                 onkeydown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        if($doingChat) abortChat();
                                        else send();
                                    }
                                 }}
                            ></textarea>
                         </div>
        
                         <div class="flex items-center pb-0.5 gap-2 shrink-0">
                             <!-- Option Button -->
                             <button 
                                class="p-2.5 rounded-full hover:bg-white/10 text-[#a0a0a0] hover:text-white transition-colors"
                                onclick={(e) => { e.stopPropagation(); openMenu = !openMenu; }}
                                title="Options"
                             >
                                <MenuIcon size={20} />
                             </button>
    
                             {#if $doingChat}
                                <button class="p-2.5 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 transition-all active:scale-95" onclick={abortChat} title="Stop Generation">
                                    <div class="w-3 h-3 bg-red-400 rounded-sm"></div> 
                                </button>
                             {:else}
                                <button class="p-2.5 rounded-full hover:bg-white/10 text-[#a0a0a0] hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed" onclick={send} disabled={messageInput.trim() === '' && fileInput.length === 0}>
                                     <ArrowDown size={20} />
                                </button>
                             {/if}
                         </div>
                    </div>
                </div>
            </div>
            
            <div class="text-[10px] text-gray-500 text-right px-4 font-medium opacity-60">
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
