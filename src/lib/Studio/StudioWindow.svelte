<script lang="ts">
    import { onMount } from 'svelte';
    import { XIcon, MaximizeIcon, MinimizeIcon } from '@lucide/svelte';
    import Button from "../UI/GUI/Button.svelte";

    let { 
        title = "Window", 
        x = $bindable(100), 
        y = $bindable(100), 
        width = $bindable(800), 
        height = $bindable(600),
        minWidth = 300,
        minHeight = 200,
        onClose = () => {},
        children,
        zIndex = 50,
        onFocus = () => {}
    } = $props();

    let isDragging = false;
    let isResizing = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let isMaximized = $state(false);

    let preMaxX = 0;
    let preMaxY = 0;
    let preMaxWidth = 0;
    let preMaxHeight = 0;

    function handleMouseDown(e: MouseEvent) {
        onFocus();
        if (e.button !== 0) return;
        if (isMaximized) return;
        isDragging = true;
        dragOffsetX = e.clientX - x;
        dragOffsetY = e.clientY - y;
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }

    function handleMouseMove(e: MouseEvent) {
        if (isDragging) {
            x = e.clientX - dragOffsetX;
            y = e.clientY - dragOffsetY;
        }
        if (isResizing) {
            width = Math.max(minWidth, e.clientX - x);
            height = Math.max(minHeight, e.clientY - y);
        }
    }

    function handleMouseUp() {
        isDragging = false;
        isResizing = false;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    }

    function handleResizeDown(e: MouseEvent) {
        if (e.button !== 0) return;
        e.stopPropagation(); // Prevent drag
        isResizing = true;
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }

    function toggleMaximize() {
        if (isMaximized) {
            x = preMaxX;
            y = preMaxY;
            width = preMaxWidth;
            height = preMaxHeight;
            isMaximized = false;
        } else {
            preMaxX = x;
            preMaxY = y;
            preMaxWidth = width;
            preMaxHeight = height;
            x = 0;
            y = 0;
            width = window.innerWidth;
            height = window.innerHeight;
            isMaximized = true;
        }
    }
</script>

<div 
    class="fixed flex flex-col bg-bgcolor border border-selected shadow-2xl overflow-hidden rounded-lg"
    style="left: {x}px; top: {y}px; width: {width}px; height: {height}px; z-index: {zIndex};"
>
    <!-- Header -->
    <div 
        class="flex justify-between items-center p-2 bg-darkbg border-b border-selected cursor-move select-none h-10 shrink-0"
        onmousedown={handleMouseDown}
        role="button"
        tabindex="0"
    >
        <span class="font-bold text-sm px-2 truncate">{title}</span>
        <div class="flex items-center gap-1" onmousedown={(e) => e.stopPropagation()} role="none">
            <button class="p-1 hover:text-white text-textcolor2 transition-colors" onclick={toggleMaximize}>
                {#if isMaximized}
                    <MinimizeIcon size="14" />
                {:else}
                    <MaximizeIcon size="14" />
                {/if}
            </button>
            <button class="p-1 hover:text-red-400 text-textcolor2 transition-colors" onclick={onClose}>
                <XIcon size="16" />
            </button>
        </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-hidden relative bg-bgcolor">
        {@render children()}
    </div>

    <!-- Resize Handle -->
    {#if !isMaximized}
        <div 
            class="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-10"
            onmousedown={handleResizeDown}
            role="button"
            tabindex="0"
        >
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="text-textcolor2 opacity-50">
                <path d="M21 15v6" />
                <path d="M15 21h6" />
            </svg>
        </div>
    {/if}
</div>