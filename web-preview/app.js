const statusEl = document.getElementById("status");
const screenEl = document.getElementById("screen");

let topics = [];
let players = [];
let screen = "setup";
let game = null;
let revealIndex = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function loadTopics() {
  return fetch("../chameleon_topics.json")
    .then((response) => response.json())
    .then((data) => {
      topics = Array.isArray(data) ? data : [];
      setStatus(`Loaded ${topics.length} topics`);
    })
    .catch(() => {
      topics = [];
      setStatus("Failed to load topics. Make sure the server is running.");
    });
}

function buildGame() {
  if (players.length === 0 || topics.length === 0) return null;
  const topic = topics[Math.floor(Math.random() * topics.length)];
  const options = Array.isArray(topic.options) ? topic.options.filter(Boolean) : [];
  const word = options.length ? options[Math.floor(Math.random() * options.length)] : "";
  const chameleonIndex = Math.floor(Math.random() * players.length);
  return {
    topic: topic.topic || "Topic",
    word,
    options,
    chameleonIndex,
  };
}

function renderSetup() {
  screenEl.innerHTML = `
    <div class="card">
      <h2>Players</h2>
      <div class="row">
        <input id="player-input" class="input" type="text" placeholder="Player name" />
        <button id="add-player" class="button">Add Player</button>
      </div>
      <ul class="list" id="players-list"></ul>
      <div class="row" style="margin-top: 16px;">
        <button id="start-game" class="button" ${players.length === 0 || topics.length === 0 ? "disabled" : ""}>Start Game</button>
      </div>
      <p class="notice">Add at least one player to start.</p>
    </div>
  `;

  const input = document.getElementById("player-input");
  const addBtn = document.getElementById("add-player");
  const startBtn = document.getElementById("start-game");
  const listEl = document.getElementById("players-list");

  function refreshList() {
    listEl.innerHTML = "";
    if (players.length === 0) {
      listEl.innerHTML = `<li class="notice">No players yet.</li>`;
      startBtn.disabled = true;
      return;
    }
    players.forEach((name, index) => {
      const item = document.createElement("li");
      item.className = "list-item";
      item.innerHTML = `
        <span>${name}</span>
        <button class="button secondary" data-index="${index}">Remove</button>
      `;
      listEl.appendChild(item);
    });
    startBtn.disabled = topics.length === 0;
  }

  addBtn.addEventListener("click", () => {
    const value = input.value.trim();
    if (!value) return;
    players.push(value);
    input.value = "";
    refreshList();
  });

  input.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      addBtn.click();
    }
  });

  listEl.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const index = Number(button.dataset.index);
    if (!Number.isNaN(index)) {
      players.splice(index, 1);
      refreshList();
    }
  });

  startBtn.addEventListener("click", () => {
    const newGame = buildGame();
    if (!newGame) return;
    game = newGame;
    screen = "game";
    render();
  });

  refreshList();
}

function renderGame() {
  if (!game) {
    screen = "setup";
    render();
    return;
  }

  screenEl.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content: space-between;">
        <button id="back-setup" class="button ghost">Back to setup</button>
        <button id="new-game" class="button secondary">New Game</button>
      </div>
      <div class="topic">Topic: ${game.topic}</div>
      <button id="show-options" class="button" style="margin-bottom: 8px;">Show Options (Landscape)</button>
      <p class="notice">Pass the phone and click your name to reveal your role.</p>
      <ul class="list" id="player-buttons"></ul>
    </div>
  `;

  const backBtn = document.getElementById("back-setup");
  const newGameBtn = document.getElementById("new-game");
  const showOptionsBtn = document.getElementById("show-options");
  const listEl = document.getElementById("player-buttons");

  players.forEach((name, index) => {
    const item = document.createElement("li");
    item.className = "list-item";
    item.innerHTML = `<button class="button" data-index="${index}" style="width: 100%;">${name}</button>`;
    listEl.appendChild(item);
  });

  backBtn.addEventListener("click", () => {
    game = null;
    screen = "setup";
    render();
  });

  newGameBtn.addEventListener("click", () => {
    const newGame = buildGame();
    if (!newGame) return;
    game = newGame;
    render();
  });

  showOptionsBtn.addEventListener("click", () => {
    screen = "options";
    render();
  });

  listEl.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const index = Number(button.dataset.index);
    if (!Number.isNaN(index)) {
      revealIndex = index;
      screen = "reveal";
      render();
    }
  });
}

function renderOptions() {
  if (!game) {
    screen = "setup";
    render();
    return;
  }

  const options = Array.isArray(game.options) ? game.options : [];
  const optionsHtml = options.length
    ? options.map((option) => `<div class="option-card">${option}</div>`).join("")
    : `<div class="notice">No options available.</div>`;

  screenEl.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content: space-between;">
        <button id="back-game" class="button ghost">Back to game</button>
        <div class="title">All Options</div>
      </div>
      <div class="topic">Topic: ${game.topic}</div>
      <div class="notice">Rotate to landscape for maximum visibility.</div>
      <div class="options-grid">
        ${optionsHtml}
      </div>
    </div>
  `;

  document.getElementById("back-game").addEventListener("click", () => {
    screen = "game";
    render();
  });
}

function renderReveal() {
  if (!game || revealIndex === null) {
    screen = "game";
    render();
    return;
  }

  const playerName = players[revealIndex] || "Player";
  const isChameleon = revealIndex === game.chameleonIndex;

  screenEl.innerHTML = `
    <div class="card">
      <h2>Player: ${playerName}</h2>
      <div class="topic">Topic: ${game.topic}</div>
      ${isChameleon ? `<div class="role">You are the Chameleon</div>` : `<div class="role">Your word</div><div class="word">${game.word || "No word available"}</div>`}
      <button id="done" class="button">Done</button>
    </div>
  `;

  document.getElementById("done").addEventListener("click", () => {
    screen = "game";
    revealIndex = null;
    render();
  });
}

function render() {
  if (screen === "setup") {
    renderSetup();
  } else if (screen === "game") {
    renderGame();
  } else if (screen === "options") {
    renderOptions();
  } else {
    renderReveal();
  }
}

loadTopics().then(render);
