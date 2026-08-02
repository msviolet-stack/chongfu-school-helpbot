/*
 * IMPORTANT:
 * Replace the URL below with the /exec URL from your deployed Google Apps Script.
 */
const WEB_APP_URL = "PASTE_YOUR_GOOGLE_APPS_SCRIPT_EXEC_URL_HERE";

/*
 * Change to true only if you want the internal Rationale shown to users.
 * KP is kept in the data but is never displayed.
 */
const SHOW_RATIONALE = false;

const MIN_DIRECT_MATCH_SCORE = 8;
const MAX_SUGGESTIONS = 4;

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "can", "do", "for", "from",
  "how", "i", "in", "is", "it", "me", "my", "of", "on", "or", "our",
  "please", "the", "their", "this", "to", "we", "what", "when", "where",
  "which", "who", "why", "with", "you", "your"
]);

let faqData = [];

const chatForm = document.getElementById("chatForm");
const questionInput = document.getElementById("questionInput");
const sendButton = document.getElementById("sendButton");
const chatMessages = document.getElementById("chatMessages");
const resetButton = document.getElementById("resetButton");
const statusBar = document.getElementById("statusBar");

document.addEventListener("DOMContentLoaded", () => {
  setInputEnabled(false);
  loadFaqData();

  document.querySelectorAll(".chip").forEach((button) => {
    button.addEventListener("click", () => submitQuestion(button.dataset.query));
  });
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitQuestion(questionInput.value);
});

resetButton.addEventListener("click", () => {
  const rows = [...chatMessages.querySelectorAll(".message-row")];
  rows.slice(1).forEach((row) => row.remove());
  questionInput.value = "";
  questionInput.focus();
});

function loadFaqData() {
  if (!WEB_APP_URL.startsWith("https://script.google.com/")) {
    setStatus(
      "Add your Apps Script /exec URL in script.js before publishing.",
      "error"
    );
    return;
  }

  const callbackName = `receiveFaqData_${Date.now()}`;
  const scriptTag = document.createElement("script");
  const separator = WEB_APP_URL.includes("?") ? "&" : "?";

  const timeoutId = window.setTimeout(() => {
    cleanup();
    setStatus(
      "The FAQ sheet could not be reached. Check the Apps Script URL and deployment access.",
      "error"
    );
  }, 15000);

  window[callbackName] = (payload) => {
    cleanup();

    if (!payload || payload.ok !== true || !Array.isArray(payload.items)) {
      setStatus(payload?.error || "The FAQ data returned an error.", "error");
      return;
    }

    faqData = payload.items.filter((item) => item.response);
    setInputEnabled(true);
    setStatus(
      `${faqData.length} approved FAQ ${faqData.length === 1 ? "answer" : "answers"} ready.`,
      "ready"
    );
    questionInput.focus();
  };

  scriptTag.onerror = () => {
    cleanup();
    setStatus(
      "The FAQ sheet could not be reached. Check the Apps Script deployment.",
      "error"
    );
  };

  function cleanup() {
    window.clearTimeout(timeoutId);
    delete window[callbackName];
    scriptTag.remove();
  }

  scriptTag.src =
    `${WEB_APP_URL}${separator}callback=${encodeURIComponent(callbackName)}` +
    `&v=${Date.now()}`;

  document.body.appendChild(scriptTag);
}

function submitQuestion(rawQuestion) {
  const question = String(rawQuestion || "").trim();

  if (!question || faqData.length === 0) {
    return;
  }

  appendUserMessage(question);
  questionInput.value = "";

  const matches = rankFaqItems(question);

  if (matches.length === 0 || matches[0].score <= 0) {
    appendBotMessage({
      text:
        "I’m sorry, I could not find a matching answer. Try using a shorter " +
        "phrase or a key term such as “Cockpit”, “assessment”, “SLS” or “ICT”."
    });
    return;
  }

  const best = matches[0];
  const second = matches[1];

  const isClearWinner =
    best.score >= MIN_DIRECT_MATCH_SCORE &&
    (!second || best.score >= second.score * 1.35);

  if (isClearWinner) {
    appendAnswer(best.item);
    return;
  }

  const suggestions = matches
    .filter((match) => match.score > 0)
    .slice(0, MAX_SUGGESTIONS)
    .map((match) => match.item);

  if (suggestions.length === 1) {
    appendAnswer(suggestions[0]);
  } else {
    appendSuggestions(suggestions);
  }
}

function rankFaqItems(question) {
  const normalQuestion = normalize(question);
  const questionTokens = tokenize(question);

  return faqData
    .map((item) => ({
      item,
      score: calculateScore(item, normalQuestion, questionTokens)
    }))
    .sort((a, b) => b.score - a.score);
}

function calculateScore(item, normalQuestion, questionTokens) {
  const itemQuestion = normalize(item.question);
  const category = normalize(item.category);
  const keywordPhrases = splitKeywords(item.keywords);
  const searchableText = normalize(
    `${item.question} ${item.category} ${item.keywords}`
  );

  let score = 0;

  if (itemQuestion && normalQuestion === itemQuestion) {
    score += 100;
  } else if (
    itemQuestion &&
    (itemQuestion.includes(normalQuestion) || normalQuestion.includes(itemQuestion))
  ) {
    score += 24;
  }

  if (category && normalQuestion.includes(category)) {
    score += 12;
  }

  keywordPhrases.forEach((phrase) => {
    const normalPhrase = normalize(phrase);

    if (!normalPhrase) return;

    if (normalQuestion === normalPhrase) {
      score += 30;
    } else if (normalQuestion.includes(normalPhrase)) {
      score += 16;
    } else {
      const phraseTokens = tokenize(normalPhrase);
      const matched = phraseTokens.filter((token) => questionTokens.includes(token));
      score += matched.length * 3;
    }
  });

  questionTokens.forEach((token) => {
    if (searchableText.includes(token)) {
      score += token.length >= 7 ? 4 : 2;
    }
  });

  return score;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalize(value)
    .split(" ")
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function splitKeywords(value) {
  return String(value || "")
    .split(/[,;\n|]+/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function appendUserMessage(text) {
  const row = document.createElement("div");
  row.className = "message-row user-row";

  const bubble = document.createElement("div");
  bubble.className = "message user-message";
  bubble.textContent = text;

  row.appendChild(bubble);
  chatMessages.appendChild(row);
  scrollToLatest();
}

function appendBotMessage({ text }) {
  const row = createBotRow();
  const bubble = row.querySelector(".message");
  bubble.textContent = text;
  chatMessages.appendChild(row);
  scrollToLatest();
}

function appendAnswer(item) {
  const row = createBotRow();
  const bubble = row.querySelector(".message");

  if (item.category) {
    const category = document.createElement("div");
    category.className = "answer-category";
    category.textContent = item.category;
    bubble.appendChild(category);
  }

  const answer = document.createElement("div");
  answer.className = "answer-text";
  answer.textContent = item.response;
  bubble.appendChild(answer);

  if (SHOW_RATIONALE && item.rationale) {
    const rationale = document.createElement("div");
    rationale.className = "answer-rationale";
    rationale.textContent = `Why: ${item.rationale}`;
    bubble.appendChild(rationale);
  }

  chatMessages.appendChild(row);
  scrollToLatest();
}

function appendSuggestions(items) {
  const row = createBotRow();
  const bubble = row.querySelector(".message");

  const intro = document.createElement("p");
  intro.textContent = "I found a few related topics. Select the closest one:";
  bubble.appendChild(intro);

  const list = document.createElement("div");
  list.className = "suggestion-list";

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion-button";
    button.textContent = item.question || item.category || "View answer";
    button.addEventListener("click", () => appendAnswer(item));
    list.appendChild(button);
  });

  bubble.appendChild(list);
  chatMessages.appendChild(row);
  scrollToLatest();
}

function createBotRow() {
  const row = document.createElement("div");
  row.className = "message-row bot-row";

  const avatar = document.createElement("div");
  avatar.className = "small-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = "🤖";

  const bubble = document.createElement("div");
  bubble.className = "message bot-message";

  row.append(avatar, bubble);
  return row;
}

function setStatus(message, type = "") {
  statusBar.textContent = message;
  statusBar.className = `status-bar ${type}`.trim();
}

function setInputEnabled(enabled) {
  questionInput.disabled = !enabled;
  sendButton.disabled = !enabled;
}

function scrollToLatest() {
  requestAnimationFrame(() => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}
