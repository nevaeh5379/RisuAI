<script lang="ts">
    import { fly } from 'svelte/transition';
    import { language } from "src/lang";
    import { exportModalStore, DBState, selectedCharID, rangeSelectionStore } from "src/ts/stores.svelte";
    import { CopyIcon, PencilIcon, SplitIcon, PowerOff, Scissors, ImageDownIcon, ArrowDownToLineIcon, ListIcon } from "@lucide/svelte";
    
    let {
        open = $bindable(false),
        x = 0,
        y = 0,
        messageIdx = -1,
        onClose = () => {},
        onCopy = () => {},
        onEdit = () => {},
        onBranch = () => {},
        onDisable = () => {},
        onDisableAbove = () => {},
    }: {
        open: boolean;
        x: number;
        y: number;
        messageIdx: number;
        onClose?: () => void;
        onCopy?: () => void;
        onEdit?: () => void;
        onBranch?: () => void;
        onDisable?: () => void;
        onDisableAbove?: () => void;
    } = $props();

    let menuRef = $state<HTMLDivElement>();
    let openTimestamp = $state(0);
    
    // Calculate menu position to avoid overflow
    let adjustedX = $derived.by(() => {
        if (typeof window === 'undefined') return x;
        const menuWidth = 220;
        const maxX = window.innerWidth - menuWidth - 20;
        return Math.min(x, maxX);
    });
    
    let adjustedY = $derived.by(() => {
        if (typeof window === 'undefined') return y;
        const menuHeight = 380;
        const maxY = window.innerHeight - menuHeight - 20;
        return Math.min(y, maxY);
    });

    function getCurrentChat() {
        const char = DBState.db.characters[$selectedCharID];
        if (!char) return null;
        return char.chats[char.chatPage];
    }

    function exportThisMessage() {
        exportModalStore.set({
            open: true,
            startIndex: messageIdx,
            endIndex: messageIdx,
            initialIndex: messageIdx,
            chatId: getCurrentChat()?.id || ''
        });
        close();
    }

    function exportFromMessage() {
        const chat = getCurrentChat();
        if (!chat) return;
        exportModalStore.set({
            open: true,
            startIndex: messageIdx,
            endIndex: chat.message.length - 1,
            initialIndex: messageIdx,
            chatId: chat.id
        });
        close();
    }

    function exportWithRange() {
        // Start range selection mode
        rangeSelectionStore.active = true;
        rangeSelectionStore.startIndex = messageIdx;
        rangeSelectionStore.endIndex = -1;
        rangeSelectionStore.chatId = getCurrentChat()?.id || '';
        close();
    }

    function close() {
        open = false;
        onClose();
    }

    function handleItemClick(action: () => void) {
        action();
        close();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            close();
        }
    }

    function handleClickOutside(e: MouseEvent | TouchEvent) {
        // Ignore events that happen within 150ms of opening (synthetic click from touch)
        if (Date.now() - openTimestamp < 150) return;
        
        const target = e.target as Node;
        if (menuRef && !menuRef.contains(target)) {
            close();
        }
    }

    $effect(() => {
        if (open) {
            openTimestamp = Date.now();
            // Small delay to prevent immediate close from synthetic click
            const timeoutId = setTimeout(() => {
                document.addEventListener('click', handleClickOutside);
                document.addEventListener('touchstart', handleClickOutside);
            }, 50);
            document.addEventListener('keydown', handleKeydown);
            
            return () => {
                clearTimeout(timeoutId);
                document.removeEventListener('click', handleClickOutside);
                document.removeEventListener('touchstart', handleClickOutside);
                document.removeEventListener('keydown', handleKeydown);
            };
        }
    });
</script>

{#if open}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div 
    class="context-menu-overlay"
    onclick={close}
    oncontextmenu={(e) => { e.preventDefault(); close(); }}
>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div 
        bind:this={menuRef}
        class="context-menu"
        style="left: {adjustedX}px; top: {adjustedY}px;"
        transition:fly={{ y: -10, duration: 150 }}
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => { if (e.key === 'Escape') close(); }}
    >
        <!-- Export Section -->
        <div class="menu-section-label">내보내기</div>
        
        <button class="menu-item" onclick={() => handleItemClick(exportThisMessage)}>
            <ImageDownIcon size={16} />
            <span>이 메시지만 내보내기</span>
        </button>
        
        <button class="menu-item" onclick={() => handleItemClick(exportFromMessage)}>
            <ArrowDownToLineIcon size={16} />
            <span>이 메시지 이후 모두</span>
        </button>
        
        <button class="menu-item" onclick={() => handleItemClick(exportWithRange)}>
            <ListIcon size={16} />
            <span>범위 선택 내보내기...</span>
        </button>

        <div class="menu-divider"></div>

        <!-- Actions Section -->
        <div class="menu-section-label">작업</div>
        
        <button class="menu-item" onclick={() => handleItemClick(onCopy)}>
            <CopyIcon size={16} />
            <span>{language.copy}</span>
        </button>
        
        <button class="menu-item" onclick={() => handleItemClick(onEdit)}>
            <PencilIcon size={16} />
            <span>{language.edit}</span>
        </button>
        
        <button class="menu-item" onclick={() => handleItemClick(onBranch)}>
            <SplitIcon size={16} />
            <span>{language.branch}</span>
        </button>

        <div class="menu-divider"></div>
        
        <button class="menu-item" onclick={() => handleItemClick(onDisable)}>
            <PowerOff size={16} />
            <span>{language.disableMessage}</span>
        </button>
        
        <button class="menu-item" onclick={() => handleItemClick(onDisableAbove)}>
            <Scissors size={16} />
            <span>{language.disableAbove}</span>
        </button>
    </div>
</div>
{/if}

<style>
    .context-menu-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
    }

    .context-menu {
        position: fixed;
        min-width: 200px;
        max-width: 280px;
        background: linear-gradient(145deg, rgba(30, 30, 45, 0.98) 0%, rgba(20, 20, 30, 0.98) 100%);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 8px 0;
        box-shadow: 
            0 20px 60px rgba(0, 0, 0, 0.5),
            0 0 0 1px rgba(255, 255, 255, 0.05),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
        overflow: hidden;
    }

    .menu-section-label {
        padding: 6px 14px 4px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.4);
    }

    .menu-item {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 10px 14px;
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.85);
        font-size: 13px;
        cursor: pointer;
        transition: all 0.15s ease;
        text-align: left;
    }

    .menu-item:hover {
        background: linear-gradient(90deg, rgba(139, 92, 246, 0.3) 0%, rgba(139, 92, 246, 0.1) 100%);
        color: #ffffff;
    }

    .menu-item:active {
        background: rgba(139, 92, 246, 0.4);
        transform: scale(0.98);
    }

    .menu-divider {
        height: 1px;
        margin: 6px 12px;
        background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.1) 50%, transparent 100%);
    }
</style>
