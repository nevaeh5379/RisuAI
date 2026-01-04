import { getDatabase, getCurrentCharacter } from "../storage/database.svelte";
import { requestChatData, type requestDataResponse } from "./request/request";
import type { OpenAIChat } from "./index.svelte";

export async function generateSessionTitle(chatIndex: number): Promise<requestDataResponse> {
    const db = getDatabase();
    const char = getCurrentCharacter();
    const chat = char.chats[chatIndex];

    const messages = chat.message;
    let contextMessages: any[] = [];

    if (!chat) {
        throw new Error("Chat is invalid");
    }

    if (messages.length === 0) {
        // Fallback to first message or description if chat is empty
        const fallbackContent = char.firstMessage || (char.type === 'character' ? char.desc : '') || char.name;
        if (fallbackContent) {
            contextMessages = [{
                role: 'char',
                data: fallbackContent
            }];
        } else {
            throw new Error("Chat is empty and no fallback content found");
        }
    } else {
        contextMessages = messages.slice(-20);
    }

    const formated: OpenAIChat[] = contextMessages.map(msg => ({
        role: msg.role === 'char' ? 'model' : 'user',
        content: msg.data
    })).map(m => {
        if (m.role === 'model') m.role = 'assistant';
        return m as OpenAIChat;
    });

    const prompt = db.titleGeneration.prompt;
    let model = db.titleGeneration.model;
    let mode: 'model' | 'submodel' = 'model';

    console.log("Title Gen - Initial Setting:", model);
    if (model === 'main') {
        model = db.aiModel;
        mode = 'model';
    } else if (model === 'sub') {
        model = db.subModel;
        mode = 'submodel';
    }
    console.log("Title Gen - Resolved Model ID:", model, "Mode:", mode);
    const maxLength = db.titleGeneration.maxLength;

    // Add the instruction as a system message or a user message at the end?
    // Usually a system message or appending to the last user message is better.
    // Let's prepend it as a system message for better adherence if the model supports it, 
    // or wrap the whole thing.

    // Simpler approach: Just send the prompt + chat history.

    formated.push({
        role: 'user',
        content: prompt
    });

    return await requestChatData({
        formated: formated,
        bias: {},
        maxTokens: maxLength,
        useStreaming: true, // We want the typewriter effect
        staticModel: model, // Use the specific model for title generation
        // We might want to disable some chat-specific processing
    }, mode);
}
