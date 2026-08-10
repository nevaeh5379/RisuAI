<script lang="ts">
    import { onDestroy, tick } from 'svelte'
    import {
        BotIcon,
        CircleAlertIcon,
        FlagIcon,
        LinkIcon,
        PlayIcon,
        PlusIcon,
        RotateCcwIcon,
        TrashIcon,
        WorkflowIcon,
        XIcon,
    } from '@lucide/svelte'
    import { v4 } from 'uuid'
    import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
    import ModelList from 'src/lib/UI/ModelList.svelte'
    import AgentPromptSettings from './AgentPromptSettings.svelte'
    import { DBState } from 'src/ts/stores.svelte'
    import type { PromptItem } from 'src/ts/process/prompt'
    import {
        createDefaultAgentGraph,
        createDefaultSubAgentConfig,
        validateAgentGraph,
        type AgentGraphEdge,
        type AgentGraphNode,
        type AgentGraphPosition,
        type SubAgentNode,
    } from 'src/ts/process/agentGraph'

    const NODE_WIDTH = 216
    const NODE_HEIGHT = 96
    const NODE_GAP = 48
    const MIN_ZOOM = 0.4
    const MAX_ZOOM = 2
    const ZOOM_STEP = 0.1
    const arrowMarkerId = `agent-graph-arrow-${v4()}`

    let viewportElement: HTMLDivElement | undefined

    let selectedNodeId = $state<string | null>(null)
    let selectedEdgeId = $state<string | null>(null)
    let connectingFrom = $state<string | null>(null)
    let connectionPointer = $state<AgentGraphPosition | null>(null)
    let connectionTargetId = $state<string | null>(null)
    let connectionError = $state('')
    let hoveredEdgeId = $state<string | null>(null)
    let zoom = $state(1)
    let dragging = $state<{
        nodeId: string
        pointerX: number
        pointerY: number
        nodeX: number
        nodeY: number
    } | null>(null)
    let panning = $state<{
        pointerX: number
        pointerY: number
        scrollLeft: number
        scrollTop: number
    } | null>(null)
    let linkDrag = $state<{
        sourceId: string
        pointerX: number
        pointerY: number
        moved: boolean
    } | null>(null)

    let validation = $derived(validateAgentGraph(DBState.db.subAgentGraph))
    let selectedNode = $derived(DBState.db.subAgentGraph.nodes.find((node) => node.id === selectedNodeId))
    let selectedEdge = $derived(DBState.db.subAgentGraph.edges.find((edge) => edge.id === selectedEdgeId))
    let canvasWidth = $derived(Math.max(
        800,
        ...DBState.db.subAgentGraph.nodes.map((node) => node.position.x + NODE_WIDTH + 24),
    ))
    let canvasHeight = $derived(Math.max(
        420,
        ...DBState.db.subAgentGraph.nodes.map((node) => node.position.y + NODE_HEIGHT + 80),
    ))
    let scaledCanvasWidth = $derived(Math.ceil(canvasWidth * zoom))
    let scaledCanvasHeight = $derived(Math.ceil(canvasHeight * zoom))

    const fieldClass = 'w-full rounded-md border border-darkborderc bg-transparent px-3 py-2 text-sm text-textcolor outline-hidden transition-colors focus:border-borderc focus:ring-2 focus:ring-borderc'
    const labelClass = 'mb-1 mt-3 block text-xs font-medium text-textcolor2'

    function mainPromptTemplateForAgent(): PromptItem[] {
        if (Array.isArray(DBState.db.promptTemplate)) {
            return DBState.db.promptTemplate
        }
        const template: PromptItem[] = []
        const order = DBState.db.formatingOrder ?? [
            'main',
            'description',
            'personaPrompt',
            'chats',
            'jailbreak',
            'lorebook',
            'globalNote',
            'authorNote',
        ]
        for (const position of order) {
            if (position === 'main') {
                template.push({ type: 'plain', type2: 'main', role: 'system', text: DBState.db.mainPrompt ?? '' })
            }
            else if (position === 'description') {
                template.push({ type: 'description' })
            }
            else if (position === 'personaPrompt') {
                template.push({ type: 'persona' })
            }
            else if (position === 'chats' && !template.some((item) => item.type === 'chat')) {
                template.push({ type: 'chat', rangeStart: -1000, rangeEnd: 'end' })
            }
            else if (position === 'jailbreak') {
                template.push({ type: 'jailbreak', type2: 'normal', role: 'system', text: DBState.db.jailbreak ?? '' })
            }
            else if (position === 'lorebook') {
                template.push({ type: 'lorebook' })
            }
            else if (position === 'globalNote') {
                template.push({ type: 'plain', type2: 'globalNote', role: 'system', text: DBState.db.globalNote ?? '' })
            }
            else if (position === 'authorNote') {
                template.push({ type: 'authornote' })
            }
            else if (position === 'postEverything') {
                template.push({ type: 'postEverything' })
            }
        }
        return template
    }

    function graphNode(nodeId: string): AgentGraphNode | undefined {
        return DBState.db.subAgentGraph.nodes.find((node) => node.id === nodeId)
    }

    function clampZoom(value: number): number {
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
    }

    function clientToWorld(clientX: number, clientY: number): AgentGraphPosition {
        if (!viewportElement) {
            return { x: 0, y: 0 }
        }
        const rect = viewportElement.getBoundingClientRect()
        return {
            x: (viewportElement.scrollLeft + clientX - rect.left - viewportElement.clientLeft) / zoom,
            y: (viewportElement.scrollTop + clientY - rect.top - viewportElement.clientTop) / zoom,
        }
    }

    function setZoom(nextValue: number, clientX?: number, clientY?: number) {
        const nextZoom = clampZoom(Math.round(nextValue * 100) / 100)
        if (!viewportElement || nextZoom === zoom) {
            zoom = nextZoom
            return
        }

        const viewport = viewportElement
        const rect = viewport.getBoundingClientRect()
        const focusX = clientX === undefined
            ? viewport.clientWidth / 2
            : clientX - rect.left - viewport.clientLeft
        const focusY = clientY === undefined
            ? viewport.clientHeight / 2
            : clientY - rect.top - viewport.clientTop
        const worldX = (viewport.scrollLeft + focusX) / zoom
        const worldY = (viewport.scrollTop + focusY) / zoom
        zoom = nextZoom

        void tick().then(() => {
            viewport.scrollTo({
                left: (worldX * nextZoom) - focusX,
                top: (worldY * nextZoom) - focusY,
            })
        })
    }

    async function fitGraph() {
        await tick()
        if (!viewportElement) {
            return
        }
        const horizontalPadding = 48
        const verticalPadding = 48
        const nextZoom = clampZoom(Math.min(
            1,
            (viewportElement.clientWidth - horizontalPadding) / canvasWidth,
            (viewportElement.clientHeight - verticalPadding) / canvasHeight,
        ))
        zoom = Math.round(nextZoom * 100) / 100
        await tick()
        viewportElement.scrollTo({
            left: Math.max(0, (scaledCanvasWidth - viewportElement.clientWidth) / 2),
            top: Math.max(0, (scaledCanvasHeight - viewportElement.clientHeight) / 2),
            behavior: 'smooth',
        })
    }

    async function focusNode(nodeId: string) {
        await tick()
        const node = graphNode(nodeId)
        if (!node || !viewportElement) {
            return
        }
        viewportElement.scrollTo({
            left: Math.max(0, ((node.position.x + (NODE_WIDTH / 2)) * zoom) - (viewportElement.clientWidth / 2)),
            top: Math.max(0, ((node.position.y + (NODE_HEIGHT / 2)) * zoom) - (viewportElement.clientHeight / 2)),
            behavior: 'smooth',
        })
    }

    function handleCanvasWheel(event: WheelEvent) {
        if (!event.ctrlKey && !event.metaKey) {
            return
        }
        event.preventDefault()
        const multiplier = Math.exp(-event.deltaY * 0.002)
        setZoom(zoom * multiplier, event.clientX, event.clientY)
    }

    function graphViewportEvents(element: HTMLDivElement) {
        element.addEventListener('wheel', handleCanvasWheel, { passive: false })
        element.addEventListener('pointerdown', startPan)
        element.addEventListener('keydown', handleCanvasKeydown)
        return {
            destroy() {
                element.removeEventListener('wheel', handleCanvasWheel)
                element.removeEventListener('pointerdown', startPan)
                element.removeEventListener('keydown', handleCanvasKeydown)
            },
        }
    }

    function defaultTargetPort(source: AgentGraphNode, target: AgentGraphNode): string {
        if (target.type === 'final-output') {
            return 'output'
        }
        if (source.type === 'prompt-input' && target.type === 'main-model') {
            return 'prompt'
        }
        if (target.type === 'sub-agent') {
            return 'input'
        }
        const port = source.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
        return port || 'guidance'
    }

    function nextIncomingOrder(targetId: string): number {
        return DBState.db.subAgentGraph.edges
            .filter((edge) => edge.target === targetId)
            .reduce((max, edge) => Math.max(max, edge.order + 1), 0)
    }

    function wouldCreateCycle(sourceId: string, targetId: string): boolean {
        const stack = [targetId]
        const visited = new Set<string>()
        while (stack.length > 0) {
            const current = stack.pop() as string
            if (current === sourceId) {
                return true
            }
            if (visited.has(current)) {
                continue
            }
            visited.add(current)
            for (const edge of DBState.db.subAgentGraph.edges) {
                if (edge.source === current) {
                    stack.push(edge.target)
                }
            }
        }
        return false
    }

    function connectionProblem(sourceId: string, targetId: string): string | undefined {
        const source = graphNode(sourceId)
        const target = graphNode(targetId)
        if (!source || !target || source.type === 'final-output' || target.type === 'prompt-input') {
            return 'That connection is not allowed for these node types.'
        }
        if (sourceId === targetId) {
            return 'A node cannot connect to itself.'
        }
        if (wouldCreateCycle(sourceId, targetId)) {
            return 'That connection would create a cycle.'
        }
        if (DBState.db.subAgentGraph.edges.some((edge) => edge.source === sourceId && edge.target === targetId)) {
            return 'Those nodes are already connected.'
        }
        return undefined
    }

    function addEdge(sourceId: string, targetId: string): boolean {
        const problem = connectionProblem(sourceId, targetId)
        if (problem) {
            connectionError = problem
            return false
        }
        const source = graphNode(sourceId) as AgentGraphNode
        const target = graphNode(targetId) as AgentGraphNode

        const edge: AgentGraphEdge = {
            id: `edge-${v4()}`,
            source: sourceId,
            target: targetId,
            targetPort: defaultTargetPort(source, target),
            order: nextIncomingOrder(targetId),
        }
        DBState.db.subAgentGraph.edges.push(edge)
        selectedNodeId = null
        selectedEdgeId = edge.id
        connectionError = ''
        return true
    }

    function finishConnection(targetId: string, event: MouseEvent) {
        event.stopPropagation()
        if (!connectingFrom) {
            return
        }
        addEdge(connectingFrom, targetId)
        connectingFrom = null
        connectionPointer = null
        connectionTargetId = null
    }

    function removeLinkDragListeners() {
        window.removeEventListener('pointermove', moveLinkDrag)
        window.removeEventListener('pointerup', stopLinkDrag)
    }

    function cancelConnection(clearError = true) {
        removeLinkDragListeners()
        connectingFrom = null
        connectionPointer = null
        connectionTargetId = null
        linkDrag = null
        if (clearError) {
            connectionError = ''
        }
    }

    function inputNodeAtPoint(clientX: number, clientY: number): string | null {
        const element = document.elementFromPoint(clientX, clientY)
        if (!(element instanceof Element)) {
            return null
        }
        return element.closest<HTMLElement>('[data-graph-input-id]')?.dataset.graphInputId ?? null
    }

    function beginConnection(sourceId: string, event: PointerEvent) {
        if (event.button !== 0) {
            return
        }
        event.stopPropagation()
        event.preventDefault()
        if (connectingFrom === sourceId && !linkDrag) {
            cancelConnection()
            return
        }
        cancelConnection()
        const pointer = clientToWorld(event.clientX, event.clientY)
        connectingFrom = sourceId
        connectionPointer = pointer
        selectedNodeId = sourceId
        selectedEdgeId = null
        linkDrag = {
            sourceId,
            pointerX: event.clientX,
            pointerY: event.clientY,
            moved: false,
        }
        window.addEventListener('pointermove', moveLinkDrag)
        window.addEventListener('pointerup', stopLinkDrag, { once: true })
    }

    function moveLinkDrag(event: PointerEvent) {
        if (!linkDrag) {
            return
        }
        const distance = Math.hypot(event.clientX - linkDrag.pointerX, event.clientY - linkDrag.pointerY)
        if (distance > 4) {
            linkDrag.moved = true
        }
        connectionPointer = clientToWorld(event.clientX, event.clientY)
        connectionTargetId = inputNodeAtPoint(event.clientX, event.clientY)
    }

    function stopLinkDrag(event: PointerEvent) {
        const activeDrag = linkDrag
        removeLinkDragListeners()
        linkDrag = null
        connectionPointer = null
        connectionTargetId = null
        if (!activeDrag) {
            return
        }

        const targetId = inputNodeAtPoint(event.clientX, event.clientY)
        if (targetId) {
            addEdge(activeDrag.sourceId, targetId)
            connectingFrom = null
            return
        }
        if (activeDrag.moved) {
            connectingFrom = null
        }
    }

    function handleOutputClick(sourceId: string, event: MouseEvent) {
        if (event.detail !== 0) {
            return
        }
        event.stopPropagation()
        connectionError = ''
        connectingFrom = connectingFrom === sourceId ? null : sourceId
        selectedNodeId = sourceId
        selectedEdgeId = null
    }

    function addSubAgent() {
        const graph = DBState.db.subAgentGraph
        const splitEdge = graph.edges.find((edge) => edge.id === selectedEdgeId)
            ?? graph.edges.find((edge) => edge.source === selectedNodeId)
            ?? graph.edges.find((edge) => {
                return graphNode(edge.source)?.type === 'prompt-input' && graphNode(edge.target)?.type === 'main-model'
            })
        const source = splitEdge ? graphNode(splitEdge.source) : undefined
        const target = splitEdge ? graphNode(splitEdge.target) : undefined
        const agentCount = graph.nodes.filter((node) => node.type === 'sub-agent').length
        const id = `sub-agent-${v4()}`
        let position = { x: 280, y: 48 + (agentCount * 124) }

        if (source && target) {
            const sourceRight = source.position.x + NODE_WIDTH
            const requiredSpace = NODE_WIDTH + (NODE_GAP * 2)
            const currentSpace = target.position.x - sourceRight
            if (currentSpace < requiredSpace) {
                const downstream = new Set([target.id])
                const pending = [target.id]
                while (pending.length > 0) {
                    const nodeId = pending.pop() as string
                    for (const edge of graph.edges) {
                        if (edge.source === nodeId && !downstream.has(edge.target)) {
                            downstream.add(edge.target)
                            pending.push(edge.target)
                        }
                    }
                }
                const shift = requiredSpace - currentSpace
                for (const node of graph.nodes) {
                    if (downstream.has(node.id)) {
                        node.position.x += shift
                    }
                }
            }
            position = {
                x: Math.round(sourceRight + ((target.position.x - sourceRight - NODE_WIDTH) / 2)),
                y: Math.round((source.position.y + target.position.y) / 2) + (agentCount * 28),
            }
        }

        const newNode: SubAgentNode = {
            id,
            name: `Sub Agent ${agentCount + 1}`,
            type: 'sub-agent',
            position,
            condition: '',
            onConditionFalse: 'bypass',
            config: createDefaultSubAgentConfig(mainPromptTemplateForAgent()),
        }
        graph.nodes.push(newNode)

        if (splitEdge && source && target) {
            graph.edges = graph.edges.filter((edge) => edge.id !== splitEdge.id)
            graph.edges.push(
                {
                    id: `edge-${v4()}`,
                    source: source.id,
                    target: newNode.id,
                    targetPort: 'input',
                    order: 0,
                },
                {
                    id: `edge-${v4()}`,
                    source: newNode.id,
                    target: target.id,
                    targetPort: splitEdge.targetPort,
                    order: splitEdge.order,
                },
            )
        }

        selectedNodeId = id
        selectedEdgeId = null
        cancelConnection()
        void focusNode(id)
    }

    function deleteNode(nodeId: string) {
        const node = graphNode(nodeId)
        if (!node || node.type !== 'sub-agent') {
            return
        }
        const graph = DBState.db.subAgentGraph
        const incoming = graph.edges.filter((edge) => edge.target === nodeId)
        const outgoing = graph.edges.filter((edge) => edge.source === nodeId)
        const remainingEdges = graph.edges.filter((edge) => {
            return edge.source !== nodeId && edge.target !== nodeId
        })

        // Removing a node inserted into a simple chain should restore that chain.
        if (
            incoming.length === 1
            && outgoing.length === 1
            && incoming[0].source !== outgoing[0].target
            && !remainingEdges.some((edge) => {
                return edge.source === incoming[0].source && edge.target === outgoing[0].target
            })
        ) {
            remainingEdges.push({
                id: `edge-${v4()}`,
                source: incoming[0].source,
                sourcePort: incoming[0].sourcePort,
                target: outgoing[0].target,
                targetPort: outgoing[0].targetPort,
                order: outgoing[0].order,
            })
        }

        graph.nodes = graph.nodes.filter((entry) => entry.id !== nodeId)
        graph.edges = remainingEdges
        selectedNodeId = null
        selectedEdgeId = null
        hoveredEdgeId = null
        cancelConnection()
    }

    function deleteEdge(edgeId: string) {
        DBState.db.subAgentGraph.edges = DBState.db.subAgentGraph.edges.filter((edge) => edge.id !== edgeId)
        selectedEdgeId = null
        hoveredEdgeId = null
    }

    function resetGraph() {
        DBState.db.subAgentGraph = createDefaultAgentGraph()
        selectedNodeId = null
        selectedEdgeId = null
        hoveredEdgeId = null
        cancelConnection()
        zoom = 1
        void tick().then(() => viewportElement?.scrollTo({ left: 0, top: 0 }))
    }

    function selectNode(nodeId: string) {
        selectedNodeId = nodeId
        selectedEdgeId = null
    }

    function selectEdge(edgeId: string, event?: Event) {
        event?.stopPropagation()
        cancelConnection()
        selectedEdgeId = edgeId
        selectedNodeId = null
    }

    function startDrag(node: AgentGraphNode, event: PointerEvent) {
        if (event.button !== 0) {
            return
        }
        event.preventDefault()
        event.stopPropagation()
        cancelConnection()
        selectNode(node.id)
        const pointer = clientToWorld(event.clientX, event.clientY)
        dragging = {
            nodeId: node.id,
            pointerX: pointer.x,
            pointerY: pointer.y,
            nodeX: node.position.x,
            nodeY: node.position.y,
        }
        window.addEventListener('pointermove', moveDrag)
        window.addEventListener('pointerup', stopDrag, { once: true })
    }

    function moveDrag(event: PointerEvent) {
        if (!dragging) {
            return
        }
        const node = graphNode(dragging.nodeId)
        if (!node) {
            return
        }
        const pointer = clientToWorld(event.clientX, event.clientY)
        node.position.x = Math.max(12, Math.round(dragging.nodeX + pointer.x - dragging.pointerX))
        node.position.y = Math.max(12, Math.round(dragging.nodeY + pointer.y - dragging.pointerY))
    }

    function stopDrag() {
        dragging = null
        window.removeEventListener('pointermove', moveDrag)
    }

    function startPan(event: PointerEvent) {
        if (!viewportElement || (event.button !== 0 && event.button !== 1)) {
            return
        }
        const target = event.target
        if (
            event.button === 0
            && target instanceof Element
            && target.closest('[data-graph-node], [data-graph-edge]')
        ) {
            return
        }
        if (connectingFrom) {
            cancelConnection()
            return
        }
        event.preventDefault()
        viewportElement.focus({ preventScroll: true })
        selectedNodeId = null
        selectedEdgeId = null
        panning = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            scrollLeft: viewportElement.scrollLeft,
            scrollTop: viewportElement.scrollTop,
        }
        window.addEventListener('pointermove', movePan)
        window.addEventListener('pointerup', stopPan, { once: true })
    }

    function movePan(event: PointerEvent) {
        if (!panning || !viewportElement) {
            return
        }
        viewportElement.scrollLeft = panning.scrollLeft - (event.clientX - panning.pointerX)
        viewportElement.scrollTop = panning.scrollTop - (event.clientY - panning.pointerY)
    }

    function stopPan() {
        panning = null
        window.removeEventListener('pointermove', movePan)
    }

    function deleteSelection() {
        if (selectedEdgeId) {
            deleteEdge(selectedEdgeId)
            return
        }
        if (selectedNodeId) {
            deleteNode(selectedNodeId)
        }
    }

    function handleCanvasKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            cancelConnection()
            return
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault()
            deleteSelection()
            return
        }
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return
        }
        if (event.key === '+' || event.key === '=') {
            event.preventDefault()
            setZoom(zoom + ZOOM_STEP)
        }
        else if (event.key === '-' || event.key === '_') {
            event.preventDefault()
            setZoom(zoom - ZOOM_STEP)
        }
        else if (event.key === '0') {
            event.preventDefault()
            setZoom(1)
        }
        else if (event.key.toLowerCase() === 'f') {
            event.preventDefault()
            void fitGraph()
        }
    }

    function curvePath(sourceX: number, sourceY: number, targetX: number, targetY: number): string {
        const curve = Math.min(180, Math.max(24, Math.abs(targetX - sourceX) * 0.45))
        return `M ${sourceX} ${sourceY} C ${sourceX + curve} ${sourceY}, ${targetX - curve} ${targetY}, ${targetX} ${targetY}`
    }

    function edgePath(edge: AgentGraphEdge): string {
        const source = graphNode(edge.source)
        const target = graphNode(edge.target)
        if (!source || !target) {
            return ''
        }
        const sourceX = source.position.x + NODE_WIDTH
        const sourceY = source.position.y + (NODE_HEIGHT / 2)
        const targetX = target.position.x
        const targetY = target.position.y + (NODE_HEIGHT / 2)
        return curvePath(sourceX, sourceY, targetX, targetY)
    }

    function connectionPreviewPath(): string {
        if (!connectingFrom || !connectionPointer) {
            return ''
        }
        const source = graphNode(connectingFrom)
        if (!source) {
            return ''
        }
        const target = connectionTargetId ? graphNode(connectionTargetId) : undefined
        const targetPosition = target
            ? { x: target.position.x, y: target.position.y + (NODE_HEIGHT / 2) }
            : connectionPointer
        return curvePath(
            source.position.x + NODE_WIDTH,
            source.position.y + (NODE_HEIGHT / 2),
            targetPosition.x,
            targetPosition.y,
        )
    }

    function nodeTypeLabel(node: AgentGraphNode): string {
        switch (node.type) {
            case 'prompt-input': return 'Prompt Input'
            case 'sub-agent': return 'Sub Agent'
            case 'main-model': return 'Main Model'
            case 'final-output': return 'Final Output'
        }
    }

    function edgeLabel(edge: AgentGraphEdge): string {
        const source = graphNode(edge.source)?.name ?? edge.source
        const target = graphNode(edge.target)?.name ?? edge.target
        return `${source} → ${target}`
    }

    onDestroy(() => {
        window.removeEventListener('pointermove', moveDrag)
        window.removeEventListener('pointerup', stopDrag)
        window.removeEventListener('pointermove', movePan)
        window.removeEventListener('pointerup', stopPan)
        removeLinkDragListeners()
    })
</script>

<section class="mt-2 text-textcolor">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
            <div class="flex items-center gap-2 text-lg font-semibold">
                <WorkflowIcon size={20} />
                <span>Sub-agent graph</span>
            </div>
            <p class="mt-1 text-xs text-textcolor2">Build a dependency graph around the existing Main Model request.</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
            <CheckInput bind:check={DBState.db.subAgentGraph.enabled} name="Enabled" />
            <button
                class="flex items-center gap-1 rounded-md border border-darkborderc bg-darkbutton px-3 py-2 text-sm hover:bg-selected"
                onclick={addSubAgent}
                title="Split the selected edge, or insert after the selected node"
            >
                <PlusIcon size={16} /> Add agent
            </button>
            <button
                class="flex items-center gap-1 rounded-md border border-darkborderc px-3 py-2 text-sm text-textcolor2 hover:bg-darkbutton hover:text-textcolor"
                onclick={resetGraph}
                title="Reset to the disabled default graph"
            >
                <RotateCcwIcon size={16} /> Reset
            </button>
        </div>
    </div>

    {#if validation.ok}
        <div class="mb-3 rounded-md border border-textcolor/10 bg-textcolor/5 px-3 py-2 text-xs text-textcolor2">
            Graph is valid. Independent nodes in the same stage run in parallel; Main Model runs once.
        </div>
    {:else}
        <div class="mb-3 rounded-md border border-draculared/40 bg-draculared/10 px-3 py-2 text-xs">
            <div class="mb-1 flex items-center gap-1 font-semibold text-draculared">
                <CircleAlertIcon size={15} /> Fix {validation.errors.length} graph issue{validation.errors.length === 1 ? '' : 's'} before generation
            </div>
            <ul class="list-disc space-y-0.5 pl-5 text-textcolor2">
                {#each validation.errors as issue}
                    <li>{issue.message}</li>
                {/each}
            </ul>
        </div>
    {/if}

    {#if connectingFrom}
        <div class="mb-2 flex items-center justify-between rounded-md border border-selected bg-selected/20 px-3 py-2 text-xs">
            <span>Drag to an input dot, or click an input dot to connect from <strong>{graphNode(connectingFrom)?.name}</strong>.</span>
            <button class="rounded p-1 hover:bg-darkbutton" onclick={() => cancelConnection()} title="Cancel connection">
                <XIcon size={15} />
            </button>
        </div>
    {/if}

    {#if connectionError}
        <div class="mb-2 flex items-center justify-between rounded-md border border-draculared/40 bg-draculared/10 px-3 py-2 text-xs text-draculared">
            <span>{connectionError}</span>
            <button class="rounded p-1 hover:bg-darkbutton" onclick={() => connectionError = ''} title="Dismiss connection error">
                <XIcon size={15} />
            </button>
        </div>
    {/if}

    <div class="relative">
        <div class="absolute right-3 top-3 z-40 flex items-center overflow-hidden rounded-md border border-darkborderc bg-bgcolor/90 shadow-lg backdrop-blur-sm" role="group" aria-label="Graph zoom controls">
            <button
                class="h-9 w-9 text-lg text-textcolor2 hover:bg-darkbutton hover:text-textcolor disabled:opacity-40"
                onclick={() => setZoom(zoom - ZOOM_STEP)}
                disabled={zoom <= MIN_ZOOM}
                title="Zoom out (-)"
                aria-label="Zoom out"
            >−</button>
            <button
                class="h-9 min-w-14 border-x border-darkborderc px-2 text-xs text-textcolor2 hover:bg-darkbutton hover:text-textcolor"
                onclick={() => setZoom(1)}
                title="Reset zoom to 100% (0)"
            >{Math.round(zoom * 100)}%</button>
            <button
                class="h-9 w-9 text-lg text-textcolor2 hover:bg-darkbutton hover:text-textcolor disabled:opacity-40"
                onclick={() => setZoom(zoom + ZOOM_STEP)}
                disabled={zoom >= MAX_ZOOM}
                title="Zoom in (+)"
                aria-label="Zoom in"
            >+</button>
            <button
                class="h-9 border-l border-darkborderc px-3 text-xs text-textcolor2 hover:bg-darkbutton hover:text-textcolor"
                onclick={() => void fitGraph()}
                title="Fit graph to view (F)"
            >Fit</button>
        </div>

        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
            bind:this={viewportElement}
            use:graphViewportEvents
            class="h-[55vh] min-h-96 max-h-[620px] touch-none overflow-auto rounded-lg border border-darkborderc bg-darkbg/40 outline-hidden focus:border-borderc focus:ring-2 focus:ring-selected"
            class:cursor-grabbing={Boolean(panning)}
            class:cursor-grab={!panning}
            tabindex="0"
            role="application"
            aria-label="Sub-agent graph editor"
        >
            <div
                class="relative min-h-full min-w-full"
                style={`width:${scaledCanvasWidth}px;height:${scaledCanvasHeight}px;`}
            >
                <div
                    class="pointer-events-none absolute inset-0 text-textcolor2 opacity-30"
                    style={`background-image:radial-gradient(circle, currentColor 1px, transparent 1px);background-size:${20 * zoom}px ${20 * zoom}px;`}
                ></div>
                <div
                    class="absolute left-0 top-0 select-none"
                    data-graph-pan-surface
                    style={`width:${canvasWidth}px;height:${canvasHeight}px;transform:scale(${zoom});transform-origin:top left;`}
                >
                    <svg class="pointer-events-none absolute inset-0 text-textcolor2" width={canvasWidth} height={canvasHeight}>
                        <defs>
                            <marker
                                id={arrowMarkerId}
                                viewBox="0 0 10 10"
                                refX="10"
                                refY="5"
                                markerWidth="7"
                                markerHeight="7"
                                orient="auto-start-reverse"
                            >
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                            </marker>
                        </defs>

                        {#each DBState.db.subAgentGraph.edges as edge (edge.id)}
                            <path
                                class:text-textcolor={selectedEdgeId === edge.id || hoveredEdgeId === edge.id}
                                d={edgePath(edge)}
                                fill="none"
                                stroke="currentColor"
                                stroke-width={selectedEdgeId === edge.id ? 3 : hoveredEdgeId === edge.id ? 2.5 : 2}
                                stroke-opacity={selectedEdgeId === edge.id ? 1 : hoveredEdgeId === edge.id ? 0.8 : 0.55}
                                marker-end={`url(#${arrowMarkerId})`}
                                vector-effect="non-scaling-stroke"
                            />
                            <path
                                class="pointer-events-auto cursor-pointer"
                                data-graph-edge={edge.id}
                                d={edgePath(edge)}
                                fill="none"
                                stroke="transparent"
                                stroke-width="16"
                                vector-effect="non-scaling-stroke"
                                role="button"
                                tabindex="0"
                                aria-label={edgeLabel(edge)}
                                onpointerenter={() => hoveredEdgeId = edge.id}
                                onpointerleave={() => hoveredEdgeId = null}
                                onclick={(event) => selectEdge(edge.id, event)}
                                onkeydown={(event) => {
                                    if(event.key === 'Enter' || event.key === ' '){
                                        event.preventDefault()
                                        selectEdge(edge.id, event)
                                    }
                                }}
                            />
                        {/each}

                        {#if connectionPreviewPath()}
                            <path
                                class:text-textcolor={Boolean(connectionTargetId && !connectionProblem(connectingFrom ?? '', connectionTargetId))}
                                class:text-draculared={Boolean(connectionTargetId && connectionProblem(connectingFrom ?? '', connectionTargetId))}
                                d={connectionPreviewPath()}
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2.5"
                                stroke-dasharray="7 5"
                                stroke-opacity="0.9"
                                marker-end={`url(#${arrowMarkerId})`}
                                vector-effect="non-scaling-stroke"
                            />
                        {/if}
                    </svg>

                    {#each DBState.db.subAgentGraph.nodes as node (node.id)}
                        <div
                            class="absolute rounded-lg border bg-bgcolor shadow-lg transition-[border-color,box-shadow]"
                            class:border-borderc={selectedNodeId === node.id || connectingFrom === node.id}
                            class:border-darkborderc={selectedNodeId !== node.id && connectingFrom !== node.id}
                            class:ring-2={selectedNodeId === node.id || connectingFrom === node.id}
                            class:ring-selected={selectedNodeId === node.id || connectingFrom === node.id}
                            data-graph-node={node.id}
                            style={`left:${node.position.x}px;top:${node.position.y}px;width:${NODE_WIDTH}px;height:${NODE_HEIGHT}px;`}
                        >
                            {#if node.type !== 'prompt-input'}
                                <button
                                    class="absolute -left-2 top-[40px] z-10 h-4 w-4 touch-none rounded-full border-2 border-bgcolor transition-transform hover:scale-125"
                                    class:animate-pulse={Boolean(connectingFrom)}
                                    class:bg-textcolor2={connectionTargetId !== node.id}
                                    class:bg-textcolor={connectionTargetId === node.id && !connectionProblem(connectingFrom ?? '', node.id)}
                                    class:bg-draculared={connectionTargetId === node.id && Boolean(connectionProblem(connectingFrom ?? '', node.id))}
                                    class:ring-2={connectionTargetId === node.id}
                                    class:ring-selected={connectionTargetId === node.id && !connectionProblem(connectingFrom ?? '', node.id)}
                                    class:ring-draculared={connectionTargetId === node.id && Boolean(connectionProblem(connectingFrom ?? '', node.id))}
                                    data-graph-input-id={node.id}
                                    onclick={(event) => finishConnection(node.id, event)}
                                    title="Input"
                                    aria-label={`Connect to ${node.name}`}
                                ></button>
                            {/if}
                            {#if node.type !== 'final-output'}
                                <button
                                    class="absolute -right-2 top-[40px] z-10 h-4 w-4 touch-none rounded-full border-2 border-bgcolor bg-selected transition-transform hover:scale-125"
                                    onpointerdown={(event) => beginConnection(node.id, event)}
                                    onclick={(event) => handleOutputClick(node.id, event)}
                                    title="Drag to connect"
                                    aria-label={`Connect from ${node.name}`}
                                ></button>
                            {/if}

                            <button
                                class="flex h-10 w-full touch-none cursor-grab items-center gap-2 border-b border-darkborderc px-3 text-left active:cursor-grabbing"
                                onpointerdown={(event) => startDrag(node, event)}
                            >
                                {#if node.type === 'prompt-input'}
                                    <PlayIcon size={17} />
                                {:else if node.type === 'sub-agent'}
                                    <BotIcon size={17} />
                                {:else if node.type === 'main-model'}
                                    <WorkflowIcon size={17} />
                                {:else}
                                    <FlagIcon size={17} />
                                {/if}
                                <span class="min-w-0 flex-1 truncate text-sm font-semibold">{node.name}</span>
                            </button>
                            <div class="flex h-14 items-center justify-between gap-2 px-3 text-xs text-textcolor2">
                                <span>{nodeTypeLabel(node)}</span>
                                {#if node.type === 'sub-agent'}
                                    <span class="max-w-24 truncate rounded bg-darkbutton px-2 py-1">
                                        {node.config.staticModel || (node.config.modelMode === 'submodel' ? 'Sub model' : 'Other Ax')}
                                    </span>
                                {/if}
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    </div>

    <p class="mt-2 text-xs text-textcolor2">
        Drag empty space to pan, Ctrl/⌘ + wheel to zoom, or use +/−/0/F. Drag an output dot onto an input dot to connect; Delete removes the selected agent or link.
    </p>

    {#if selectedNode}
        <div class="mt-4 rounded-lg border border-darkborderc bg-darkbg/30 p-4">
            <div class="flex items-center justify-between gap-2">
                <div>
                    <div class="text-sm font-semibold">{selectedNode.name}</div>
                    <div class="text-xs text-textcolor2">{nodeTypeLabel(selectedNode)} · {selectedNode.id}</div>
                </div>
                {#if selectedNode.type === 'sub-agent'}
                    <button
                        class="rounded-md p-2 text-textcolor2 hover:bg-draculared/10 hover:text-draculared"
                        onclick={() => deleteNode(selectedNode.id)}
                        title="Delete sub-agent"
                    >
                        <TrashIcon size={18} />
                    </button>
                {/if}
            </div>

            {#if selectedNode.type === 'sub-agent'}
                <div class="mt-3">
                    <label class={labelClass} for="agent-graph-name">Name</label>
                    <input
                        id="agent-graph-name"
                        class={fieldClass}
                        value={selectedNode.name}
                        oninput={(event) => selectedNode.name = event.currentTarget.value}
                    />

                    <label class={labelClass} for="agent-graph-instruction">Instruction variable</label>
                    <textarea
                        id="agent-graph-instruction"
                        class={`${fieldClass} min-h-24 resize-y`}
                        value={selectedNode.config.instruction}
                        placeholder="Analyze continuity, plan the response, or revise the Main Model output..."
                        oninput={(event) => selectedNode.config.instruction = event.currentTarget.value}
                    ></textarea>
                    <p class="mt-1 text-[11px] text-textcolor2">
                        Insert this value from a Plain prompt block with {'{{instruction}}'}.
                    </p>

                    <div class="mt-4 flex items-end justify-between gap-3">
                        <div>
                            <div class="text-sm font-semibold">Prompt blocks</div>
                            <p class="mt-1 text-xs text-textcolor2">
                                This is the same block editor as Chat Bot → Prompt. A new agent copies the current main prompt and appends Agent task at the end.
                            </p>
                        </div>
                    </div>
                    {#key selectedNode.id}
                        <AgentPromptSettings bind:promptTemplate={selectedNode.config.promptTemplate} />
                    {/key}
                    <p class="mt-2 text-[11px] text-textcolor2">
                        Plain prompt variables: {'{{instruction}}'}, {'{{upstream}}'}, {'{{upstream.port}}'}, {'{{originalPrompt}}'}, {'{{lastUserMessage}}'}, {'{{mainModelOutput}}'}. Risu CBS expressions are also supported.
                    </p>

                    <div class="mt-4 grid gap-x-4 lg:grid-cols-2">
                        <div>
                        <label class={labelClass} for="agent-graph-model-mode">Configured model group</label>
                        <select
                            id="agent-graph-model-mode"
                            class={fieldClass}
                            value={selectedNode.config.modelMode}
                            onchange={(event) => selectedNode.config.modelMode = event.currentTarget.value as SubAgentNode['config']['modelMode']}
                        >
                            <option value="submodel">Sub model</option>
                            <option value="otherAx">Other Ax model</option>
                        </select>

                        <span class={labelClass}>Static model override</span>
                        <div class="rounded-md border border-darkborderc">
                            <ModelList
                                value={selectedNode.config.staticModel ?? ''}
                                blankable
                                noMargin
                                onChange={(value) => selectedNode.config.staticModel = value || undefined}
                            />
                        </div>
                        <p class="mt-1 text-[11px] text-textcolor2">Leave empty to use the configured model group above.</p>

                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class={labelClass} for="agent-graph-max-tokens">Max tokens</label>
                                <input
                                    id="agent-graph-max-tokens"
                                    type="number"
                                    min="1"
                                    step="1"
                                    class={fieldClass}
                                    value={selectedNode.config.maxTokens}
                                    onchange={(event) => selectedNode.config.maxTokens = Number(event.currentTarget.value)}
                                />
                            </div>
                            <div>
                                <label class={labelClass} for="agent-graph-temperature">Temperature</label>
                                <input
                                    id="agent-graph-temperature"
                                    type="number"
                                    min="0"
                                    max="2"
                                    step="0.05"
                                    class={fieldClass}
                                    value={selectedNode.config.temperature ?? 0.7}
                                    onchange={(event) => selectedNode.config.temperature = Number(event.currentTarget.value)}
                                />
                            </div>
                        </div>

                        <label class={labelClass} for="agent-graph-timeout">Timeout (milliseconds)</label>
                        <input
                            id="agent-graph-timeout"
                            type="number"
                            min="1"
                            step="1000"
                            class={fieldClass}
                            value={selectedNode.config.timeoutMs ?? 120000}
                            onchange={(event) => selectedNode.config.timeoutMs = Number(event.currentTarget.value)}
                        />
                        </div>

                        <div>
                        <label class={labelClass} for="agent-graph-condition">CBS execution condition</label>
                        <input
                            id="agent-graph-condition"
                            class={`${fieldClass} font-mono`}
                            value={selectedNode.condition ?? ''}
                            placeholder={'{{equal::{{getvar::scene_type}}::combat}}'}
                            oninput={(event) => selectedNode.condition = event.currentTarget.value}
                        />

                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class={labelClass} for="agent-graph-condition-false">When false</label>
                                <select
                                    id="agent-graph-condition-false"
                                    class={fieldClass}
                                    value={selectedNode.onConditionFalse ?? 'bypass'}
                                    onchange={(event) => selectedNode.onConditionFalse = event.currentTarget.value as 'bypass' | 'empty'}
                                >
                                    <option value="bypass">Bypass input</option>
                                    <option value="empty">Return empty</option>
                                </select>
                            </div>
                            <div>
                                <label class={labelClass} for="agent-graph-error">On error</label>
                                <select
                                    id="agent-graph-error"
                                    class={fieldClass}
                                    value={selectedNode.config.onError}
                                    onchange={(event) => selectedNode.config.onError = event.currentTarget.value as SubAgentNode['config']['onError']}
                                >
                                    <option value="abort">Abort generation</option>
                                    <option value="passthrough">Pass through input</option>
                                    <option value="empty">Return empty</option>
                                </select>
                            </div>
                        </div>
                        </div>
                    </div>
                </div>
            {:else}
                <p class="mt-3 text-sm text-textcolor2">
                    This required node is configured by the normal bot settings. Move it or connect dependencies here.
                </p>
            {/if}
        </div>
    {:else if selectedEdge}
        <div class="mt-4 rounded-lg border border-darkborderc bg-darkbg/30 p-4">
            <div class="flex items-center justify-between gap-2">
                <div>
                    <div class="flex items-center gap-2 text-sm font-semibold"><LinkIcon size={16} /> {edgeLabel(selectedEdge)}</div>
                    <div class="text-xs text-textcolor2">Dependency edge · {selectedEdge.id}</div>
                </div>
                <button
                    class="rounded-md p-2 text-textcolor2 hover:bg-draculared/10 hover:text-draculared"
                    onclick={() => deleteEdge(selectedEdge.id)}
                    title="Delete edge"
                >
                    <TrashIcon size={18} />
                </button>
            </div>
            <div class="mt-2 grid gap-3 md:grid-cols-2">
                <div>
                    <label class={labelClass} for="agent-graph-port">Target port</label>
                    <input
                        id="agent-graph-port"
                        class={fieldClass}
                        value={selectedEdge.targetPort}
                        oninput={(event) => selectedEdge.targetPort = event.currentTarget.value}
                    />
                </div>
                <div>
                    <label class={labelClass} for="agent-graph-order">Merge order</label>
                    <input
                        id="agent-graph-order"
                        type="number"
                        min="0"
                        step="1"
                        class={fieldClass}
                        value={selectedEdge.order}
                        onchange={(event) => selectedEdge.order = Number(event.currentTarget.value)}
                    />
                </div>
            </div>
            <p class="mt-2 text-xs text-textcolor2">Incoming values are merged by this order, never by canvas position.</p>
        </div>
    {/if}
</section>
