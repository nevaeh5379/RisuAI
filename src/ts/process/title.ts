import { getDatabase, getCurrentCharacter } from "../storage/database.svelte";
import { requestChatData, type requestDataResponse } from "./request/request";
import type { OpenAIChat } from "./index.svelte";

export async function generateSessionTitle(chatIndex: number): Promise<requestDataResponse> {
    const db = getDatabase();
    const char = getCurrentCharacter();
    const chat = char.chats[chatIndex];

    if (!chat || chat.message.length === 0) {
        throw new Error("Chat is empty");
    }

    const messages = chat.message;
    // Take the last 10 messages or so for context, or maybe more depending on the prompt
    // For a title, usually the beginning or a summary of recent events is good.
    // Let's take up to 20 recent messages.
    const contextMessages = messages.slice(-20);

    const formated: OpenAIChat[] = contextMessages.map(msg => ({
        role: msg.role === 'char' ? 'model' : 'user', // Map 'char' to 'model' (or 'assistant' depending on backend, requestChatData handles some of this but let's stick to OpenAIChat type)
        // Wait, OpenAIChat role is 'system'|'user'|'assistant'. request.ts says:
        // export interface OpenAIChat { role: 'system'|'user'|'assistant', content: string }
        // So I should map 'char' to 'assistant'.
        content: msg.data
    })).map(m => {
        if (m.role === 'model') m.role = 'assistant';
        return m as OpenAIChat;
    });

    const prompt = db.titleGeneration.prompt;
    let model = db.titleGeneration.model;
    if (model === 'main') {
        model = db.aiModel;
    } else if (model === 'sub') {
        model = db.subModel;
    }
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
    }, 'model');
}
