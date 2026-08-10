// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import {
    AgentGraphNodeExecutionError,
    createDefaultAgentGraph,
    createDefaultSubAgentConfig,
    executeAgentGraph,
    normalizeAgentGraph,
    renderSubAgentInputTemplate,
    summarizeAgentGraphTrace,
    validateAgentGraph,
    type AgentGraph,
    type AgentGraphNode,
    type SubAgentNode,
} from './agentGraph'
import {
    buildSubAgentRequestMessages,
    type SubAgentPromptSources,
} from './agentGraphMessages'

function node(
    id: string,
    type: AgentGraphNode['type'],
    x: number,
): AgentGraphNode {
    const base = { id, name: id, type, position: { x, y: 0 } }
    if (type === 'sub-agent') {
        return {
            ...base,
            type,
            config: createDefaultSubAgentConfig(),
        }
    }
    return base as AgentGraphNode
}

function graph(nodes: AgentGraphNode[], connections: Array<[string, string, string?]>): AgentGraph {
    const incomingOrders = new Map<string, number>()
    return {
        version: 1,
        enabled: true,
        nodes,
        edges: connections.map(([source, target, port], index) => {
            const order = incomingOrders.get(target) ?? 0
            incomingOrders.set(target, order + 1)
            return {
                id: `edge-${index}`,
                source,
                target,
                targetPort: port ?? `input-${order}`,
                order,
            }
        }),
    }
}

const neverAborted = new AbortController().signal

function promptSources(
    chats: SubAgentPromptSources['chats'] = [],
    overrides: Partial<SubAgentPromptSources> = {},
): SubAgentPromptSources {
    return {
        chats,
        personaPrompt: [],
        description: [],
        authorNote: [],
        lorebook: [],
        memory: [],
        postEverything: [],
        sendChatAsSystem: false,
        automaticCachePoint: false,
        mergeAdjacentSystemMessages: false,
        jailbreakEnabled: true,
        chainOfThoughtEnabled: true,
        parsePromptText: (text) => text,
        ...overrides,
    }
}

describe('agent graph validation', () => {
    test('accepts the disabled default graph', () => {
        expect(validateAgentGraph(createDefaultAgentGraph())).toEqual({ ok: true, errors: [] })
    })

    test('reports cycles', () => {
        const value = graph(
            [
                node('prompt', 'prompt-input', 0),
                node('agent', 'sub-agent', 1),
                node('main', 'main-model', 2),
                node('output', 'final-output', 3),
            ],
            [
                ['prompt', 'agent'],
                ['agent', 'main'],
                ['main', 'agent'],
                ['main', 'output'],
            ],
        )

        const codes = validateAgentGraph(value).errors.map((issue) => issue.code)
        expect(codes).toContain('cycle')
    })

    test('rejects a path that bypasses Main Model', () => {
        const value = graph(
            [
                node('prompt', 'prompt-input', 0),
                node('main', 'main-model', 1),
                node('output', 'final-output', 2),
            ],
            [
                ['prompt', 'main'],
                ['main', 'output'],
                ['prompt', 'output'],
            ],
        )

        expect(validateAgentGraph(value).errors.map((issue) => issue.code)).toContain('main-model-bypass')
    })

    test('rejects duplicate incoming edge orders', () => {
        const value = createDefaultAgentGraph()
        value.edges.push({
            id: 'second-prompt-edge',
            source: 'prompt-input',
            target: 'main-model',
            targetPort: 'other',
            order: 0,
        })
        expect(validateAgentGraph(value).errors.map((issue) => issue.code)).toContain('duplicate-edge-order')
    })

    test('rejects stored edge conditions until conditional routing is implemented', () => {
        const value = createDefaultAgentGraph()
        value.edges[0].condition = '{{condition}}'
        expect(validateAgentGraph(value).errors.map((issue) => issue.code)).toContain('unsupported-edge-condition')
    })
})

describe('agent graph execution', () => {
    test('runs independent agents in parallel and preserves edge order', async () => {
        const value = graph(
            [
                node('prompt', 'prompt-input', 0),
                node('agent-a', 'sub-agent', 1),
                node('agent-b', 'sub-agent', 1),
                node('main', 'main-model', 2),
                node('output', 'final-output', 3),
            ],
            [
                ['prompt', 'agent-a'],
                ['prompt', 'agent-b'],
                ['agent-a', 'main', 'analysis'],
                ['agent-b', 'main', 'style'],
                ['main', 'output'],
            ],
        )
        let active = 0
        let maxActive = 0
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const mainInputs: string[] = []

        const execution = executeAgentGraph(value, {
            originalPrompt: 'full prompt',
            lastUserMessage: 'last message',
            signal: neverAborted,
            executeSubAgent: async (agent) => {
                active++
                maxActive = Math.max(maxActive, active)
                await gate
                active--
                return agent.id.toUpperCase()
            },
            executeMainModel: async (inputs) => {
                mainInputs.push(...inputs.map((input) => `${input.targetPort}:${input.text}`))
                return 'main output'
            },
        })

        await vi.waitFor(() => expect(maxActive).toBe(2))
        release()
        const result = await execution

        expect(mainInputs).toEqual(['analysis:AGENT-A', 'style:AGENT-B'])
        expect(result.output).toBe('main output')
        expect(result.trace.map((entry) => entry.nodeId)).toEqual([
            'prompt',
            'agent-a',
            'agent-b',
            'main',
            'output',
        ])
    })

    test('supports serial pre-processing and post-processing', async () => {
        const preA = node('pre-a', 'sub-agent', 1) as SubAgentNode
        const preB = node('pre-b', 'sub-agent', 2) as SubAgentNode
        const post = node('post', 'sub-agent', 4) as SubAgentNode
        preB.config.contextMode = 'upstream-only'
        post.config.contextMode = 'upstream-only'
        const value = graph(
            [
                node('prompt', 'prompt-input', 0),
                preA,
                preB,
                node('main', 'main-model', 3),
                post,
                node('output', 'final-output', 5),
            ],
            [
                ['prompt', 'pre-a'],
                ['pre-a', 'pre-b'],
                ['pre-b', 'main'],
                ['main', 'post'],
                ['post', 'output'],
            ],
        )
        const seen: string[] = []

        const result = await executeAgentGraph(value, {
            originalPrompt: 'ORIGINAL',
            lastUserMessage: 'LAST',
            signal: neverAborted,
            executeSubAgent: async (agent, _prompt, inputs) => {
                const input = inputs.map((entry) => entry.text).join('|')
                seen.push(`${agent.id}:${input}`)
                return `${agent.id}(${input})`
            },
            executeMainModel: async (inputs) => `main(${inputs[0].text})`,
        })

        expect(seen).toEqual([
            'pre-a:ORIGINAL',
            'pre-b:pre-a(ORIGINAL)',
            'post:main(pre-b(pre-a(ORIGINAL)))',
        ])
        expect(result.output).toBe('post(main(pre-b(pre-a(ORIGINAL))))')
    })

    test('adds the selected conversation context to agents without a direct Prompt edge', async () => {
        const post = node('post', 'sub-agent', 2) as SubAgentNode
        const value = graph(
            [node('prompt', 'prompt-input', 0), node('main', 'main-model', 1), post, node('output', 'final-output', 3)],
            [['prompt', 'main'], ['main', 'post'], ['post', 'output']],
        )
        const seen: string[][] = []

        for (const mode of ['full-prompt', 'last-message', 'upstream-only'] as const) {
            post.config.contextMode = mode
            await executeAgentGraph(value, {
                originalPrompt: 'ORIGINAL',
                lastUserMessage: 'LAST',
                signal: neverAborted,
                executeSubAgent: async (_node, _prompt, inputs) => {
                    seen.push(inputs.map((input) => input.text))
                    return 'post output'
                },
                executeMainModel: async () => 'MAIN',
            })
        }

        expect(seen).toEqual([
            ['ORIGINAL', 'MAIN'],
            ['LAST', 'MAIN'],
            ['MAIN'],
        ])
    })

    test('uses the configured context mode for Prompt inputs', async () => {
        const agent = node('agent', 'sub-agent', 1) as SubAgentNode
        const value = graph(
            [node('prompt', 'prompt-input', 0), agent, node('main', 'main-model', 2), node('output', 'final-output', 3)],
            [['prompt', 'agent'], ['agent', 'main'], ['main', 'output']],
        )
        const seen: string[][] = []

        for (const mode of ['full-prompt', 'last-message', 'upstream-only'] as const) {
            agent.config.contextMode = mode
            await executeAgentGraph(value, {
                originalPrompt: 'ORIGINAL',
                lastUserMessage: 'LAST',
                signal: neverAborted,
                executeSubAgent: async (_node, _prompt, inputs) => {
                    seen.push(inputs.map((input) => input.text))
                    return 'agent output'
                },
                executeMainModel: async () => 'main',
            })
        }

        expect(seen).toEqual([['ORIGINAL'], ['LAST'], []])
    })

    test('does not flatten Prompt input when the host sends role-preserved context messages', async () => {
        const agent = node('agent', 'sub-agent', 1) as SubAgentNode
        agent.config.instruction = 'CHECK'
        agent.config.inputTemplate = '{{instruction}}|{{upstream}}'
        const value = graph(
            [node('prompt', 'prompt-input', 0), agent, node('main', 'main-model', 2), node('output', 'final-output', 3)],
            [['prompt', 'agent'], ['agent', 'main'], ['main', 'output']],
        )
        let renderedTask = ''
        let receivedInputs: string[] = []

        await executeAgentGraph(value, {
            originalPrompt: 'SERIALIZED CONVERSATION',
            lastUserMessage: 'LATEST USER MESSAGE',
            signal: neverAborted,
            promptContextMode: 'messages',
            executeSubAgent: async (_node, prompt, inputs) => {
                renderedTask = prompt
                receivedInputs = inputs.map((input) => input.text)
                return 'agent output'
            },
            executeMainModel: async () => 'main output',
        })

        expect(renderedTask).toBe('CHECK|')
        expect(receivedInputs).toEqual([])
    })

    test('bypasses a sub-agent when its condition is false', async () => {
        const agent = node('agent', 'sub-agent', 1) as SubAgentNode
        agent.condition = '{{condition}}'
        agent.onConditionFalse = 'bypass'
        const value = graph(
            [node('prompt', 'prompt-input', 0), agent, node('main', 'main-model', 2), node('output', 'final-output', 3)],
            [['prompt', 'agent'], ['agent', 'main'], ['main', 'output']],
        )
        const executeSubAgent = vi.fn()

        const result = await executeAgentGraph(value, {
            originalPrompt: 'ORIGINAL',
            lastUserMessage: 'LAST',
            signal: neverAborted,
            evaluateCondition: () => false,
            executeSubAgent,
            executeMainModel: async (inputs) => inputs[0].text,
        })

        expect(executeSubAgent).not.toHaveBeenCalled()
        expect(result.output).toBe('ORIGINAL')
        expect(result.trace.find((entry) => entry.nodeId === 'agent')).toMatchObject({
            status: 'skipped',
            conditionPassed: false,
        })
    })

    test('applies passthrough and abort error policies', async () => {
        const agent = node('agent', 'sub-agent', 1) as SubAgentNode
        const value = graph(
            [node('prompt', 'prompt-input', 0), agent, node('main', 'main-model', 2), node('output', 'final-output', 3)],
            [['prompt', 'agent'], ['agent', 'main'], ['main', 'output']],
        )
        const context = {
            originalPrompt: 'ORIGINAL',
            lastUserMessage: 'LAST',
            signal: neverAborted,
            executeSubAgent: async () => {
                throw new Error('request failed')
            },
            executeMainModel: async (inputs: { text: string }[]) => inputs[0].text,
        }

        agent.config.onError = 'passthrough'
        await expect(executeAgentGraph(value, context)).resolves.toMatchObject({ output: 'ORIGINAL' })

        agent.config.onError = 'abort'
        await expect(executeAgentGraph(value, context)).rejects.toBeInstanceOf(AgentGraphNodeExecutionError)
    })

    test('enforces a node timeout even when the model promise does not settle', async () => {
        const agent = node('agent', 'sub-agent', 1) as SubAgentNode
        agent.config.timeoutMs = 5
        agent.config.onError = 'empty'
        const value = graph(
            [node('prompt', 'prompt-input', 0), agent, node('main', 'main-model', 2), node('output', 'final-output', 3)],
            [['prompt', 'agent'], ['agent', 'main'], ['main', 'output']],
        )

        const result = await executeAgentGraph(value, {
            originalPrompt: 'ORIGINAL',
            lastUserMessage: 'LAST',
            signal: neverAborted,
            executeSubAgent: () => new Promise<never>(() => undefined),
            executeMainModel: async (inputs) => inputs[0].text,
        })

        expect(result.output).toBe('')
        expect(result.trace.find((entry) => entry.nodeId === 'agent')).toMatchObject({
            status: 'failed',
            error: 'Timed out after 5ms',
        })
    })

    test('propagates the parent AbortSignal into an active sub-agent request', async () => {
        const agent = node('agent', 'sub-agent', 1) as SubAgentNode
        const value = graph(
            [node('prompt', 'prompt-input', 0), agent, node('main', 'main-model', 2), node('output', 'final-output', 3)],
            [['prompt', 'agent'], ['agent', 'main'], ['main', 'output']],
        )
        const controller = new AbortController()
        let started: () => void = () => undefined
        const requestStarted = new Promise<void>((resolve) => {
            started = resolve
        })
        let requestSignal: AbortSignal | undefined

        const execution = executeAgentGraph(value, {
            originalPrompt: 'ORIGINAL',
            lastUserMessage: 'LAST',
            signal: controller.signal,
            executeSubAgent: async (_node, _prompt, _inputs, signal) => {
                requestSignal = signal
                started()
                return new Promise<never>(() => undefined)
            },
            executeMainModel: async () => 'main',
        })

        await requestStarted
        controller.abort()

        await expect(execution).rejects.toMatchObject({ name: 'AbortError' })
        expect(requestSignal?.aborted).toBe(true)
    })
})

describe('agent graph templates and migration', () => {
    test('preserves role messages and cache points before the agent-specific task', () => {
        const agent = node('agent', 'sub-agent', 0) as SubAgentNode
        agent.config.promptTemplate[1] = {
            type: 'plain',
            type2: 'normal',
            name: 'Agent task',
            role: 'user',
            text: 'AGENT TASK',
        }
        const formated = [
            { role: 'system' as const, content: 'SYSTEM' },
            { role: 'user' as const, content: 'OLD USER', cachePoint: true },
            { role: 'assistant' as const, content: 'ASSISTANT' },
            { role: 'user' as const, content: 'LATEST USER', cachePoint: true },
        ]

        const messages = buildSubAgentRequestMessages(agent, promptSources(formated), [], {
            originalPrompt: 'ORIGINAL',
            lastUserMessage: 'LATEST USER',
        })

        expect(messages.slice(0, -1)).toEqual(formated)
        expect(messages[1].cachePoint).toBe(true)
        expect(messages[3].cachePoint).toBe(true)
        expect(messages.at(-1)).toEqual({
            role: 'user',
            content: 'AGENT TASK',
            attr: ['agent-graph-prompt'],
        })
        expect(messages[0]).not.toBe(formated[0])
    })

    test('limits structured context without changing the appended agent task', () => {
        const agent = node('agent', 'sub-agent', 0) as SubAgentNode
        const formated = [
            { role: 'system' as const, content: 'SYSTEM' },
            { role: 'user' as const, content: 'FIRST USER' },
            { role: 'assistant' as const, content: 'ASSISTANT' },
            { role: 'user' as const, content: 'LATEST USER', cachePoint: true },
        ]

        agent.config.promptTemplate = [
            { type: 'chat', rangeStart: -1, rangeEnd: 'end' },
            { type: 'plain', type2: 'normal', role: 'user', text: 'TASK' },
        ]
        expect(buildSubAgentRequestMessages(agent, promptSources(formated), [], {
            originalPrompt: 'ORIGINAL',
            lastUserMessage: 'LATEST USER',
        })).toEqual([
            { role: 'user', content: 'LATEST USER', cachePoint: true },
            { role: 'user', content: 'TASK', attr: ['agent-graph-prompt'] },
        ])

        agent.config.promptTemplate = [{ type: 'plain', type2: 'normal', role: 'user', text: 'TASK' }]
        expect(buildSubAgentRequestMessages(agent, promptSources(formated), [], {
            originalPrompt: 'ORIGINAL',
            lastUserMessage: 'LATEST USER',
        })).toEqual([
            { role: 'user', content: 'TASK', attr: ['agent-graph-prompt'] },
        ])
    })

    test('processes role-aware prompt and cache blocks in their configured order', () => {
        const agent = node('agent', 'sub-agent', 0) as SubAgentNode
        agent.config.instruction = 'CHECK {{user}}'
        agent.config.promptTemplate = [
            { type: 'plain', type2: 'normal', role: 'system', text: 'RULE: {{instruction}}' },
            { type: 'chat', rangeStart: -1000, rangeEnd: 'end' },
            { type: 'cache', name: '', role: 'user', depth: 1 },
            { type: 'plain', type2: 'normal', role: 'bot', text: 'RESULT: {{upstream.analysis}}' },
        ]
        const formated = [
            { role: 'system' as const, content: 'ORIGINAL SYSTEM' },
            { role: 'user' as const, content: 'ORIGINAL USER' },
        ]

        const messages = buildSubAgentRequestMessages(agent, promptSources(formated, {
            parsePromptText: (text) => text.replaceAll('{{user}}', 'ALICE'),
        }), [{
            sourceNodeId: 'source',
            sourceNodeName: 'Source',
            targetPort: 'analysis',
            text: 'UPSTREAM',
        }], {
            originalPrompt: 'SERIALIZED',
            lastUserMessage: 'ORIGINAL USER',
        })

        expect(messages).toEqual([
            { role: 'system', content: 'RULE: CHECK ALICE', attr: ['agent-graph-prompt'] },
            { role: 'system', content: 'ORIGINAL SYSTEM' },
            { role: 'user', content: 'ORIGINAL USER', cachePoint: true },
            { role: 'assistant', content: 'RESULT: UPSTREAM', attr: ['agent-graph-prompt'] },
        ])
        expect(formated[1]).not.toHaveProperty('cachePoint')
    })

    test('supports ranged original messages and role-aware ChatML blocks', () => {
        const agent = node('agent', 'sub-agent', 0) as SubAgentNode
        agent.config.promptTemplate = [
            { type: 'chat', rangeStart: -2, rangeEnd: 'end' },
            {
                type: 'chatML',
                text: '<|im_start|>system\nSYS {{instruction}}<|im_end|>\n<|im_start|>assistant\nREADY<|im_end|>',
            },
        ]
        agent.config.instruction = 'RULE'
        const formated = [
            { role: 'system' as const, content: 'SKIPPED' },
            { role: 'assistant' as const, content: 'KEPT A' },
            { role: 'user' as const, content: 'KEPT U' },
        ]

        expect(buildSubAgentRequestMessages(agent, promptSources(formated), [], {
            originalPrompt: 'SERIALIZED',
            lastUserMessage: 'KEPT U',
        })).toEqual([
            { role: 'assistant', content: 'KEPT A' },
            { role: 'user', content: 'KEPT U' },
            { role: 'system', content: 'SYS RULE', thoughts: [], attr: ['agent-graph-prompt'] },
            { role: 'assistant', content: 'READY', thoughts: [], attr: ['agent-graph-prompt'] },
        ])
    })

    test('supports every source-backed block from the main Prompt menu', () => {
        const agent = node('agent', 'sub-agent', 0) as SubAgentNode
        agent.config.promptTemplate = [
            { type: 'plain', type2: 'main', role: 'system', text: 'MAIN' },
            { type: 'jailbreak', type2: 'normal', role: 'user', text: 'JAILBREAK' },
            { type: 'cot', type2: 'normal', role: 'bot', text: 'COT' },
            { type: 'persona', innerFormat: 'P[{{slot}}]', role2: 'user' },
            { type: 'description', innerFormat: 'D[{{slot}}]', role2: 'bot' },
            { type: 'authornote', innerFormat: 'A[{{slot}}]', role2: 'system' },
            { type: 'lorebook' },
            { type: 'memory', innerFormat: 'M[{{slot}}]', role2: 'user' },
            { type: 'chat', rangeStart: -1000, rangeEnd: 'end' },
            { type: 'postEverything' },
        ]
        const sources = promptSources([{ role: 'user', content: 'CHAT' }], {
            personaPrompt: [{ role: 'system', content: 'PERSONA' }],
            description: [
                { role: 'system', content: 'BEFORE' },
                { role: 'system', content: 'BASE' },
                { role: 'system', content: 'AFTER' },
            ],
            descriptionBaseIndex: 1,
            authorNote: [{ role: 'system', content: 'NOTE' }],
            lorebook: [{ role: 'system', content: 'LORE' }],
            memory: [{ role: 'system', content: 'MEMORY' }],
            postEverything: [{ role: 'system', content: 'POST' }],
            postEndInnerFormat: 'POST END',
        })

        expect(buildSubAgentRequestMessages(agent, sources, [], {
            originalPrompt: 'SERIALIZED',
            lastUserMessage: 'CHAT',
        })).toEqual([
            { role: 'system', content: 'MAIN', attr: ['agent-graph-prompt'] },
            { role: 'user', content: 'JAILBREAK', attr: ['agent-graph-prompt'] },
            { role: 'assistant', content: 'COT', attr: ['agent-graph-prompt'] },
            { role: 'user', content: 'P[PERSONA]' },
            { role: 'system', content: 'D[BEFORE]' },
            { role: 'assistant', content: 'D[BASE]' },
            { role: 'system', content: 'D[AFTER]' },
            { role: 'system', content: 'A[NOTE]' },
            { role: 'system', content: 'LORE' },
            { role: 'user', content: 'M[MEMORY]' },
            { role: 'user', content: 'CHAT' },
            { role: 'system', content: 'POST' },
            { role: 'system', content: 'POST END' },
        ])
    })

    test('copies the main Prompt menu and appends the agent task without mutating it', () => {
        const mainTemplate = [
            { type: 'plain' as const, type2: 'main' as const, role: 'system' as const, text: 'MAIN' },
            { type: 'chat' as const, rangeStart: -1000, rangeEnd: 'end' as const },
        ]

        const config = createDefaultSubAgentConfig(mainTemplate)

        expect(config.promptTemplate).toEqual([
            ...mainTemplate,
            { type: 'postEverything' },
            {
                type: 'plain',
                type2: 'normal',
                name: 'Agent task',
                role: 'user',
                text: expect.stringContaining('{{instruction}}'),
            },
        ])
        expect(mainTemplate).toHaveLength(2)
    })

    test('renders named upstream values without consuming unknown CBS expressions', () => {
        const agent = node('agent', 'sub-agent', 0) as SubAgentNode
        agent.config.instruction = 'Do the work'
        agent.config.inputTemplate = '{{instruction}} / {{upstream.analysis}} / {{upstream}} / {{unknown::value}}'

        const result = renderSubAgentInputTemplate(agent, [{
            sourceNodeId: 'source',
            sourceNodeName: 'Source',
            targetPort: 'analysis',
            text: 'RESULT',
        }], {
            originalPrompt: 'ORIGINAL',
            lastUserMessage: 'LAST',
        })

        expect(result).toBe('Do the work / RESULT / RESULT / {{unknown::value}}')
    })

    test('fills defaults when normalizing an older sub-agent config', () => {
        const value = normalizeAgentGraph({
            enabled: true,
            nodes: [
                { id: 'prompt', name: 'Prompt', type: 'prompt-input', position: { x: 0, y: 0 } },
                { id: 'agent', name: 'Agent', type: 'sub-agent', position: { x: 1, y: 0 }, config: { instruction: 'hello' } },
                { id: 'main', name: 'Main', type: 'main-model', position: { x: 2, y: 0 } },
                { id: 'output', name: 'Output', type: 'final-output', position: { x: 3, y: 0 } },
            ],
            edges: [
                { id: 'a', source: 'prompt', target: 'agent', targetPort: 'input', order: 0 },
                { id: 'b', source: 'agent', target: 'main', targetPort: 'input', order: 0 },
                { id: 'c', source: 'main', target: 'output', targetPort: 'output', order: 0 },
            ],
        })

        const agent = value.nodes.find((entry): entry is SubAgentNode => entry.type === 'sub-agent')
        expect(agent?.config).toMatchObject({
            instruction: 'hello',
            contextMode: 'full-prompt',
            modelMode: 'submodel',
            onError: 'abort',
        })
        expect(agent?.config.promptTemplate).toEqual([
            {
                type: 'chat',
                name: 'Original prompt',
                rangeStart: -1000,
                rangeEnd: 'end',
            },
            {
                type: 'plain',
                type2: 'normal',
                name: 'Agent task',
                role: 'user',
                text: expect.stringContaining('{{instruction}}'),
            },
        ])
        expect(validateAgentGraph(value).ok).toBe(true)
    })

    test('migrates legacy context and input fields into prompt blocks', () => {
        const value = normalizeAgentGraph({
            enabled: true,
            nodes: [{
                id: 'agent',
                name: 'Agent',
                type: 'sub-agent',
                position: { x: 0, y: 0 },
                config: {
                    contextMode: 'last-message',
                    inputTemplate: 'LEGACY {{upstream}}',
                },
            }],
            edges: [],
        })
        const agent = value.nodes[0] as SubAgentNode

        expect(agent.config.promptTemplate).toEqual([
            {
                type: 'chat',
                name: 'Last user message',
                rangeStart: -1,
                rangeEnd: 'end',
            },
            {
                type: 'plain',
                type2: 'normal',
                name: 'Agent task',
                role: 'user',
                text: 'LEGACY {{upstream}}',
            },
        ])
    })

    test('stores bounded sub-agent previews without copying the full Prompt into message metadata', () => {
        const agent = node('agent', 'sub-agent', 1) as SubAgentNode
        const value = graph(
            [node('prompt', 'prompt-input', 0), agent, node('main', 'main-model', 2), node('output', 'final-output', 3)],
            [['prompt', 'agent'], ['agent', 'main'], ['main', 'output']],
        )
        const now = Date.now()
        const trace = summarizeAgentGraphTrace(value, [
            { nodeId: 'prompt', status: 'success', text: 'PRIVATE PROMPT', startedAt: now, finishedAt: now, durationMs: 0 },
            { nodeId: 'agent', status: 'success', text: '123456789', startedAt: now, finishedAt: now, durationMs: 0 },
        ], 5)

        expect(trace[0]).not.toHaveProperty('text')
        expect(trace[0]).not.toHaveProperty('outputPreview')
        expect(trace[1]).toMatchObject({ nodeName: 'agent', outputPreview: '12345…' })
    })
})
