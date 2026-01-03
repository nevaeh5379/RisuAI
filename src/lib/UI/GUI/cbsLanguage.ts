import { normalCBS, normalCBSwithParams, displayRelatedCBS, nestedCBS, specialCBS, deprecatedCBS, deprecatedCBSwithParams, decorators } from "src/ts/gui/highlight";

export const registerCBS = (monaco: any) => {
    monaco.languages.register({ id: 'risuai-cbs' });

    monaco.languages.setLanguageConfiguration('risuai-cbs', {
        brackets: [
            ['{{', '}}'],
            ['<', '>'], // for HTML tags
        ],
        autoClosingPairs: [
            { open: '{{', close: '}}' },
            { open: '<', close: '>' },
            { open: '"', close: '"' },
            { open: "'", close: "'" },
            { open: '`', close: '`' },
            { open: '(', close: ')' },
            { open: '[', close: ']' },
        ],
        surroundingPairs: [
            { open: '{{', close: '}}' },
            { open: '<', close: '>' },
            { open: '"', close: '"' },
            { open: "'", close: "'" },
            { open: '`', close: '`' },
            { open: '(', close: ')' },
            { open: '[', close: ']' },
        ]
    });

    monaco.languages.setMonarchTokensProvider('risuai-cbs', {
        defaultToken: '',
        tokenPostfix: '.cbs',

        // Helper to remove ':' from the end if present for keyword matching
        keywords: [
            ...normalCBS,
            ...normalCBSwithParams,
            ...displayRelatedCBS.map(k => k.replace(/:$/, '')),
            ...nestedCBS.map(k => k.replace(/^#/, '').trim()), // special handling for #
            ...specialCBS.map(k => k.replace(/:$/, '').replace(/\?/, '')),
            ...deprecatedCBS,
            ...deprecatedCBSwithParams
        ],

        decorators: decorators,

        tokenizer: {
            root: [
                // CBS tags start
                [/\{\{/, { token: 'delimiter.cbs', next: '@cbs' }],
                
                // HTML/XML tags
                [/<\/?[a-zA-Z0-9]+[^>]*>/, 'tag'],
                
                // Decorators
                [/@@@?[a-zA-Z_]\w*/, {
                    cases: {
                        '@decorators': 'annotation',
                        '@default': ''
                    }
                }],

                // Basic Markdown support (headers)
                [/^#+ .*/, 'keyword'],
                [/\*\*.+?\*\*/, 'strong'],
                [/\*.+?\*/, 'emphasis'],
                [/`[^`]+`/, 'variable'],

                // Default text
                [/[^\{<*#@`]+/, '']
            ],

            cbs: [
                [/\{\{/, { token: 'delimiter.cbs', next: '@push' }],
                [/\}\}/, { token: 'delimiter.cbs', next: '@pop' }],
                
                // Comments
                [/\/\/.*$/, 'comment'],
                
                // Separators
                [/::/, 'delimiter'],
                
                // Keywords starting with #
                [/#(if|each|func|pure|pure_display|if_pure)/, 'keyword'],

                // Standard keywords
                [/[\w\/]+(?=\s|::|\}\})/, {
                    cases: {
                        '@keywords': 'keyword',
                        '@default': 'identifier'
                    }
                }],
                
                // Strings/Arguments
                [/[^\{\}]+/, 'string']
            ]
        }
    });

    // Define a theme (optional, but good for custom colors)
    monaco.editor.defineTheme('risu-cbs-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: 'delimiter.cbs', foreground: 'FFD700' }, // Gold for {{ }}
            { token: 'keyword', foreground: 'C586C0' }, // Pink/Purple for keywords
            { token: 'identifier', foreground: '9CDCFE' }, // Blue for vars
            { token: 'string', foreground: 'CE9178' }, // Orange for string args
            { token: 'comment', foreground: '6A9955' }, // Green for comments
            { token: 'tag', foreground: '808080' }, // Gray for HTML tags
            { token: 'annotation', foreground: 'DCDCAA' } // Yellow-ish for decorators
        ],
        colors: {
            'editor.background': '#00000000'
        }
    });
}
