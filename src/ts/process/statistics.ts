
import { getDatabase } from "src/ts/storage/database.svelte";

let timer: number | null = null;

export function startTimeTracking() {
    if (timer) return;
    
    let lastTime = Date.now();
    
    timer = window.setInterval(() => {
        const now = Date.now();
        const diff = now - lastTime;
        lastTime = now;
        
        if (typeof document !== 'undefined' && document.hidden) {
             return;
        }

        const db = getDatabase();
        if (db && db.statics) {
            db.statics.totalTime = (db.statics.totalTime || 0) + diff;
        }
    }, 1000);
}

function getTodayKey() {
    const now = new Date();
    // Use ISO string YYYY-MM-DD
    return now.toISOString().split('T')[0];
}

export function incrementMessageCount(botName: string, modelName: string) {
    const db = getDatabase();
    if (!db || !db.statics) return;

    db.statics.messages = (db.statics.messages || 0) + 1;
    
    // Model usage
    if (modelName) {
        db.statics.modelUsage = db.statics.modelUsage || {};
        db.statics.modelUsage[modelName] = (db.statics.modelUsage[modelName] || 0) + 1;
    }

    // Bot usage
    if (botName) {
        db.statics.botUsage = db.statics.botUsage || {};
        db.statics.botUsage[botName] = (db.statics.botUsage[botName] || 0) + 1;
    }

    // Daily stats
    const today = getTodayKey();
    db.statics.daily = db.statics.daily || {};
    if (!db.statics.daily[today]) {
        db.statics.daily[today] = { messages: 0, inputTokens: 0, outputTokens: 0 };
    }
    db.statics.daily[today].messages += 1;
}

export function addTokenUsage(input: number, output: number) {
    const db = getDatabase();
    if (!db || !db.statics) return;

    db.statics.inputTokens = (db.statics.inputTokens || 0) + input;
    db.statics.outputTokens = (db.statics.outputTokens || 0) + output;

    // Daily stats
    const today = getTodayKey();
    db.statics.daily = db.statics.daily || {};
    if (!db.statics.daily[today]) {
        db.statics.daily[today] = { messages: 0, inputTokens: 0, outputTokens: 0 };
    }
    db.statics.daily[today].inputTokens += input;
    db.statics.daily[today].outputTokens += output;
}
