<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import loader from '@monaco-editor/loader';
    import { DBState } from 'src/ts/stores.svelte';
    import { registerCBS } from './cbsLanguage';
    import { validateCBS } from './cbsValidator';
    import { debounce } from 'lodash';

    let { 
        value = $bindable(), 
        height = $bindable("200px"), 
        language = "markdown", 
        options = {},
        onInput = () => {},
        onKeyDown = (e: any) => {},
        onPaste = (e: ClipboardEvent) => {},
        minHeight = 40,
        maxHeight = 600,
        autoResize = true,
        resizable = false
    } = $props();

    let mobileTextarea: HTMLTextAreaElement;
    import { isMobile } from 'src/ts/platform';

    let editorContainer: HTMLElement;
    let editor: any;
    let monaco: any;
    let contentHeight = 0;
    let resizeObserver: ResizeObserver;

    onMount(async () => {
        if (isMobile) {
            if (autoResize && mobileTextarea) {
                // Initial resize for mobile
                resizeMobile();
            }
            return; 
        }

        // Load Monaco
        monaco = await loader.init();

        registerCBS(monaco);

        if (!editorContainer) return;

        editor = monaco.editor.create(editorContainer, {
            value: value ?? '',
            language: language === 'markdown' ? 'risuai-cbs' : language,
            theme: 'risu-cbs-dark', 
            automaticLayout: false, // We use ResizeObserver
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            scrollBeyondLastColumn: 0,
            wordWrap: 'on',
            wrappingStrategy: 'advanced',
            lineNumbers: 'off',
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 0,
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            scrollbar: {
                vertical: autoResize ? 'hidden' : 'auto', 
                horizontal: 'hidden',
                useShadows: false
            },
            ...options
        });

        const validate = debounce(() => {
            const model = editor.getModel();
            if (model && model.getLanguageId() === 'risuai-cbs') {
                const markers = validateCBS(model.getValue());
                monaco.editor.setModelMarkers(model, 'cbs', markers);
            }
        }, 500);

        // Sync value from editor to prop
        editor.onDidChangeModelContent(() => {
            const val = editor.getValue();
            if (val !== value) {
                value = val;
                onInput();
            }
            if (autoResize) {
                updateHeight();
            }
            validate();
        });

        validate(); // Initial check

        editor.onKeyDown((e: any) => {
            onKeyDown(e);
        });

        // Handle Paste
        const domNode = editor.getDomNode();
        if (domNode) {
            domNode.addEventListener('paste', (e: ClipboardEvent) => {
                onPaste(e);
            }, true); // Capture phase might be needed to intercept before Monaco handles text
        }
        
        updateTheme();
        if (autoResize) {
            updateHeight();
        }

        // Setup ResizeObserver
        resizeObserver = new ResizeObserver(() => {
            editor.layout();
        });
        resizeObserver.observe(editorContainer);
    });

    function resizeMobile() {
        if (!mobileTextarea || !autoResize) return;
        mobileTextarea.style.height = 'auto';
        const newHeight = mobileTextarea.scrollHeight;
        const h = Math.max(minHeight, Math.min(newHeight, maxHeight));
        height = `${h}px`;
        mobileTextarea.style.height = height;
    }

    // Sync value from prop to editor
    $effect(() => {
        if (editor && (value ?? '') !== editor.getValue()) {
            editor.setValue(value ?? '');
            if (autoResize) {
                updateHeight();
            }
        }
    });

    function updateHeight() {
        if (!editor) return;
        const newHeight = editor.getContentHeight();
        if (newHeight !== contentHeight) {
            contentHeight = newHeight;
            const h = Math.max(minHeight, Math.min(newHeight, maxHeight)); 
            height = `${h}px`;
            editor.layout();
        }
    }

    function updateTheme() {
        if (!monaco || !editor) return;
        
        const selectedTheme = DBState.db.monacoEditorTheme || 'risu-cbs-dark';
        
        // For built-in themes, just apply them directly
        if (selectedTheme === 'vs' || selectedTheme === 'vs-dark' || selectedTheme === 'hc-black') {
            editor.updateOptions({ theme: selectedTheme });
            return;
        }
        
        // For custom RisuAI theme with transparent background
        monaco.editor.defineTheme('risu-cbs-dark-transparent', {
            base: 'vs-dark',
            inherit: true,
            rules: [
                { token: 'delimiter.cbs', foreground: 'FFD700' }, 
                { token: 'keyword', foreground: 'C586C0' }, 
                { token: 'identifier', foreground: '9CDCFE' }, 
                { token: 'string', foreground: 'CE9178' }, 
                { token: 'comment', foreground: '6A9955' }, 
                { token: 'tag', foreground: '808080' },
                { token: 'annotation', foreground: 'DCDCAA' }
            ],
            colors: {
                'editor.background': '#00000000', 
            }
        });
        editor.updateOptions({ theme: 'risu-cbs-dark-transparent' });
    }

    onDestroy(() => {
        if (resizeObserver) {
            resizeObserver.disconnect();
        }
        if (editor) {
            editor.dispose();
        }
    });
</script>

{#if isMobile}
    <textarea
        bind:this={mobileTextarea}
        class="monaco-container monaco-mobile-textarea"
        style="height: {height}; resize: {resizable ? 'vertical' : 'none'};"
        bind:value={value}
        oninput={() => { onInput(); resizeMobile(); }}
        onkeydown={(e) => onKeyDown(e)}
        onpaste={(e) => onPaste(e)}
        readonly={options.readOnly}
        spellcheck="false"
    ></textarea>
{:else}
    <div 
        class="monaco-container" 
        style="height: {height}; resize: {resizable ? 'vertical' : 'none'};" 
        bind:this={editorContainer}
    ></div>
{/if}

<style>
    .monaco-container {
        width: 100%;
        overflow: hidden;
        border-radius: 0.375rem;
        border: 1px solid var(--risu-theme-borderc);
        background-color: transparent;
    }
    
    .monaco-mobile-textarea {
        color: var(--risu-theme-text);
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        font-size: 14px;
        line-height: 1.5;
        padding: 0.5rem;
        outline: none;
        overflow-y: auto;
    }
    
    .monaco-mobile-textarea:focus {
        border-color: var(--risu-theme-main);
    }
</style>
