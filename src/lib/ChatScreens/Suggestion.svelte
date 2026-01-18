<script lang="ts">
	import { requestChatData } from "src/ts/process/request/request";
    import { doingChat, type OpenAIChat } from "../../ts/process/index.svelte";
    import { setDatabase, type character, type Message, type groupChat, type Database } from "../../ts/storage/database.svelte";
	import { DBState } from 'src/ts/stores.svelte';
    import { selectedCharID } from "../../ts/stores.svelte";
    import { translate } from "src/ts/translator/translator";
    import { CopyIcon, LanguagesIcon, RefreshCcwIcon, XIcon } from "@lucide/svelte";
    import { loadLoreBookV3Prompt } from "../../ts/process/lorebook.svelte";
    import { risuChatParser } from "../../ts/process/scripts";
    import { getAuthorNoteDefaultText, getPersonaPrompt } from "../../ts/util";
    import { alertConfirm } from "src/ts/alert";
    import { language } from "src/lang";
    import { getUserName, replacePlaceholders } from "../../ts/util";
    import { onDestroy } from 'svelte';
    import { slide } from 'svelte/transition';
    import { ParseMarkdown } from "src/ts/parser.svelte";
    import {defaultAutoSuggestPrompt} from "../../ts/storage/defaultPrompts.js";

    interface Props {
        send: () => any;
        messageInput: (string:string) => any;
    }

    let { send, messageInput }: Props = $props();
    let suggestMessages:string[] = $state(DBState.db.characters[$selectedCharID]?.chats[DBState.db.characters[$selectedCharID].chatPage]?.suggestMessages)
    let suggestMessagesTranslated:string[] = $state()
    let toggleTranslate:boolean = $state(DBState.db.autoTranslate)
    let progress:boolean = $state();
    let progressChatPage=-1;
    let abortController:AbortController;
    let chatPage:number = $state()

    const updateSuggestions = () => {
        if($selectedCharID > -1 && !$doingChat) {
            if(progressChatPage > 0 && progressChatPage != chatPage){
                progress=false
                abortController?.abort()
            }
            let currentChar = DBState.db.characters[$selectedCharID];
            suggestMessages = currentChar?.chats[currentChar.chatPage].suggestMessages
        }
    }
    

    const unsub = doingChat.subscribe(async (v) => {
        if(v) {
            progress=false
            abortController?.abort()
            suggestMessages = []
        }
        if(!v && $selectedCharID > -1 && (!suggestMessages || suggestMessages.length === 0) && !progress){
            let currentChar:character|groupChat = DBState.db.characters[$selectedCharID];
            let messages:Message[] = []
            
            messages = [...messages, ...currentChar.chats[currentChar.chatPage].message];
            let lastMessages:Message[] = messages.slice(Math.max(messages.length - 10, 0));
            if(lastMessages.length === 0)
                return
            const prompt = DBState.db.autoSuggestPrompt && DBState.db.autoSuggestPrompt.length > 0 ? DBState.db.autoSuggestPrompt : defaultAutoSuggestPrompt
            
            // Context Building
            let context = ""
            
            // 1. Description, Personality, Scenario
            context += risuChatParser(currentChar.desc, {chara: currentChar})
            if(currentChar.personality){
                context += "\n\n" + risuChatParser(currentChar.personality, {chara: currentChar})
            }
            if(currentChar.scenario){
                context += "\n\n" + risuChatParser(currentChar.scenario, {chara: currentChar})
            }

            // 2. Persona
            const personaPrompt = getPersonaPrompt()
            if(personaPrompt){
                context += "\n\n" + risuChatParser(personaPrompt, {chara: currentChar})
            }

            // 3. Lorebook
            const lorepmt = await loadLoreBookV3Prompt()
            for(const lore of lorepmt.actives){
                context += "\n\n" + risuChatParser(lore.prompt, {chara: currentChar})
            }

            // 4. Author's Note
            const authorNote = currentChar.chats[currentChar.chatPage].note || getAuthorNoteDefaultText()
            if(authorNote){
                context += "\n\n" + risuChatParser(authorNote, {chara: currentChar})
            }

            let promptbody:OpenAIChat[] = [
            {
                role:'system',
                content: context
            },
            {
                role:'system',
                content: replacePlaceholders(prompt, currentChar.name)
            }
            // ,{
            //     role: 'user', 
            //     content: lastMessages.map(b=>(b.role==='char'? currentChar.name : getUserName())+":"+b.data).reduce((a,b)=>a+','+b)
            // }
            ]

            lastMessages.map (b=> {
                if(b.role === 'user') {
                    promptbody.push({
                        role: 'user',
                        content: b.data
                    })
                } else {
                    promptbody.push({
                        role: 'assistant',
                        content: b.data
                    })
                }
            })

            progress = true
            progressChatPage = chatPage
            abortController = new AbortController()
            requestChatData({
                formated: promptbody,
                bias: {},
                currentChar : currentChar as character
            }, 'submodel', abortController.signal).then(rq2=>{
                if(rq2.type !== 'fail' && rq2.type !== 'streaming' && rq2.type !== 'multiline' && progress){
                    var suggestMessagesNew = rq2.result.split('\n').filter(msg => msg.startsWith('-')).map(msg => msg.replace('-','').trim())
                    const db:Database = DBState.db;
                    db.characters[$selectedCharID].chats[currentChar.chatPage].suggestMessages = suggestMessagesNew
                    setDatabase(db)
                    suggestMessages = suggestMessagesNew
                }
                progress = false
            })
            }
    })

    const translateSuggest = async (toggle, messages)=>{
        if(toggle && messages && messages.length > 0) {
            suggestMessagesTranslated = []
            for(let i = 0; i < suggestMessages.length; i++){
                let msg = suggestMessages[i]
                let translated = await translate(msg, false)
                suggestMessagesTranslated[i] = translated
            }
        }
    }

    onDestroy(unsub)

    $effect.pre(() => {
        $selectedCharID
        //FIXME add selectedChatPage for optimize render
        chatPage = DBState.db.characters[$selectedCharID].chatPage
        updateSuggestions()
    });
    $effect.pre(() => {translateSuggest(toggleTranslate, suggestMessages)});
</script>

<div class="w-full">
    {#if progress}
        <div class="flex items-center justify-center py-2 text-textcolor2 text-sm border border-b-0 border-darkborderc rounded-t-lg bg-bgcolor">
            <div class="loadmove mr-2"></div>
            <span>{language.creatingSuggestions}</span>
        </div>
    {:else if !$doingChat && suggestMessages && suggestMessages.length > 0}
        <div 
            class="p-3 border border-b-0 border-darkborderc rounded-t-lg bg-bgcolor overflow-hidden"
            transition:slide={{ duration: 200 }}
        >
            <div class="text-xs text-textcolor2 mb-2 flex items-center justify-between">
                <span>{language.autoSuggest}</span>
                <div class="flex items-center gap-2">
                    <button 
                        class="hover:text-textcolor transition-colors"
                        title={language.reroll}
                        onclick={() => {
                            suggestMessages = []
                            doingChat.set(true)
                            doingChat.set(false)
                        }}
                    >
                        <RefreshCcwIcon size={12}/>
                    </button>
                    <button 
                        class="hover:text-textcolor transition-colors"
                        title={language.close}
                        onclick={() => {
                            suggestMessages = []
                        }}
                    >
                        <XIcon size={12}/>
                    </button>
                </div>
            </div>
            <ul class="space-y-1">
                {#each (suggestMessages??[]).slice(0, 4) as suggest, i}
                    <li 
                        class="text-sm text-textcolor cursor-pointer hover:text-green-400 transition-colors py-0.5 pl-2 border-l-2 border-transparent hover:border-green-400"
                        onclick={() => {
                            suggestMessages = []
                            messageInput(suggest)
                            send()
                        }}
                    >
                        {DBState.db.translator !== '' && toggleTranslate && suggestMessagesTranslated && suggestMessagesTranslated.length > 0 ? suggestMessagesTranslated[i]??suggest : suggest}
                    </li>
                {/each}
            </ul>
        </div>
    {:else if !$doingChat}
        <div class="flex justify-center py-2">
            <button 
                class="text-xs text-textcolor2 hover:text-textcolor px-3 py-1.5 rounded-lg bg-textcolor2/30 hover:bg-textcolor2/50 transition-colors flex items-center gap-1"
                onclick={() => {
                    suggestMessages = []
                    doingChat.set(true)
                    doingChat.set(false)
                }}
            >
                <RefreshCcwIcon size={12}/>
                <span>{language.generateSuggestions}</span>
            </button>
        </div>
    {/if}
</div>

<style>
    
    .loadmove {
        animation: spin 1s linear infinite;
        border-radius: 50%;
        border: 0.4rem solid rgba(0,0,0,0);
        width: 1rem;
        height: 1rem;
        border-top: 0.4rem solid var(--risu-theme-textcolor);
        border-left: 0.4rem solid var(--risu-theme-textcolor);
    }

    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
</style>

