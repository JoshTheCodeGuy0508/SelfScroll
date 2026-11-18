(() => {
    // Prevent duplicate injection
    if (window.__selfScrollLoaded) {
        return;
    }
    window.__selfScrollLoaded = true;

    let isScrolling = false;
    let direction = 'down'; // 'down' | 'up'
    let speed = 30; // 1 to 100
    let animFrameId = null;
    let lastTimestamp = null;
    let accumulatedDelta = 0;

    /**
     * Calculates pixels per second using an exponential scale.
     * Level 1: ~3 px/sec (extremely slow, relaxed reading)
     * Level 100: ~3600 px/sec (super fast skimming / browsing)
     */
    function calculatePixelsPerSecond(level) {
        const clamped = Math.max(1, Math.min(100, Number(level) || 30));
        const minSpeed = 3;
        const maxSpeed = 3600;
        const t = (clamped - 1) / 99;
        return Math.round(minSpeed * Math.pow(maxSpeed / minSpeed, t));
    }

    /**
     * Finds scrollable container if window scrolling is not effective
     */
    function getScrollableContainer() {
        const docElem = document.documentElement;
        const body = document.body;
        if (docElem && (docElem.scrollHeight > window.innerHeight + 1)) {
            return null;
        }
        if (body && (body.scrollHeight > window.innerHeight + 1)) {
            return null;
        }

        const candidates = document.querySelectorAll('main, article, section, div');
        let bestTarget = null;
        let bestArea = 0;

        for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            if (el.scrollHeight > el.clientHeight + 15) {
                const style = window.getComputedStyle(el);
                if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                    const rect = el.getBoundingClientRect();
                    const area = rect.width * rect.height;
                    if (area > bestArea) {
                        bestArea = area;
                        bestTarget = el;
                    }
                }
            }
        }
        return bestTarget;
    }

    function performScroll(pixels) {
        const beforeY = window.scrollY || window.pageYOffset || 0;
        window.scrollBy({ top: pixels, left: 0, behavior: 'instant' });
        const afterY = window.scrollY || window.pageYOffset || 0;

        // If window didn't scroll, try fallback container
        if (Math.abs(afterY - beforeY) < 0.1) {
            const container = getScrollableContainer();
            if (container) {
                container.scrollBy({ top: pixels, left: 0, behavior: 'instant' });
            }
        }
    }

    function scrollLoop(timestamp) {
        if (!isScrolling) {
            animFrameId = null;
            lastTimestamp = null;
            return;
        }

        if (lastTimestamp === null) {
            lastTimestamp = timestamp;
        }

        // Clamp delta time to 0.1s to avoid huge jumps on frame drops/tab switching
        const deltaTime = Math.min((timestamp - lastTimestamp) / 1000, 0.1);
        lastTimestamp = timestamp;

        const pps = calculatePixelsPerSecond(speed);
        accumulatedDelta += pps * deltaTime;

        if (accumulatedDelta >= 1) {
            const pixelsToMove = Math.floor(accumulatedDelta);
            accumulatedDelta -= pixelsToMove;

            const delta = direction === 'down' ? pixelsToMove : -pixelsToMove;
            performScroll(delta);
        }

        animFrameId = requestAnimationFrame(scrollLoop);
    }

    function startScrolling(options) {
        if (options) {
            if (options.direction) direction = options.direction;
            if (typeof options.speed === 'number') speed = options.speed;
        }

        if (!isScrolling) {
            isScrolling = true;
            lastTimestamp = null;
            accumulatedDelta = 0;
            if (animFrameId) {
                cancelAnimationFrame(animFrameId);
            }
            animFrameId = requestAnimationFrame(scrollLoop);
        }
    }

    function stopScrolling() {
        isScrolling = false;
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
        lastTimestamp = null;
        accumulatedDelta = 0;
    }

    function getStatus() {
        return {
            isScrolling,
            direction,
            speed,
            pixelsPerSecond: calculatePixelsPerSecond(speed)
        };
    }

    // Listen for Escape key on the page to quickly stop scrolling
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isScrolling) {
            stopScrolling();
        }
    });

    // Cross-browser message listener
    const runtime = (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime : chrome.runtime;
    if (runtime && runtime.onMessage) {
        runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (!message || !message.action) return false;

            switch (message.action) {
                case 'GET_STATUS':
                    sendResponse(getStatus());
                    break;

                case 'START':
                    startScrolling({
                        direction: message.direction,
                        speed: message.speed
                    });
                    sendResponse(getStatus());
                    break;

                case 'STOP':
                    stopScrolling();
                    sendResponse(getStatus());
                    break;

                case 'TOGGLE':
                    if (isScrolling) {
                        stopScrolling();
                    } else {
                        startScrolling({
                            direction: message.direction,
                            speed: message.speed
                        });
                    }
                    sendResponse(getStatus());
                    break;

                case 'SET_SPEED':
                    if (typeof message.speed === 'number') {
                        speed = message.speed;
                    }
                    sendResponse(getStatus());
                    break;

                case 'SET_DIRECTION':
                    if (message.direction === 'down' || message.direction === 'up') {
                        direction = message.direction;
                    }
                    sendResponse(getStatus());
                    break;

                default:
                    sendResponse({ error: 'Unknown action: ' + message.action });
                    break;
            }

            return true;
        });
    }
})();
