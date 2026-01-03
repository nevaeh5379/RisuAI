<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import loader from '@monaco-editor/loader';
    import { DBState } from 'src/ts/stores.svelte';

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

    let editorContainer: HTMLElement;
    let editor: any;
    let monaco: any;
    let contentHeight = 0;
    let resizeObserver: ResizeObserver;

    onMount(async () => {
        // Load Monaco
        monaco = await loader.init();

        if (!editorContainer) return;

        editor = monaco.editor.create(editorContainer, {
            value: value ?? '',
            language: language,
            theme: 'vs-dark', 
            automaticLayout: false, // We use ResizeObserver
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            lineNumbers: 'off',
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 0,
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            scrollbar: {
                vertical: autoResize ? 'hidden' : 'auto', 
                horizontal: 'hidden'
            },
            ...options
        });

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
        });

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
        monaco.editor.defineTheme('risu-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [],
            colors: {
                'editor.background': '#00000000', 
            }
        });
        editor.updateOptions({ theme: 'risu-dark' });
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

<div 
    class="monaco-container" 
    style="height: {height}; resize: {resizable ? 'vertical' : 'none'};" 
    bind:this={editorContainer}
></div>

<style>
    .monaco-container {
        width: 100%;
        overflow: hidden;
        border-radius: 0.375rem;
        border: 1px solid var(--risu-theme-borderc);
        background-color: transparent;
    }
</style>
