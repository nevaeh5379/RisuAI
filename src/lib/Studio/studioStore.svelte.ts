import { v4 } from "uuid";

export interface StudioTab {
    id: string;
    key: string;
    title: string;
    icon?: any;
}

export interface FloatingWindowData {
    id: string;
    tab: StudioTab;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
}

export const StudioState = $state({
    tabs: [] as StudioTab[],
    activeTabId: null as string | null,
    floatingWindows: [] as FloatingWindowData[],
    globalZIndex: 100,
});

export function openStudioTab(key: string, title: string, icon?: any) {
    // Check if already in floating windows
    const fw = StudioState.floatingWindows.find(w => w.tab.key === key);
    if (fw) {
        bringStudioWindowToFront(fw.id);
        return;
    }

    // Check if already in tabs
    const existingTab = StudioState.tabs.find(t => t.key === key);
    if (existingTab) {
        StudioState.activeTabId = existingTab.id;
        return;
    }

    // Add new tab
    const newTab: StudioTab = {
        id: v4(),
        key,
        title,
        icon
    };
    StudioState.tabs.push(newTab);
    StudioState.activeTabId = newTab.id;
}

export function closeStudioTab(id: string) {
    const index = StudioState.tabs.findIndex(t => t.id === id);
    if (index === -1) return;

    StudioState.tabs.splice(index, 1);
    if (StudioState.activeTabId === id) {
        // Select new active tab
        if (StudioState.tabs.length > 0) {
            // Try to select previous one, or the one at the same index
            const newIndex = Math.max(0, index - 1);
            StudioState.activeTabId = StudioState.tabs[newIndex].id;
        } else {
            StudioState.activeTabId = null;
        }
    }
}

export function popOutStudioTab(id: string) {
    const tab = StudioState.tabs.find(t => t.id === id);
    if (!tab) return;
    
    closeStudioTab(id);
    
    StudioState.globalZIndex++;
    const fw: FloatingWindowData = {
        id: v4(),
        tab: {...tab},
        x: 100,
        y: 100,
        width: 600,
        height: 500,
        zIndex: StudioState.globalZIndex
    };
    StudioState.floatingWindows.push(fw);
}

export function closeFloatingWindow(id: string) {
    const index = StudioState.floatingWindows.findIndex(w => w.id === id);
    if (index !== -1) {
        StudioState.floatingWindows.splice(index, 1);
    }
}

export function bringStudioWindowToFront(id: string | 'main') {
    StudioState.globalZIndex++;
    if (id !== 'main') {
        const win = StudioState.floatingWindows.find(w => w.id === id);
        if (win) win.zIndex = StudioState.globalZIndex;
    }
}
