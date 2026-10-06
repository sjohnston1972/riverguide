// River Guide v2.0.0 — Highland Cartographic
// Scottish Rivers AI Assistant

// Disclaimer gate
(function () {
    const overlay = document.getElementById('disclaimerOverlay');
    const btn = document.getElementById('disclaimerAccept');

    if (localStorage.getItem('riverguide_disclaimer') === 'accepted') {
        overlay.remove();
    } else {
        btn.addEventListener('click', function () {
            localStorage.setItem('riverguide_disclaimer', 'accepted');
            overlay.classList.add('hidden');
            setTimeout(() => overlay.remove(), 300);
            document.getElementById('userInput').focus();
        });
    }
})();

// Theme toggle
(function () {
    const saved = localStorage.getItem('riverguide_theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);

    document.getElementById('themeToggle').addEventListener('click', function () {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('riverguide_theme', next);
    });
})();

// The AI system/guardrail prompt is owned and applied server-side — see
// README.md ("System Prompt / Guardrails"). This client does not fetch it
// and does not forward it in the request body; it only sends the
// conversation (see sendMessage() below).

// Conversation state
let conversationHistory = [];

// DOM refs
const chatContainer = document.getElementById('chatContainer');
const userInput = document.getElementById('userInput');
const sendButton = document.getElementById('sendButton');
const loadingIndicator = document.getElementById('loadingIndicator');

// Popular paddling rivers for random suggestions
const rivers = [
    'River Leny', 'River Orchy', 'River Findhorn', 'River Tay', 'River Spey',
    'River Tummel', 'River Garry', 'River Etive', 'River Roy', 'River Spean',
    'River Lyon', 'River Teith', 'River Awe', 'River Moriston', 'River Nevis',
    'River Nith', 'River Tweed', 'River Dochart', 'River Braan', 'River Fechlin',
    'River Arkaig', 'River Ewe', 'River Lochy', 'River Dee', 'River Don',
    'River Tilt', 'River Feshie', 'River Falloch', 'River Leven', 'River Coe'
];

function randomRiver(exclude) {
    const pool = exclude ? rivers.filter(r => r !== exclude) : rivers;
    return pool[Math.floor(Math.random() * pool.length)];
}

// Query templates per card type — river name gets swapped in
const cardTemplates = {
    'River Levels':     r => `What are the current levels like on the ${r}? Is it paddleable?`,
    'Weather':          r => `What's the weather looking like for the ${r} today and tomorrow?`,
    'Grades & Hazards': r => `Tell me about the ${r} - grades, main rapids, and any hazards.`,
    'Access Points':    r => `Where are the put-in and take-out points for the ${r}?`
};

function askSuggestion(el) {
    const label = el.querySelector('.card-label').textContent;
    const tpl = cardTemplates[label];
    if (tpl) {
        userInput.value = tpl(randomRiver());
        sendMessage();
    }
}

// Auto-resize textarea
userInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = this.scrollHeight + 'px';
});

// Enter to send, Shift+Enter for newline
userInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Add message to chat
function addMessage(content, role) {
    // Remove welcome on first message
    const welcome = chatContainer.querySelector('.welcome');
    if (welcome) welcome.remove();

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'message-content';
    bubble.innerHTML = formatMessage(content);

    messageDiv.appendChild(bubble);
    chatContainer.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Markdown-lite formatting: formatMessage() lives in format.js (loaded
// before this file, see index.html) so it can also be unit-tested from
// Node without a DOM — see test/format.test.js.

// Loading state
function setLoading(isLoading) {
    if (isLoading) {
        loadingIndicator.classList.add('active');
        sendButton.disabled = true;
        userInput.disabled = true;
    } else {
        loadingIndicator.classList.remove('active');
        sendButton.disabled = false;
        userInput.disabled = false;
    }
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Send message
async function sendMessage() {
    const message = userInput.value.trim();
    if (!message) return;

    addMessage(message, 'user');

    userInput.value = '';
    userInput.style.height = 'auto';

    conversationHistory.push({ role: 'user', content: message });

    setLoading(true);

    try {
        const response = await fetch('/api/mcp/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: conversationHistory
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `API Error: ${response.status}`);
        }

        const data = await response.json();

        const textBlocks = data.content.filter(b => b.type === 'text');
        const assistantMessage = textBlocks.map(b => b.text).join('\n\n');

        addMessage(assistantMessage, 'assistant');

        conversationHistory.push({ role: 'assistant', content: data.content });

    } catch (error) {
        console.error('Error:', error);
        addMessage('Sorry, I encountered an error. Please try again.', 'assistant');
    } finally {
        setLoading(false);
        userInput.focus();
    }
}

// Focus input on load
window.addEventListener('load', () => userInput.focus());
