const api = typeof browser !== 'undefined' ? browser : chrome;

// State
let currentTabId = null;
let isScrolling = false;
let direction = 'down'; // 'down' | 'up'
let speed = 30; // 1 to 100

// DOM Elements
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const toggleBtn = document.getElementById('toggleBtn');
const toggleIcon = document.getElementById('toggleIcon');
const toggleText = document.getElementById('toggleText');
const dirDownBtn = document.getElementById('dirDownBtn');
const dirUpBtn = document.getElementById('dirUpBtn');
const speedValue = document.getElementById('speedValue');
const speedDescriptor = document.getElementById('speedDescriptor');
const speedSlider = document.getElementById('speedSlider');
const speedMinusBtn = document.getElementById('speedMinusBtn');
const speedPlusBtn = document.getElementById('speedPlusBtn');
const presetChips = document.querySelectorAll('.preset-chip');
const unavailableNotice = document.getElementById('unavailableNotice');
const controlsGroup = document.getElementById('controlsGroup');

/**
 * Calculates pixels per second using an exponential scale (same as content.js)
 */
function calculatePixelsPerSecond(level) {
    const clamped = Math.max(1, Math.min(100, Number(level) || 30));
    const minSpeed = 3;
    const maxSpeed = 3600;
    const t = (clamped - 1) / 99;
    return Math.round(minSpeed * Math.pow(maxSpeed / minSpeed, t));
}

/**
 * Returns human-readable label and rate for the speed level
 */
function getSpeedDescriptor(level) {
    const pps = calculatePixelsPerSecond(level);
    let category = '';

    if (level === 1) category = 'Min';
    else if (level <= 15) category = 'Extremely Slow';
    else if (level <= 35) category = 'Slow';
    else if (level <= 65) category = 'Medium';
    else if (level <= 85) category = 'Fast';
    else if (level <= 99) category = 'Very Fast';
    else category = 'Super Fast';

    return `${category} • ${pps} px/s`;
}

/**
 * Storage helpers
 */
const storage = {
    async get(keys) {
        if (api.storage && api.storage.local) {
            try {
                return await api.storage.local.get(keys);
            } catch {
                return new Promise((resolve) => api.storage.local.get(keys, resolve));
            }
        }
        const result = {};
        for (const k of (Array.isArray(keys) ? keys : Object.keys(keys))) {
            const val = localStorage.getItem(k);
            if (val !== null) {
                try { result[k] = JSON.parse(val); } catch { result[k] = val; }
            }
        }
        return result;
    },
    async set(items) {
        if (api.storage && api.storage.local) {
            try {
                return await api.storage.local.set(items);
            } catch {
                return new Promise((resolve) => api.storage.local.set(items, resolve));
            }
        }
        for (const [k, v] of Object.entries(items)) {
            localStorage.setItem(k, JSON.stringify(v));
        }
    }
};

/**
 * Get the current active tab in Safari
 */
async function getActiveTab() {
    const query = async (queryInfo) => {
        if (api.tabs && api.tabs.query) {
            try {
                return await api.tabs.query(queryInfo);
            } catch {
                return new Promise((resolve) => api.tabs.query(queryInfo, resolve));
            }
        }
        return [];
    };

    let tabs = await query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
        tabs = await query({ active: true, lastFocusedWindow: true });
    }
    if (!tabs || tabs.length === 0) {
        tabs = await query({ active: true });
    }
    return tabs && tabs.length > 0 ? tabs[0] : null;
}

/**
 * Send a message to the active tab, with auto injection fallback if needed
 */
async function sendMessageToTab(tabId, message) {
    const send = async () => {
        if (api.tabs && api.tabs.sendMessage) {
            try {
                return await api.tabs.sendMessage(tabId, message);
            } catch (err) {
                return new Promise((resolve, reject) => {
                    api.tabs.sendMessage(tabId, message, (res) => {
                        if (api.runtime.lastError) reject(api.runtime.lastError);
                        else resolve(res);
                    });
                });
            }
        }
        throw new Error('tabs.sendMessage not available');
    };

    try {
        return await send();
    } catch {
        // Try injecting content.js if tab was loaded before extension
        try {
            if (api.scripting && api.scripting.executeScript) {
                await api.scripting.executeScript({
                    target: { tabId },
                    files: ['content.js']
                });
                return await send();
            }
        } catch (injectErr) {
            console.warn('Script injection failed:', injectErr);
        }
        throw new Error('Cannot communicate with active tab');
    }
}

/**
 * Update UI elements to match current state
 */
function updateUI() {
    // Status Badge
    if (isScrolling) {
        statusBadge.className = 'status-badge scrolling';
        statusText.textContent = direction === 'down' ? 'Scrolling Down' : 'Scrolling Up';

        toggleBtn.className = 'primary-btn stop-state';
        toggleIcon.textContent = '⏹';
        toggleText.textContent = 'Stop Scrolling';
    } else {
        statusBadge.className = 'status-badge stopped';
        statusText.textContent = 'Stopped';

        toggleBtn.className = 'primary-btn start-state';
        toggleIcon.textContent = '▶';
        toggleText.textContent = 'Start Scrolling';
    }

    // Direction Buttons
    if (direction === 'down') {
        dirDownBtn.classList.add('active');
        dirUpBtn.classList.remove('active');
    } else {
        dirDownBtn.classList.remove('active');
        dirUpBtn.classList.add('active');
    }

    // Speed Controls
    speedSlider.value = speed;
    speedValue.textContent = speed;
    speedDescriptor.textContent = getSpeedDescriptor(speed);

    // Preset Chips highlighting
    presetChips.forEach(chip => {
        const chipSpeed = Number(chip.getAttribute('data-speed'));
        if (chipSpeed === speed) {
            chip.classList.add('active');
        } else {
            chip.classList.remove('active');
        }
    });
}

/**
 * Show warning when active tab is unsupported
 */
function showUnavailable() {
    unavailableNotice.classList.remove('hidden');
    controlsGroup.style.opacity = '0.5';
    controlsGroup.style.pointerEvents = 'none';
}

/**
 * Handle Start / Stop
 */
async function handleToggle() {
    if (!currentTabId) return;

    if (isScrolling) {
        try {
            const res = await sendMessageToTab(currentTabId, { action: 'STOP' });
            if (res) {
                isScrolling = false;
            }
        } catch (err) {
            console.error('Failed to stop:', err);
            isScrolling = false;
        }
    } else {
        try {
            const res = await sendMessageToTab(currentTabId, {
                action: 'START',
                direction,
                speed
            });
            if (res) {
                isScrolling = true;
            }
        } catch (err) {
            console.error('Failed to start:', err);
        }
    }

    updateUI();
}

/**
 * Handle direction change
 */
async function setDirection(newDir) {
    if (direction === newDir) return;
    direction = newDir;
    updateUI();

    await storage.set({ savedDirection: direction });

    if (currentTabId) {
        try {
            await sendMessageToTab(currentTabId, {
                action: 'SET_DIRECTION',
                direction
            });
        } catch (err) {
            console.warn('Could not update direction on tab:', err);
        }
    }
}

/**
 * Handle speed change
 */
let saveSpeedTimeout = null;
async function setSpeed(newSpeed) {
    const clamped = Math.max(1, Math.min(100, Number(newSpeed) || 30));
    speed = clamped;
    updateUI();

    // Debounce persistent save
    clearTimeout(saveSpeedTimeout);
    saveSpeedTimeout = setTimeout(() => {
        storage.set({ savedSpeed: speed });
    }, 250);

    if (currentTabId) {
        try {
            await sendMessageToTab(currentTabId, {
                action: 'SET_SPEED',
                speed
            });
        } catch (err) {
            console.warn('Could not update speed on tab:', err);
        }
    }
}

// Event Listeners
toggleBtn.addEventListener('click', handleToggle);

dirDownBtn.addEventListener('click', () => setDirection('down'));
dirUpBtn.addEventListener('click', () => setDirection('up'));

speedSlider.addEventListener('input', (e) => {
    setSpeed(Number(e.target.value));
});

speedMinusBtn.addEventListener('click', () => {
    setSpeed(speed - 1);
});

speedPlusBtn.addEventListener('click', () => {
    setSpeed(speed + 1);
});

presetChips.forEach(chip => {
    chip.addEventListener('click', () => {
        const val = Number(chip.getAttribute('data-speed'));
        setSpeed(val);
    });
});

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Load saved preferences
    try {
        const saved = await storage.get(['savedSpeed', 'savedDirection']);
        if (saved && typeof saved.savedSpeed === 'number') {
            speed = saved.savedSpeed;
        }
        if (saved && (saved.savedDirection === 'down' || saved.savedDirection === 'up')) {
            direction = saved.savedDirection;
        }
    } catch (e) {
        console.warn('Could not load preferences:', e);
    }

    updateUI();

    // 2. Query active tab
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
        showUnavailable();
        return;
    }

    currentTabId = tab.id;

    // Check if URL is unsupported (internal Safari pages, empty URLs, etc.)
    const url = tab.url || '';
    if (url.startsWith('safari-extension://') || url.startsWith('about:') || url.startsWith('safari:')) {
        showUnavailable();
        return;
    }

    // 3. Query current status from tab
    try {
        const status = await sendMessageToTab(currentTabId, { action: 'GET_STATUS' });
        if (status) {
            isScrolling = status.isScrolling;
            if (status.direction) direction = status.direction;
            if (typeof status.speed === 'number') speed = status.speed;
            updateUI();
        }
    } catch {
        // Content script might not be active yet or page is idle; UI remains ready with saved preferences
        updateUI();
    }
});
