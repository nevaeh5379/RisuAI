import type { PromptRole } from './prompt'
import type { OpenAIChat } from './index.svelte'
import {
    renderSubAgentPromptText,
    type NodeInputValue,
    type SubAgentNode,
    type SubAgentTemplateContext,
} from './agentGraph'

export interface SubAgentPromptSources {
    chats: OpenAIChat[]
    personaPrompt: OpenAIChat[]
    description: OpenAIChat[]
    descriptionBaseIndex?: number
    authorNote: OpenAIChat[]
    lorebook: OpenAIChat[]
    memory: OpenAIChat[]
    postEverything: OpenAIChat[]
    postEndInnerFormat?: string
    sendChatAsSystem: boolean
    automaticCachePoint: boolean
    mergeAdjacentSystemMessages: boolean
    jailbreakEnabled: boolean
    chainOfThoughtEnabled: boolean
    parsePromptText: (
        text: string,
        role?: PromptRole,
        position?: string,
        originalText?: string,
    ) => string
}

function parseAgentChatML(data: string): OpenAIChat[] | null {
    const starter = '<|im_start|>'
    const separator = '<|im_sep|>'
    const ender = '<|im_end|>'
    const trimmedData = data.trim()
    if (!trimmedData.startsWith(starter)) {
        return null
    }

    return trimmedData
        .split(starter)
        .filter(Boolean)
        .map((part) => {
            let role: OpenAIChat['role'] = 'user'
            if (part.startsWith(`user${separator}`)) {
                part = part.slice(4 + separator.length)
            }
            else if (part.startsWith(`system${separator}`)) {
                role = 'system'
                part = part.slice(6 + separator.length)
            }
            else if (part.startsWith(`assistant${separator}`)) {
                role = 'assistant'
                part = part.slice(9 + separator.length)
            }
            else if (part.startsWith('user ') || part.startsWith('user\n')) {
                part = part.slice(5)
            }
            else if (part.startsWith('system ') || part.startsWith('system\n')) {
                role = 'system'
                part = part.slice(7)
            }
            else if (part.startsWith('assistant ') || part.startsWith('assistant\n')) {
                role = 'assistant'
                part = part.slice(10)
            }

            part = part.trim()
            if (part.endsWith(ender)) {
                part = part.slice(0, -ender.length)
            }
            const thoughts: string[] = []
            part = part.replace(/<Thoughts>(.+)<\/Thoughts>/gms, (_match, thought: string) => {
                thoughts.push(thought)
                return ''
            })
            return { role, content: part, thoughts }
        })
}

function cloneChatMessage(message: OpenAIChat): OpenAIChat {
    return {
        ...message,
        attr: message.attr ? [...message.attr] : undefined,
        thoughts: message.thoughts ? [...message.thoughts] : undefined,
        multimodals: message.multimodals?.map((item) => ({ ...item })),
    }
}

function applyPromptRole(messages: OpenAIChat[], role?: PromptRole, onlyIndex?: number) {
    if (!role) {
        return
    }
    const requestRole = role === 'bot' ? 'assistant' : role
    if (onlyIndex !== undefined) {
        if (messages[onlyIndex]) {
            messages[onlyIndex].role = requestRole
        }
        return
    }
    for (const message of messages) {
        message.role = requestRole
    }
}

function systemizeChat(messages: OpenAIChat[]): OpenAIChat[] {
    for (const message of messages) {
        if (message.role !== 'user' && message.role !== 'assistant') {
            continue
        }
        const attributes = message.attr ?? []
        if (message.name?.startsWith('example_')) {
            message.content = `${message.name}: ${message.content}`
        }
        else if (!attributes.includes('nameAdded')) {
            message.content = `${message.role}: ${message.content}`
        }
        message.role = 'system'
        delete message.memo
        delete message.name
    }
    return messages
}

function pushPrompts(target: OpenAIChat[], additions: OpenAIChat[], mergeAdjacentSystemMessages: boolean) {
    for (const message of additions) {
        if (!message.content.trim() && !message.multimodals?.length) {
            continue
        }
        const previous = target.at(-1)
        if (
            mergeAdjacentSystemMessages
            && message.role === 'system'
            && previous?.role === 'system'
            && previous.memo === message.memo
            && previous.name === message.name
        ) {
            previous.content += `\n\n${message.content}`
            previous.cachePoint ||= message.cachePoint
        }
        else {
            target.push(message)
        }
    }
}

function selectChatRange(
    messages: OpenAIChat[],
    rangeStart: number,
    rangeEnd: number | 'end',
): OpenAIChat[] {
    let start = rangeStart
    let end = rangeEnd === 'end' ? messages.length : rangeEnd
    if (start === -1000) {
        start = 0
        end = messages.length
    }
    if (start < 0) {
        start = Math.max(0, messages.length + start)
    }
    if (end < 0) {
        end = Math.max(0, messages.length + end)
    }
    if (start >= end) {
        return []
    }
    return messages.slice(start, end).map(cloneChatMessage)
}

function markCachePoint(messages: OpenAIChat[], depth: number, role: 'all' | 'user' | 'assistant' | 'system') {
    let pointer = messages.length - 1
    let depthRemaining = Math.max(0, Math.floor(depth))
    while (pointer >= 0 && depthRemaining > 0) {
        const message = messages[pointer]
        if (role === 'all' || message.role === role) {
            message.cachePoint = true
            depthRemaining--
        }
        pointer--
    }
}

/** Builds the request with the same PromptItem order and semantics as the main Prompt menu. */
export function buildSubAgentRequestMessages(
    node: SubAgentNode,
    sources: SubAgentPromptSources,
    inputs: NodeInputValue[],
    context: SubAgentTemplateContext,
): OpenAIChat[] {
    const messages: OpenAIChat[] = []
    const hasExplicitCachePoint = node.config.promptTemplate.some((item) => item.type === 'cache')

    const parseAndRender = (
        text: string,
        role?: PromptRole,
        position?: string,
        originalText?: string,
    ) => renderSubAgentPromptText(
        node,
        sources.parsePromptText(text, role, position, originalText),
        inputs,
        {
            ...context,
            instruction: sources.parsePromptText(node.config.instruction, role),
        },
    )

    const applyInnerFormat = (
        sourceMessages: OpenAIChat[],
        innerFormat: string | undefined,
        role: PromptRole | undefined,
        position?: string,
        roleIndex?: number,
        defaultText = '',
    ) => {
        const result = sourceMessages.map(cloneChatMessage)
        applyPromptRole(result, role, roleIndex)
        if (innerFormat && result.length > 0) {
            for (const message of result) {
                const format = parseAndRender(innerFormat, role, position, innerFormat)
                message.content = format.replace('{{slot}}', message.content || defaultText)
            }
        }
        return result
    }

    for (const item of node.config.promptTemplate) {
        switch (item.type) {
            case 'persona': {
                pushPrompts(messages, applyInnerFormat(
                    sources.personaPrompt,
                    item.innerFormat,
                    item.role2,
                    item.type,
                ), sources.mergeAdjacentSystemMessages)
                break
            }
            case 'description': {
                pushPrompts(messages, applyInnerFormat(
                    sources.description,
                    item.innerFormat,
                    item.role2,
                    item.type,
                    sources.descriptionBaseIndex,
                ), sources.mergeAdjacentSystemMessages)
                break
            }
            case 'authornote': {
                pushPrompts(messages, applyInnerFormat(
                    sources.authorNote,
                    item.innerFormat,
                    item.role2,
                    item.type,
                    undefined,
                    item.defaultText,
                ), sources.mergeAdjacentSystemMessages)
                break
            }
            case 'lorebook': {
                pushPrompts(messages, sources.lorebook.map(cloneChatMessage), sources.mergeAdjacentSystemMessages)
                break
            }
            case 'memory': {
                pushPrompts(messages, applyInnerFormat(
                    sources.memory,
                    item.innerFormat,
                    item.role2,
                ), sources.mergeAdjacentSystemMessages)
                break
            }
            case 'postEverything': {
                pushPrompts(messages, sources.postEverything.map(cloneChatMessage), sources.mergeAdjacentSystemMessages)
                if (sources.postEndInnerFormat) {
                    pushPrompts(messages, [{
                        role: 'system',
                        content: parseAndRender(sources.postEndInnerFormat, 'system'),
                    }], sources.mergeAdjacentSystemMessages)
                }
                break
            }
            case 'plain':
            case 'jailbreak':
            case 'cot': {
                if (item.type === 'jailbreak' && !sources.jailbreakEnabled) {
                    break
                }
                if (item.type === 'cot' && !sources.chainOfThoughtEnabled) {
                    break
                }
                const position = item.type === 'plain' ? item.type2 : item.type
                const content = parseAndRender(item.text, item.role, position, item.text)
                pushPrompts(messages, [{
                    role: item.role === 'bot' ? 'assistant' : item.role,
                    content,
                    attr: ['agent-graph-prompt'],
                }], sources.mergeAdjacentSystemMessages)
                break
            }
            case 'chatML': {
                const parsed = parseAgentChatML(item.text) ?? []
                for (const message of parsed) {
                    const promptRole: PromptRole = message.role === 'assistant'
                        ? 'bot'
                        : (message.role === 'user' ? 'user' : 'system')
                    message.content = parseAndRender(message.content, promptRole)
                    message.attr = ['agent-graph-prompt']
                }
                pushPrompts(messages, parsed, sources.mergeAdjacentSystemMessages)
                break
            }
            case 'chat': {
                let chats = selectChatRange(sources.chats, item.rangeStart, item.rangeEnd)
                if (sources.sendChatAsSystem && !item.chatAsOriginalOnSystem) {
                    chats = systemizeChat(chats)
                }
                pushPrompts(messages, chats, sources.mergeAdjacentSystemMessages)
                if (sources.automaticCachePoint && !hasExplicitCachePoint) {
                    markCachePoint(messages, 3, 'user')
                }
                break
            }
            case 'cache': {
                markCachePoint(messages, item.depth, item.role)
                break
            }
        }
    }

    return messages.map((message) => ({ ...message, content: message.content.trim() }))
}
