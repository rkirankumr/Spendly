// --- Database Management (IndexedDB) ---
const DataService = {
    db: null,
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('SpendlyDB', 3);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('transactions')) {
                    db.createObjectStore('transactions', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings');
                }
                if (!db.objectStoreNames.contains('groceryItems')) {
                    db.createObjectStore('groceryItems', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('milkTracker')) {
                    db.createObjectStore('milkTracker', { keyPath: 'id' });
                }
            };
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },
    // Raw IndexedDB methods to bypass Firebase triggers
    async putRaw(store, data) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(store, 'readwrite');
            const s = tx.objectStore(store);
            const request = s.put(data);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },
    async deleteRaw(store, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(store, 'readwrite');
            const s = tx.objectStore(store);
            const request = s.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },
    async saveSettingRaw(key, value) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('settings', 'readwrite');
            const s = tx.objectStore('settings');
            const request = s.put(value, key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },
    async getAllRaw(store) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(store, 'readonly');
            const s = tx.objectStore(store);
            const request = s.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },
    async getSettingRaw(key) {
        return new Promise((resolve) => {
            const tx = this.db.transaction('settings', 'readonly');
            const s = tx.objectStore('settings');
            const request = s.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(undefined);
        });
    },
    // Standard methods that trigger Firebase sync if logged in
    async save(store, data) {
        await this.putRaw(store, data);
        if (typeof firebase !== 'undefined' && firebase.apps.length > 0 && firebase.auth().currentUser) {
            const uid = firebase.auth().currentUser.uid;
            try {
                await firebase.firestore().collection('users').doc(uid).collection(store).doc(String(data.id)).set(data);
            } catch (err) {
                console.error(`Firebase sync failed for ${store}/${data.id}:`, err);
            }
        }
    },
    async saveSetting(key, value) {
        await this.saveSettingRaw(key, value);
        if (typeof firebase !== 'undefined' && firebase.apps.length > 0 && firebase.auth().currentUser) {
            const uid = firebase.auth().currentUser.uid;
            try {
                await firebase.firestore().collection('users').doc(uid).collection('settings').doc(key).set({ value: value });
            } catch (err) {
                console.error(`Firebase settings sync failed for ${key}:`, err);
            }
        }
    },
    async getSetting(key, defaultValue) {
        return new Promise((resolve) => {
            const tx = this.db.transaction('settings', 'readonly');
            const s = tx.objectStore('settings');
            const request = s.get(key);
            request.onsuccess = () => resolve(request.result !== undefined ? request.result : defaultValue);
            request.onerror = () => resolve(defaultValue);
        });
    },
    async getAll(store) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(store, 'readonly');
            const s = tx.objectStore(store);
            const request = s.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },
    async get(store, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(store, 'readonly');
            const s = tx.objectStore(store);
            const request = s.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },
    async delete(store, key) {
        await this.deleteRaw(store, key);
        if (typeof firebase !== 'undefined' && firebase.apps.length > 0 && firebase.auth().currentUser) {
            const uid = firebase.auth().currentUser.uid;
            try {
                await firebase.firestore().collection('users').doc(uid).collection(store).doc(String(key)).delete();
            } catch (err) {
                console.error(`Firebase delete failed for ${store}/${key}:`, err);
            }
        }
    },
    async clearAll() {
        return new Promise((resolve) => {
            const tx = this.db.transaction(['transactions', 'settings', 'groceryItems', 'milkTracker'], 'readwrite');
            tx.objectStore('transactions').clear();
            tx.objectStore('settings').clear();
            tx.objectStore('groceryItems').clear();
            tx.objectStore('milkTracker').clear();
            tx.oncomplete = () => resolve();
        });
    }
};

// Date Parsing and Formatting Helpers (Local Time Safe)
function parseLocalDate(dateStr) {
    if (!dateStr) return new Date();
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }
    return new Date(dateStr);
}

function getLocalDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// State Management
let transactions = [];
let groceryItems = [];
let categoryBudgets = {};
let userName = 'Rojaa';
let startingBalance = 0;
let editTransactionId = null;
let tabBeforeEdit = null;

let paginationState = {
    'expense-list': 1,
    'income-list': 1,
    'grocery-list': 1
};
const ITEMS_PER_PAGE = 10;

let selectedMonth = new Date().getMonth();
let selectedYear = new Date().getFullYear();

// Milk Tracker State
let selectedMilkMonth = new Date().getMonth();
let selectedMilkYear = new Date().getFullYear();

let dashboardChart = null;
let reportsChart = null;
let analysisTrendChart = null;

// Categories & Icons
let categoryIcons = {
    'Room Rent': '🏠', 'Power Bill': '⚡', 'Milkman': '🥛',
    'Aunty': '🧹', 'Vegetables': '🥬', 'Petrol': '⛽',
    'Grocery': '🛒', 'Internet and Phone Bill': '🌐',
    'Baby milk powder': '🍼', 'Huggies': '👶', 'Other': '🏷️'
};

const emojiDictionary = {
    'food': '🍔', 'pizza': '🍕', 'burger': '🍔', 'snack': '🥨', 'dining': '🍽️', 'restaurant': '🍽️', 'meal': '🍱',
    'travel': '✈️', 'flight': '✈️', 'bus': '🚌', 'train': '🚆', 'taxi': '🚕', 'uber': '🚕', 'cab': '🚕', 'trip': '🧳',
    'health': '🏥', 'doctor': '👨‍⚕️', 'medicine': '💊', 'pharmacy': '💊', 'hospital': '🏥', 'medical': '⚕️',
    'education': '🎓', 'school': '🏫', 'college': '🏫', 'books': '📚', 'tuition': '👩‍🏫', 'course': '📖',
    'entertainment': '🎬', 'movie': '🍿', 'games': '🎮', 'music': '🎵', 'concert': '🎫', 'fun': '🎡',
    'shopping': '🛍️', 'clothes': '👕', 'shoes': '👞', 'electronics': '📱', 'gadget': '💻', 'mall': '🏬',
    'bill': '🧾', 'water': '💧', 'internet': '🌐', 'wifi': '📶', 'phone': '📱', 'mobile': '📱', 'utility': '🔌',
    'rent': '🏠', 'house': '🏡', 'maintenance': '🔧', 'repair': '🛠️', 'home': '🏠',
    'gift': '🎁', 'party': '🎉', 'festival': '🎆', 'celebration': '🎊', 'birthday': '🎂',
    'salary': '💰', 'bonus': '💵', 'profit': '📈', 'investment': '🏦', 'wage': '💸',
    'car': '🚗', 'bike': '🏍️', 'fuel': '⛽', 'gas': '⛽', 'auto': '🚘',
    'pet': '🐾', 'dog': '🐶', 'cat': '🐱', 'vet': '🩺',
    'baby': '👶', 'diaper': '🧷', 'huggies': '👶', 'milk': '🍼',
    'gym': '🏋️', 'fitness': '🏃', 'sport': '⚽', 'yoga': '🧘', 'workout': '💪',
    'beauty': '💅', 'salon': '💇', 'cosmetics': '💄', 'hair': '💈'
};

function autoSuggestEmoji(name) {
    const lowerName = name.toLowerCase();
    for (const [keyword, emoji] of Object.entries(emojiDictionary)) {
        if (lowerName.includes(keyword)) {
            return emoji;
        }
    }
    return '🏷️';
}

const SPENDLY_FIREBASE_CONFIG = {
  "projectId": "spendly-tracker-12995",
  "appId": "1:495737847987:web:232c38e47dc294f4aff0c6",
  "storageBucket": "spendly-tracker-12995.firebasestorage.app",
  "apiKey": "AIzaSyDMH90JwqFN4CtqBjzW_SXJ0rRBpAkLnfg",
  "authDomain": "spendly-tracker-12995.firebaseapp.com",
  "messagingSenderId": "495737847987"
};

const chartColors = ['#76c8c8', '#f6ad55', '#fc8181', '#68d391', '#f6e05e', '#b794f4', '#63b3ed', '#a0aec0'];

document.addEventListener('DOMContentLoaded', async () => {
    await initApp();
});

// --- Initialization ---
async function initApp() {
    await DataService.init();
    await migrateData();
    await loadState();

    try {
        initFirebase(SPENDLY_FIREBASE_CONFIG);
    } catch (e) {
        console.error("Failed to initialize Firebase:", e);
    }

    updateCategoryDropdowns();
    setupSidebar();
    setupTabs();
    setupForms();
    setupSettings();
    setupDashboardInteractivity();
    setupMilkTracker();
    setupReportTab();
    updateHeader();
    startClock();
    updateUI();
    initCharts();
    applyTimeTheme();
    renderGroceryList();
    setupPiggyBank();

    showWelcomePopup();

    // Check theme every minute
    setInterval(applyTimeTheme, 60000);
}

async function migrateData() {
    const oldTx = localStorage.getItem('flow_tx');
    if (oldTx) {
        const txs = JSON.parse(oldTx);
        for (const t of txs) await DataService.save('transactions', t);
        localStorage.removeItem('flow_tx');
    }

    const oldBudgets = localStorage.getItem('flow_cat_budgets');
    if (oldBudgets) {
        await DataService.saveSetting('categoryBudgets', JSON.parse(oldBudgets));
        localStorage.removeItem('flow_cat_budgets');
    }

    const oldName = localStorage.getItem('flow_name');
    if (oldName) {
        await DataService.saveSetting('userName', oldName);
        localStorage.removeItem('flow_name');
    }

    const oldBalance = localStorage.getItem('flow_starting_balance');
    if (oldBalance) {
        await DataService.saveSetting('startingBalance', parseFloat(oldBalance));
        localStorage.removeItem('flow_starting_balance');
    }

    const oldCustomCats = localStorage.getItem('flow_custom_categories');
    if (oldCustomCats) {
        await DataService.saveSetting('customCategories', JSON.parse(oldCustomCats));
        localStorage.removeItem('flow_custom_categories');
    }
}

async function loadState() {
    transactions = await DataService.getAll('transactions');
    groceryItems = await DataService.getAll('groceryItems');
    categoryBudgets = await DataService.getSetting('categoryBudgets', {});
    userName = await DataService.getSetting('userName', 'Rojaa');
    startingBalance = await DataService.getSetting('startingBalance', 0);

    const customCats = await DataService.getSetting('customCategories', {});
    categoryIcons = { ...categoryIcons, ...customCats };
}

function applyTimeTheme() {
    const hour = new Date().getHours();
    // Night theme between 6 PM (18) and 6 AM (6)
    const isNight = hour < 6 || hour >= 18;

    if (isNight) {
        document.body.classList.add('dark-theme');
    } else {
        document.body.classList.remove('dark-theme');
    }
}

function showWelcomePopup() {
    const popup = document.getElementById('welcome-popup');
    const userEl = document.getElementById('welcome-user-name');
    if (popup && userEl) {
        userEl.textContent = userName;

        // Slight delay for a smoother entrance
        setTimeout(() => {
            popup.style.opacity = '1';
            popup.style.pointerEvents = 'all';
            popup.firstElementChild.style.transform = 'translateY(0)';
        }, 100);

        // Auto close after 3 seconds
        setTimeout(() => {
            popup.style.opacity = '0';
            popup.style.pointerEvents = 'none';
            popup.firstElementChild.style.transform = 'translateY(30px)';
        }, 3000);
    }
}

function startClock() {
    const timeEl = document.getElementById('clock-time');
    const secEl = document.getElementById('clock-sec');
    const ampmEl = document.getElementById('clock-ampm');

    if (!timeEl) return;

    function tick() {
        const now = new Date();
        let hours = now.getHours();
        let minutes = now.getMinutes();
        let seconds = now.getSeconds();
        const ampm = hours >= 12 ? 'PM' : 'AM';

        hours = hours % 12;
        hours = hours ? hours : 12;

        timeEl.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        secEl.textContent = seconds.toString().padStart(2, '0');
        ampmEl.textContent = ampm;
    }

    tick(); // Initial call
    setInterval(tick, 1000);
}

function setupDashboardInteractivity() {
    const monthSelect = document.getElementById('dash-month-select');
    const yearSelect = document.getElementById('dash-year-select');

    if (!monthSelect || !yearSelect) return;

    const currentYear = new Date().getFullYear();
    let yearHtml = '';
    for (let y = currentYear - 10; y <= currentYear + 2; y++) {
        yearHtml += `<option value="${y}">${y}</option>`;
    }
    yearSelect.innerHTML = yearHtml;

    const groceryYear = document.getElementById('grocery-year');
    if (groceryYear) {
        groceryYear.innerHTML = yearHtml;
        groceryYear.value = currentYear;
        const groceryMonth = document.getElementById('grocery-month');
        if (groceryMonth) groceryMonth.value = new Date().getMonth();
    }

    // Set initial values
    monthSelect.value = selectedMonth;
    yearSelect.value = selectedYear;

    const handleChange = () => {
        selectedMonth = parseInt(monthSelect.value);
        selectedYear = parseInt(yearSelect.value);
        updateUI();
    };

    monthSelect.addEventListener('change', handleChange);
    yearSelect.addEventListener('change', handleChange);
}

function updateCategoryDropdowns() {
    const optionsHtml = `<option value="" disabled selected>Select Category</option>` +
        Object.keys(categoryIcons).map(cat => `<option value="${cat}">${cat}</option>`).join('');

    const expSelect = document.getElementById('exp-category');
    if (expSelect) expSelect.innerHTML = optionsHtml;

    const budgetSelect = document.getElementById('budget-category');
    if (budgetSelect) budgetSelect.innerHTML = optionsHtml;

    updateReportCategories();
}

// --- Sidebar Logic ---
function setupSidebar() {
    const toggleBtn = document.getElementById('sidebar-toggle');
    const sideNav = document.getElementById('side-nav');

    toggleBtn.addEventListener('click', () => {
        sideNav.classList.toggle('collapsed');
        if (sideNav.classList.contains('collapsed')) {
            toggleBtn.textContent = '▶';
        } else {
            toggleBtn.textContent = '◀';
        }

        // Resize charts after transition to ensure they fit the new layout
        setTimeout(() => {
            if (dashboardChart) dashboardChart.resize();
            if (reportsChart) reportsChart.resize();
        }, 300);
    });
}

// --- Tab Logic ---
function setupTabs() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class
            navBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));

            // Add active class to clicked
            btn.classList.add('active');
            const targetId = `tab-${btn.dataset.tab}`;
            document.getElementById(targetId).classList.add('active');

            // Re-render charts if specific tabs are opened
            if (btn.dataset.tab === 'reports' && reportsChart) {
                reportsChart.resize();
            }
            if (btn.dataset.tab === 'analysis' && analysisTrendChart) {
                analysisTrendChart.resize();
            }
            if (btn.dataset.tab === 'milk') {
                loadAndRenderMilkTracker();
            }
            if (btn.dataset.tab === 'report') {
                updateReportCategories();
                generateReport();
            }
            if (btn.dataset.tab === 'piggy') {
                updatePiggyBank();
            } else {
                stopCoinAnimation();
            }
        });
    });
}

// --- Header Logic ---
function updateHeader() {
    document.getElementById('user-name-input').value = userName;

    const today = new Date();
    document.getElementById('current-date-display').textContent = today.toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });

    const hour = today.getHours();
    let timeGreeting = 'Good evening';
    if (hour >= 5 && hour < 12) timeGreeting = 'Good morning';
    else if (hour >= 12 && hour < 17) timeGreeting = 'Good afternoon';
    else if (hour >= 17 && hour < 21) timeGreeting = 'Good evening';
    else timeGreeting = 'Good night';

    document.getElementById('greeting-text').textContent = `${timeGreeting}, ${userName}!`;
}

// --- Forms Logic ---
function setupForms() {
    const todayStr = getLocalDateString();
    document.getElementById('exp-date').value = todayStr;
    document.getElementById('inc-date').value = todayStr;

    // Expense Form
    document.getElementById('expense-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const data = {
            date: document.getElementById('exp-date').value,
            category: document.getElementById('exp-category').value,
            note: document.getElementById('exp-note').value,
            amount: parseFloat(document.getElementById('exp-amount').value)
        };
        if (editTransactionId) {
            updateTransaction(editTransactionId, 'expense', data);
            if (tabBeforeEdit) {
                const returnTab = document.querySelector(`.nav-btn[data-tab="${tabBeforeEdit}"]`);
                if (returnTab) returnTab.click();
                tabBeforeEdit = null;
            }
        } else {
            addTransaction('expense', data);
        }
        resetForm('expense');
    });

    // Income Form
    document.getElementById('income-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const data = {
            date: document.getElementById('inc-date').value,
            category: document.getElementById('inc-source').value,
            note: '',
            amount: parseFloat(document.getElementById('inc-amount').value)
        };
        if (editTransactionId) {
            updateTransaction(editTransactionId, 'income', data);
            if (tabBeforeEdit) {
                const returnTab = document.querySelector(`.nav-btn[data-tab="${tabBeforeEdit}"]`);
                if (returnTab) returnTab.click();
                tabBeforeEdit = null;
            }
        } else {
            addTransaction('income', data);
        }
        resetForm('income');
    });

    // Budget Form
    document.getElementById('category-budget-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const cat = document.getElementById('budget-category').value;
        const amount = parseFloat(document.getElementById('cat-budget-amount').value);
        if (cat && !isNaN(amount) && amount >= 0) {
            categoryBudgets[cat] = amount;
            await DataService.saveSetting('categoryBudgets', categoryBudgets);
            updateUI();
        }
        e.target.reset();
    });

    // Grocery Form
    const groceryForm = document.getElementById('grocery-form');
    if (groceryForm) {
        groceryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('edit-grocery-id').value;
            const name = document.getElementById('grocery-item-name').value.trim();
            const qty = parseFloat(document.getElementById('grocery-qty').value) || 1;
            const uom = document.getElementById('grocery-uom').value;
            const expected = parseFloat(document.getElementById('grocery-expected').value) || 0;
            const actual = parseFloat(document.getElementById('grocery-actual').value) || 0;
            const targetMonth = parseInt(document.getElementById('grocery-month').value) || new Date().getMonth();
            const targetYear = parseInt(document.getElementById('grocery-year').value) || new Date().getFullYear();

            if (name) {
                if (id) {
                    // Update existing
                    const index = groceryItems.findIndex(i => i.id == id);
                    if (index > -1) {
                        groceryItems[index] = { ...groceryItems[index], name, qty, uom, expected, actual, targetMonth, targetYear, completed: actual > 0 };
                        await DataService.save('groceryItems', groceryItems[index]);
                    }
                } else {
                    // Add new
                    const newItem = {
                        id: Date.now(),
                        name, qty, uom, expected, actual, targetMonth, targetYear,
                        completed: actual > 0
                    };
                    groceryItems.unshift(newItem);
                    await DataService.save('groceryItems', newItem);
                }
                renderGroceryList();
                updateUI(); // Check alerts
                resetGroceryForm();
            }
        });

        document.getElementById('grocery-cancel-btn').addEventListener('click', resetGroceryForm);
    }
}

function resetGroceryForm() {
    document.getElementById('grocery-form').reset();
    document.getElementById('edit-grocery-id').value = '';
    const m = document.getElementById('grocery-month');
    if (m) m.value = new Date().getMonth();
    const y = document.getElementById('grocery-year');
    if (y) y.value = new Date().getFullYear();
    document.getElementById('grocery-form-title').textContent = 'New Thing to Buy';
    document.getElementById('grocery-submit-btn').textContent = 'Add to List';
    document.getElementById('grocery-cancel-btn').style.display = 'none';
}

function resetForm(type) {
    editTransactionId = null;
    const todayStr = getLocalDateString();
    if (type === 'expense') {
        document.getElementById('expense-form').reset();
        document.getElementById('exp-date').value = todayStr;
        document.querySelector('#expense-form .submit-btn').textContent = 'Add Expense';
    } else {
        document.getElementById('income-form').reset();
        document.getElementById('inc-date').value = todayStr;
        document.querySelector('#income-form .submit-btn').textContent = 'Add Income';
    }
}

async function addTransaction(type, data) {
    if (!data.amount || !data.category || !data.date) return;

    const newTx = {
        id: Date.now(),
        type: type,
        ...data
    };
    transactions.unshift(newTx);
    await DataService.save('transactions', newTx);
    updateUI();
}

async function updateTransaction(id, type, data) {
    if (!data.amount || !data.category || !data.date) return;
    const index = transactions.findIndex(t => t.id === id);
    if (index > -1) {
        transactions[index] = { ...transactions[index], ...data };
        await DataService.save('transactions', transactions[index]);
        updateUI();
    }
}

// Make globally accessible for inline onclick
window.editItem = function (id) {
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;
    editTransactionId = id;

    // Remember the tab the user is currently on
    const activeTab = document.querySelector('.nav-btn.active');
    if (activeTab) {
        tabBeforeEdit = activeTab.dataset.tab;
    }

    // Switch to appropriate tab
    const tabBtn = document.querySelector(`.nav-btn[data-tab="${tx.type}"]`);
    if (tabBtn) tabBtn.click();

    if (tx.type === 'expense') {
        document.getElementById('exp-date').value = tx.date;
        document.getElementById('exp-category').value = tx.category;
        document.getElementById('exp-note').value = tx.note || '';
        document.getElementById('exp-amount').value = tx.amount;
        document.querySelector('#expense-form .submit-btn').textContent = 'Update Expense';
    } else {
        document.getElementById('inc-date').value = tx.date;
        document.getElementById('inc-source').value = tx.category;
        document.getElementById('inc-amount').value = tx.amount;
        document.querySelector('#income-form .submit-btn').textContent = 'Update Income';
    }
};

window.deleteItem = async function (id) {
    if (confirm('Delete this transaction?')) {
        transactions = transactions.filter(t => t.id !== id);
        await DataService.delete('transactions', id);
        updateUI();
    }
};

// --- Settings Logic ---
function parseFirebaseConfig(text) {
    text = text.trim();
    if (!text) return null;

    // Look for a curly brace block that contains apiKey
    const match = text.match(/\{[^{}]*apiKey[^{}]*\}/);
    if (match) {
        text = match[0];
    } else {
        // Fallback: try to find any curly brace block if apiKey match fails
        const fallbackMatch = text.match(/\{[\s\S]*\}/);
        if (fallbackMatch) {
            text = fallbackMatch[0];
        }
    }

    try {
        return JSON.parse(text);
    } catch (e) {
        try {
            const fn = new Function("return " + text + ";");
            const obj = fn();
            if (obj && typeof obj === 'object') {
                return obj;
            }
        } catch (evalErr) { }
        throw new Error("Invalid Firebase Config format. Please copy the entire config object starting with '{' and ending with '}'.");
    }
}

function setupSettings() {
    // Bind sub-tabs inside settings
    const subTabBtns = document.querySelectorAll('.sub-tab-btn');
    const settingsPanels = document.querySelectorAll('.settings-panel');
    subTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            subTabBtns.forEach(b => b.classList.remove('active'));
            settingsPanels.forEach(p => {
                p.style.display = 'none';
                p.classList.remove('active');
            });
            
            btn.classList.add('active');
            const targetPanel = document.getElementById(`settings-${btn.dataset.subTab}-panel`);
            if (targetPanel) {
                targetPanel.style.display = 'block';
                targetPanel.classList.add('active');
            }
        });
    });

    // Populate Firebase config if saved
    const configInput = document.getElementById('firebase-config-input');
    if (configInput) {
        DataService.getSetting('firebaseConfig', null).then(savedConfig => {
            if (savedConfig) {
                configInput.value = JSON.stringify(savedConfig, null, 2);
            }
        });
    }

    function showAuthError(msg) {
        const errEl = document.getElementById('firebase-error-msg');
        if (errEl) {
            errEl.textContent = msg;
            errEl.style.display = 'block';
            setTimeout(() => { errEl.style.display = 'none'; }, 5000);
        } else {
            alert(msg);
        }
    }

    // Bind Firebase buttons
    const loginBtn = document.getElementById('firebase-login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const email = document.getElementById('firebase-email-input').value.trim();
            const password = document.getElementById('firebase-password-input').value;

            if (!email || !password) {
                showAuthError("Please enter both email and password.");
                return;
            }

            try {
                loginBtn.textContent = "Connecting...";
                await initFirebase(SPENDLY_FIREBASE_CONFIG);
                await firebase.auth().signInWithEmailAndPassword(email, password);
                loginBtn.textContent = "Login / Connect";
            } catch (err) {
                console.error("Sign in failed:", err);
                showAuthError("Connection failed: " + err.message);
                loginBtn.textContent = "Login / Connect";
            }
        });
    }

    const registerBtn = document.getElementById('firebase-register-btn');
    if (registerBtn) {
        registerBtn.addEventListener('click', async () => {
            const email = document.getElementById('firebase-email-input').value.trim();
            const password = document.getElementById('firebase-password-input').value;

            if (!email || !password) {
                showAuthError("Please enter email and password for the new account.");
                return;
            }
            if (password.length < 6) {
                showAuthError("Password must be at least 6 characters.");
                return;
            }

            try {
                registerBtn.textContent = "Creating...";
                await initFirebase(SPENDLY_FIREBASE_CONFIG);
                await firebase.auth().createUserWithEmailAndPassword(email, password);
                registerBtn.textContent = "Create Account";
            } catch (err) {
                console.error("Registration failed:", err);
                showAuthError("Registration failed: " + err.message);
                registerBtn.textContent = "Create Account";
            }
        });
    }

    const logoutBtn = document.getElementById('firebase-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            if (confirm("Are you sure you want to sign out? Your cloud sync will stop, but local data will remain.")) {
                try {
                    await firebase.auth().signOut();
                    alert("Signed out successfully.");
                } catch (err) {
                    alert("Sign out failed: " + err.message);
                }
            }
        });
    }

    const syncBtn = document.getElementById('firebase-sync-now-btn');
    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            syncBtn.disabled = true;
            const originalText = syncBtn.textContent;
            syncBtn.textContent = "🔄 Syncing...";
            try {
                await syncWithFirebase();
                alert("Cloud sync complete!");
            } catch (e) {
                console.error(e);
            } finally {
                syncBtn.disabled = false;
                syncBtn.textContent = originalText;
            }
        });
    }

    document.getElementById('save-name-btn').addEventListener('click', async () => {
        const newName = document.getElementById('user-name-input').value.trim();
        if (newName) {
            userName = newName;
            await DataService.saveSetting('userName', userName);
            updateHeader();
            alert('Name updated successfully!');
        }
    });

    const balanceInput = document.getElementById('starting-balance-input');
    if (balanceInput) {
        balanceInput.value = startingBalance || '';
    }

    document.getElementById('save-balance-btn').addEventListener('click', async () => {
        const val = parseFloat(document.getElementById('starting-balance-input').value) || 0;
        startingBalance = val;
        await DataService.saveSetting('startingBalance', val);
        updateUI();
        alert('Starting balance saved!');
    });

    const newCatNameInput = document.getElementById('new-cat-name');
    const newCatEmojiInput = document.getElementById('new-cat-emoji');
    let userModifiedEmoji = false;

    newCatEmojiInput.addEventListener('input', () => {
        userModifiedEmoji = true;
    });

    newCatNameInput.addEventListener('input', (e) => {
        if (userModifiedEmoji) return;
        const name = e.target.value.trim();
        if (name.length >= 2) {
            newCatEmojiInput.value = autoSuggestEmoji(name);
        } else if (name.length === 0) {
            newCatEmojiInput.value = '';
        }
    });

    document.getElementById('add-category-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const emoji = document.getElementById('new-cat-emoji').value.trim();
        const name = document.getElementById('new-cat-name').value.trim();
        if (emoji && name) {
            const customCats = await DataService.getSetting('customCategories', {});
            customCats[name] = emoji;
            await DataService.saveSetting('customCategories', customCats);

            categoryIcons[name] = emoji;
            updateCategoryDropdowns();
            alert('Category added successfully!');
            e.target.reset();
            userModifiedEmoji = false;
        }
    });

    // Backup & Restore
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            try {
                const data = {
                    transactions: await DataService.getAll('transactions'),
                    groceryItems: await DataService.getAll('groceryItems'),
                    milkTracker: await DataService.getAll('milkTracker'),
                    settings: {
                        categoryBudgets: await DataService.getSetting('categoryBudgets', {}),
                        userName: await DataService.getSetting('userName', 'Rojaa'),
                        startingBalance: await DataService.getSetting('startingBalance', 0),
                        customCategories: await DataService.getSetting('customCategories', {})
                    }
                };

                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `spendly_backup_${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error('Export failed:', err);
                alert('Failed to export data.');
            }
        });
    }

    const importBtnTrigger = document.getElementById('import-btn-trigger');
    const importFile = document.getElementById('import-file');
    if (importBtnTrigger && importFile) {
        importBtnTrigger.addEventListener('click', () => {
            importFile.click();
        });

        importFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const data = JSON.parse(event.target.result);

                    if (confirm('Importing data will REPLACE your current data completely. Are you sure you want to proceed?')) {
                        // Clear existing data
                        await DataService.clearAll();

                        // Restore Transactions
                        if (data.transactions && Array.isArray(data.transactions)) {
                            for (const tx of data.transactions) {
                                await DataService.save('transactions', tx);
                            }
                        }

                        // Restore Grocery Items
                        if (data.groceryItems && Array.isArray(data.groceryItems)) {
                            for (const item of data.groceryItems) {
                                await DataService.save('groceryItems', item);
                            }
                        }

                        // Restore Milk Tracker
                        if (data.milkTracker && Array.isArray(data.milkTracker)) {
                            for (const item of data.milkTracker) {
                                await DataService.save('milkTracker', item);
                            }
                        }

                        // Restore Settings
                        if (data.settings) {
                            if (data.settings.categoryBudgets) await DataService.saveSetting('categoryBudgets', data.settings.categoryBudgets);
                            if (data.settings.userName) await DataService.saveSetting('userName', data.settings.userName);
                            if (data.settings.startingBalance !== undefined) await DataService.saveSetting('startingBalance', data.settings.startingBalance);
                            if (data.settings.customCategories) await DataService.saveSetting('customCategories', data.settings.customCategories);
                        }

                        alert('Data successfully imported! The app will now reload.');
                        window.location.reload();
                    }
                } catch (err) {
                    console.error('Import failed:', err);
                    alert('Invalid backup file. Please ensure it is a valid Spendly JSON backup.');
                }

                // Clear the input
                importFile.value = '';
            };
            reader.readAsText(file);
        });
    }

    document.getElementById('clear-data').addEventListener('click', async () => {
        if (confirm('Are you absolutely sure? This cannot be undone.')) {
            transactions = [];
            categoryBudgets = {};
            await DataService.clearAll();
            updateUI();

            // Reload page to reset hard state
            window.location.reload();
        }
    });
}

// --- Grocery Logic ---
function renderGroceryList() {
    const listEl = document.getElementById('grocery-list');
    if (!listEl) return;

    listEl.innerHTML = '';
    let totalExp = 0;
    let totalAct = 0;

    groceryItems.forEach(item => {
        const itemTotalExp = item.expected * (item.qty || 1);
        const itemTotalAct = item.actual * (item.qty || 1);

        totalExp += itemTotalExp;
        totalAct += itemTotalAct;

        const diff = itemTotalExp - itemTotalAct;
        const diffColor = diff >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        const diffText = item.actual > 0 ? (diff >= 0 ? `Saved ₹${diff}` : `Over ₹${Math.abs(diff)}`) : '';

        const itemEl = document.createElement('div');
        itemEl.className = `transaction-item grocery-item neu-flat ${item.completed ? 'completed' : ''}`;
        itemEl.style.marginBottom = '1rem';
        itemEl.innerHTML = `
            <div class="tx-left">
                <input type="checkbox" class="custom-checkbox" ${item.completed ? 'checked' : ''} 
                    onchange="toggleGroceryStatus(${item.id}, this.checked)">
                <div class="tx-details">
                    <span class="tx-title">${item.name} <small style="color: var(--text-muted)">(${item.qty} ${item.uom})</small></span>
                    <span class="tx-date" style="color: ${diffColor}">${diffText}</span>
                </div>
            </div>
            <div style="text-align: right; display: flex; align-items: center; gap: 1rem;">
                <div style="font-size: 0.85rem; line-height: 1.2;">
                    <div style="color: var(--text-muted)">Exp: ₹${itemTotalExp}</div>
                    <div style="font-weight: 700; color: var(--text-heading)">Act: ₹${itemTotalAct || '--'}</div>
                </div>
                <div style="display: flex; gap: 0.3rem;">
                    <button onclick="editGroceryItem(${item.id})" class="action-btn" title="Edit">✏️</button>
                    <button onclick="deleteGroceryItem(${item.id})" class="action-btn" title="Delete">🗑️</button>
                </div>
            </div>
        `;
        listEl.appendChild(itemEl);
    });

    const totalPages = Math.ceil(groceryItems.length / ITEMS_PER_PAGE);
    const currentPage = paginationState['grocery-list'];
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const paginatedItems = groceryItems.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    listEl.innerHTML = ''; // Clear again to append paginated
    paginatedItems.forEach(item => {
        const itemTotalExp = item.expected * (item.qty || 1);
        const itemTotalAct = item.actual * (item.qty || 1);

        const diff = itemTotalExp - itemTotalAct;
        const diffColor = diff >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        const diffText = item.actual > 0 ? (diff >= 0 ? `Saved ₹${diff}` : `Over ₹${Math.abs(diff)}`) : '';

        const itemEl = document.createElement('div');
        itemEl.className = `transaction-item grocery-item neu-flat ${item.completed ? 'completed' : ''}`;
        itemEl.style.marginBottom = '1rem';
        itemEl.innerHTML = `
            <div class="tx-left">
                <input type="checkbox" class="custom-checkbox" ${item.completed ? 'checked' : ''} 
                    onchange="toggleGroceryStatus(${item.id}, this.checked)">
                <div class="tx-details">
                    <span class="tx-title">${item.name} <small style="color: var(--text-muted)">(${item.qty} ${item.uom})</small></span>
                    <span class="tx-date" style="color: ${diffColor}">${diffText}</span>
                </div>
            </div>
            <div style="text-align: right; display: flex; align-items: center; gap: 1rem;">
                <div style="font-size: 0.85rem; line-height: 1.2;">
                    <div style="color: var(--text-muted)">Exp: ₹${itemTotalExp}</div>
                    <div style="font-weight: 700; color: var(--text-heading)">Act: ₹${itemTotalAct || '--'}</div>
                </div>
                <div style="display: flex; gap: 0.3rem;">
                    <button onclick="editGroceryItem(${item.id})" class="action-btn" title="Edit">✏️</button>
                    <button onclick="deleteGroceryItem(${item.id})" class="action-btn" title="Delete">🗑️</button>
                </div>
            </div>
        `;
        listEl.appendChild(itemEl);
    });

    if (totalPages > 1) {
        listEl.innerHTML += `
        <div style="display: flex; justify-content: center; gap: 1rem; padding: 1rem 0;">
            <button class="neu-btn" style="padding: 0.5rem 1rem;" onclick="changePage('grocery-list', -1)" ${currentPage === 1 ? 'disabled style="opacity: 0.5;"' : ''}>Previous</button>
            <span style="display: flex; align-items: center; font-size: 0.9rem; color: var(--text-muted);">Page ${currentPage} of ${totalPages}</span>
            <button class="neu-btn" style="padding: 0.5rem 1rem;" onclick="changePage('grocery-list', 1)" ${currentPage === totalPages ? 'disabled style="opacity: 0.5;"' : ''}>Next</button>
        </div>`;
    }

    document.getElementById('total-grocery-exp').textContent = `₹${totalExp.toLocaleString()}`;
    document.getElementById('total-grocery-act').textContent = `₹${totalAct.toLocaleString()}`;
}

window.toggleGroceryStatus = async function (id, isChecked) {
    const index = groceryItems.findIndex(i => i.id === id);
    if (index > -1) {
        groceryItems[index].completed = isChecked;
        await DataService.save('groceryItems', groceryItems[index]);
        renderGroceryList();
        updateUI();
    }
};

window.editGroceryItem = function (id) {
    const item = groceryItems.find(i => i.id === id);
    if (!item) return;

    document.getElementById('edit-grocery-id').value = item.id;
    document.getElementById('grocery-item-name').value = item.name;
    document.getElementById('grocery-qty').value = item.qty || 1;
    document.getElementById('grocery-uom').value = item.uom || 'kg';
    document.getElementById('grocery-expected').value = item.expected;
    document.getElementById('grocery-actual').value = item.actual || '';
    if (item.targetMonth !== undefined) document.getElementById('grocery-month').value = item.targetMonth;
    if (item.targetYear !== undefined) document.getElementById('grocery-year').value = item.targetYear;

    document.getElementById('grocery-form-title').textContent = 'Update Item';
    document.getElementById('grocery-submit-btn').textContent = 'Update Item';
    document.getElementById('grocery-cancel-btn').style.display = 'block';

    // Smooth scroll to form on mobile
    document.getElementById('grocery-form').scrollIntoView({ behavior: 'smooth' });
};

window.deleteGroceryItem = async function (id) {
    if (confirm('Delete this item?')) {
        groceryItems = groceryItems.filter(i => i.id !== id);
        await DataService.delete('groceryItems', id);
        renderGroceryList();
    }
};

// --- UI Updates ---
function checkGroceryAlerts() {
    const alertEl = document.getElementById('dashboard-alert-container');
    const alertText = document.getElementById('dashboard-alert-text');
    if (!alertEl || !alertText) return;

    const today = new Date();
    // Get last day of current month
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    // Difference in days
    const daysLeft = Math.ceil((endOfMonth - today) / (1000 * 60 * 60 * 24));

    if (daysLeft <= 5 && daysLeft >= 0) {
        const pendingItems = groceryItems.filter(i =>
            i.targetMonth === today.getMonth() &&
            i.targetYear === today.getFullYear() &&
            !i.completed
        );

        if (pendingItems.length > 0) {
            alertEl.style.display = 'block';
            const dayText = daysLeft === 1 ? '1 day' : `${daysLeft} days`;
            alertText.textContent = `You have ${pendingItems.length} pending item(s) in "Things to Buy" for this month with ${dayText} left!`;
        } else {
            alertEl.style.display = 'none';
        }
    } else {
        alertEl.style.display = 'none';
    }
}

function updateUI() {
    checkGroceryAlerts();

    let currentMonthInc = 0, currentMonthExp = 0;
    let previousMonthNet = startingBalance;
    const expenses = [], incomes = [];
    const spentPerCategory = {};

    transactions.forEach(t => {
        const d = parseLocalDate(t.date);
        const isCurrentMonth = d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
        const isBeforeThisMonth = d.getFullYear() < selectedYear || (d.getFullYear() === selectedYear && d.getMonth() < selectedMonth);

        if (t.type === 'income') {
            if (isCurrentMonth) currentMonthInc += t.amount;
            if (isBeforeThisMonth) previousMonthNet += t.amount;
            incomes.push(t);
        } else {
            if (isCurrentMonth) {
                currentMonthExp += t.amount;
                spentPerCategory[t.category] = (spentPerCategory[t.category] || 0) + t.amount;
            }
            if (isBeforeThisMonth) previousMonthNet -= t.amount;
            expenses.push(t);
        }
    });

    // Calculate Total Monthly Budget
    const monthlyBudget = Object.values(categoryBudgets).reduce((sum, val) => sum + val, 0);
    const effectiveBudget = monthlyBudget;

    // Header Updates
    const leftoverEl = document.getElementById('previous-leftover');
    if (leftoverEl) {
        leftoverEl.textContent = `₹${Math.abs(previousMonthNet).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
        leftoverEl.style.color = previousMonthNet < 0 ? 'var(--accent-red)' : 'var(--text-heading)';
        if (previousMonthNet < 0) leftoverEl.textContent = `-` + leftoverEl.textContent;
    }

    const fixedLimitEl = document.getElementById('monthly-fixed-limit');
    if (fixedLimitEl) {
        fixedLimitEl.textContent = `₹${monthlyBudget.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    }

    const totalEffEl = document.getElementById('total-effective-budget');
    if (totalEffEl) {
        totalEffEl.textContent = `₹${Math.abs(effectiveBudget).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
        totalEffEl.style.color = effectiveBudget < 0 ? 'var(--accent-red)' : 'var(--accent-green)';
        if (effectiveBudget < 0) totalEffEl.textContent = `-` + totalEffEl.textContent;
    }

    const estSavingsEl = document.getElementById('est-savings');
    if (estSavingsEl) {
        const estSavings = currentMonthInc - monthlyBudget;
        estSavingsEl.textContent = `₹${Math.abs(estSavings).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
        estSavingsEl.style.color = estSavings < 0 ? 'var(--accent-red)' : 'var(--accent-green)';
        if (estSavings < 0) estSavingsEl.textContent = `-` + estSavingsEl.textContent;
    }

    const netEl = document.getElementById('net-balance');
    const labelEl = document.getElementById('balance-label');

    if (monthlyBudget > 0) {
        const remaining = effectiveBudget - currentMonthExp;
        if (labelEl) labelEl.textContent = 'Remaining Budget';
        netEl.textContent = `₹${Math.abs(remaining).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
        netEl.style.color = remaining < 0 ? 'var(--accent-red)' : 'var(--text-heading)';
        if (remaining < 0) netEl.textContent = `-` + netEl.textContent;
    } else {
        const net = currentMonthInc - currentMonthExp + previousMonthNet;
        if (labelEl) labelEl.textContent = 'Net Balance (Including Leftover)';
        netEl.textContent = `₹${Math.abs(net).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
        netEl.style.color = net < 0 ? 'var(--accent-red)' : 'var(--text-heading)';
        if (net < 0) netEl.textContent = `-` + netEl.textContent;
    }

    // Dashboard Updates
    document.getElementById('dash-income').textContent = `₹${currentMonthInc.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    document.getElementById('dash-expense').textContent = `₹${currentMonthExp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    // Render Category Budgets
    document.getElementById('total-budget-sum').textContent = `₹${monthlyBudget.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    const catBudgetList = document.getElementById('category-budget-list');
    const categoriesToRender = Object.keys(categoryIcons).filter(cat => categoryBudgets[cat] > 0 || spentPerCategory[cat] > 0);

    if (categoriesToRender.length === 0) {
        catBudgetList.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No budgets or spending yet.</div>`;
    } else {
        catBudgetList.innerHTML = categoriesToRender.map(cat => {
            const budgetAmt = categoryBudgets[cat] || 0;
            const spentAmt = spentPerCategory[cat] || 0;
            const percentage = budgetAmt > 0 ? Math.min((spentAmt / budgetAmt) * 100, 100) : (spentAmt > 0 ? 100 : 0);

            let color = 'var(--accent-teal)';
            if (budgetAmt > 0) {
                if (percentage >= 90) color = 'var(--accent-red)';
                else if (percentage >= 75) color = 'var(--accent-orange)';
            } else if (spentAmt > 0) {
                color = 'var(--accent-red)';
            }

            return `
            <div class="transaction-item neu-flat" style="flex-direction: column; align-items: stretch; gap: 4px; padding: 8px 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <div class="tx-icon" style="color: var(--text-heading); width: 26px; height: 26px; font-size: 0.9rem; min-width: 26px;">${categoryIcons[cat]}</div>
                        <span class="tx-title" style="font-size: 0.9rem;">${cat}</span>
                    </div>
                    <div style="text-align: right; line-height: 1;">
                        <strong style="color: ${color}; font-size: 0.9rem;">₹${spentAmt.toLocaleString('en-IN')}</strong> <span style="font-size: 0.8rem; color: var(--text-muted);">/ ₹${budgetAmt.toLocaleString('en-IN')}</span>
                    </div>
                </div>
                ${budgetAmt > 0 ? `
                <div class="progress-bar-container" style="background: var(--bg-color); border-radius: var(--radius-sm); height: 4px; box-shadow: inset 1px 1px 3px rgba(163,177,198, 0.6), inset -1px -1px 3px rgba(255,255,255, 0.5); overflow: hidden;">
                    <div style="width: ${percentage}%; background: ${color}; height: 100%; border-radius: var(--radius-sm); transition: width 0.3s ease;"></div>
                </div>
                ` : `<div style="font-size: 0.7rem; color: var(--accent-red); text-align: right; line-height: 1;">No limit set!</div>`}
            </div>`;
        }).join('');
    }

    // Sort and Render Lists
    const sortDesc = (a, b) => {
        const dateDiff = parseLocalDate(b.date) - parseLocalDate(a.date);
        return dateDiff !== 0 ? dateDiff : b.id - a.id;
    };
    expenses.sort(sortDesc);
    incomes.sort(sortDesc);

    renderList('expense-list', expenses, true);
    renderList('income-list', incomes, true);

    updateCharts(currentMonthExp, previousMonthNet);
    updateAnalysisUI();
    updatePiggyBank();
}

function renderList(elementId, items, showActions = true) {
    const el = document.getElementById(elementId);
    if (items.length === 0) {
        el.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No items found.</div>`;
        return;
    }

    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const currentPage = paginationState[elementId];
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const paginatedItems = items.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    let html = paginatedItems.map(item => {
        const isExp = item.type === 'expense';
        const icon = isExp ? (categoryIcons[item.category] || '🏷️') : '💰';
        const sign = isExp ? '-' : '+';
        const amountClass = isExp ? 'expense' : 'income';

        return `
        <div class="transaction-item neu-flat" data-id="${item.id}" style="padding: 8px 12px; margin-bottom: 8px;">
            <div class="tx-left" style="gap: 8px;">
                <div class="tx-icon" style="color: ${isExp ? 'var(--accent-teal)' : 'var(--accent-green)'}; width: 26px; height: 26px; font-size: 0.9rem; min-width: 26px;">${icon}</div>
                <div class="tx-details">
                    <span class="tx-title" style="font-size: 0.9rem; line-height: 1;">${item.category}</span>
                    <span class="tx-date" style="font-size: 0.75rem;">${formatDate(item.date)} ${item.note ? `• ${item.note}` : ''}</span>
                </div>
            </div>
            <div class="tx-right" style="gap: 8px;">
                <strong class="tx-amount ${amountClass}" style="font-size: 0.9rem;">${sign}₹${item.amount.toLocaleString('en-IN')}</strong>
                ${showActions ? `
                <div class="tx-actions" style="gap: 4px;">
                    <button class="action-btn edit-btn" onclick="editItem(${item.id})" style="padding: 4px; font-size: 0.8rem; min-width: unset;">✏️</button>
                    <button class="action-btn delete-btn" onclick="deleteItem(${item.id})" style="padding: 4px; font-size: 0.8rem; min-width: unset;">🗑️</button>
                </div>
                ` : ''}
            </div>
        </div>`;
    }).join('');

    if (totalPages > 1) {
        html += `
        <div style="display: flex; justify-content: center; gap: 1rem; padding: 1rem 0;">
            <button class="neu-btn" style="padding: 0.5rem 1rem;" onclick="changePage('${elementId}', -1)" ${currentPage === 1 ? 'disabled style="opacity: 0.5;"' : ''}>Previous</button>
            <span style="display: flex; align-items: center; font-size: 0.9rem; color: var(--text-muted);">Page ${currentPage} of ${totalPages}</span>
            <button class="neu-btn" style="padding: 0.5rem 1rem;" onclick="changePage('${elementId}', 1)" ${currentPage === totalPages ? 'disabled style="opacity: 0.5;"' : ''}>Next</button>
        </div>`;
    }

    el.innerHTML = html;
}

window.changePage = function (elementId, dir) {
    paginationState[elementId] += dir;
    if (elementId === 'grocery-list') {
        renderGroceryList();
    } else {
        updateUI();
    }
};

function formatDate(dateStr) {
    return parseLocalDate(dateStr).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

// --- Charts Logic ---
function initCharts() {
    const dashCtx = document.getElementById('dashboardChart').getContext('2d');
    dashboardChart = new Chart(dashCtx, {
        type: 'doughnut',
        data: { labels: [], datasets: [{ data: [], backgroundColor: chartColors, borderWidth: 0, hoverOffset: 5 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return context.label + ': ₹' + context.parsed.toLocaleString('en-IN');
                        }
                    }
                }
            },
            cutout: '80%'
        }
    });

    const repCtx = document.getElementById('reportsChart').getContext('2d');
    reportsChart = new Chart(repCtx, {
        type: 'bar',
        data: { labels: [], datasets: [{ label: 'Expenses', data: [], backgroundColor: chartColors, borderRadius: 5 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(163,177,198, 0.2)' } },
                x: { grid: { display: false } }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return '₹' + context.parsed.y.toLocaleString('en-IN');
                        }
                    }
                }
            }
        }
    });

    const trendCtxEl = document.getElementById('analysis-trend-chart');
    if (trendCtxEl) {
        const ctx = trendCtxEl.getContext('2d');

        const gradientInc = ctx.createLinearGradient(0, 0, 0, 250);
        gradientInc.addColorStop(0, 'rgba(34, 197, 94, 0.5)');
        gradientInc.addColorStop(1, 'rgba(34, 197, 94, 0.0)');

        const gradientExp = ctx.createLinearGradient(0, 0, 0, 250);
        gradientExp.addColorStop(0, 'rgba(239, 68, 68, 0.5)');
        gradientExp.addColorStop(1, 'rgba(239, 68, 68, 0.0)');

        analysisTrendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [], datasets: [
                    {
                        label: 'Income',
                        data: [],
                        borderColor: 'rgba(34, 197, 94, 1)',
                        backgroundColor: gradientInc,
                        fill: true,
                        tension: 0.4,
                        borderWidth: 3,
                        pointBackgroundColor: 'var(--bg-color)',
                        pointBorderColor: 'rgba(34, 197, 94, 1)',
                        pointBorderWidth: 2,
                        pointRadius: 4,
                        pointHoverRadius: 6
                    },
                    {
                        label: 'Expense',
                        data: [],
                        borderColor: 'rgba(239, 68, 68, 1)',
                        backgroundColor: gradientExp,
                        fill: true,
                        tension: 0.4,
                        borderWidth: 3,
                        pointBackgroundColor: 'var(--bg-color)',
                        pointBorderColor: 'rgba(239, 68, 68, 1)',
                        pointBorderWidth: 2,
                        pointRadius: 4,
                        pointHoverRadius: 6
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(163,177,198, 0.2)', borderDash: [5, 5] },
                        border: { display: false },
                        ticks: {
                            callback: function (value) {
                                return '₹' + value.toLocaleString('en-IN');
                            }
                        }
                    },
                    x: {
                        grid: { display: false },
                        border: { display: false }
                    }
                },
                plugins: {
                    legend: { display: true, position: 'top', labels: { usePointStyle: true, boxWidth: 8 } },
                    tooltip: {
                        backgroundColor: 'rgba(20, 25, 30, 0.9)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 10,
                        boxPadding: 4,
                        usePointStyle: true,
                        callbacks: {
                            label: function (context) {
                                return context.dataset.label + ': ₹' + context.parsed.y.toLocaleString('en-IN');
                            }
                        }
                    }
                }
            }
        });
    }

    updateUI(); // Trigger initial chart update
}

function updateCharts(currentMonthExp, previousMonthNet = 0) {
    if (!dashboardChart || !reportsChart) return;

    const catTotals = {};
    const categories = Object.keys(categoryIcons);
    categories.forEach(c => catTotals[c] = 0);

    transactions.filter(t => t.type === 'expense').forEach(t => {
        const d = parseLocalDate(t.date);
        if (d.getMonth() === selectedMonth && d.getFullYear() === selectedYear) {
            if (catTotals[t.category] !== undefined) catTotals[t.category] += t.amount;
            else catTotals['Other'] += t.amount;
        }
    });

    // Update Dashboard Doughnut
    dashboardChart.data.labels = categories;
    dashboardChart.data.datasets[0].data = categories.map(c => catTotals[c]);
    dashboardChart.update();

    // Update Reports Bar Chart
    reportsChart.data.labels = categories;
    reportsChart.data.datasets[0].data = categories.map(c => catTotals[c]);
    reportsChart.data.datasets[0].backgroundColor = chartColors.slice(0, categories.length);
    reportsChart.update();

    const legendHtml = categories.map((cat, index) => {
        const color = chartColors[index % chartColors.length];
        return `
        <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; padding: 0.3rem 0.6rem; background: var(--bg-color); border-radius: var(--radius-sm); box-shadow: inset 1px 1px 3px rgba(163,177,198,0.4), inset -1px -1px 3px rgba(255,255,255,0.5);">
            <div style="width: 10px; height: 10px; border-radius: 50%; background-color: ${color};"></div>
            <span>${categoryIcons[cat]} <span style="color: var(--text-muted);">${cat}</span></span>
        </div>`;
    }).join('');

    const legendEl = document.getElementById('reports-legend');
    if (legendEl) legendEl.innerHTML = legendHtml;

    // --- Smart Insights Calculation ---
    const now = new Date();
    const isCurrentMonthView = selectedMonth === now.getMonth() && selectedYear === now.getFullYear();
    const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    const daysPassed = isCurrentMonthView ? now.getDate() : daysInMonth;

    const dailyAvg = currentMonthExp / (daysPassed || 1);

    let topCat = 'None';
    let maxSpent = 0;
    Object.entries(catTotals).forEach(([cat, amt]) => {
        if (amt > maxSpent) {
            maxSpent = amt;
            topCat = cat;
        }
    });

    const monthlyBudget = Object.values(categoryBudgets).reduce((sum, val) => sum + val, 0);
    const effectiveBudget = monthlyBudget;
    const utilization = effectiveBudget > 0 ? (currentMonthExp / effectiveBudget) * 100 : 0;

    // Update Insights UI
    const dailyAvgEl = document.getElementById('daily-avg');
    if (dailyAvgEl) dailyAvgEl.textContent = `₹${dailyAvg.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

    const topCatEl = document.getElementById('top-expense-cat');
    if (topCatEl) topCatEl.textContent = topCat !== 'None' ? `${categoryIcons[topCat]} ${topCat}` : 'None';

    const utilEl = document.getElementById('budget-utilization');
    if (utilEl) utilEl.textContent = `${utilization.toFixed(0)}%`;

    let centerHtml = '';
    if (monthlyBudget > 0) {
        const remaining = effectiveBudget - currentMonthExp;
        const color = remaining < 0 ? 'var(--accent-red)' : 'var(--text-heading)';
        centerHtml = `<span style="font-size: 0.8rem; color: var(--text-muted); display: block;">${remaining < 0 ? 'Over' : 'Left'}</span>
                      <span style="color: ${color}; font-size: 1.1rem;">₹${Math.abs(remaining).toLocaleString('en-IN')}</span>`;
    } else {
        centerHtml = `<span style="font-size: 0.8rem; color: var(--text-muted); display: block;">Spent</span>
                      <span style="font-size: 1.1rem;">₹${currentMonthExp.toLocaleString('en-IN')}</span>`;
    }
    document.getElementById('chart-center-text').innerHTML = centerHtml;

    // Update Reports Bar Chart with better filtering
    const activeCategories = categories.filter(c => catTotals[c] > 0);
    reportsChart.data.labels = activeCategories;
    reportsChart.data.datasets[0].data = activeCategories.map(c => catTotals[c]);
    reportsChart.data.datasets[0].backgroundColor = activeCategories.map(c => {
        const idx = categories.indexOf(c);
        return chartColors[idx % chartColors.length];
    });
    reportsChart.update();
}

function updateAnalysisUI() {
    if (!analysisTrendChart) return;

    // 1. 6-Month Trend Data
    const labels = [];
    const incomeData = [];
    const expenseData = [];

    const now = new Date(selectedYear, selectedMonth, 1);

    for (let i = 5; i >= 0; i--) {
        const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const m = targetDate.getMonth();
        const y = targetDate.getFullYear();

        const monthName = targetDate.toLocaleDateString('en-IN', { month: 'short' });
        labels.push(`${monthName} '${y.toString().slice(-2)}`);

        let mInc = 0;
        let mExp = 0;

        transactions.forEach(t => {
            const d = parseLocalDate(t.date);
            if (d.getMonth() === m && d.getFullYear() === y) {
                if (t.type === 'income') mInc += t.amount;
                else mExp += t.amount;
            }
        });

        incomeData.push(mInc);
        expenseData.push(mExp);
    }

    analysisTrendChart.data.labels = labels;
    analysisTrendChart.data.datasets[0].data = incomeData;
    analysisTrendChart.data.datasets[1].data = expenseData;
    analysisTrendChart.update();

    // 2. Top Categories All-Time
    const catTotals = {};
    transactions.filter(t => t.type === 'expense').forEach(t => {
        catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
    });

    const topCatsList = document.getElementById('analysis-top-categories');
    if (topCatsList) {
        const sortedCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (sortedCats.length === 0) {
            topCatsList.innerHTML = `<span style="color: var(--text-muted);">No expenses yet.</span>`;
        } else {
            topCatsList.innerHTML = sortedCats.map(([cat, amt], idx) => {
                const icon = categoryIcons[cat] || '🏷️';
                return `
                <div class="neu-flat" style="display: flex; justify-content: space-between; padding: 0.8rem; align-items: center; border-radius: var(--radius-sm);">
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <span style="font-size: 1.2rem; font-weight: bold; color: var(--text-muted); width: 20px;">#${idx + 1}</span>
                        <div class="tx-icon" style="color: var(--accent-teal); width: 24px; height: 24px; font-size: 0.9rem; min-width: 24px;">${icon}</div>
                        <span style="color: var(--text-heading); font-size: 0.95rem;">${cat}</span>
                    </div>
                    <strong style="color: var(--accent-red);">₹${amt.toLocaleString('en-IN')}</strong>
                </div>`;
            }).join('');
        }
    }

    // 3. Month-over-Month Insights
    const momInsights = document.getElementById('analysis-mom-insights');
    if (momInsights) {
        const curExp = expenseData[5];
        const prevExp = expenseData[4] || 0;

        let insight1 = '';
        if (prevExp === 0) {
            insight1 = `<span style="color: var(--accent-teal);">📊 Not enough past data to compare spending.</span>`;
        } else {
            const diff = curExp - prevExp;
            const pct = ((Math.abs(diff) / prevExp) * 100).toFixed(1);
            if (diff > 0) {
                insight1 = `<span style="color: var(--accent-red);">🚨 You spent <b>${pct}% (₹${diff.toLocaleString('en-IN')}) MORE</b> this month compared to last month.</span>`;
            } else {
                insight1 = `<span style="color: var(--accent-green);">✅ Great job! You spent <b>${pct}% (₹${Math.abs(diff).toLocaleString('en-IN')}) LESS</b> this month compared to last month.</span>`;
            }
        }

        const curInc = incomeData[5];
        const prevInc = incomeData[4] || 0;
        let insight2 = '';
        if (curInc > prevInc && prevInc > 0) {
            const incDiff = curInc - prevInc;
            insight2 = `<br><span style="color: var(--accent-green);">🚀 Your income increased by <b>₹${incDiff.toLocaleString('en-IN')}</b>!</span>`;
        }

        momInsights.innerHTML = `${insight1}${insight2}`;
    }

    // 4. Savings Rate
    const savingsCircle = document.getElementById('analysis-savings-rate-circle');
    const savingsPctText = document.getElementById('analysis-savings-percent');
    if (savingsCircle && savingsPctText) {
        const curInc = incomeData[5];
        const curExp = expenseData[5];
        let rate = 0;
        if (curInc > 0) {
            const saved = curInc - curExp;
            rate = Math.max(0, (saved / curInc) * 100);
        }

        savingsPctText.textContent = `${rate.toFixed(0)}%`;
        if (rate >= 20) {
            savingsPctText.style.color = 'var(--accent-green)';
            savingsCircle.style.boxShadow = `inset 2px 2px 5px rgba(163,177,198,0.5), inset -2px -2px 5px rgba(255,255,255,0.6), 0 0 10px rgba(34, 197, 94, 0.4)`;
        } else if (rate > 0) {
            savingsPctText.style.color = 'var(--accent-orange)';
            savingsCircle.style.boxShadow = `inset 2px 2px 5px rgba(163,177,198,0.5), inset -2px -2px 5px rgba(255,255,255,0.6), 0 0 10px rgba(245, 158, 11, 0.4)`;
        } else {
            savingsPctText.style.color = 'var(--accent-red)';
            savingsCircle.style.boxShadow = `inset 2px 2px 5px rgba(163,177,198,0.5), inset -2px -2px 5px rgba(255,255,255,0.6), 0 0 10px rgba(239, 68, 68, 0.4)`;
        }
    }
}

// --- Milk Tracker Logic ---
function setupMilkTracker() {
    const monthSelect = document.getElementById('milk-month-select');
    const yearSelect = document.getElementById('milk-year-select');
    if (!monthSelect || !yearSelect) return;

    const currentYear = new Date().getFullYear();
    let yearHtml = '';
    for (let y = currentYear - 10; y <= currentYear + 2; y++) {
        yearHtml += `<option value="${y}">${y}</option>`;
    }
    yearSelect.innerHTML = yearHtml;

    // Set initial values
    monthSelect.value = selectedMilkMonth;
    yearSelect.value = selectedMilkYear;

    // Add change listeners
    const handleChange = () => {
        selectedMilkMonth = parseInt(monthSelect.value);
        selectedMilkYear = parseInt(yearSelect.value);
        loadAndRenderMilkTracker();
    };

    monthSelect.addEventListener('change', handleChange);
    yearSelect.addEventListener('change', handleChange);

    // Save calendar data button
    const saveCalBtn = document.getElementById('save-milk-calendar-btn');
    if (saveCalBtn) {
        saveCalBtn.addEventListener('click', saveMilkCalendarData);
    }

    // Save payment button
    const savePayBtn = document.getElementById('save-milk-payment-btn');
    if (savePayBtn) {
        savePayBtn.addEventListener('click', saveMilkPaymentData);
    }

    // Add input listeners for real-time recalculations
    const priceInput = document.getElementById('milk-price-input');
    if (priceInput) {
        priceInput.addEventListener('input', calculateCurrentMilkTotals);
    }

    const amtPaidInput = document.getElementById('milk-amount-paid');
    if (amtPaidInput) {
        amtPaidInput.addEventListener('input', calculateCurrentMilkTotals);
    }

    const advPaidInput = document.getElementById('milk-advance-paid');
    if (advPaidInput) {
        advPaidInput.addEventListener('input', calculateCurrentMilkTotals);
    }

    // Load initial data
    loadAndRenderMilkTracker();
}

async function loadAndRenderMilkTracker() {
    const key = `${selectedMilkYear}-${String(selectedMilkMonth + 1).padStart(2, '0')}`;
    let milkData = await DataService.get('milkTracker', key);

    if (!milkData) {
        milkData = {
            id: key,
            pricePerLiter: 70, // Default price
            days: {},
            amountPaid: 0,
            advanceAmount: 0
        };
    }

    // Set UI values
    document.getElementById('milk-price-input').value = milkData.pricePerLiter;
    document.getElementById('milk-amount-paid').value = milkData.amountPaid || 0;
    document.getElementById('milk-advance-paid').value = milkData.advanceAmount || 0;

    // Render calendar
    renderMilkCalendar(milkData);

    // Render breakdowns
    await updateMilkSummaryAndBreakdown(milkData);
}

function renderMilkCalendar(milkData) {
    const gridEl = document.getElementById('milk-calendar-grid');
    if (!gridEl) return;

    gridEl.innerHTML = '';

    const daysInMonth = new Date(selectedMilkYear, selectedMilkMonth + 1, 0).getDate();
    const firstDayIndex = new Date(selectedMilkYear, selectedMilkMonth, 1).getDay();

    // Render blank spaces for weekdays before 1st of month
    for (let i = 0; i < firstDayIndex; i++) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'calendar-day-card calendar-day-empty';
        emptyEl.innerHTML = `
            <span class="day-number">-</span>
            <div class="calendar-day-select-wrapper">
                <select class="calendar-day-select neu-pressed" disabled>
                    <option>Select</option>
                </select>
            </div>
        `;
        gridEl.appendChild(emptyEl);
    }

    // Render days
    for (let day = 1; day <= daysInMonth; day++) {
        const val = milkData.days[day] !== undefined ? milkData.days[day] : 0;
        const cardEl = document.createElement('div');
        cardEl.className = 'calendar-day-card neu-flat';

        const options = [
            { value: 0, label: 'Select' },
            { value: 0.5, label: '0.5 Ltr' },
            { value: 1.0, label: '1.0 Ltr' },
            { value: 1.5, label: '1.5 Ltr' },
            { value: 2.0, label: '2.0 Ltr' },
            { value: 2.5, label: '2.5 Ltr' },
            { value: 3.0, label: '3.0 Ltr' }
        ];

        const hasValue = val > 0;
        const selectClass = hasValue ? 'calendar-day-select neu-pressed has-value' : 'calendar-day-select neu-pressed';

        let optionsHtml = options.map(opt => {
            const selectedAttr = parseFloat(val) === parseFloat(opt.value) ? 'selected' : '';
            return `<option value="${opt.value}" ${selectedAttr}>${opt.label}</option>`;
        }).join('');

        cardEl.innerHTML = `
            <span class="day-number">${day}</span>
            <div class="calendar-day-select-wrapper">
                ${hasValue ? '<span class="droplet-icon">💧</span>' : ''}
                <select class="${selectClass}" data-day="${day}" onchange="onMilkDayChange(this)">
                    ${optionsHtml}
                </select>
            </div>
        `;
        gridEl.appendChild(cardEl);
    }
}

window.onMilkDayChange = function (selectEl) {
    const val = parseFloat(selectEl.value);
    const wrapper = selectEl.parentElement;
    const hasDroplet = wrapper.querySelector('.droplet-icon');

    if (val > 0) {
        selectEl.classList.add('has-value');
        if (!hasDroplet) {
            const drop = document.createElement('span');
            drop.className = 'droplet-icon';
            drop.textContent = '💧';
            wrapper.insertBefore(drop, selectEl);
        }
    } else {
        selectEl.classList.remove('has-value');
        if (hasDroplet) {
            hasDroplet.remove();
        }
    }

    calculateCurrentMilkTotals();
};

function calculateCurrentMilkTotals() {
    const priceInput = document.getElementById('milk-price-input');
    const price = parseFloat(priceInput.value) || 0;

    let totalLiters = 0;
    const selects = document.querySelectorAll('#milk-calendar-grid select:not([disabled])');
    selects.forEach(sel => {
        totalLiters += parseFloat(sel.value) || 0;
    });

    const totalAmount = totalLiters * price;
    const amountPaid = parseFloat(document.getElementById('milk-amount-paid').value) || 0;
    const advanceAmount = parseFloat(document.getElementById('milk-advance-paid').value) || 0;
    const outstanding = totalAmount - (amountPaid + advanceAmount);

    document.getElementById('milk-total-liters').textContent = `${totalLiters.toFixed(2)} L`;
    document.getElementById('milk-total-amount').textContent = `₹${totalAmount.toFixed(2)}`;

    const outstandingEl = document.getElementById('milk-outstanding-balance');
    outstandingEl.textContent = `₹${outstanding.toFixed(2)}`;
    if (outstanding > 0) {
        outstandingEl.style.color = 'var(--accent-red)';
    } else if (outstanding < 0) {
        outstandingEl.style.color = 'var(--accent-green)';
    } else {
        outstandingEl.style.color = 'var(--text-heading)';
    }
}

async function saveMilkCalendarData() {
    const key = `${selectedMilkYear}-${String(selectedMilkMonth + 1).padStart(2, '0')}`;
    const priceInput = document.getElementById('milk-price-input');
    const price = parseFloat(priceInput.value) || 0;

    const days = {};
    const selects = document.querySelectorAll('#milk-calendar-grid select:not([disabled])');
    selects.forEach(sel => {
        const day = sel.dataset.day;
        const val = parseFloat(sel.value) || 0;
        if (val > 0) {
            days[day] = val;
        }
    });

    let milkData = await DataService.get('milkTracker', key);
    if (!milkData) {
        milkData = {
            id: key,
            pricePerLiter: price,
            days: days,
            amountPaid: 0,
            advanceAmount: 0
        };
    } else {
        milkData.pricePerLiter = price;
        milkData.days = days;
    }

    await DataService.save('milkTracker', milkData);
    await loadAndRenderMilkTracker();
    alert('Calendar data saved successfully!');
}

async function saveMilkPaymentData() {
    const key = `${selectedMilkYear}-${String(selectedMilkMonth + 1).padStart(2, '0')}`;
    const amountPaid = parseFloat(document.getElementById('milk-amount-paid').value) || 0;
    const advanceAmount = parseFloat(document.getElementById('milk-advance-paid').value) || 0;

    let milkData = await DataService.get('milkTracker', key);
    if (!milkData) {
        milkData = {
            id: key,
            pricePerLiter: parseFloat(document.getElementById('milk-price-input').value) || 70,
            days: {},
            amountPaid: amountPaid,
            advanceAmount: advanceAmount
        };
    } else {
        milkData.amountPaid = amountPaid;
        milkData.advanceAmount = advanceAmount;
    }

    await DataService.save('milkTracker', milkData);
    await syncMilkPaymentToLedger(milkData);
    await loadAndRenderMilkTracker();
    alert('Payment details saved successfully!');
}

async function syncMilkPaymentToLedger(milkData) {
    const key = milkData.id;
    const amount = (milkData.amountPaid || 0) + (milkData.advanceAmount || 0);
    const existingIndex = transactions.findIndex(t => t.milkMonth === key);

    const monthNamesLong = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const today = new Date();
    let dateStr = '';
    const parts = key.split('-');
    const yr = parseInt(parts[0]);
    const moIdx = parseInt(parts[1]) - 1;

    if (moIdx === today.getMonth() && yr === today.getFullYear()) {
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        dateStr = `${year}-${month}-${day}`;
    } else {
        const lastDay = new Date(yr, moIdx + 1, 0).getDate();
        dateStr = `${yr}-${String(moIdx + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }

    if (existingIndex > -1) {
        if (amount === 0) {
            const txId = transactions[existingIndex].id;
            transactions.splice(existingIndex, 1);
            await DataService.delete('transactions', txId);
        } else {
            transactions[existingIndex].amount = amount;
            transactions[existingIndex].date = dateStr;
            await DataService.save('transactions', transactions[existingIndex]);
        }
    } else {
        if (amount > 0) {
            const newTx = {
                id: Date.now(),
                type: 'expense',
                date: dateStr,
                category: 'Milkman',
                note: `Milk payment for ${monthNamesLong[moIdx]} ${yr}`,
                amount: amount,
                milkMonth: key
            };
            transactions.unshift(newTx);
            await DataService.save('transactions', newTx);
        }
    }

    updateUI();
}

async function updateMilkSummaryAndBreakdown(milkData) {
    calculateCurrentMilkTotals();

    const allRecords = await DataService.getAll('milkTracker');
    let overallUnpaid = 0;
    const breakdownListEl = document.getElementById('milk-breakdown-list');
    breakdownListEl.innerHTML = '';

    const monthNamesShort = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];

    allRecords.sort((a, b) => a.id.localeCompare(b.id));

    allRecords.forEach(rec => {
        let recLiters = 0;
        if (rec.days) {
            Object.values(rec.days).forEach(v => {
                recLiters += parseFloat(v) || 0;
            });
        }
        const recPrice = rec.pricePerLiter || 0;
        const recAmount = recLiters * recPrice;
        const recPaid = rec.amountPaid || 0;
        const recAdvance = rec.advanceAmount || 0;
        const recOutstanding = recAmount - (recPaid + recAdvance);

        if (recOutstanding > 0) {
            overallUnpaid += recOutstanding;

            const parts = rec.id.split('-');
            const yr = parts[0];
            const moIdx = parseInt(parts[1]) - 1;
            const moName = monthNamesShort[moIdx] || parts[1];

            const itemEl = document.createElement('div');
            itemEl.style.display = 'flex';
            itemEl.style.justify = 'space-between';
            itemEl.style.alignItems = 'center';
            itemEl.style.padding = '0.4rem 0.8rem';
            itemEl.style.borderRadius = 'var(--radius-sm)';
            itemEl.style.cursor = 'pointer';
            itemEl.className = 'neu-pressed';
            itemEl.title = `Click to switch to ${moName} ${yr}`;

            itemEl.innerHTML = `
                <span style="font-size: 0.85rem; color: var(--text-main); font-weight: 600;">${moName} ${yr}</span>
                <strong style="font-size: 0.85rem; color: var(--accent-red);">₹${recOutstanding.toFixed(2)}</strong>
            `;

            itemEl.addEventListener('click', () => {
                document.getElementById('milk-month-select').value = moIdx;
                document.getElementById('milk-year-select').value = yr;
                selectedMilkMonth = moIdx;
                selectedMilkYear = parseInt(yr);
                loadAndRenderMilkTracker();
            });

            breakdownListEl.appendChild(itemEl);
        }
    });

    if (breakdownListEl.children.length === 0) {
        breakdownListEl.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 1rem;">No outstanding balances!</div>`;
    }

    document.getElementById('milk-overall-unpaid').textContent = `₹${overallUnpaid.toFixed(2)}`;
}

// --- Report Tab Logic ---
function setupReportTab() {
    const startInput = document.getElementById('report-start-date');
    const endInput = document.getElementById('report-end-date');
    if (!startInput || !endInput) return;

    // Default to "This Month"
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

    const formatDateLocal = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    startInput.value = formatDateLocal(firstDay);
    endInput.value = formatDateLocal(today);

    // Set "This Month" preset button as active initially
    const thisMonthPreset = document.querySelector('.report-presets button[data-preset="this-month"]');
    if (thisMonthPreset) {
        thisMonthPreset.classList.add('active');
    }

    // Wire presets
    const presetBtns = document.querySelectorAll('.report-presets button');
    presetBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            presetBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            const preset = e.target.dataset.preset;
            const now = new Date();
            let start = null;
            let end = now;

            if (preset === 'this-month') {
                start = new Date(now.getFullYear(), now.getMonth(), 1);
            } else if (preset === 'last-month') {
                start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                end = new Date(now.getFullYear(), now.getMonth(), 0);
            } else if (preset === 'last-30-days') {
                start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            } else if (preset === 'this-year') {
                start = new Date(now.getFullYear(), 0, 1);
            } else if (preset === 'all-time') {
                start = new Date(1970, 0, 1);
                end = new Date(2100, 11, 31);
            }

            if (start) startInput.value = formatDateLocal(start);
            if (end) endInput.value = formatDateLocal(end);

            generateReport();
        });
    });

    // Generate Report button
    document.getElementById('generate-report-btn').addEventListener('click', generateReport);

    // Clear filters button
    document.getElementById('clear-report-filters-btn').addEventListener('click', () => {
        startInput.value = formatDateLocal(firstDay);
        endInput.value = formatDateLocal(today);
        document.getElementById('report-category-select').value = 'ALL';
        presetBtns.forEach(b => b.classList.remove('active'));
        if (thisMonthPreset) {
            thisMonthPreset.classList.add('active');
        }
        generateReport();
    });

    // Export CSV button
    document.getElementById('export-report-csv-btn').addEventListener('click', exportReportToCSV);

    // Print button
    document.getElementById('print-report-btn').addEventListener('click', () => {
        window.print();
    });

    // Load initial categories
    updateReportCategories();
    // Generate initial report
    generateReport();
}

function updateReportCategories() {
    const selectEl = document.getElementById('report-category-select');
    if (!selectEl) return;

    const curVal = selectEl.value;

    let html = `<option value="ALL">All Categories</option>`;
    Object.keys(categoryIcons).forEach(cat => {
        html += `<option value="${cat}">${categoryIcons[cat]} ${cat}</option>`;
    });

    selectEl.innerHTML = html;

    if (categoryIcons[curVal]) {
        selectEl.value = curVal;
    } else {
        selectEl.value = 'ALL';
    }
}

function generateReport() {
    const startVal = document.getElementById('report-start-date').value;
    const endVal = document.getElementById('report-end-date').value;
    const catVal = document.getElementById('report-category-select').value;

    const startDate = startVal ? new Date(startVal + 'T00:00:00') : null;
    const endDate = endVal ? new Date(endVal + 'T23:59:59') : null;

    let filtered = transactions.filter(t => t.type === 'expense');

    if (startDate) {
        filtered = filtered.filter(t => {
            const d = parseLocalDate(t.date);
            return d >= startDate;
        });
    }

    if (endDate) {
        filtered = filtered.filter(t => {
            const d = parseLocalDate(t.date);
            return d <= endDate;
        });
    }

    if (catVal !== 'ALL') {
        filtered = filtered.filter(t => t.category === catVal);
    }

    // Sort report chronologically
    filtered.sort((a, b) => {
        const dateDiff = parseLocalDate(a.date) - parseLocalDate(b.date);
        return dateDiff !== 0 ? dateDiff : a.id - b.id;
    });

    // Calculate Metrics
    let totalSum = 0;
    let maxAmount = 0;
    filtered.forEach(t => {
        totalSum += t.amount;
        if (t.amount > maxAmount) {
            maxAmount = t.amount;
        }
    });

    const count = filtered.length;
    const avgAmount = count > 0 ? totalSum / count : 0;

    // Render Metrics
    document.getElementById('report-total-sum').textContent = `₹${totalSum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    document.getElementById('report-avg-amount').textContent = `₹${avgAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    document.getElementById('report-count').textContent = count;
    document.getElementById('report-max-amount').textContent = `₹${maxAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    // Render Table Body
    const tbody = document.getElementById('report-table-body');
    if (!tbody) return;

    if (count === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 2rem;">No matching expenses found for the selected filters.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(t => {
        const icon = categoryIcons[t.category] || '🏷️';
        const displayDate = parseLocalDate(t.date).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });

        return `
            <tr>
                <td>${displayDate}</td>
                <td><span style="display: flex; align-items: center; gap: 0.5rem;"><span>${icon}</span> <span>${t.category}</span></span></td>
                <td>${t.note || '—'}</td>
                <td style="text-align: right; font-weight: 600; color: var(--accent-red);">-₹${t.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
        `;
    }).join('');
}

function exportReportToCSV() {
    const startVal = document.getElementById('report-start-date').value;
    const endVal = document.getElementById('report-end-date').value;
    const catVal = document.getElementById('report-category-select').value;

    const startDate = startVal ? new Date(startVal + 'T00:00:00') : null;
    const endDate = endVal ? new Date(endVal + 'T23:59:59') : null;

    let filtered = transactions.filter(t => t.type === 'expense');

    if (startDate) {
        filtered = filtered.filter(t => {
            const d = parseLocalDate(t.date);
            return d >= startDate;
        });
    }

    if (endDate) {
        filtered = filtered.filter(t => {
            const d = parseLocalDate(t.date);
            return d <= endDate;
        });
    }

    if (catVal !== 'ALL') {
        filtered = filtered.filter(t => t.category === catVal);
    }

    filtered.sort((a, b) => {
        const dateDiff = parseLocalDate(a.date) - parseLocalDate(b.date);
        return dateDiff !== 0 ? dateDiff : a.id - b.id;
    });

    const headers = ['Date', 'Category', 'Description/Note', 'Amount (INR)'];
    const rows = filtered.map(t => [
        t.date,
        t.category,
        t.note || '',
        t.amount
    ]);

    const csvContent = [headers, ...rows]
        .map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    const filename = `spendly_expense_report_${startVal || 'all'}_to_${endVal || 'all'}.csv`;

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// --- Firebase Sync Helpers ---
async function initFirebase(config) {
    if (typeof firebase === 'undefined') return;
    if (firebase.apps.length > 0) {
        await firebase.app().delete();
    }
    firebase.initializeApp(config);
    bindFirebaseAuth();
}

function bindFirebaseAuth() {
    firebase.auth().onAuthStateChanged(async (user) => {
        const loggedOutEl = document.getElementById('firebase-logged-out');
        const loggedInEl = document.getElementById('firebase-logged-in');
        const statusEl = document.getElementById('firebase-user-status');

        if (user) {
            if (loggedOutEl) loggedOutEl.style.display = 'none';
            if (loggedInEl) loggedInEl.style.display = 'block';
            if (statusEl) statusEl.textContent = `Connected as ${user.email}`;
            await syncWithFirebase();
        } else {
            if (loggedOutEl) loggedOutEl.style.display = 'block';
            if (loggedInEl) loggedInEl.style.display = 'none';
        }
    });
}

async function syncWithFirebase() {
    if (typeof firebase === 'undefined' || !firebase.apps.length || !firebase.auth().currentUser) return;

    const uid = firebase.auth().currentUser.uid;
    const dbRef = firebase.firestore();

    try {
        console.log("Syncing with Firebase...");

        // 1. Transactions
        const cloudTxsSnap = await dbRef.collection('users').doc(uid).collection('transactions').get();
        const cloudTxs = cloudTxsSnap.docs.map(d => d.data());

        const localTxs = await DataService.getAllRaw('transactions');
        const mergedTxsMap = new Map();
        localTxs.forEach(t => mergedTxsMap.set(t.id, t));
        cloudTxs.forEach(t => mergedTxsMap.set(t.id, t));

        transactions = Array.from(mergedTxsMap.values());
        for (const t of transactions) {
            await DataService.putRaw('transactions', t);
            await dbRef.collection('users').doc(uid).collection('transactions').doc(String(t.id)).set(t);
        }

        // 2. Grocery Items
        const cloudGroceriesSnap = await dbRef.collection('users').doc(uid).collection('groceryItems').get();
        const cloudGroceries = cloudGroceriesSnap.docs.map(d => d.data());

        const localGroceries = await DataService.getAllRaw('groceryItems');
        const mergedGroceriesMap = new Map();
        localGroceries.forEach(i => mergedGroceriesMap.set(i.id, i));
        cloudGroceries.forEach(i => mergedGroceriesMap.set(i.id, i));

        groceryItems = Array.from(mergedGroceriesMap.values());
        for (const i of groceryItems) {
            await DataService.putRaw('groceryItems', i);
            await dbRef.collection('users').doc(uid).collection('groceryItems').doc(String(i.id)).set(i);
        }

        // 3. Milk Tracker
        const cloudMilkSnap = await dbRef.collection('users').doc(uid).collection('milkTracker').get();
        const cloudMilk = cloudMilkSnap.docs.map(d => d.data());

        const localMilk = await DataService.getAllRaw('milkTracker');
        const mergedMilkMap = new Map();
        localMilk.forEach(m => mergedMilkMap.set(m.id, m));
        cloudMilk.forEach(m => mergedMilkMap.set(m.id, m));

        const allMilk = Array.from(mergedMilkMap.values());
        for (const m of allMilk) {
            await DataService.putRaw('milkTracker', m);
            await dbRef.collection('users').doc(uid).collection('milkTracker').doc(String(m.id)).set(m);
        }

        // 4. Settings
        const settingsKeys = ['categoryBudgets', 'userName', 'startingBalance', 'customCategories'];
        for (const key of settingsKeys) {
            const docSnap = await dbRef.collection('users').doc(uid).collection('settings').doc(key).get();
            const localVal = await DataService.getSettingRaw(key);

            if (docSnap.exists) {
                const cloudVal = docSnap.data().value;
                let mergedVal = cloudVal;
                if (key === 'categoryBudgets' || key === 'customCategories') {
                    mergedVal = { ...(localVal || {}), ...(cloudVal || {}) };
                } else if (key === 'startingBalance') {
                    mergedVal = cloudVal !== undefined ? cloudVal : localVal || 0;
                } else if (key === 'userName') {
                    mergedVal = cloudVal || localVal || 'Rojaa';
                }

                await DataService.saveSettingRaw(key, mergedVal);
                await dbRef.collection('users').doc(uid).collection('settings').doc(key).set({ value: mergedVal });
            } else if (localVal !== undefined) {
                await dbRef.collection('users').doc(uid).collection('settings').doc(key).set({ value: localVal });
            }
        }

        // Reload state to memory
        await loadState();
        updateUI();
        renderGroceryList();

        // If Milk or Report tab is active, update
        const activeTab = document.querySelector('.nav-btn.active');
        if (activeTab && activeTab.dataset.tab === 'milk') {
            loadAndRenderMilkTracker();
        }
        if (activeTab && activeTab.dataset.tab === 'report') {
            generateReport();
        }

        console.log("Firebase sync completed successfully!");
    } catch (err) {
        console.error("Firebase sync error:", err);
        alert("Sync failed: " + err.message);
    }
}

// ===================================================
// VIRTUAL PIGGY BANK
// ===================================================

let piggyChart = null;
let coinAnimInterval = null;

function setupPiggyBank() {
    updatePiggyBank();
}

function updatePiggyBank() {
    const piggyTab = document.getElementById('tab-piggy');
    if (!piggyTab) return;

    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();

    // Current month transactions
    const monthTxs = transactions.filter(t => {
        const d = parseLocalDate(t.date);
        return d.getMonth() === month && d.getFullYear() === year;
    });

    const totalIncome  = monthTxs.filter(t => t.type === 'income') .reduce((s, t) => s + t.amount, 0);
    const totalExpense = monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const savings      = totalIncome - totalExpense;
    const savingsRate  = totalIncome > 0 ? Math.max(0, (savings / totalIncome) * 100) : 0;

    // ---- Determine pig state ----
    let state, message, borderColor;
    if (savings < 0) {
        state = 'crying';
        message = "\uD83D\uDE22 You're spending more than you earn! The piggy is sad...";
        borderColor = '#fc8181';
    } else if (savingsRate < 10) {
        state = 'worried';
        message = "\uD83D\uDE1F Barely any savings this month. Can you cut back a little?";
        borderColor = '#f6ad55';
    } else if (savingsRate < 30) {
        state = 'normal';
        message = "\uD83D\uDE42 Good start! Keep saving more to make the piggy happy!";
        borderColor = '#76c8c8';
    } else if (savingsRate < 60) {
        state = 'happy';
        message = "\uD83D\uDE04 Great job! The piggy bank is getting nice and chubby! \uD83D\uDC37\uD83D\uDC95";
        borderColor = '#68d391';
    } else {
        state = 'ecstatic';
        message = "\uD83C\uDF89 WOW! Amazing savings! The piggy bank is overjoyed! \uD83C\uDF7E\uD83C\uDF8A";
        borderColor = '#b794f4';
    }

    // ---- Update pig SVG ----
    const pigSvg = document.getElementById('piggy-svg');
    if (pigSvg) pigSvg.setAttribute('data-state', state);

    // Scale pig body based on savings (fatter = more savings)
    const pigBody = document.getElementById('pig-body');
    if (pigBody) {
        const fatScale = 1 + Math.min(savingsRate / 100, 1) * 0.3;
        pigBody.setAttribute('ry', String(Math.round(65 * fatScale)));
    }

    // Tears
    const tearL = document.getElementById('pig-tear-l');
    const tearR = document.getElementById('pig-tear-r');
    if (tearL) tearL.setAttribute('opacity', savings < 0 ? '0.9' : '0');
    if (tearR) tearR.setAttribute('opacity', savings < 0 ? '0.9' : '0');

    // Blush
    document.querySelectorAll('.pig-blush').forEach(b => {
        b.setAttribute('opacity', savingsRate >= 30 ? '0.35' : '0');
    });

    // Party hat
    const hat = document.getElementById('pig-hat');
    if (hat) hat.style.display = savingsRate >= 60 ? 'block' : 'none';

    // Mouth path
    const mouth = document.getElementById('pig-mouth');
    if (mouth) {
        if (savings < 0) {
            mouth.setAttribute('d', 'M 106 140 Q 120 130 134 140'); // frown
        } else if (savingsRate >= 30) {
            mouth.setAttribute('d', 'M 100 130 Q 120 146 140 130'); // big smile
        } else {
            mouth.setAttribute('d', 'M 106 132 Q 120 142 134 132'); // normal smile
        }
    }

    // ---- Update text values ----
    const fmt = v => '\u20b9' + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 0 });

    const amountEl = document.getElementById('piggy-savings-amount');
    if (amountEl) {
        amountEl.textContent = fmt(savings);
        amountEl.style.color = savings >= 0 ? 'var(--accent-teal)' : 'var(--accent-red)';
    }

    const rateEl = document.getElementById('piggy-savings-rate');
    if (rateEl) rateEl.textContent = savingsRate.toFixed(1) + '% of income';

    const labelEl = document.getElementById('piggy-savings-label');
    if (labelEl) {
        labelEl.textContent = savings >= 0 ? 'Saved This Month' : 'Overspent This Month';
    }

    const msgEl = document.getElementById('piggy-message');
    if (msgEl) msgEl.textContent = message;

    const msgBox = document.querySelector('.piggy-message-box');
    if (msgBox) msgBox.style.borderLeftColor = borderColor;

    const fillBar = document.getElementById('piggy-fill-bar');
    if (fillBar) fillBar.style.width = Math.min(100, savingsRate).toFixed(1) + '%';

    const incEl = document.getElementById('piggy-income');
    if (incEl) incEl.textContent = fmt(totalIncome);

    const expEl = document.getElementById('piggy-expense');
    if (expEl) expEl.textContent = fmt(totalExpense);

    // ---- Compute best month & streak ----
    const monthlyMap = {};
    transactions.forEach(t => {
        const d = parseLocalDate(t.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyMap[key]) monthlyMap[key] = { inc: 0, exp: 0 };
        if (t.type === 'income') monthlyMap[key].inc += t.amount;
        else monthlyMap[key].exp += t.amount;
    });

    let bestMonth = null, bestSavings = -Infinity;
    let streak = 0, prevPositive = true;

    const sortedKeys = Object.keys(monthlyMap).sort();
    sortedKeys.forEach(key => {
        const s = monthlyMap[key].inc - monthlyMap[key].exp;
        if (s > bestSavings) { bestSavings = s; bestMonth = key; }
    });

    // Streak: consecutive recent months with positive savings
    for (let i = sortedKeys.length - 1; i >= 0; i--) {
        const k = sortedKeys[i];
        const s = monthlyMap[k].inc - monthlyMap[k].exp;
        if (s > 0) streak++;
        else break;
    }

    const bestEl = document.getElementById('piggy-best-month');
    if (bestEl && bestMonth) {
        const [y, m] = bestMonth.split('-');
        const d = new Date(parseInt(y), parseInt(m) - 1, 1);
        bestEl.textContent = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) + ' (' + fmt(bestSavings) + ')';
    } else if (bestEl) {
        bestEl.textContent = '\u2014';
    }

    const streakEl = document.getElementById('piggy-streak');
    if (streakEl) streakEl.textContent = streak + (streak === 1 ? ' month' : ' months');

    // ---- Coin animation ----
    if (savings > 0 && piggyTab.classList.contains('active')) {
        startCoinAnimation();
    } else {
        stopCoinAnimation();
    }

    // ---- Update savings history chart ----
    updatePiggyChart(monthlyMap);
}

function startCoinAnimation() {
    const coinsEl = document.getElementById('piggy-coins');
    if (!coinsEl || coinAnimInterval) return;
    coinAnimInterval = setInterval(() => {
        const tab = document.getElementById('tab-piggy');
        if (!tab || !tab.classList.contains('active')) {
            stopCoinAnimation();
            return;
        }
        const coin = document.createElement('div');
        coin.className = 'falling-coin';
        coin.textContent = ['\uD83E\uDE99', '\uD83D\uDCB0', '\u2728'][Math.floor(Math.random() * 3)];
        coin.style.left = (20 + Math.random() * 60) + '%';
        coin.style.animationDuration = (0.9 + Math.random() * 0.7) + 's';
        coinsEl.appendChild(coin);
        setTimeout(() => { if (coin.parentNode) coin.remove(); }, 1800);
    }, 700);
}

function stopCoinAnimation() {
    if (coinAnimInterval) {
        clearInterval(coinAnimInterval);
        coinAnimInterval = null;
    }
    const coinsEl = document.getElementById('piggy-coins');
    if (coinsEl) coinsEl.innerHTML = '';
}

function updatePiggyChart(monthlyMap) {
    const canvas = document.getElementById('piggy-chart');
    if (!canvas) return;

    // Build last 6 months
    const labels = [], savingsData = [], incData = [], expData = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
        labels.push(label);
        const data = monthlyMap[key] || { inc: 0, exp: 0 };
        incData.push(data.inc);
        expData.push(data.exp);
        savingsData.push(Math.max(0, data.inc - data.exp));
    }

    if (piggyChart) {
        piggyChart.data.labels = labels;
        piggyChart.data.datasets[0].data = savingsData;
        piggyChart.data.datasets[1].data = incData;
        piggyChart.data.datasets[2].data = expData;
        piggyChart.update();
        return;
    }

    piggyChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Savings',
                    data: savingsData,
                    backgroundColor: 'rgba(118,200,200,0.7)',
                    borderColor: '#76c8c8',
                    borderWidth: 2,
                    borderRadius: 8,
                    order: 1
                },
                {
                    label: 'Income',
                    data: incData,
                    type: 'line',
                    borderColor: '#68d391',
                    backgroundColor: 'rgba(104,211,145,0.1)',
                    borderWidth: 2.5,
                    pointRadius: 5,
                    pointBackgroundColor: '#68d391',
                    fill: false,
                    tension: 0.4,
                    order: 0
                },
                {
                    label: 'Expenses',
                    data: expData,
                    type: 'line',
                    borderColor: '#fc8181',
                    backgroundColor: 'rgba(252,129,129,0.1)',
                    borderWidth: 2.5,
                    pointRadius: 5,
                    pointBackgroundColor: '#fc8181',
                    fill: false,
                    tension: 0.4,
                    order: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(163,177,198,0.2)' },
                    ticks: {
                        callback: v => '\u20b9' + v.toLocaleString('en-IN')
                    }
                },
                x: { grid: { display: false } }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { usePointStyle: true, padding: 16, font: { size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ctx.dataset.label + ': \u20b9' + ctx.parsed.y.toLocaleString('en-IN')
                    }
                }
            }
        }
    });
}
