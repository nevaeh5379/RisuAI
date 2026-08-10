import type { PromptItem, PromptRole } from './prompt'

export const AGENT_GRAPH_VERSION = 1 as const

export const DEFAULT_SUB_AGENT_INPUT_TEMPLATE = `Analyze the conversation according to the following instruction.

<instruction>
{{instruction}}
</instruction>

<upstream-outputs>
{{upstream}}
</upstream-outputs>`

export type AgentGraphNodeType = 'prompt-input' | 'sub-agent' | 'main-model' | 'final-output'
export type SubAgentContextMode = 'full-prompt' | 'last-message' | 'upstream-only'
export type SubAgentModelMode = 'submodel' | 'otherAx'
export type SubAgentErrorMode = 'abort' | 'empty' | 'passthrough'
export type SubAgentConditionFalseMode = 'bypass' | 'empty'

export interface AgentGraphPosition {
    x: number
    y: number
}

export interface BaseGraphNode {
    id: string
    name: string
    position: AgentGraphPosition
}

export interface PromptInputNode extends BaseGraphNode {
    type: 'prompt-input'
}

export interface MainModelNode extends BaseGraphNode {
    type: 'main-model'
}

export interface FinalOutputNode extends BaseGraphNode {
    type: 'final-output'
}

export interface SubAgentConfig {
    instruction: string
    promptTemplate: PromptItem[]
    /** @deprecated Migrated into `promptTemplate`; retained for older graph callers. */
    contextMode: SubAgentContextMode
    /** @deprecated Migrated into `promptTemplate`; retained for older graph callers. */
    inputTemplate: string
    modelMode: SubAgentModelMode
    staticModel?: string
    maxTokens: number
    temperature?: number
    onError: SubAgentErrorMode
    timeoutMs?: number
}

export interface SubAgentNode extends BaseGraphNode {
    type: 'sub-agent'
    condition?: string
    onConditionFalse?: SubAgentConditionFalseMode
    config: SubAgentConfig
}

export type AgentGraphNode = PromptInputNode | SubAgentNode | MainModelNode | FinalOutputNode

export interface AgentGraphEdge {
    id: string
    source: string
    sourcePort?: string
    target: string
    targetPort: string
    order: number
    condition?: string
}

export interface AgentGraph {
    version: typeof AGENT_GRAPH_VERSION
    enabled: boolean
    nodes: AgentGraphNode[]
    edges: AgentGraphEdge[]
}

export interface NodeInputValue {
    sourceNodeId: string
    sourceNodeName: string
    targetPort: string
    text: string
}

export interface GraphNodeResult {
    nodeId: string
    status: 'success' | 'skipped' | 'failed'
    text: string
    startedAt: number
    finishedAt: number
    durationMs: number
    model?: string
    inputTokens?: number
    outputTokens?: number
    condition?: string
    conditionPassed?: boolean
    skippedReason?: 'condition-false'
    error?: string
}

export type AgentGraphTraceEntry = Omit<GraphNodeResult, 'text'> & {
    nodeName?: string
    outputPreview?: string
}

export interface AgentGraphExecutionResult {
    output: string
    trace: GraphNodeResult[]
}

export interface GraphModelExecutionResult {
    text: string
    model?: string
    inputTokens?: number
    outputTokens?: number
}

export interface AgentGraphExecutionContext {
    originalPrompt: string
    lastUserMessage: string
    signal: AbortSignal
    /**
     * `messages` means the host sends conversation context as structured chat
     * messages, so Prompt input must not be flattened into the agent task text.
     */
    promptContextMode?: 'inline' | 'messages'
    executeSubAgent: (
        node: SubAgentNode,
        prompt: string,
        inputs: NodeInputValue[],
        signal: AbortSignal,
        templateContext: SubAgentTemplateContext,
    ) => Promise<string | GraphModelExecutionResult>
    evaluateCondition?: (condition: string, node: SubAgentNode) => boolean | Promise<boolean>
}

export interface SubAgentTemplateContext {
    originalPrompt: string
    lastUserMessage: string
    mainModelOutput?: string
    instruction?: string
}

export interface FullAgentGraphExecutionContext extends AgentGraphExecutionContext {
    executeMainModel: (
        inputs: NodeInputValue[],
        signal: AbortSignal,
    ) => Promise<string | GraphModelExecutionResult>
}

export type AgentGraphValidationErrorCode =
    | 'unsupported-version'
    | 'invalid-node-id'
    | 'duplicate-node-id'
    | 'invalid-node-position'
    | 'invalid-node-config'
    | 'special-node-count'
    | 'invalid-edge-id'
    | 'duplicate-edge-id'
    | 'missing-edge-node'
    | 'duplicate-edge'
    | 'invalid-edge-order'
    | 'duplicate-edge-order'
    | 'invalid-edge-port'
    | 'unsupported-edge-condition'
    | 'invalid-special-edge'
    | 'cycle'
    | 'unreachable-node'
    | 'dead-end-node'
    | 'main-model-bypass'

export interface AgentGraphValidationIssue {
    code: AgentGraphValidationErrorCode
    message: string
    nodeId?: string
    edgeId?: string
}

export interface AgentGraphValidationResult {
    ok: boolean
    errors: AgentGraphValidationIssue[]
}

export class AgentGraphValidationError extends Error {
    readonly issues: AgentGraphValidationIssue[]

    constructor(issues: AgentGraphValidationIssue[]) {
        super(issues.map((issue) => issue.message).join('\n'))
        this.name = 'AgentGraphValidationError'
        this.issues = issues
    }
}

export class AgentGraphNodeExecutionError extends Error {
    readonly node: SubAgentNode
    readonly result: GraphNodeResult

    constructor(node: SubAgentNode, result: GraphNodeResult, cause?: unknown) {
        super(`Sub-agent "${node.name}" failed: ${result.error ?? 'Unknown error'}`, { cause })
        this.name = 'AgentGraphNodeExecutionError'
        this.node = node
        this.result = result
    }
}

export function createDefaultSubAgentPromptTemplate(
    contextMode: SubAgentContextMode = 'full-prompt',
    inputTemplate = DEFAULT_SUB_AGENT_INPUT_TEMPLATE,
    baseTemplate?: PromptItem[],
): PromptItem[] {
    if (baseTemplate) {
        const copiedTemplate = baseTemplate.map((item) => ({ ...item })) as PromptItem[]
        if (!copiedTemplate.some((item) => item.type === 'postEverything')) {
            copiedTemplate.push({ type: 'postEverything' })
        }
        return [
            ...copiedTemplate,
            {
                type: 'plain',
                type2: 'normal',
                name: 'Agent task',
                role: 'user',
                text: inputTemplate || DEFAULT_SUB_AGENT_INPUT_TEMPLATE,
            },
        ]
    }

    const blocks: PromptItem[] = []
    if (contextMode !== 'upstream-only') {
        blocks.push({
            type: 'chat',
            name: contextMode === 'last-message' ? 'Last user message' : 'Original prompt',
            rangeStart: contextMode === 'last-message' ? -1 : -1000,
            rangeEnd: 'end',
        })
    }
    blocks.push({
        type: 'plain',
        type2: 'normal',
        name: 'Agent task',
        role: 'user' as const,
        text: inputTemplate || DEFAULT_SUB_AGENT_INPUT_TEMPLATE,
    })
    return blocks
}

export function createDefaultSubAgentConfig(baseTemplate?: PromptItem[]): SubAgentConfig {
    return {
        instruction: '',
        promptTemplate: createDefaultSubAgentPromptTemplate('full-prompt', DEFAULT_SUB_AGENT_INPUT_TEMPLATE, baseTemplate),
        contextMode: 'full-prompt',
        inputTemplate: DEFAULT_SUB_AGENT_INPUT_TEMPLATE,
        modelMode: 'submodel',
        maxTokens: 500,
        temperature: 0.7,
        onError: 'abort',
        timeoutMs: 120000,
    }
}

export function createDefaultAgentGraph(): AgentGraph {
    return {
        version: AGENT_GRAPH_VERSION,
        enabled: false,
        nodes: [
            {
                id: 'prompt-input',
                name: 'Prompt',
                type: 'prompt-input',
                position: { x: 24, y: 120 },
            },
            {
                id: 'main-model',
                name: 'Main Model',
                type: 'main-model',
                position: { x: 284, y: 120 },
            },
            {
                id: 'final-output',
                name: 'Output',
                type: 'final-output',
                position: { x: 544, y: 120 },
            },
        ],
        edges: [
            {
                id: 'prompt-to-main',
                source: 'prompt-input',
                target: 'main-model',
                targetPort: 'prompt',
                order: 0,
            },
            {
                id: 'main-to-output',
                source: 'main-model',
                target: 'final-output',
                targetPort: 'output',
                order: 0,
            },
        ],
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizePosition(value: unknown, index: number): AgentGraphPosition {
    const position = isRecord(value) ? value : {}
    return {
        x: finiteNumber(position.x, 24 + (index * 260)),
        y: finiteNumber(position.y, 120),
    }
}

function normalizePromptRole(value: unknown, fallback: PromptRole = 'system'): PromptRole {
    if (value === 'user' || value === 'system' || value === 'bot') {
        return value
    }
    if (value === 'assistant' || value === 'char') {
        return 'bot'
    }
    return fallback
}

function normalizePromptBlock(value: unknown): PromptItem | undefined {
    if (!isRecord(value)) {
        return undefined
    }

    const name = typeof value.name === 'string' ? value.name : undefined
    if (value.type === 'plain' || value.type === 'jailbreak' || value.type === 'cot') {
        return {
            type: value.type,
            type2: value.type2 === 'globalNote' || value.type2 === 'main' ? value.type2 : 'normal',
            name,
            text: typeof value.text === 'string' ? value.text : '',
            role: normalizePromptRole(value.role),
        }
    }
    if (value.type === 'chatML') {
        return {
            type: 'chatML',
            name,
            text: typeof value.text === 'string' ? value.text : '',
        }
    }
    if (value.type === 'chat') {
        let rangeStart = finiteNumber(value.rangeStart, -1000)
        if (value.selection === 'last-user') {
            rangeStart = -1
        }
        else if (value.selection === 'all') {
            rangeStart = -1000
        }
        return {
            type: 'chat',
            name,
            rangeStart,
            rangeEnd: value.rangeEnd === 'end' ? 'end' : finiteNumber(value.rangeEnd, 0),
            chatAsOriginalOnSystem: value.chatAsOriginalOnSystem === true || undefined,
        }
    }
    if (value.type === 'cache') {
        const role = value.role === 'user'
            || value.role === 'assistant'
            || value.role === 'system'
            ? value.role
            : 'all'
        return {
            type: 'cache',
            name: name ?? '',
            depth: finiteNumber(value.depth, 1),
            role,
        }
    }
    if (
        value.type === 'persona'
        || value.type === 'description'
        || value.type === 'lorebook'
        || value.type === 'postEverything'
        || value.type === 'memory'
    ) {
        return {
            type: value.type,
            name,
            innerFormat: typeof value.innerFormat === 'string' ? value.innerFormat : undefined,
            role2: value.role2 === undefined || value.role2 === null
                ? undefined
                : normalizePromptRole(value.role2),
        }
    }
    if (value.type === 'authornote') {
        return {
            type: 'authornote',
            name,
            innerFormat: typeof value.innerFormat === 'string' ? value.innerFormat : undefined,
            defaultText: typeof value.defaultText === 'string' ? value.defaultText : undefined,
            role2: value.role2 === undefined || value.role2 === null
                ? undefined
                : normalizePromptRole(value.role2),
        }
    }
    return undefined
}

function normalizeSubAgentConfig(value: unknown, baseTemplate?: PromptItem[]): SubAgentConfig {
    const defaults = createDefaultSubAgentConfig()
    const config = isRecord(value) ? value : {}
    const contextMode = config.contextMode === 'last-message' || config.contextMode === 'upstream-only'
        ? config.contextMode
        : 'full-prompt'
    const modelMode = config.modelMode === 'otherAx' ? 'otherAx' : 'submodel'
    const onError = config.onError === 'empty' || config.onError === 'passthrough'
        ? config.onError
        : 'abort'
    const inputTemplate = typeof config.inputTemplate === 'string'
        ? config.inputTemplate
        : defaults.inputTemplate
    const hasLegacyPromptConfiguration = typeof config.contextMode === 'string'
        || typeof config.inputTemplate === 'string'
    const promptTemplate = Array.isArray(config.promptTemplate)
        ? config.promptTemplate
            .map(normalizePromptBlock)
            .filter((block): block is PromptItem => Boolean(block))
        : createDefaultSubAgentPromptTemplate(
            contextMode,
            inputTemplate,
            hasLegacyPromptConfiguration ? undefined : baseTemplate,
        )

    return {
        instruction: typeof config.instruction === 'string' ? config.instruction : defaults.instruction,
        promptTemplate,
        contextMode,
        inputTemplate,
        modelMode,
        staticModel: typeof config.staticModel === 'string' ? config.staticModel : undefined,
        maxTokens: finiteNumber(config.maxTokens, defaults.maxTokens),
        temperature: config.temperature === undefined
            ? defaults.temperature
            : finiteNumber(config.temperature, defaults.temperature ?? 0.7),
        onError,
        timeoutMs: config.timeoutMs === undefined
            ? defaults.timeoutMs
            : finiteNumber(config.timeoutMs, defaults.timeoutMs ?? 120000),
    }
}

function normalizeNode(value: unknown, index: number, baseTemplate?: PromptItem[]): AgentGraphNode | undefined {
    if (!isRecord(value)) {
        return undefined
    }

    const type = value.type
    if (type !== 'prompt-input' && type !== 'sub-agent' && type !== 'main-model' && type !== 'final-output') {
        return undefined
    }

    const base = {
        id: typeof value.id === 'string' ? value.id : '',
        name: typeof value.name === 'string' ? value.name : type,
        position: normalizePosition(value.position, index),
    }

    if (type === 'sub-agent') {
        return {
            ...base,
            type,
            condition: typeof value.condition === 'string' ? value.condition : undefined,
            onConditionFalse: value.onConditionFalse === 'empty' ? 'empty' : 'bypass',
            config: normalizeSubAgentConfig(value.config, baseTemplate),
        }
    }

    return { ...base, type }
}

function normalizeEdge(value: unknown): AgentGraphEdge | undefined {
    if (!isRecord(value)) {
        return undefined
    }

    return {
        id: typeof value.id === 'string' ? value.id : '',
        source: typeof value.source === 'string' ? value.source : '',
        sourcePort: typeof value.sourcePort === 'string' ? value.sourcePort : undefined,
        target: typeof value.target === 'string' ? value.target : '',
        targetPort: typeof value.targetPort === 'string' ? value.targetPort : '',
        order: finiteNumber(value.order, 0),
        condition: typeof value.condition === 'string' ? value.condition : undefined,
    }
}

export function normalizeAgentGraph(value: unknown, baseTemplate?: PromptItem[]): AgentGraph {
    if (!isRecord(value)) {
        return createDefaultAgentGraph()
    }
    if (value.version !== undefined && value.version !== AGENT_GRAPH_VERSION) {
        return createDefaultAgentGraph()
    }

    return {
        version: AGENT_GRAPH_VERSION,
        enabled: value.enabled === true,
        nodes: Array.isArray(value.nodes)
            ? value.nodes
                .map((node, index) => normalizeNode(node, index, baseTemplate))
                .filter((node): node is AgentGraphNode => Boolean(node))
            : [],
        edges: Array.isArray(value.edges)
            ? value.edges.map(normalizeEdge).filter((edge): edge is AgentGraphEdge => Boolean(edge))
            : [],
    }
}

function addIssue(
    errors: AgentGraphValidationIssue[],
    code: AgentGraphValidationErrorCode,
    message: string,
    details: Pick<AgentGraphValidationIssue, 'nodeId' | 'edgeId'> = {},
) {
    errors.push({ code, message, ...details })
}

function visitReachable(start: string, adjacency: Map<string, string[]>, skipNode?: string): Set<string> {
    const visited = new Set<string>()
    const stack = [start]

    while (stack.length > 0) {
        const nodeId = stack.pop() as string
        if (nodeId === skipNode || visited.has(nodeId)) {
            continue
        }
        visited.add(nodeId)
        for (const next of adjacency.get(nodeId) ?? []) {
            if (next !== skipNode && !visited.has(next)) {
                stack.push(next)
            }
        }
    }

    return visited
}

export function validateAgentGraph(graph: AgentGraph): AgentGraphValidationResult {
    const errors: AgentGraphValidationIssue[] = []
    if (graph.version !== AGENT_GRAPH_VERSION) {
        addIssue(errors, 'unsupported-version', `Unsupported agent graph version: ${graph.version}`)
    }

    const nodesById = new Map<string, AgentGraphNode>()
    for (const node of graph.nodes) {
        if (!node.id.trim()) {
            addIssue(errors, 'invalid-node-id', 'Every graph node must have a non-empty ID.', { nodeId: node.id })
        }
        if (nodesById.has(node.id)) {
            addIssue(errors, 'duplicate-node-id', `Duplicate graph node ID: ${node.id}`, { nodeId: node.id })
        }
        else {
            nodesById.set(node.id, node)
        }
        if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) {
            addIssue(errors, 'invalid-node-position', `Node "${node.name}" has an invalid position.`, { nodeId: node.id })
        }
        if (node.type === 'sub-agent') {
            if (!Array.isArray(node.config.promptTemplate) || !node.config.promptTemplate.some((block) => block.type !== 'cache')) {
                addIssue(errors, 'invalid-node-config', `Sub-agent "${node.name}" needs at least one message-producing prompt block.`, { nodeId: node.id })
            }
            for (const block of node.config.promptTemplate ?? []) {
                if (
                    (block.type === 'plain' || block.type === 'jailbreak' || block.type === 'cot')
                    && !['system', 'user', 'bot'].includes(block.role)
                ) {
                    addIssue(errors, 'invalid-node-config', `Sub-agent "${node.name}" has a plain prompt with an invalid role.`, { nodeId: node.id })
                }
                if (block.type === 'chat' && (
                    !Number.isFinite(block.rangeStart)
                    || (block.rangeEnd !== 'end' && !Number.isFinite(block.rangeEnd))
                )) {
                    addIssue(errors, 'invalid-node-config', `Sub-agent "${node.name}" has an invalid prompt message range.`, { nodeId: node.id })
                }
                if (block.type === 'cache' && (!Number.isFinite(block.depth) || block.depth <= 0)) {
                    addIssue(errors, 'invalid-node-config', `Sub-agent "${node.name}" cache depth must be positive.`, { nodeId: node.id })
                }
            }
            if (!Number.isFinite(node.config.maxTokens) || node.config.maxTokens <= 0) {
                addIssue(errors, 'invalid-node-config', `Sub-agent "${node.name}" must use a positive max token count.`, { nodeId: node.id })
            }
            if (node.config.temperature !== undefined && !Number.isFinite(node.config.temperature)) {
                addIssue(errors, 'invalid-node-config', `Sub-agent "${node.name}" has an invalid temperature.`, { nodeId: node.id })
            }
            if (node.config.timeoutMs !== undefined && (!Number.isFinite(node.config.timeoutMs) || node.config.timeoutMs <= 0)) {
                addIssue(errors, 'invalid-node-config', `Sub-agent "${node.name}" must use a positive timeout.`, { nodeId: node.id })
            }
        }
    }

    const specialNodes = {
        prompt: graph.nodes.filter((node) => node.type === 'prompt-input'),
        main: graph.nodes.filter((node) => node.type === 'main-model'),
        output: graph.nodes.filter((node) => node.type === 'final-output'),
    }
    for (const [name, nodes] of Object.entries(specialNodes)) {
        if (nodes.length !== 1) {
            addIssue(errors, 'special-node-count', `Agent graph must contain exactly one ${name} node; found ${nodes.length}.`)
        }
    }

    const edgeIds = new Set<string>()
    const edgeKeys = new Set<string>()
    const targetOrders = new Set<string>()
    const validEdges: AgentGraphEdge[] = []

    for (const edge of graph.edges) {
        if (!edge.id.trim()) {
            addIssue(errors, 'invalid-edge-id', 'Every graph edge must have a non-empty ID.', { edgeId: edge.id })
        }
        if (edgeIds.has(edge.id)) {
            addIssue(errors, 'duplicate-edge-id', `Duplicate graph edge ID: ${edge.id}`, { edgeId: edge.id })
        }
        edgeIds.add(edge.id)

        const source = nodesById.get(edge.source)
        const target = nodesById.get(edge.target)
        if (!source || !target) {
            addIssue(errors, 'missing-edge-node', `Edge "${edge.id}" references a node that does not exist.`, { edgeId: edge.id })
            continue
        }
        validEdges.push(edge)

        const edgeKey = `${edge.source}\u0000${edge.sourcePort ?? ''}\u0000${edge.target}\u0000${edge.targetPort}`
        if (edgeKeys.has(edgeKey)) {
            addIssue(errors, 'duplicate-edge', `Duplicate connection from "${source.name}" to "${target.name}".`, { edgeId: edge.id })
        }
        edgeKeys.add(edgeKey)

        if (!Number.isInteger(edge.order) || edge.order < 0) {
            addIssue(errors, 'invalid-edge-order', `Edge "${edge.id}" must have a non-negative integer order.`, { edgeId: edge.id })
        }
        const orderKey = `${edge.target}\u0000${edge.order}`
        if (targetOrders.has(orderKey)) {
            addIssue(errors, 'duplicate-edge-order', `Incoming edges for "${target.name}" cannot share order ${edge.order}.`, { edgeId: edge.id })
        }
        targetOrders.add(orderKey)

        if (!edge.targetPort.trim()) {
            addIssue(errors, 'invalid-edge-port', `Edge "${edge.id}" must specify a target port.`, { edgeId: edge.id })
        }
        if (edge.condition?.trim()) {
            addIssue(errors, 'unsupported-edge-condition', `Edge conditions are not supported yet (edge "${edge.id}").`, { edgeId: edge.id })
        }
        if (source.type === 'final-output' || target.type === 'prompt-input') {
            addIssue(errors, 'invalid-special-edge', `Edge "${edge.id}" points in an invalid direction for a special node.`, { edgeId: edge.id })
        }
    }

    const adjacency = new Map<string, string[]>()
    const reverseAdjacency = new Map<string, string[]>()
    const indegree = new Map<string, number>()
    for (const nodeId of nodesById.keys()) {
        adjacency.set(nodeId, [])
        reverseAdjacency.set(nodeId, [])
        indegree.set(nodeId, 0)
    }
    for (const edge of validEdges) {
        adjacency.get(edge.source)?.push(edge.target)
        reverseAdjacency.get(edge.target)?.push(edge.source)
        indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
    }

    const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id)
    let visitedCount = 0
    while (queue.length > 0) {
        const nodeId = queue.shift() as string
        visitedCount++
        for (const target of adjacency.get(nodeId) ?? []) {
            const nextDegree = (indegree.get(target) ?? 0) - 1
            indegree.set(target, nextDegree)
            if (nextDegree === 0) {
                queue.push(target)
            }
        }
    }
    if (visitedCount !== nodesById.size) {
        addIssue(errors, 'cycle', 'Agent graph contains a cycle.')
    }

    if (specialNodes.prompt.length === 1 && specialNodes.output.length === 1) {
        const promptId = specialNodes.prompt[0].id
        const outputId = specialNodes.output[0].id
        const reachable = visitReachable(promptId, adjacency)
        const canReachOutput = visitReachable(outputId, reverseAdjacency)

        for (const node of graph.nodes) {
            if (!reachable.has(node.id)) {
                addIssue(errors, 'unreachable-node', `Node "${node.name}" is not reachable from Prompt.`, { nodeId: node.id })
            }
            if (!canReachOutput.has(node.id)) {
                addIssue(errors, 'dead-end-node', `Node "${node.name}" cannot reach Output.`, { nodeId: node.id })
            }
        }

        if (specialNodes.main.length === 1) {
            const withoutMain = visitReachable(promptId, adjacency, specialNodes.main[0].id)
            if (withoutMain.has(outputId)) {
                addIssue(errors, 'main-model-bypass', 'Every Prompt-to-Output path must pass through Main Model.')
            }
        }
    }

    return { ok: errors.length === 0, errors }
}

function sortedIncomingEdges(graph: AgentGraph, nodeId: string): AgentGraphEdge[] {
    return graph.edges
        .filter((edge) => edge.target === nodeId)
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}

function escapeAttribute(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
}

export function formatNamedNodeInputs(inputs: NodeInputValue[]): string {
    if (inputs.length === 0) {
        return ''
    }
    if (inputs.length === 1) {
        return inputs[0].text
    }
    return inputs.map((input) => {
        const name = input.targetPort || input.sourceNodeName || input.sourceNodeId
        return `<subagent-output name="${escapeAttribute(name)}">\n${input.text}\n</subagent-output>`
    }).join('\n\n')
}

export function formatAgentGraphGuidance(graph: AgentGraph, inputs: NodeInputValue[]): string {
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
    const guidanceInputs = inputs.filter((input) => nodesById.get(input.sourceNodeId)?.type !== 'prompt-input')
    if (guidanceInputs.length === 0) {
        return ''
    }

    const body = guidanceInputs.map((input) => {
        const name = input.targetPort || input.sourceNodeName || input.sourceNodeId
        return `<subagent-output name="${escapeAttribute(name)}">\n${input.text}\n</subagent-output>`
    }).join('\n\n')
    return `<subagent-guidance>\n${body}\n</subagent-guidance>`
}

export function summarizeAgentGraphTrace(
    graph: AgentGraph,
    trace: GraphNodeResult[],
    previewLength = 600,
): AgentGraphTraceEntry[] {
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
    return trace.map((result) => {
        const { text, ...entry } = result
        const node = nodesById.get(result.nodeId)
        const namedEntry = { ...entry, nodeName: node?.name }
        if (node?.type !== 'sub-agent' || !text) {
            return namedEntry
        }
        return {
            ...namedEntry,
            outputPreview: text.length > previewLength ? `${text.slice(0, previewLength)}…` : text,
        }
    })
}

function replaceTemplateValue(template: string, pattern: RegExp, value: string): string {
    return template.replace(pattern, () => value)
}

export function renderSubAgentPromptText(
    node: SubAgentNode,
    template: string,
    inputs: NodeInputValue[],
    context: SubAgentTemplateContext,
): string {
    const byPort = new Map<string, string[]>()
    for (const input of inputs) {
        const values = byPort.get(input.targetPort) ?? []
        values.push(input.text)
        byPort.set(input.targetPort, values)
    }

    let result = template
    result = result.replace(/{{\s*upstream\.([^{}\s]+)\s*}}/g, (_match, port: string) => {
        return (byPort.get(port) ?? []).join('\n\n')
    })
    result = replaceTemplateValue(result, /{{\s*instruction\s*}}/g, context.instruction ?? node.config.instruction)
    result = replaceTemplateValue(result, /{{\s*upstream\s*}}/g, formatNamedNodeInputs(inputs))
    result = replaceTemplateValue(result, /{{\s*originalPrompt\s*}}/g, context.originalPrompt)
    result = replaceTemplateValue(result, /{{\s*lastUserMessage\s*}}/g, context.lastUserMessage)
    result = replaceTemplateValue(result, /{{\s*mainModelOutput\s*}}/g, context.mainModelOutput ?? '')
    return result
}

export function renderSubAgentInputTemplate(
    node: SubAgentNode,
    inputs: NodeInputValue[],
    context: SubAgentTemplateContext,
): string {
    return renderSubAgentPromptText(
        node,
        node.config.inputTemplate || DEFAULT_SUB_AGENT_INPUT_TEMPLATE,
        inputs,
        context,
    )
}

function normalizeModelResult(value: string | GraphModelExecutionResult): GraphModelExecutionResult {
    return typeof value === 'string' ? { text: value } : value
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message
    }
    return String(error)
}

function abortError(): DOMException {
    return new DOMException('Aborted', 'AbortError')
}

function throwIfAborted(signal: AbortSignal) {
    if (signal.aborted) {
        throw abortError()
    }
}

async function awaitWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
        throw signal.reason instanceof Error ? signal.reason : abortError()
    }

    let onAbort: (() => void) | undefined
    const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason instanceof Error ? signal.reason : abortError())
        signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
        return await Promise.race([operation, aborted])
    }
    finally {
        if (onAbort) {
            signal.removeEventListener('abort', onAbort)
        }
    }
}

function createNodeSignal(parent: AbortSignal, timeoutMs?: number) {
    const controller = new AbortController()
    let timedOut = false
    const onAbort = () => controller.abort(parent.reason)
    parent.addEventListener('abort', onAbort, { once: true })
    const timer = timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true
            controller.abort(new DOMException('Timed out', 'TimeoutError'))
        }, timeoutMs)

    if (parent.aborted) {
        onAbort()
    }

    return {
        signal: controller.signal,
        didTimeOut: () => timedOut,
        abort: (reason?: unknown) => controller.abort(reason),
        cleanup: () => {
            parent.removeEventListener('abort', onAbort)
            if (timer !== undefined) {
                clearTimeout(timer)
            }
        },
    }
}

export class AgentGraphSession {
    readonly graph: AgentGraph
    readonly context: AgentGraphExecutionContext
    private readonly pending: Set<string>
    private readonly completed = new Map<string, GraphNodeResult>()
    private readonly trace: GraphNodeResult[] = []
    private mainInputs: NodeInputValue[] | undefined
    private mainStartedAt: number | undefined
    private mainModelOutput = ''
    private prepared = false
    private finished = false

    constructor(graph: AgentGraph, context: AgentGraphExecutionContext) {
        const validation = validateAgentGraph(graph)
        if (!validation.ok) {
            throw new AgentGraphValidationError(validation.errors)
        }
        this.graph = graph
        this.context = context
        this.pending = new Set(graph.nodes.map((node) => node.id))
    }

    private collectNodeInputs(nodeId: string): NodeInputValue[] {
        const nodesById = new Map(this.graph.nodes.map((node) => [node.id, node]))
        return sortedIncomingEdges(this.graph, nodeId).map((edge) => {
            const sourceResult = this.completed.get(edge.source)
            const sourceNode = nodesById.get(edge.source)
            if (!sourceResult || !sourceNode) {
                throw new Error(`Unresolved graph input from ${edge.source} to ${nodeId}`)
            }
            return {
                sourceNodeId: sourceNode.id,
                sourceNodeName: sourceNode.name,
                targetPort: edge.targetPort,
                text: sourceResult.text,
            }
        })
    }

    private recordResult(result: GraphNodeResult) {
        this.completed.set(result.nodeId, result)
        this.pending.delete(result.nodeId)
        this.trace.push(result)
    }

    private async executeSubAgentNode(
        node: SubAgentNode,
        inputs: NodeInputValue[],
        executionSignal: AbortSignal,
    ): Promise<GraphNodeResult> {
        throwIfAborted(executionSignal)
        const startedAt = Date.now()
        let conditionPassed = true

        try {
            if (node.condition?.trim() && this.context.evaluateCondition) {
                conditionPassed = await this.context.evaluateCondition(node.condition, node)
            }

            if (!conditionPassed) {
                const finishedAt = Date.now()
                return {
                    nodeId: node.id,
                    status: 'skipped',
                    text: (node.onConditionFalse ?? 'bypass') === 'bypass' ? formatNamedNodeInputs(inputs) : '',
                    startedAt,
                    finishedAt,
                    durationMs: finishedAt - startedAt,
                    condition: node.condition,
                    conditionPassed: false,
                    skippedReason: 'condition-false',
                }
            }

            const promptNode = this.graph.nodes.find((entry) => entry.type === 'prompt-input') as PromptInputNode
            let hasPromptInput = false
            const contextualInputs = inputs.flatMap((input): NodeInputValue[] => {
                if (input.sourceNodeId !== promptNode.id) {
                    return [input]
                }
                hasPromptInput = true
                if (this.context.promptContextMode === 'messages') {
                    return []
                }
                if (node.config.contextMode === 'upstream-only') {
                    return []
                }
                if (node.config.contextMode === 'last-message') {
                    return [{ ...input, text: this.context.lastUserMessage }]
                }
                return [input]
            })
            if (
                this.context.promptContextMode !== 'messages'
                && !hasPromptInput
                && node.config.contextMode !== 'upstream-only'
            ) {
                contextualInputs.unshift({
                    sourceNodeId: promptNode.id,
                    sourceNodeName: promptNode.name,
                    targetPort: 'context',
                    text: node.config.contextMode === 'last-message'
                        ? this.context.lastUserMessage
                        : this.context.originalPrompt,
                })
            }
            const templateContext: SubAgentTemplateContext = {
                originalPrompt: this.context.originalPrompt,
                lastUserMessage: this.context.lastUserMessage,
                mainModelOutput: this.mainModelOutput,
            }
            const prompt = renderSubAgentInputTemplate(node, contextualInputs, templateContext)
            const nodeSignal = createNodeSignal(executionSignal, node.config.timeoutMs)
            try {
                const response = normalizeModelResult(await awaitWithSignal(
                    this.context.executeSubAgent(node, prompt, contextualInputs, nodeSignal.signal, templateContext),
                    nodeSignal.signal,
                ))
                throwIfAborted(executionSignal)
                if (nodeSignal.didTimeOut()) {
                    throw new Error(`Timed out after ${node.config.timeoutMs}ms`)
                }
                const finishedAt = Date.now()
                return {
                    nodeId: node.id,
                    status: 'success',
                    text: response.text,
                    startedAt,
                    finishedAt,
                    durationMs: finishedAt - startedAt,
                    model: response.model,
                    inputTokens: response.inputTokens,
                    outputTokens: response.outputTokens,
                    condition: node.condition,
                    conditionPassed,
                }
            }
            catch (error) {
                if (this.context.signal.aborted || (executionSignal.aborted && !nodeSignal.didTimeOut())) {
                    throw abortError()
                }
                const message = nodeSignal.didTimeOut()
                    ? `Timed out after ${node.config.timeoutMs}ms`
                    : errorMessage(error)
                const finishedAt = Date.now()
                const result: GraphNodeResult = {
                    nodeId: node.id,
                    status: 'failed',
                    text: node.config.onError === 'passthrough' ? formatNamedNodeInputs(inputs) : '',
                    startedAt,
                    finishedAt,
                    durationMs: finishedAt - startedAt,
                    condition: node.condition,
                    conditionPassed,
                    error: message,
                }
                if (node.config.onError === 'abort') {
                    throw new AgentGraphNodeExecutionError(node, result, error)
                }
                return result
            }
            finally {
                nodeSignal.cleanup()
            }
        }
        catch (error) {
            if (error instanceof AgentGraphNodeExecutionError || (error instanceof DOMException && error.name === 'AbortError')) {
                throw error
            }
            const finishedAt = Date.now()
            const result: GraphNodeResult = {
                nodeId: node.id,
                status: 'failed',
                text: node.config.onError === 'passthrough' ? formatNamedNodeInputs(inputs) : '',
                startedAt,
                finishedAt,
                durationMs: finishedAt - startedAt,
                condition: node.condition,
                conditionPassed,
                error: errorMessage(error),
            }
            if (node.config.onError === 'abort') {
                throw new AgentGraphNodeExecutionError(node, result, error)
            }
            return result
        }
    }

    private async executeNode(node: AgentGraphNode, executionSignal: AbortSignal): Promise<GraphNodeResult> {
        const inputs = this.collectNodeInputs(node.id)
        const startedAt = Date.now()

        if (node.type === 'prompt-input') {
            const finishedAt = Date.now()
            return {
                nodeId: node.id,
                status: 'success',
                text: this.context.originalPrompt,
                startedAt,
                finishedAt,
                durationMs: finishedAt - startedAt,
            }
        }
        if (node.type === 'sub-agent') {
            return this.executeSubAgentNode(node, inputs, executionSignal)
        }
        if (node.type === 'final-output') {
            const finishedAt = Date.now()
            return {
                nodeId: node.id,
                status: 'success',
                text: formatNamedNodeInputs(inputs),
                startedAt,
                finishedAt,
                durationMs: finishedAt - startedAt,
            }
        }
        throw new Error('Main Model must be completed through completeMain().')
    }

    private async executeLayer(nodes: AgentGraphNode[]): Promise<GraphNodeResult[]> {
        const layerSignal = createNodeSignal(this.context.signal)
        try {
            return await Promise.all(nodes.map(async (node) => {
                try {
                    return await this.executeNode(node, layerSignal.signal)
                }
                catch (error) {
                    layerSignal.abort(error)
                    throw error
                }
            }))
        }
        finally {
            layerSignal.cleanup()
        }
    }

    private readyNodes(): AgentGraphNode[] {
        return this.graph.nodes.filter((node) => {
            if (!this.pending.has(node.id)) {
                return false
            }
            return sortedIncomingEdges(this.graph, node.id).every((edge) => this.completed.has(edge.source))
        })
    }

    async prepareMain(): Promise<NodeInputValue[]> {
        if (this.prepared) {
            return this.mainInputs ?? []
        }
        const mainNode = this.graph.nodes.find((node): node is MainModelNode => node.type === 'main-model') as MainModelNode

        while (this.pending.has(mainNode.id)) {
            throwIfAborted(this.context.signal)
            const ready = this.readyNodes()
            const executable = ready.filter((node) => node.type !== 'main-model')

            if (ready.some((node) => node.id === mainNode.id) && executable.length === 0) {
                this.mainInputs = this.collectNodeInputs(mainNode.id)
                this.prepared = true
                return this.mainInputs
            }
            if (executable.length === 0) {
                throw new Error('Agent graph contains an unresolved dependency before Main Model.')
            }

            const results = await this.executeLayer(executable)
            for (const result of results) {
                this.recordResult(result)
            }
        }

        throw new Error('Main Model was completed before prepareMain().')
    }

    markMainStarted() {
        if (!this.prepared) {
            throw new Error('Main Model cannot start before prepareMain().')
        }
        this.mainStartedAt ??= Date.now()
    }

    async completeMain(
        value: string | GraphModelExecutionResult,
    ): Promise<AgentGraphExecutionResult> {
        if (this.finished) {
            throw new Error('Agent graph session is already complete.')
        }
        if (!this.prepared) {
            await this.prepareMain()
        }
        throwIfAborted(this.context.signal)

        const mainNode = this.graph.nodes.find((node): node is MainModelNode => node.type === 'main-model') as MainModelNode
        const response = normalizeModelResult(value)
        const finishedAt = Date.now()
        this.mainModelOutput = response.text
        this.recordResult({
            nodeId: mainNode.id,
            status: 'success',
            text: response.text,
            startedAt: this.mainStartedAt ?? finishedAt,
            finishedAt,
            durationMs: finishedAt - (this.mainStartedAt ?? finishedAt),
            model: response.model,
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
        })

        while (this.pending.size > 0) {
            throwIfAborted(this.context.signal)
            const ready = this.readyNodes()
            if (ready.length === 0) {
                throw new Error('Agent graph contains an unresolved dependency after Main Model.')
            }
            const results = await this.executeLayer(ready)
            for (const result of results) {
                this.recordResult(result)
            }
        }

        const finalNode = this.graph.nodes.find((node): node is FinalOutputNode => node.type === 'final-output') as FinalOutputNode
        const output = this.completed.get(finalNode.id)?.text
        if (output === undefined) {
            throw new Error('Agent graph did not produce a Final Output value.')
        }
        this.finished = true
        return {
            output,
            trace: [...this.trace],
        }
    }
}

export async function executeAgentGraph(
    graph: AgentGraph,
    context: FullAgentGraphExecutionContext,
): Promise<AgentGraphExecutionResult> {
    const session = new AgentGraphSession(graph, context)
    const inputs = await session.prepareMain()
    session.markMainStarted()
    const mainResult = await context.executeMainModel(inputs, context.signal)
    return session.completeMain(mainResult)
}
