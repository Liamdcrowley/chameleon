import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  collection,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCULaNmeuxMVeFebXqIjuD92gaaQgwGDRc",
  authDomain: "chameleon-486615.firebaseapp.com",
  projectId: "chameleon-486615",
  storageBucket: "chameleon-486615.firebasestorage.app",
  messagingSenderId: "918185882696",
  appId: "1:918185882696:web:742af61d2ecfc10ffd547d",
  measurementId: "G-64DZ29FQ1D"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const roomId = "default";
const roomRef = doc(db, "rooms", roomId);
const playersCol = collection(roomRef, "players");

const statusEl = document.getElementById("status");
const screenEl = document.getElementById("screen");
const headerActionsEl = document.getElementById("header-actions");

let topics = [];
let room = null;
let players = [];
let currentUser = null;
let currentPlayer = null;
let nameDraft = "";
let gameView = "list";
let revealPlayerId = null;
let voteFinalizeInProgress = false;

function setStatus(text) {
  statusEl.textContent = text;
}

async function loadTopics() {
  try {
    const response = await fetch("chameleon_topics.json");
    const data = await response.json();
    topics = Array.isArray(data) ? data : [];
  } catch (error) {
    topics = [];
  }
}

async function ensureRoom() {
  const snap = await getDoc(roomRef);
  if (!snap.exists()) {
    await setDoc(roomRef, {
      status: "waiting",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
}

function subscribeRoom() {
  onSnapshot(roomRef, (snap) => {
    room = snap.exists() ? snap.data() : { status: "waiting" };
    if (room.status !== "in_progress") {
      gameView = "list";
      revealPlayerId = null;
    }
    render();
  });
}

function subscribePlayers() {
  const q = query(playersCol, orderBy("joinedAt", "asc"));
  onSnapshot(q, (snap) => {
    players = snap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));
    render();
  });
}

function subscribeCurrentPlayer() {
  if (!currentUser) return;
  const playerRef = doc(playersCol, currentUser.uid);
  onSnapshot(playerRef, (snap) => {
    currentPlayer = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    if (currentPlayer && !nameDraft) {
      nameDraft = currentPlayer.name || "";
    }
    render();
  });
}

async function joinRoom() {
  if (!currentUser) return;
  if (room?.status === "in_progress") {
    setStatus("Game is full right now.");
    return;
  }
  const name = nameDraft.trim();
  if (!name) {
    setStatus("Enter a name to join.");
    return;
  }

  const playerRef = doc(playersCol, currentUser.uid);
  const snap = await getDoc(playerRef);
  if (snap.exists()) {
    await updateDoc(playerRef, {
      name,
      lastSeen: serverTimestamp()
    });
  } else {
    await setDoc(playerRef, {
      name,
      joinedAt: serverTimestamp(),
      lastSeen: serverTimestamp()
    });
  }
}

async function leaveRoom() {
  if (!currentUser) return;
  const playerRef = doc(playersCol, currentUser.uid);
  await deleteDoc(playerRef);
  nameDraft = "";
}

function pickTopic() {
  if (topics.length === 0) return null;
  const topicIndex = Math.floor(Math.random() * topics.length);
  const topic = topics[topicIndex];
  const options = Array.isArray(topic.options) ? topic.options.filter(Boolean) : [];
  const word = options.length ? options[Math.floor(Math.random() * options.length)] : "";
  return {
    topicIndex,
    topicName: topic.topic || "Topic",
    word
  };
}

async function startGame() {
  if (!room || room.status !== "waiting") return;
  if (!currentPlayer) {
    setStatus("Join the room to start the game.");
    return;
  }
  if (players.length === 0) {
    setStatus("Add at least one player.");
    return;
  }
  const selection = pickTopic();
  if (!selection) {
    setStatus("No topics available.");
    return;
  }

  const chameleon = players[Math.floor(Math.random() * players.length)];

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef);
      const data = snap.exists() ? snap.data() : { status: "waiting" };
      if (data.status === "in_progress") {
        throw new Error("already-started");
      }
      tx.set(
        roomRef,
        {
          status: "in_progress",
          topic: selection.topicName,
          topicIndex: selection.topicIndex,
          word: selection.word,
          chameleonId: chameleon?.id || "",
          voteStatus: "inactive",
          votes: {},
          voteResults: deleteField(),
          startedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    });
  } catch (error) {
    setStatus("Game already started.");
  }
}

async function endGame() {
  if (!room) return;
  await updateDoc(roomRef, {
    status: "waiting",
    voteStatus: "inactive",
    votes: {},
    voteResults: deleteField(),
    updatedAt: serverTimestamp()
  });
  gameView = "list";
  revealPlayerId = null;
}

async function callVote() {
  if (!room || room.status !== "in_progress") return;
  if (!currentPlayer) return;
  if (room.voteStatus === "open") return;
  await updateDoc(roomRef, {
    voteStatus: "open",
    votes: {},
    voteResults: deleteField(),
    voteStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

async function castVote(targetId) {
  if (!room || room.status !== "in_progress") return;
  if (room.voteStatus !== "open") return;
  if (!currentUser || !targetId) return;
  if (targetId === currentUser.uid) return;
  await updateDoc(roomRef, {
    [`votes.${currentUser.uid}`]: targetId,
    updatedAt: serverTimestamp()
  });
}

async function cancelVote() {
  if (!room || room.status !== "in_progress") return;
  if (room.voteStatus !== "open") return;
  if (!currentUser) return;
  await updateDoc(roomRef, {
    [`votes.${currentUser.uid}`]: deleteField(),
    updatedAt: serverTimestamp()
  });
}

async function finalizeVoteIfReady() {
  if (voteFinalizeInProgress) return;
  if (!room || room.status !== "in_progress") return;
  if (room.voteStatus !== "open") return;
  if (!players.length) return;
  const votes = room.votes || {};
  const voteCount = Object.keys(votes).length;
  if (voteCount < players.length) return;

  const tally = {};
  Object.values(votes).forEach((targetId) => {
    if (!targetId) return;
    tally[targetId] = (tally[targetId] || 0) + 1;
  });
  const results = players
    .map((player) => ({
      id: player.id,
      name: player.name || "Player",
      count: tally[player.id] || 0
    }))
    .sort((a, b) => b.count - a.count);

  voteFinalizeInProgress = true;
  try {
    await updateDoc(roomRef, {
      voteStatus: "complete",
      voteResults: results,
      updatedAt: serverTimestamp()
    });
  } finally {
    voteFinalizeInProgress = false;
  }
}

function getCurrentOptions() {
  if (!room) return [];
  if (typeof room.topicIndex === "number" && topics[room.topicIndex]) {
    return Array.isArray(topics[room.topicIndex].options)
      ? topics[room.topicIndex].options
      : [];
  }
  const match = topics.find((item) => item.topic === room.topic);
  return match && Array.isArray(match.options) ? match.options : [];
}

function renderHeaderActions() {
  if (!headerActionsEl) return;
  headerActionsEl.innerHTML = "";
  if (!room) return;

  if (room.status === "waiting") {
    const disabled = !(currentPlayer && topics.length > 0 && players.length > 0);
    headerActionsEl.innerHTML = `
      <button id="header-start" class="button" ${disabled ? "disabled" : ""}>Everyone Ready</button>
    `;
    const startBtn = document.getElementById("header-start");
    if (startBtn) {
      startBtn.addEventListener("click", startGame);
    }
  } else if (room.status === "in_progress" && currentPlayer) {
    headerActionsEl.innerHTML = `
      <button id="header-end" class="button ghost">End Game</button>
    `;
    const endBtn = document.getElementById("header-end");
    if (endBtn) {
      endBtn.addEventListener("click", endGame);
    }
  }
}

function renderWaiting() {
  const joined = Boolean(currentPlayer);
  const playerList = players
    .map((player) => {
      const isYou = player.id === currentUser?.uid;
      return `
        <li class="list-item">
          <span>${player.name || "Player"}</span>
          ${isYou ? '<span class="pill">You</span>' : ""}
        </li>
      `;
    })
    .join("");

  screenEl.innerHTML = `
    <div class="card">
      <h2>Waiting Room</h2>
      <div class="row">
        <input id="player-input" class="input" type="text" placeholder="Your name" />
        <button id="join-button" class="button">${joined ? "Update Name" : "Join Room"}</button>
      </div>
      <div class="row">
        ${joined ? '<button id="leave-button" class="button secondary">Leave Room</button>' : ""}
      </div>
      <ul class="list">${playerList || '<li class="notice">No players yet.</li>'}</ul>
    </div>
  `;

  const input = document.getElementById("player-input");
  const joinBtn = document.getElementById("join-button");
  const leaveBtn = document.getElementById("leave-button");

  input.value = nameDraft || currentPlayer?.name || "";
  input.addEventListener("input", (event) => {
    nameDraft = event.target.value;
  });

  joinBtn.addEventListener("click", joinRoom);
  if (leaveBtn) {
    leaveBtn.addEventListener("click", leaveRoom);
  }
}

function renderGame() {
  if (!room) return;
  const topic = room.topic || "Topic";
  const voteStatus = room.voteStatus || "inactive";
  const voteMap = room.votes || {};
  const voteCount = Object.keys(voteMap).length;
  const totalVotes = players.length;
  const yourVote = currentUser ? voteMap[currentUser.uid] : null;

  let voteHtml = `
    <div class="row" style="justify-content: flex-end;">
      <button id="call-vote" class="button">Call Vote</button>
    </div>
  `;

  if (voteStatus === "open") {
    const voteList = players
      .filter((player) => player.id !== currentUser?.uid)
      .map((player) => {
        const selected = yourVote === player.id;
        const buttonClass = selected ? "button" : "button secondary";
        return `
          <li class="list-item">
            <button class="${buttonClass}" data-id="${player.id}" style="width: 100%;">
              ${player.name || "Player"}
            </button>
          </li>
        `;
      })
      .join("");

    voteHtml = `
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="title">Voting (${voteCount}/${totalVotes})</div>
        <button id="cancel-vote" class="button secondary" ${yourVote ? "" : "disabled"}>Cancel Vote</button>
      </div>
      <p class="notice">Tap another player to vote.</p>
      <ul class="list" id="vote-buttons">
        ${voteList || '<li class="notice">No other players.</li>'}
      </ul>
    `;
  }

  if (voteStatus === "complete") {
    const results = Array.isArray(room.voteResults) ? room.voteResults : [];
    const resultsHtml = results
      .map((result) => `
        <li class="list-item">
          <span>${result.name}</span>
          <span class="pill">${result.count}</span>
        </li>
      `)
      .join("");

    voteHtml = `
      <div class="title">Vote Results</div>
      <ul class="list">
        ${resultsHtml || '<li class="notice">No votes recorded.</li>'}
      </ul>
      <div class="row" style="justify-content: flex-end;">
        <button id="call-vote" class="button">Call Vote</button>
      </div>
    `;
  }

  screenEl.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content: flex-end;">
        <button id="show-options" class="button secondary wide">Show Options</button>
      </div>
      <div class="topic">Topic: ${topic}</div>
      <p class="notice">Click your name to reveal your role.</p>
      <ul class="list" id="player-buttons"></ul>
      <div class="vote-block">
        ${voteHtml}
      </div>
    </div>
  `;

  const listEl = document.getElementById("player-buttons");
  players.forEach((player) => {
    const item = document.createElement("li");
    item.className = "list-item";
    const isYou = player.id === currentUser?.uid;
    const label = isYou ? `${player.name || "Player"} (You)` : (player.name || "Player");
    item.innerHTML = `
      <button class="button ${isYou ? "" : "secondary"}" data-id="${player.id}" style="width: 100%;" ${isYou ? "" : "disabled"}>
        ${label}
      </button>
    `;
    listEl.appendChild(item);
  });

  document.getElementById("show-options").addEventListener("click", () => {
    gameView = "options";
    render();
  });

  listEl.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.disabled) return;
    const targetId = button.dataset.id || null;
    if (!targetId || targetId !== currentUser?.uid) return;
    revealPlayerId = targetId;
    gameView = "reveal";
    render();
  });

  const callVoteBtn = document.getElementById("call-vote");
  if (callVoteBtn) {
    callVoteBtn.addEventListener("click", callVote);
  }

  const cancelVoteBtn = document.getElementById("cancel-vote");
  if (cancelVoteBtn) {
    cancelVoteBtn.addEventListener("click", cancelVote);
  }

  const voteListEl = document.getElementById("vote-buttons");
  if (voteListEl) {
    voteListEl.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      const targetId = button.dataset.id;
      if (targetId) {
        castVote(targetId);
      }
    });
  }
}

function renderOptions() {
  if (!room) return;
  const options = getCurrentOptions();
  const optionsHtml = options.length
    ? options.map((option) => `<div class="option-card">${option}</div>`).join("")
    : `<div class="notice">No options available.</div>`;

  screenEl.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content: flex-end;">
        <button id="back-game" class="button secondary wide">Hide Options</button>
      </div>
      <div class="topic">Topic: ${room.topic || "Topic"}</div>
      <div class="options-grid">${optionsHtml}</div>
    </div>
  `;

  document.getElementById("back-game").addEventListener("click", () => {
    gameView = "list";
    render();
  });
}

function renderReveal() {
  if (!room) return;
  const player = players.find((item) => item.id === revealPlayerId);
  const playerName = player?.name || "Player";
  const isChameleon = revealPlayerId === room.chameleonId;

  screenEl.innerHTML = `
    <div class="card">
      <h2>Player: ${playerName}</h2>
      <div class="topic">Topic: ${room.topic || "Topic"}</div>
      ${isChameleon ? `<div class="role">You are the Chameleon</div>` : `<div class="role">Your word</div><div class="word">${room.word || "No word available"}</div>`}
      <button id="done" class="button">Done</button>
    </div>
  `;

  document.getElementById("done").addEventListener("click", () => {
    gameView = "list";
    revealPlayerId = null;
    render();
  });
}

function renderFull() {
  screenEl.innerHTML = `
    <div class="card">
      <div class="full-message">Game in progress</div>
      <p class="notice">This room is full right now. Please try again later.</p>
      <button id="refresh" class="button secondary">Check again</button>
    </div>
  `;
  document.getElementById("refresh").addEventListener("click", () => {
    window.location.reload();
  });
}

function render() {
  if (!currentUser || !room) {
    setStatus("Connecting...");
    if (headerActionsEl) {
      headerActionsEl.innerHTML = "";
    }
    return;
  }

  renderHeaderActions();

  if (room.status === "waiting") {
    setStatus(`Waiting room • ${players.length} player${players.length === 1 ? "" : "s"}`);
    renderWaiting();
    return;
  }

  if (room.status === "in_progress") {
    if (!currentPlayer) {
      setStatus("Game in progress");
      renderFull();
      return;
    }
    setStatus("Game in progress");
    finalizeVoteIfReady();
    if (gameView === "options") {
      renderOptions();
    } else if (gameView === "reveal") {
      renderReveal();
    } else {
      renderGame();
    }
    return;
  }

  setStatus("Loading...");
}

async function init() {
  await loadTopics();
  signInAnonymously(auth).catch(() => {
    setStatus("Failed to sign in.");
  });

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
      await ensureRoom();
      subscribeRoom();
      subscribePlayers();
      subscribeCurrentPlayer();
    } else {
      render();
    }
  });
}

init();
