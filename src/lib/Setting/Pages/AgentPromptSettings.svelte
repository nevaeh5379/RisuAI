<script lang="ts">
    import { PlusIcon } from '@lucide/svelte'
    import { onDestroy, onMount } from 'svelte'
    import { language } from 'src/lang'
    import PromptDataItem from 'src/lib/UI/PromptDataItem.svelte'
    import { tokenizePreset, type PromptItem } from 'src/ts/process/prompt'

    interface Props {
        promptTemplate: PromptItem[]
    }

    let { promptTemplate = $bindable() }: Props = $props()
    let tokens = $state(0)
    let exactTokens = $state(0)
    let draggedIndex = $state(-1)
    let dragOverIndex = $state(-1)
    let openedItemIndices = $state(new Set<number>())

    async function executeTokenize(template: PromptItem[]) {
        tokens = await tokenizePreset(template, true)
        exactTokens = await tokenizePreset(template, false)
    }

    $effect(() => {
        void executeTokenize(promptTemplate)
    })

    function getDisplayTemplate() {
        return promptTemplate.map((item, index) => ({
            item,
            originalIndex: index,
            displayIndex: index,
        }))
    }

    function getReorderedTemplate() {
        if (draggedIndex === -1 || dragOverIndex === -1 || draggedIndex === dragOverIndex) {
            return getDisplayTemplate()
        }

        const items = getDisplayTemplate()
        const [movedItem] = items.splice(draggedIndex, 1)
        const adjustedDropIndex = draggedIndex < dragOverIndex ? dragOverIndex - 1 : dragOverIndex
        items.splice(adjustedDropIndex, 0, movedItem)
        return items.map((item, displayIndex) => ({ ...item, displayIndex }))
    }

    function handlePromptDrop() {
        if (draggedIndex === -1 || dragOverIndex === -1 || draggedIndex === dragOverIndex) {
            return
        }

        const templates = [...promptTemplate]
        const [movedItem] = templates.splice(draggedIndex, 1)
        const adjustedDropIndex = draggedIndex < dragOverIndex ? dragOverIndex - 1 : dragOverIndex
        templates.splice(adjustedDropIndex, 0, movedItem)

        const nextOpenedIndices = new Set<number>()
        openedItemIndices.forEach((index) => {
            if (index === draggedIndex) {
                nextOpenedIndices.add(adjustedDropIndex)
            }
            else if (draggedIndex < adjustedDropIndex && index > draggedIndex && index <= adjustedDropIndex) {
                nextOpenedIndices.add(index - 1)
            }
            else if (draggedIndex > adjustedDropIndex && index >= adjustedDropIndex && index < draggedIndex) {
                nextOpenedIndices.add(index + 1)
            }
            else {
                nextOpenedIndices.add(index)
            }
        })

        promptTemplate = templates
        openedItemIndices = nextOpenedIndices
        draggedIndex = -1
        dragOverIndex = -1
    }

    function removePrompt(index: number) {
        const templates = [...promptTemplate]
        templates.splice(index, 1)
        promptTemplate = templates
        openedItemIndices = new Set([...openedItemIndices]
            .filter((openedIndex) => openedIndex !== index)
            .map((openedIndex) => openedIndex > index ? openedIndex - 1 : openedIndex))
        draggedIndex = -1
        dragOverIndex = -1
    }

    function movePrompt(index: number, direction: -1 | 1) {
        const targetIndex = index + direction
        if (targetIndex < 0 || targetIndex >= promptTemplate.length) {
            return
        }
        const templates = [...promptTemplate]
        const current = templates[index]
        templates[index] = templates[targetIndex]
        templates[targetIndex] = current
        promptTemplate = templates
        openedItemIndices = new Set([...openedItemIndices].map((openedIndex) => {
            if (openedIndex === index) return targetIndex
            if (openedIndex === targetIndex) return index
            return openedIndex
        }))
    }

    function addPrompt() {
        promptTemplate = [...promptTemplate, {
            type: 'plain',
            text: '',
            role: 'system',
            type2: 'normal',
        }]
    }

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.ctrlKey && event.altKey && event.key === 'o') {
            openedItemIndices = openedItemIndices.size === promptTemplate.length
                ? new Set<number>()
                : new Set(promptTemplate.map((_, index) => index))
        }
    }

    onMount(() => document.addEventListener('keydown', handleKeyDown))
    onDestroy(() => document.removeEventListener('keydown', handleKeyDown))
</script>

<div class="contain mt-2 flex w-full max-w-full flex-col rounded-md p-3">
    {#if promptTemplate.length === 0}
        <div class="text-textcolor2">No Format</div>
    {/if}
    {#each getReorderedTemplate() as { originalIndex, displayIndex }}
        <PromptDataItem
            bind:promptItem={promptTemplate[originalIndex]}
            isDragging={draggedIndex === originalIndex}
            isOpened={openedItemIndices.has(originalIndex)}
            bind:draggedIndex
            bind:dragOverIndex
            bind:openedItemIndices
            currentIndex={originalIndex}
            displayIndex={displayIndex}
            onDrop={handlePromptDrop}
            onRemove={() => removePrompt(originalIndex)}
            moveDown={() => movePrompt(originalIndex, 1)}
            moveUp={() => movePrompt(originalIndex, -1)}
        />
    {/each}
</div>

<button class="cursor-pointer font-medium hover:text-green-500" onclick={addPrompt} title="Add prompt block">
    <PlusIcon />
</button>

<div class="mt-2 flex flex-col text-sm text-textcolor2">
    <span>{tokens} {language.fixedTokens}</span>
    <span>{exactTokens} {language.exactTokens}</span>
</div>
