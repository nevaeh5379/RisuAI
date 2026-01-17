<script lang="ts">
    import { fly, fade } from 'svelte/transition';
    import { exportModalStore, rangeSelectionStore, DBState, selectedCharID } from "src/ts/stores.svelte";
    import { ImageDownIcon, XIcon, CheckIcon } from "@lucide/svelte";

    function getCurrentChat() {
        const char = DBState.db.characters[$selectedCharID];
        if (!char) return null;
        return char.chats[char.chatPage];
    }

    function confirmExport() {
        const start = Math.min(rangeSelectionStore.startIndex, rangeSelectionStore.endIndex);
        const end = Math.max(rangeSelectionStore.startIndex, rangeSelectionStore.endIndex);
        
        exportModalStore.set({
            open: true,
            startIndex: start,
            endIndex: end,
            initialIndex: start,
            chatId: rangeSelectionStore.chatId
        });
        
        cancelSelection();
    }

    function cancelSelection() {
        rangeSelectionStore.active = false;
        rangeSelectionStore.startIndex = -1;
        rangeSelectionStore.endIndex = -1;
        rangeSelectionStore.chatId = '';
    }

    let messageCount = $derived.by(() => {
        if (rangeSelectionStore.startIndex < 0 || rangeSelectionStore.endIndex < 0) {
            return 0;
        }
        return Math.abs(rangeSelectionStore.endIndex - rangeSelectionStore.startIndex) + 1;
    });

    let canConfirm = $derived(rangeSelectionStore.endIndex >= 0);
</script>

{#if rangeSelectionStore.active}
<!-- Range selection mode active overlay -->
<div 
    class="range-selection-bar"
    transition:fly={{ y: -20, duration: 200 }}
>
    <div class="range-bar-content">
        <div class="range-icon">
            <ImageDownIcon size={20} />
        </div>
        
        <div class="range-info">
            {#if rangeSelectionStore.endIndex < 0}
                <span class="range-instruction">내보낼 마지막 메시지를 선택하세요</span>
                <span class="range-start">시작: 메시지 #{rangeSelectionStore.startIndex + 1}</span>
            {:else}
                <span class="range-selected">{messageCount}개 메시지 선택됨</span>
                <span class="range-detail">#{Math.min(rangeSelectionStore.startIndex, rangeSelectionStore.endIndex) + 1} ~ #{Math.max(rangeSelectionStore.startIndex, rangeSelectionStore.endIndex) + 1}</span>
            {/if}
        </div>
        
        <div class="range-actions">
            <button class="range-btn range-btn-cancel" onclick={cancelSelection}>
                <XIcon size={18} />
                <span>취소</span>
            </button>
            
            {#if canConfirm}
            <button class="range-btn range-btn-confirm" onclick={confirmExport} transition:fly={{ x: 20, duration: 150 }}>
                <CheckIcon size={18} />
                <span>내보내기</span>
            </button>
            {/if}
        </div>
    </div>
</div>
{/if}

<style>
    .range-selection-bar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 9998;
        background: linear-gradient(135deg, rgba(139, 92, 246, 0.95) 0%, rgba(109, 40, 217, 0.95) 100%);
        backdrop-filter: blur(12px);
        padding: 12px 20px;
        box-shadow: 0 4px 20px rgba(139, 92, 246, 0.4);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .range-bar-content {
        display: flex;
        align-items: center;
        gap: 16px;
        max-width: 1200px;
        margin: 0 auto;
    }

    .range-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 10px;
        color: white;
    }

    .range-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .range-instruction {
        font-size: 14px;
        font-weight: 600;
        color: white;
    }

    .range-start {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.7);
    }

    .range-selected {
        font-size: 14px;
        font-weight: 600;
        color: white;
    }

    .range-detail {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.7);
        font-family: monospace;
    }

    .range-actions {
        display: flex;
        gap: 8px;
    }

    .range-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        border: none;
    }

    .range-btn-cancel {
        background: rgba(255, 255, 255, 0.15);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .range-btn-cancel:hover {
        background: rgba(255, 255, 255, 0.25);
    }

    .range-btn-confirm {
        background: white;
        color: #7c3aed;
    }

    .range-btn-confirm:hover {
        background: #f5f3ff;
        transform: scale(1.02);
    }

    @media (max-width: 600px) {
        .range-bar-content {
            flex-wrap: wrap;
        }
        
        .range-info {
            flex: 1 1 100%;
            order: 2;
        }
        
        .range-actions {
            order: 3;
            width: 100%;
            justify-content: flex-end;
            margin-top: 8px;
        }
    }
</style>
