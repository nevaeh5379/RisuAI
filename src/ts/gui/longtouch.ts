export function longpress(node:HTMLElement, callback:(e:MouseEvent|TouchEvent)=>void) {
	const TIME_MS = 500;
	const MOVE_THRESHOLD = 10; // pixels - if touch moves more than this, cancel longpress
	let timeoutPtr: number;
	let startX = 0;
	let startY = 0;
	let cancelled = false;

	// Check if there's an active text selection
	function hasTextSelection(): boolean {
		const selection = window.getSelection();
		return selection !== null && selection.toString().length > 0;
	}

	// Mouse event handlers
	function handleMouseDown(e:MouseEvent) {
		cancelled = false;
		window.addEventListener('mousemove', handleMouseMoveBeforeLong);
		window.addEventListener('selectionchange', handleSelectionChange);
		timeoutPtr = window.setTimeout(() => {
			window.removeEventListener('mousemove', handleMouseMoveBeforeLong);
			window.removeEventListener('selectionchange', handleSelectionChange);
			if (!cancelled && !hasTextSelection()) {
				callback(e);
			}
		}, TIME_MS);
	}
	function handleMouseMoveBeforeLong(e:MouseEvent) {
		window.clearTimeout(timeoutPtr); 
		window.removeEventListener('mousemove', handleMouseMoveBeforeLong);
		window.removeEventListener('selectionchange', handleSelectionChange);
	}
	function handleMouseUp(e:MouseEvent) {
		window.clearTimeout(timeoutPtr); 
		window.removeEventListener('mousemove', handleMouseMoveBeforeLong);
		window.removeEventListener('selectionchange', handleSelectionChange);
	}

	// Handle text selection starting
	function handleSelectionChange() {
		if (hasTextSelection()) {
			cancelled = true;
			window.clearTimeout(timeoutPtr);
			window.removeEventListener('selectionchange', handleSelectionChange);
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
			timeoutPtr = window.setTimeout(() => {
				window.removeEventListener('touchmove', handleTouchMoveBeforeLong);
				document.removeEventListener('selectionchange', handleSelectionChange);
				// Only fire callback if no text selection and not cancelled
				if (!cancelled && !hasTextSelection()) {
					callback(e);
				}
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
				window.clearTimeout(timeoutPtr);
				window.removeEventListener('touchmove', handleTouchMoveBeforeLong);
				document.removeEventListener('selectionchange', handleSelectionChange);
			}
		}
	}
	function handleTouchEnd(e:TouchEvent) {
		window.clearTimeout(timeoutPtr);
		window.removeEventListener('touchmove', handleTouchMoveBeforeLong);
		document.removeEventListener('selectionchange', handleSelectionChange);
	}

	node.addEventListener('mousedown', handleMouseDown);
	node.addEventListener('mouseup', handleMouseUp);
	node.addEventListener('touchstart', handleTouchStart, { passive: true });
	node.addEventListener('touchend', handleTouchEnd);

	return {
		destroy: () => {
			window.clearTimeout(timeoutPtr);
			node.removeEventListener('mousedown', handleMouseDown);
			node.removeEventListener('mouseup', handleMouseUp);
			node.removeEventListener('touchstart', handleTouchStart);
			node.removeEventListener('touchend', handleTouchEnd);
			window.removeEventListener('mousemove', handleMouseMoveBeforeLong);
			window.removeEventListener('touchmove', handleTouchMoveBeforeLong);
			window.removeEventListener('selectionchange', handleSelectionChange);
			document.removeEventListener('selectionchange', handleSelectionChange);
		}
	};
}