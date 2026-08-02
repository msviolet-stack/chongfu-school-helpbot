const params = new URLSearchParams(window.location.search);

if (params.get("embed") === "1") {
    document.body.classList.add("embed-mode");
}
const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbxsEBQObwSNkxXLFNWKH76tqZOsp9tyMQH58BATe5dgbRPB1Z9PHj1Vpz7t1YD_Qjxc9Q/exec";

const SHOW_RATIONALE = false;
const MIN_DIRECT_MATCH_SCORE = 8;
const MAX_SUGGESTIONS = 4;

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "can", "do",
  "for", "from", "how", "i", "in", "is", "it", "me", "my",
  "of", "on", "or", "our", "please", "the", "their", "this",
  "to", "we", "what", "when", "where", "which", "who", "why",
  "with", "you", "your"
]);

let faqData = [];
let chatClosed = false;

const chatForm = document.getElementById("chatForm");
const questionInput = document.getElementById("questionInput");
const sendButton = document.getElementById("sendButton");
const chatMessages = document.getElementById("chatMessages");
const resetButton = document.getElementById("resetButton");
const statusBar = document.getElementById("statusBar");

document.addEventListener("DOMContentLoaded", () => {
  setInputEnabled(false);
  loadFaqData();

  document.querySelectorAll(".starter-button").forEach((button) => {
    button.addEventListener("click", () => {
      submitQuestion(button.dataset.query);
    });
  });
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitQuestion(questionInput.value);
});

resetButton.addEventListener("click", startNewChat);

/* =====================================================
   LOAD GOOGLE SHEET DATA
===================================================== */

function loadFaqData() {
  const callbackName = `receiveFaqData_${Date.now()}`;
  const scriptTag = document.createElement("script");

  const timeoutId = window.setTimeout(() => {
    cleanup();

    setStatus(
      "The FAQ sheet could not be reached. Check the Apps Script deployment.",
      "error"
    );
  }, 15000);

  window[callbackName] = (payload) => {
    cleanup();

    if (
      !payload ||
      payload.ok !== true ||
      !Array.isArray(payload.items)
    ) {
      setStatus(
        payload?.error || "The FAQ data returned an error.",
        "error"
      );

      return;
    }

    faqData = payload.items.filter((item) => item.response);

    setInputEnabled(true);

    setStatus(
      `${faqData.length} approved FAQ ${
        faqData.length === 1 ? "answer" : "answers"
      } ready.`,
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

  const separator = WEB_APP_URL.includes("?") ? "&" : "?";

  scriptTag.src =
    `${WEB_APP_URL}${separator}` +
    `callback=${encodeURIComponent(callbackName)}` +
    `&v=${Date.now()}`;

  document.body.appendChild(scriptTag);
}

/* =====================================================
   QUESTION HANDLING
===================================================== */

function submitQuestion(rawQuestion) {
  const question = String(rawQuestion || "").trim();

  if (!question || faqData.length === 0 || chatClosed) {
    return;
  }

  removePendingFeedback();
  appendUserMessage(question);

  questionInput.value = "";

  const matches = rankFaqItems(question);

  if (matches.length === 0 || matches[0].score <= 0) {
    appendBotMessage(
      "I’m sorry, I could not find a matching answer. " +
      "Please try using a shorter phrase or another keyword."
    );

    appendUnmatchedHelp();
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

/* =====================================================
   KEYWORD MATCHING
===================================================== */

function rankFaqItems(question) {
  const normalQuestion = normalize(question);
  const questionTokens = tokenize(question);

  return faqData
    .map((item) => ({
      item,
      score: calculateScore(
        item,
        normalQuestion,
        questionTokens
      )
    }))
    .sort((a, b) => b.score - a.score);
}

function calculateScore(
  item,
  normalQuestion,
  questionTokens
) {
  const itemQuestion = normalize(item.question);
  const category = normalize(item.category);

  const keywordPhrases = splitKeywords(item.keywords);

  const searchableText = normalize(
    `${item.question || ""} ` +
    `${item.category || ""} ` +
    `${item.keywords || ""}`
  );

  let score = 0;

  if (
    itemQuestion &&
    normalQuestion === itemQuestion
  ) {
    score += 100;
  } else if (
    itemQuestion &&
    (
      itemQuestion.includes(normalQuestion) ||
      normalQuestion.includes(itemQuestion)
    )
  ) {
    score += 24;
  }

  if (
    category &&
    normalQuestion.includes(category)
  ) {
    score += 12;
  }

  keywordPhrases.forEach((phrase) => {
    const normalPhrase = normalize(phrase);

    if (!normalPhrase) {
      return;
    }

    if (normalQuestion === normalPhrase) {
      score += 30;
    } else if (
      normalQuestion.includes(normalPhrase)
    ) {
      score += 16;
    } else {
      const phraseTokens = tokenize(normalPhrase);

      const matchedTokens = phraseTokens.filter((token) =>
        questionTokens.includes(token)
      );

      score += matchedTokens.length * 3;
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
    .filter(
      (word) =>
        word.length > 1 &&
        !STOP_WORDS.has(word)
    );
}

function splitKeywords(value) {
  return String(value || "")
    .split(/[,;\n|]+/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

/* =====================================================
   CHAT MESSAGES
===================================================== */

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

function appendBotMessage(text) {
  const row = createBotRow();
  const bubble = row.querySelector(".message");

  bubble.textContent = text;

  chatMessages.appendChild(row);
  scrollToLatest();

  return row;
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

  appendFeedbackPrompt(item);
  scrollToLatest();
}

function appendSuggestions(items) {
  const row = createBotRow();
  const bubble = row.querySelector(".message");

  const introduction = document.createElement("p");

  introduction.textContent =
    "I found a few related topics. Please select the closest one:";

  bubble.appendChild(introduction);

  const list = document.createElement("div");
  list.className = "suggestion-list";

  items.forEach((item) => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "suggestion-button";

    button.textContent =
      item.question ||
      item.category ||
      "View answer";

    button.addEventListener("click", () => {
      row.remove();
      appendAnswer(item);
    });

    list.appendChild(button);
  });

  bubble.appendChild(list);
  chatMessages.appendChild(row);

  scrollToLatest();
}

/* =====================================================
   FEEDBACK PROMPT
===================================================== */

function appendFeedbackPrompt(item) {
  const row = createBotRow();

  row.classList.add("feedback-row");

  const bubble = row.querySelector(".message");

  const question = document.createElement("p");

  question.innerHTML =
    "<strong>Did I answer your enquiry?</strong><br>" +
    "Please select an option below.";

  bubble.appendChild(question);

  const panel = document.createElement("div");
  panel.className = "feedback-panel";

  const yesButton = document.createElement("button");

  yesButton.type = "button";
  yesButton.className = "feedback-button yes";
  yesButton.textContent =
    "✓ Yes, that answers my enquiry";

  yesButton.addEventListener("click", () => {
    handleYes(row);
  });

  const noButton = document.createElement("button");

  noButton.type = "button";
  noButton.className = "feedback-button no";
  noButton.textContent =
    "✕ No, I need more help";

  noButton.addEventListener("click", () => {
    handleNo(row, item);
  });

  panel.append(yesButton, noButton);
  bubble.appendChild(panel);

  chatMessages.appendChild(row);
  scrollToLatest();
}

/* =====================================================
   YES RESPONSE
===================================================== */

function handleYes(feedbackRow) {
  feedbackRow.remove();

  appendUserMessage(
    "Yes, that answers my enquiry."
  );

  chatClosed = true;
  setInputEnabled(false);

  const row = createBotRow();
  const bubble = row.querySelector(".message");

  bubble.classList.add("closed-message");

  const message = document.createElement("p");

  message.innerHTML =
    "<strong>Thank you.</strong><br>" +
    "I’m glad I could help. This chat is now closed.";

  bubble.appendChild(message);

  const restartButton =
    document.createElement("button");

  restartButton.type = "button";
  restartButton.className = "restart-button";
  restartButton.textContent = "Start a new enquiry";

  restartButton.addEventListener(
    "click",
    startNewChat
  );

  bubble.appendChild(restartButton);
  chatMessages.appendChild(row);

  scrollToLatest();
}

/* =====================================================
   NO RESPONSE
===================================================== */

function handleNo(feedbackRow, item) {
  feedbackRow.remove();

  appendUserMessage(
    "No, I need more help."
  );

  const row = createBotRow();
  const bubble = row.querySelector(".message");

  const introduction =
    document.createElement("p");

  introduction.innerHTML =
    "<strong>No problem.</strong><br>" +
    "You may ask another question below or approach " +
    "the relevant Key Personnel for clarification.";

  bubble.appendChild(introduction);

  const kpCard = document.createElement("div");
  kpCard.className = "kp-card";

  const kpTitle = document.createElement("strong");
  kpTitle.textContent = "Key Personnel:";

  const kpName = document.createElement("div");

  kpName.textContent =
    item.kp ||
    "Please approach the relevant department or Key Personnel.";

  kpCard.append(
    kpTitle,
    document.createElement("br"),
    kpName
  );

  bubble.appendChild(kpCard);

  const followUp = document.createElement("p");

  followUp.style.marginTop = "12px";
  followUp.textContent =
    "How else can I help you?";

  bubble.appendChild(followUp);
  chatMessages.appendChild(row);

  setInputEnabled(true);
  questionInput.focus();

  scrollToLatest();
}

/* =====================================================
   NO MATCH FOUND
===================================================== */

function appendUnmatchedHelp() {
  const row = createBotRow();
  const bubble = row.querySelector(".message");

  const message = document.createElement("p");

  message.textContent =
    "You may ask another question or approach the relevant " +
    "department or Key Personnel for clarification.";

  bubble.appendChild(message);
  chatMessages.appendChild(row);

  scrollToLatest();
}

/* =====================================================
   HELPER FUNCTIONS
===================================================== */

function removePendingFeedback() {
  chatMessages
    .querySelectorAll(".feedback-row")
    .forEach((row) => row.remove());
}

function createBotRow() {
  const row = document.createElement("div");
  row.className = "message-row bot-row";

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = "🤖";

  const bubble = document.createElement("div");
  bubble.className = "message bot-message";

  row.append(avatar, bubble);

  return row;
}

function startNewChat() {
  chatClosed = false;

  const rows = [
    ...chatMessages.querySelectorAll(".message-row")
  ];

  rows
    .filter(
      (row) =>
        !row.classList.contains("welcome-row")
    )
    .forEach((row) => row.remove());

  questionInput.value = "";

  setInputEnabled(faqData.length > 0);

  questionInput.focus();
  scrollToLatest();
}

function setStatus(message, type = "") {
  statusBar.textContent = message;
  statusBar.className =
    `status-bar ${type}`.trim();
}

function setInputEnabled(enabled) {
  questionInput.disabled = !enabled;
  sendButton.disabled = !enabled;
}

function scrollToLatest() {
  requestAnimationFrame(() => {
    chatMessages.scrollTop =
      chatMessages.scrollHeight;
  });
}
