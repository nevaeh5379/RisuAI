import { normalCBS, normalCBSwithParams, displayRelatedCBS, nestedCBS, specialCBS, deprecatedCBS, deprecatedCBSwithParams, decorators } from "src/ts/gui/highlight";

// Flatten lists for easy checking
const validKeywords = new Set([
    ...normalCBS,
    ...normalCBSwithParams,
    ...displayRelatedCBS.map(k => k.replace(/:$/, '')),
    ...nestedCBS.map(k => k.trim()), // #if, #each, etc.
    ...specialCBS.map(k => k.replace(/:$/, '').replace(/\?/, '').trim()),
    ...deprecatedCBS,
    ...deprecatedCBSwithParams
]);

const deprecatedKeywords = new Set([
    ...deprecatedCBS,
    ...deprecatedCBSwithParams
]);

export interface ValidationResult {
    severity: number; // 1: Error, 2: Warning, 3: Info
    message: string;
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
}

export const validateCBS = (text: string): ValidationResult[] => {
    const markers: ValidationResult[] = [];
    const lines = text.split('\n');
    const stack: { line: number, col: number, index: number }[] = [];
    
    // Iterate through text to find {{ and }}
    // We need precise positioning, so it's easier to iterate char by char or use regex with indices
    // But regex for nested structures is hard. State machine is better.

    let line = 1;
    let col = 1;
    
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i+1];

        if (char === '\n') {
            line++;
            col = 1;
            continue;
        }

        if (char === '{' && nextChar === '{') {
            stack.push({ line, col, index: i });
            
            // Check keyword immediately after {{
            // Skip {{
            let j = i + 2;
            let keyStart = j;
            // Skip whitespace
            // while (j < text.length && /\s/.test(text[j])) j++;
            
            // Capture keyword until ::, }}, or whitespace
            while (j < text.length) {
                if (text[j] === '}' && text[j+1] === '}') break;
                if (text.substring(j, j+2) === '::') break;
                if (/\s/.test(text[j])) break; // Basic keyword end
                j++;
            }
            
            const keyword = text.substring(keyStart, j).trim();
            // Clean keyword (remove ?, # if needed for check, though our set has them)
            // Our set has #if, but text might be {{#if ...}}
            // If keyword is not empty and not a variable/macro that might be dynamic
            if (keyword && !validKeywords.has(keyword) && !keyword.startsWith('//')) {
                // Heuristic: only flag if it looks like a command (no spaces inside, etc)
                // And maybe it's just a variable lookup {{varName}}. 
                // RisuAI variables are often just strings.
                // So "Unknown keyword" might be too aggressive for {{character_name}}.
                // But validKeywords includes 'char', 'user'.
                // If it's a command like {{setvar::...}}, 'setvar' is in list.
                // If user types {{setvarrr::...}}, we want to flag 'setvarrr'.
                
                // Let's only flag if it looks like a function call (followed by ::)
                if (text.substring(j, j+2) === '::') {
                     markers.push({
                        severity: 2, // Warning
                        message: `Unknown command: "${keyword}"`, // Corrected escaping for template literal
                        startLineNumber: line,
                        startColumn: col + 2,
                        endLineNumber: line,
                        endColumn: col + 2 + keyword.length
                    });
                }
            }
            
             if (deprecatedKeywords.has(keyword)) {
                 markers.push({
                    severity: 2, // Warning
                    message: `Deprecated command: "${keyword}"`, // Corrected escaping for template literal
                    startLineNumber: line,
                    startColumn: col + 2,
                    endLineNumber: line,
                    endColumn: col + 2 + keyword.length
                });
            }

            i++; // Skip second {
            col++;
        } 
        else if (char === '}' && nextChar === '}') {
            if (stack.length === 0) {
                markers.push({
                    severity: 8, // Error (MarkerSeverity.Error = 8 in Monaco)
                    message: "Unexpected closing brackets '}}'",
                    startLineNumber: line,
                    startColumn: col,
                    endLineNumber: line,
                    endColumn: col + 2
                });
            } else {
                stack.pop();
            }
            i++; // Skip second }
            col++;
        }
        
        col++;
    }

    // Check for unclosed brackets
    for (const open of stack) {
        markers.push({
            severity: 8, // Error
            message: "Unclosed macro '{{'",
            startLineNumber: open.line,
            startColumn: open.col,
            endLineNumber: open.line,
            endColumn: open.col + 2
        });
    }

    return markers;
}
