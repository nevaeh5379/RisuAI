export function longpress(node:HTMLElement, callback:(e:MouseEvent|TouchEvent)=>void) {
	const TIME_MS = 500;
	const MOVE_THRESHOLD = 10; // pixels - if touch moves more than this, cancel longpress
	const SELECTION_CHECK_INTERVAL = 50; // ms - how often to check for text selection
	let timeoutPtr: number;
	let selectionCheckInterval: number;
	let startX = 0;
	let startY = 0;
	let cancelled = false;
	let initialSelection = '';

	// Check if there's an active text selection
	function hasTextSelection(): boolean {
		const selection = window.getSelection();
		return selection !== null && selection.toString().length > 0;
	}

	// Check if selection has changed (indicating user is selecting text)
	function hasSelectionChanged(): boolean {
		const selection = window.getSelection();
		const currentSelection = selection?.toString() || '';
		return currentSelection !== initialSelection;
	}

	// Start periodic selection checking
	function startSelectionCheck() {
		initialSelection = window.getSelection()?.toString() || '';
		selectionCheckInterval = window.setInterval(() => {
			if (hasSelectionChanged() || hasTextSelection()) {
				cancelled = true;
				cleanup();
			}
		}, SELECTION_CHECK_INTERVAL);
	}

	// Cleanup all listeners and timers
	function cleanup() {
		window.clearTimeout(timeoutPtr);
		window.clearInterval(selectionCheckInterval);
		window.removeEventListener('mousemove', handleMouseMoveBeforeLong);
		window.removeEventListener('touchmove', handleTouchMoveBeforeLong);
		document.removeEventListener('selectionchange', handleSelectionChange);
	}

	// Mouse event handlers
	function handleMouseDown(e:MouseEvent) {
		cancelled = false;
		window.addEventListener('mousemove', handleMouseMoveBeforeLong);
		document.addEventListener('selectionchange', handleSelectionChange);
		startSelectionCheck();
		timeoutPtr = window.setTimeout(() => {
			cleanup();
			if (!cancelled && !hasTextSelection()) {
				callback(e);
			}
		}, TIME_MS);
	}
	function handleMouseMoveBeforeLong(e:MouseEvent) {
		cleanup();
	}
	function handleMouseUp(e:MouseEvent) {
		cleanup();
	}

	// Handle text selection starting
	function handleSelectionChange() {
		if (hasTextSelection() || hasSelectionChanged()) {
			cancelled = true;
			cleanup();
		}
	}

	// Touch event handlers
	function handleTouchStart(e:TouchEvent) {
		if (e.touches.length === 1) {
			cancelled = false;
			const touch = e.touches[0];
			startX = touch.clientX;
			startY = touch.clientY;
			window.addEventListener('touchmove', handleTouchMoveBeforeLong);
			document.addEventListener('selectionchange', handleSelectionChange);
			startSelectionCheck();
			timeoutPtr = window.setTimeout(() => {
				cleanup();
				// Final check right before firing - give browser a moment to update selection
				requestAnimationFrame(() => {
					if (!cancelled && !hasTextSelection() && !hasSelectionChanged()) {
						callback(e);
					}
				});
			}, TIME_MS);
		}
	}
	function handleTouchMoveBeforeLong(e:TouchEvent) {
		if (e.touches.length === 1) {
			const touch = e.touches[0];
			const deltaX = Math.abs(touch.clientX - startX);
			const deltaY = Math.abs(touch.clientY - startY);
			// Cancel longpress if finger moved beyond threshold (likely text selection)
			if (deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD) {
				cancelled = true;
				cleanup();
			}
		}
	}
	function handleTouchEnd(e:TouchEvent) {
		cleanup();
	}

	node.addEventListener('mousedown', handleMouseDown);
	node.addEventListener('mouseup', handleMouseUp);
	node.addEventListener('touchstart', handleTouchStart, { passive: true });
	node.addEventListener('touchend', handleTouchEnd);

	return {
		destroy: () => {
			cleanup();
			node.removeEventListener('mousedown', handleMouseDown);
			node.removeEventListener('mouseup', handleMouseUp);
			node.removeEventListener('touchstart', handleTouchStart);
			node.removeEventListener('touchend', handleTouchEnd);
		}
	};
}