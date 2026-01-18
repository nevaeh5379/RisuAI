export function longpress(node:HTMLElement, callback:(e:MouseEvent|TouchEvent)=>void) {
	const TIME_MS = 500;
	const MOVE_THRESHOLD = 10; // pixels - if touch moves more than this, cancel longpress
	let timeoutPtr: number;
	let startX = 0;
	let startY = 0;

	// Mouse event handlers
	function handleMouseDown(e:MouseEvent) {
		window.addEventListener('mousemove', handleMouseMoveBeforeLong);
		timeoutPtr = window.setTimeout(() => {
			window.removeEventListener('mousemove', handleMouseMoveBeforeLong);
			callback(e);
		}, TIME_MS);
	}
	function handleMouseMoveBeforeLong(e:MouseEvent) {
		window.clearTimeout(timeoutPtr); 
		window.removeEventListener('mousemove', handleMouseMoveBeforeLong);
	}
	function handleMouseUp(e:MouseEvent) {
		window.clearTimeout(timeoutPtr); 
		window.removeEventListener('mousemove', handleMouseMoveBeforeLong);
	}

	// Touch event handlers
	function handleTouchStart(e:TouchEvent) {
		if (e.touches.length === 1) {
			const touch = e.touches[0];
			startX = touch.clientX;
			startY = touch.clientY;
			window.addEventListener('touchmove', handleTouchMoveBeforeLong);
			timeoutPtr = window.setTimeout(() => {
				window.removeEventListener('touchmove', handleTouchMoveBeforeLong);
				callback(e);
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
				window.clearTimeout(timeoutPtr);
				window.removeEventListener('touchmove', handleTouchMoveBeforeLong);
			}
		}
	}
	function handleTouchEnd(e:TouchEvent) {
		window.clearTimeout(timeoutPtr);
		window.removeEventListener('touchmove', handleTouchMoveBeforeLong);
	}

	node.addEventListener('mousedown', handleMouseDown);
	node.addEventListener('mouseup', handleMouseUp);
	node.addEventListener('touchstart', handleTouchStart, { passive: true });
	node.addEventListener('touchend', handleTouchEnd);

	return {
		destroy: () => {
			node.removeEventListener('mousedown', handleMouseDown);
			node.removeEventListener('mouseup', handleMouseUp);
			node.removeEventListener('touchstart', handleTouchStart);
			node.removeEventListener('touchend', handleTouchEnd);
			window.removeEventListener('mousemove', handleMouseMoveBeforeLong);
			window.removeEventListener('touchmove', handleTouchMoveBeforeLong);
		}
	};
}