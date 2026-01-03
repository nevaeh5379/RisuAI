import { normalCBS, normalCBSwithParams, displayRelatedCBS, nestedCBS, specialCBS, deprecatedCBS, deprecatedCBSwithParams, decorators } from "src/ts/gui/highlight";

// Categorize commands
const spaceCommands = new Set([
    'if', 'each', 'pure', 'if_pure', 'func', 'pure_display',
    '/if', '/each', '/pure', '/if_pure', '/func', '/pure_display',
    ...nestedCBS.map(k => k.trim())
]);

const paramsCommands = new Set([
    ...normalCBSwithParams,
    ...displayRelatedCBS.map(k => k.replace(/:$/, '')),
    ...deprecatedCBSwithParams
]);

// All valid keywords (for unknown check)
const validKeywords = new Set([
    ...normalCBS,
    ...normalCBSwithParams,
    ...displayRelatedCBS.map(k => k.replace(/:$/, '')),
    ...nestedCBS.map(k => k.trim()),
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
            
            // Keyword extraction
            let j = i + 2;
            let keyStart = j;
            
            // Capture keyword until ::, }}, or whitespace
            while (j < text.length) {
                if (text[j] === '}' && text[j+1] === '}') break;
                if (text.substring(j, j+2) === '::') break;
                if (/\s/.test(text[j])) break; 
                j++;
            }
            
            const keyword = text.substring(keyStart, j).trim();
            const afterKeywordIndex = j;
            const isFollowedByDoubleColon = text.substring(j, j+2) === '::';
            const isFollowedBySpace = /\s/.test(text[j]);
            const isFollowedByClose = text[j] === '}' && text[j+1] === '}';

            if (keyword && !keyword.startsWith('//')) {
                // 1. Check for unknown commands
                if (!validKeywords.has(keyword)) {
                    // Flag if it looks like a command usage
                    if (isFollowedByDoubleColon) {
                         markers.push({
                            severity: 2, // Warning
                            message: `Unknown command: "${keyword}"`,
                            startLineNumber: line,
                            startColumn: col + 2,
                            endLineNumber: line,
                            endColumn: col + 2 + keyword.length
                        });
                    } else if (isFollowedBySpace) {
                        // Check if it's just a variable with trailing space: {{var }}
                        // Look ahead for }} ignoring whitespace
                        let k = j;
                        while (k < text.length && /\s/.test(text[k])) k++;
                        if (!(text[k] === '}' && text[k+1] === '}')) {
                             // It has arguments, so it's likely an intended command
                             markers.push({
                                severity: 2, // Warning
                                message: `Unknown command: "${keyword}" (or invalid variable syntax)`,
                                startLineNumber: line,
                                startColumn: col + 2,
                                endLineNumber: line,
                                endColumn: col + 2 + keyword.length
                            });
                        }
                    }
                } 
                else {
                    // 2. Validate usage of known commands
                    if (paramsCommands.has(keyword)) {
                        if (!isFollowedByDoubleColon && !isFollowedByClose) {
                             // Allow {{command}} (0 args) if supported, but typically params commands need args.
                             // Specifically 'equal' needs args.
                             // We'll warn if it has space arguments instead of ::
                             if (isFollowedBySpace) {
                                markers.push({
                                    severity: 2,
                                    message: `Command "${keyword}" typically requires arguments separated by '::'`,
                                    startLineNumber: line,
                                    startColumn: col + 2,
                                    endLineNumber: line,
                                    endColumn: col + 2 + keyword.length
                                });
                             }
                        }
                    } else if (spaceCommands.has(keyword)) {
                        // Space commands usually use space.
                        // If used with ::, it might be valid (not strictly forbidden?), but unusual.
                        // RisuAI parser might handle it, but style-wise space is standard.
                        // Let's not be too strict here unless we are sure.
                    }
                    
                    // 3. Check for deprecated
                    if (deprecatedKeywords.has(keyword)) {
                        markers.push({
                           severity: 3, // Info/Warning
                           message: `Deprecated command: "${keyword}"`,
                           startLineNumber: line,
                           startColumn: col + 2,
                           endLineNumber: line,
                           endColumn: col + 2 + keyword.length
                       });
                   }
                }
            }

            i++; // Skip second {
            col++;
        } 
        else if (char === '}' && nextChar === '}') {
            if (stack.length === 0) {
                markers.push({
                    severity: 8, // Error
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
