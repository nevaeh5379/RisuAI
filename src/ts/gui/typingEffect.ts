/**
 * Typing Impact Effect Module
 * Provides visual and audio feedback when typing in the chat input
 */

export type TypingSoundType = 'click' | 'sine' | 'none';

let audioContext: AudioContext | null = null;
let lastPlayTime = 0;
const DEBOUNCE_MS = 30; // Minimum time between sounds
const SOUND_VOLUME = 0.1; // Base volume

/**
 * Initialize AudioContext (must be called after user interaction)
 */
function getAudioContext(): AudioContext {
    if (!audioContext) {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContext;
}

/**
 * Play mechanical keyboard-like click sound (original)
 */
function playClickSound(): void {
    try {
        const ctx = getAudioContext();
        
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        // Randomize pitch slightly for natural feel
        const baseFreq = 1800 + Math.random() * 400;
        oscillator.frequency.setValueAtTime(baseFreq, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.02);
        
        oscillator.type = 'sine';
        
        // Quick attack and decay for click sound
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.002);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.025);
        
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.03);
    } catch (e) {
        // Silently fail if audio not available
    }
}

/**
 * Play soft sine wave sound (user's original - smooth and gentle)
 */
function playSineSound(): void {
    try {
        const ctx = getAudioContext();
        
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        // Frequency with slight randomization
        oscillator.frequency.value = 800 + (Math.random() * 200 - 100);
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(SOUND_VOLUME, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
        
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.05);
    } catch (e) {
        // Silently fail
    }
}

/**
 * Play send sound - triangle wave with rising frequency
 * Called when user sends a message
 */
export function playSendSound(): void {
    try {
        const ctx = getAudioContext();
        
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        // Rising frequency for a "send" feel
        oscillator.frequency.setValueAtTime(400, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.1);
        oscillator.type = 'triangle';
        
        gainNode.gain.setValueAtTime(SOUND_VOLUME * 2, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.15);
    } catch (e) {
        // Silently fail
    }
}

/**
 * Play typing sound based on selected type
 */
export function playTypingSound(soundType: TypingSoundType = 'click'): void {
    const now = Date.now();
    if (now - lastPlayTime < DEBOUNCE_MS) return;
    lastPlayTime = now;

    switch (soundType) {
        case 'click':
            playClickSound();
            break;
        case 'sine':
            playSineSound();
            break;
        case 'none':
        default:
            // No sound
            break;
    }
}

/**
 * Apply a subtle visual pulse/shake effect to an element
 */
export function triggerTypingVisualEffect(element: HTMLElement): void {
    if (!element) return;
    
    // Add animation class
    element.classList.add('typing-impact');
    
    // Remove after animation completes
    setTimeout(() => {
        element.classList.remove('typing-impact');
    }, 50);
}

/**
 * Combined effect - plays sound and triggers visual
 */
export function triggerTypingEffect(element: HTMLElement, soundType: TypingSoundType = 'click'): void {
    playTypingSound(soundType);
    triggerTypingVisualEffect(element);
}

/**
 * CSS styles for the typing effect (to be injected)
 */
export const typingEffectStyles = `
@keyframes typingImpact {
    0% { transform: scale(1); }
    50% { transform: scale(1.002) translateY(-0.5px); }
    100% { transform: scale(1); }
}

.typing-impact {
    animation: typingImpact 50ms ease-out;
}
`;

// Inject styles when module loads
if (typeof document !== 'undefined') {
    const styleEl = document.createElement('style');
    styleEl.textContent = typingEffectStyles;
    document.head.appendChild(styleEl);
}
