import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
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

let topics = [];
let room = null;
let players = [];
let currentUser = null;
let currentPlayer = null;
let nameDraft = "";
let gameView = "list";
let revealPlayerId = null;

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
    updatedAt: serverTimestamp()
  });
  gameView = "list";
  revealPlayerId = null;
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
      <p class="notice">Share this page so everyone can join. When ready, anyone can start.</p>
      <div class="row">
        <input id="player-input" class="input" type="text" placeholder="Your name" />
        <button id="join-button" class="button">${joined ? "Update Name" : "Join Room"}</button>
      </div>
      <div class="row">
        ${joined ? '<button id="leave-button" class="button secondary">Leave Room</button>' : ""}
        <button id="start-game" class="button" ${joined && topics.length > 0 && players.length > 0 ? "" : "disabled"}>Start Game</button>
      </div>
      <ul class="list">${playerList || '<li class="notice">No players yet.</li>'}</ul>
    </div>
  `;

  const input = document.getElementById("player-input");
  const joinBtn = document.getElementById("join-button");
  const startBtn = document.getElementById("start-game");
  const leaveBtn = document.getElementById("leave-button");

  input.value = nameDraft || currentPlayer?.name || "";
  input.addEventListener("input", (event) => {
    nameDraft = event.target.value;
  });

  joinBtn.addEventListener("click", joinRoom);
  startBtn.addEventListener("click", startGame);
  if (leaveBtn) {
    leaveBtn.addEventListener("click", leaveRoom);
  }
}

function renderGame() {
  if (!room) return;
  const topic = room.topic || "Topic";

  screenEl.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content: space-between;">
        <button id="end-game" class="button ghost">End Game</button>
        <button id="show-options" class="button secondary">Show Options (Landscape)</button>
      </div>
      <div class="topic">Topic: ${topic}</div>
      <p class="notice">Click your name to reveal your role.</p>
      <ul class="list" id="player-buttons"></ul>
    </div>
  `;

  const listEl = document.getElementById("player-buttons");
  players.forEach((player) => {
    const item = document.createElement("li");
    item.className = "list-item";
    item.innerHTML = `<button class="button" data-id="${player.id}" style="width: 100%;">${player.name || "Player"}</button>`;
    listEl.appendChild(item);
  });

  document.getElementById("end-game").addEventListener("click", endGame);
  document.getElementById("show-options").addEventListener("click", () => {
    gameView = "options";
    render();
  });

  listEl.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    revealPlayerId = button.dataset.id || null;
    if (revealPlayerId) {
      gameView = "reveal";
      render();
    }
  });
}

function renderOptions() {
  if (!room) return;
  const options = getCurrentOptions();
  const optionsHtml = options.length
    ? options.map((option) => `<div class="option-card">${option}</div>`).join("")
    : `<div class="notice">No options available.</div>`;

  screenEl.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content: space-between;">
        <button id="back-game" class="button ghost">Back to game</button>
        <div class="title">All Options</div>
      </div>
      <div class="topic">Topic: ${room.topic || "Topic"}</div>
      <div class="notice">Rotate to landscape for maximum visibility.</div>
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
    return;
  }

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
