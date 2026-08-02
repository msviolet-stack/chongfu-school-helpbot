const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbx6Pkz1I2KKZbdt1o1YQpZ9Iaczyk_a0VAjIosqPGZvlrjM7ywLs6wYwT19wGnFP9J1/exec";

const SHOW_RATIONALE = false;
const MAX_SUGGESTIONS = 5;
const MAX_CATEGORY_QUESTIONS = 6;
const MIN_DIRECT_MATCH_SCORE = 8;

const CATEGORY_ICONS = {
  assessment: "📘",
  ict: "💻",
  cockpit: "🧭",
  parents: "👨‍👩‍👧",
  parent: "👨‍👩‍👧",
  staff: "👩‍🏫",
  safety: "🦺",
  finance: "💰",
  admin: "📋",
  student: "🎓",
  students: "🎓",
  attendance: "🗓️",
  school: "🏫",
  others: "📌",
  other: "📌"
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "can", "could",
  "did", "do", "does", "for", "from", "had", "has", "have",
  "how", "i", "in", "is", "it", "may", "me", "my", "of",
  "on", "or", "our", "please", "should", "the", "their",
  "this", "to", "we", "what", "when", "where", "which",
  "who", "why", "will", "with", "would", "you", "your"
]);

let faqData = [];
let categoryData = [];
let chatClosed = false;

const chatForm = document.getElementById("chatForm");
const questionInput = document.getElementById("questionInput");
const sendButton = document.getElementById("sendButton");
const chatMessages = document.getElementById("chatMessages");
const resetButton = document.getElementById("resetButton");
const statusBar = document.getElementById("statusBar");
const starterButtonsContainer =
  document.querySelector(".starter-buttons");

document.addEventListener("DOMContentLoaded", () => {
  setInputEnabled(false);
  loadFaqData();
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
  const callbackName = `receiveHelpBotData_${Date.now()}`;
  const scriptTag = document.createElement("script");

  const timeoutId = window.setTimeout(() => {
    cleanup();

    setStatus(
      "The FAQ information could not be reached. Please check the Apps Script deployment.",
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
        payload?.error ||
          "The FAQ information could not be loaded.",
        "error"
      );
      return;
    }

    faqData = payload.items
      .filter((item) => item.question && item.response)
      .map((item) => ({
        id: item.id || "",
        question: String(item.question || "").trim(),
        category: String(item.category || "").trim(),
        keywords: String(item.keywords || "").trim(),
        response: String(item.response || "").trim(),
        rationale: String(item.rationale || "").trim(),
        kp: String(item.kp || "").trim()
      }));

    categoryData = Array.isArray(payload.categories)
      ? payload.categories.filter(Boolean)
      : buildCategoriesFromFaq();

    renderCategoryButtons(categoryData);

    setInputEnabled(true);

    const lastUpdatedDate =
      formatLastUpdatedDate(payload.updatedAt);

    setStatus(
      `Information last updated ${lastUpdatedDate}`,
      "ready"
    );

    questionInput.focus();
  };

  scriptTag.onerror = () => {
    cleanup();

    setStatus(
      "The FAQ information could not be reached. Please check the Apps Script deployment.",
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
   DYNAMIC CATEGORY BUTTONS
===================================================== */

function buildCategoriesFromFaq() {
  return [
    ...new Set(
      faqData
        .map((item) => item.category)
        .filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b));
}

function renderCategoryButtons(categories) {
  if (!starterButtonsContainer) {
    return;
  }

  starterButtonsContainer.innerHTML = "";

  if (!categories.length) {
    const button = createStarterButton(
      "View common questions",
      "common"
    );

    starterButtonsContainer.appendChild(button);
    return;
  }

  categories.forEach((category) => {
    const icon = getCategoryIcon(category);

    const button = createStarterButton(
      `${icon} ${category}`,
      category
    );

    starterButtonsContainer.appendChild(button);
  });
}

function createStarterButton(label, category) {
  const button = document.createElement("button");

  button.type = "button";
  button.className = "starter-button";
  button.textContent = label;

  button.addEventListener("click", () => {
    showCategoryQuestions(category);
  });

  return button;
}

function getCategoryIcon(category) {
  const normalCategory = normalize(category);

  for (const [key, icon] of Object.entries(CATEGORY_ICONS)) {
    if (normalCategory.includes(key)) {
      return icon;
    }
  }

  return "📌";
}

function showCategoryQuestions(category) {
  if (chatClosed) {
    return;
  }

  removePendingFeedback();

  const displayCategory =
    category === "common"
      ? "Common questions"
      : category;

  appendUserMessage(displayCategory);

  let items;

  if (category === "common") {
    items = faqData.slice(0, MAX_CATEGORY_QUESTIONS);
  } else {
    items = faqData
      .filter(
        (item) =>
          normalize(item.category) === normalize(category)
      )
      .slice(0, MAX_CATEGORY_QUESTIONS);
  }

  if (!items.length) {
    appendBotMessage(
      "There are currently no questions listed under this category."
    );
    return;
  }

  appendQuestionChoices(
    items,
    `Here are some ${displayCategory} questions:`
  );
}

/* =====================================================
   QUESTION HANDLING
===================================================== */

function submitQuestion(rawQuestion) {
  const question = String(rawQuestion || "").trim();

  if (
    !question ||
    faqData.length === 0 ||
    chatClosed
  ) {
    return;
  }

  removePendingFeedback();
  appendUserMessage(question);

  questionInput.value = "";

  const matches = rankFaqItems(question);

  if (
    matches.length === 0 ||
    matches[0].score <= 0
  ) {
    appendNoMatchMessage();
    return;
  }

  const best = matches[0];
  const second = matches[1];

  const isClearWinner =
    best.score >= MIN_DIRECT_MATCH_SCORE &&
    (
      !second ||
      best.score >= second.score * 1.35
    );

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
    appendQuestionChoices(
      suggestions,
      "I found a few related questions. Please select the closest one:"
    );
  }
}

/* =====================================================
   SEARCH AND MATCHING
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
    `${item.question} ${item.category} ${item.keywords}`
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
    score += 28;
  }

  if (
    category &&
    normalQuestion === category
  ) {
    score += 25;
  } else if (
    category &&
    normalQuestion.includes(category)
  ) {
    score += 14;
  }

  keywordPhrases.forEach((phrase) => {
    const normalPhrase = normalize(phrase);

    if (!normalPhrase) {
      return;
    }

    if (normalQuestion === normalPhrase) {
      score += 35;
    } else if (
      normalQuestion.includes(normalPhrase)
    ) {
      score += 18;
    } else {
      const phraseTokens = tokenize(normalPhrase);

      const matchedTokens = phraseTokens.filter((token) =>
        questionTokens.includes(token)
      );

      score += matchedTokens.length * 4;
    }
  });

  questionTokens.forEach((token) => {
    if (searchableText.includes(token)) {
      score += token.length >= 7 ? 5 : 3;
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
    category.textContent =
      `${getCategoryIcon(item.category)} ${item.category}`;

    bubble.appendChild(category);
  }

  const answer = document.createElement("div");

  answer.className = "answer-text";
  answer.textContent = item.response;

  bubble.appendChild(answer);

  if (
    SHOW_RATIONALE &&
    item.rationale
  ) {
    const rationale = document.createElement("div");

    rationale.className = "answer-rationale";
    rationale.textContent =
      `Rationale: ${item.rationale}`;

    bubble.appendChild(rationale);
  }

  chatMessages.appendChild(row);

  appendFeedbackPrompt(item);
  scrollToLatest();
}

function appendQuestionChoices(items, introductionText) {
  const row = createBotRow();
  const bubble = row.querySelector(".message");

  const introduction =
    document.createElement("p");

  introduction.textContent =
    introductionText;

  bubble.appendChild(introduction);

  const list = document.createElement("div");
  list.className = "suggestion-list";

  items.forEach((item) => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "suggestion-button";
    button.textContent = item.question;

    button.addEventListener("click", () => {
      row.remove();
      appendUserMessage(item.question);
      appendAnswer(item);
    });

    list.appendChild(button);
  });

  bubble.appendChild(list);
  chatMessages.appendChild(row);

  scrollToLatest();
}

function appendNoMatchMessage() {
  const row = createBotRow();
  const bubble = row.querySelector(".message");

  const message = document.createElement("p");

  message.textContent =
    "I’m sorry, I could not find a matching answer. " +
    "Please try using a shorter phrase, another keyword or one of the categories above.";

  bubble.appendChild(message);

  const help = document.createElement("p");

  help.style.marginTop = "12px";
  help.textContent =
    "You may also approach the relevant department or Key Personnel for clarification.";

  bubble.appendChild(help);

  chatMessages.appendChild(row);
  scrollToLatest();
}

/* =====================================================
   FEEDBACK
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
  restartButton.textContent =
    "Start a new enquiry";

  restartButton.addEventListener(
    "click",
    startNewChat
  );

  bubble.appendChild(restartButton);
  chatMessages.appendChild(row);

  scrollToLatest();
}

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
    "You may ask another question below or approach the relevant Key Personnel for clarification.";

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
   RESET AND HELPERS
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

function formatLastUpdatedDate(dateValue) {
  if (!dateValue) {
    return "recently";
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "recently";
  }

  return new Intl.DateTimeFormat(
    "en-SG",
    {
      month: "short",
      year: "numeric",
      timeZone: "Asia/Singapore"
    }
  ).format(date);
}

function scrollToLatest() {
  requestAnimationFrame(() => {
    chatMessages.scrollTop =
      chatMessages.scrollHeight;
  });
}
