import type { character } from '../storage/database.svelte'
import type { OpenAIChat } from './index.svelte'
import { requestChatData, requestChatDataMain, type requestDataResponse } from './request/request'
import {
    AgentGraphSession,
    type AgentGraph,
    type GraphModelExecutionResult,
    type NodeInputValue,
    type SubAgentNode,
    type SubAgentTemplateContext,
} from './agentGraph'
import {
    buildSubAgentRequestMessages,
    type SubAgentPromptSources,
} from './agentGraphMessages'
import { risuChatParser, risuUnescape } from '../parser/parser.svelte'

export interface RisuAgentGraphSessionOptions {
    graph: AgentGraph
    formated: OpenAIChat[]
    currentChar: character
    promptSources: SubAgentPromptSources
    signal: AbortSignal
    firstMessage: boolean
}

function multimodalLabel(message: OpenAIChat): string {
    if (!message.multimodals?.length) {
        return ''
    }
    const counts = new Map<string, number>()
    for (const item of message.multimodals) {
        counts.set(item.type, (counts.get(item.type) ?? 0) + 1)
    }
    return `\n${[...counts.entries()].map(([type, count]) => `[${type} x${count}]`).join(' ')}`
}

function escapePromptAttribute(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
}

export function serializeAgentGraphPrompt(formated: OpenAIChat[]): string {
    return formated.map((message) => {
        const name = message.name ? ` name="${escapePromptAttribute(message.name)}"` : ''
        return `<message role="${message.role}"${name}>\n${message.content}${multimodalLabel(message)}\n</message>`
    }).join('\n\n')
}

export function findLastUserMessage(formated: OpenAIChat[]): string {
    for (let index = formated.length - 1; index >= 0; index--) {
        if (formated[index].role === 'user') {
            return formated[index].content
        }
    }
    return ''
}

async function collectStreamingText(
    stream: ReadableStream<{ [key: string]: string }>,
    signal: AbortSignal,
): Promise<string> {
    const reader = stream.getReader()
    let result = ''
    const abortReader = () => {
        void reader.cancel().catch(() => undefined)
    }
    signal.addEventListener('abort', abortReader, { once: true })
    try {
        while (!signal.aborted) {
            const chunk = await reader.read()
            if (chunk.value) {
                const firstKey = Object.keys(chunk.value)[0]
                result = firstKey ? (chunk.value[firstKey] ?? result) : result
            }
            if (chunk.done) {
                break
            }
        }
    }
    finally {
        signal.removeEventListener('abort', abortReader)
        void reader.cancel().catch(() => undefined)
    }
    if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError')
    }
    return result
}

async function normalizeSubAgentResponse(
    response: requestDataResponse,
    signal: AbortSignal,
): Promise<GraphModelExecutionResult> {
    if (response.type === 'fail') {
        throw new Error(response.result)
    }
    if (response.type === 'success') {
        return { text: response.result, model: response.model }
    }
    if (response.type === 'multiline') {
        return {
            text: response.result
                .filter(([role]) => role === 'char')
                .map(([, text]) => text)
                .join('\n\n'),
            model: response.model,
        }
    }
    if (response.type === 'streaming') {
        return {
            text: await collectStreamingText(response.result, signal),
            model: response.model,
        }
    }
    throw new Error('Unexpected sub-agent response type.')
}

async function requestSubAgent(
    node: SubAgentNode,
    inputs: NodeInputValue[],
    templateContext: SubAgentTemplateContext,
    promptSources: SubAgentPromptSources,
    currentChar: character,
    signal: AbortSignal,
): Promise<GraphModelExecutionResult> {
    const request: Parameters<typeof requestChatData>[0] = {
        formated: buildSubAgentRequestMessages(
            node,
            promptSources,
            inputs,
            templateContext,
        ).map((message) => ({
            ...message,
            content: risuUnescape(message.content),
        })),
        bias: {},
        currentChar,
        temperature: node.config.temperature,
        maxTokens: Math.max(1, Math.floor(node.config.maxTokens)),
        useStreaming: false,
        noMultiGen: true,
        staticModel: node.config.staticModel || undefined,
        tools: [],
        rememberToolUsage: false,
    }
    const response = node.config.staticModel
        ? await requestChatDataMain(request, node.config.modelMode, signal)
        : await requestChatData(request, node.config.modelMode, signal)

    return normalizeSubAgentResponse(response, signal)
}

export function createRisuAgentGraphSession(options: RisuAgentGraphSessionOptions): AgentGraphSession {
    const originalPrompt = serializeAgentGraphPrompt(options.formated)
    const lastUserMessage = findLastUserMessage(options.formated)

    return new AgentGraphSession(options.graph, {
        originalPrompt,
        lastUserMessage,
        signal: options.signal,
        promptContextMode: 'messages',
        executeSubAgent: async (node, _prompt, inputs, signal, templateContext) => {
            return requestSubAgent(
                node,
                inputs,
                templateContext,
                options.promptSources,
                options.currentChar,
                signal,
            )
        },
        evaluateCondition: (condition) => {
            const parsed = risuChatParser(condition, {
                chara: options.currentChar,
                runVar: false,
                rmVar: true,
                cbsConditions: { firstmsg: options.firstMessage },
            }).trim()
            return parsed === '1'
        },
    })
}
