import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  collection,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  writeBatch
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

const TABLE_PARAM = "table";
const NAME_KEY = "chameleon_sandbox_name";

function normalizeTableId(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

function generateTableId(length = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

const params = new URLSearchParams(window.location.search);
let tableId = normalizeTableId(params.get(TABLE_PARAM));
if (!tableId) {
  tableId = generateTableId();
}
params.set(TABLE_PARAM, tableId);
const nextUrl = `${window.location.pathname}?${params.toString()}`;
if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
  window.history.replaceState(null, "", nextUrl);
}

const roomId = `sandbox_${tableId}`;
const roomRef = doc(db, "rooms", roomId);
const playersCol = collection(roomRef, "players");

const statusEl = document.getElementById("status");
const screenEl = document.getElementById("screen");
const tableCodeEl = document.getElementById("table-code");
const copyLinkBtn = document.getElementById("copy-link");

let topics = [];
let room = null;
let players = [];
let currentUser = null;
let currentPlayer = null;
let nameDraft = localStorage.getItem(NAME_KEY) || "";
let gameView = "list"; // list | reveal
let revealPlayerId = null;
let voteFinalizeInProgress = false;

if (tableCodeEl) {
  tableCodeEl.textContent = `Table ${tableId}`;
}

if (copyLinkBtn) {
  copyLinkBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setStatus("Invite link copied.");
    } catch (error) {
      setStatus("Could not copy link.");
    }
  });
}

function setStatus(text) {
  statusEl.textContent = text;
}

function shuffleArray(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[swapIndex]] = [copy[swapIndex], copy[i]];
  }
  return copy;
}

function sanitizeTopicBag(topicBag) {
  if (!Array.isArray(topicBag)) return [];
  return topicBag.filter(
    (value) => Number.isInteger(value) && value >= 0 && value < topics.length
  );
}

function getResetCounter() {
  return Number.isInteger(room?.resetCounter) ? room.resetCounter : 0;
}

function getActivePlayers() {
  const resetCounter = getResetCounter();
  return players.filter((player) => (player.joinedReset ?? -1) === resetCounter);
}

function getCurrentJoinedPlayer() {
  if (!currentPlayer) return null;
  return (currentPlayer.joinedReset ?? -1) === getResetCounter() ? currentPlayer : null;
}

function getRoundPlayerIds() {
  const activePlayers = getActivePlayers();
  let roundIds = [];
  if (Array.isArray(room?.roundPlayerIds) && room.roundPlayerIds.length) {
    roundIds = room.roundPlayerIds.slice();
  } else {
    roundIds = activePlayers.map((player) => player.id);
  }

  if (!activePlayers.length) return roundIds;
  const activeSet = new Set(activePlayers.map((player) => player.id));
  return roundIds.filter((playerId) => activeSet.has(playerId));
}

function isCurrentUserInRound() {
  if (!currentUser) return false;
  return getRoundPlayerIds().includes(currentUser.uid);
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

function buildPlayerRows(sourcePlayers, roundIds) {
  return sourcePlayers
    .map((player) => {
      const isYou = player.id === currentUser?.uid;
      const isActive = roundIds.includes(player.id);
      const pills = [];
      if (isYou) pills.push('<span class="pill you">You</span>');
      if (!isActive) pills.push('<span class="pill next">Next</span>');
      const pillHtml = pills.length ? `<span class="pill-group">${pills.join("")}</span>` : "";
      const disabled = !isYou || !isActive;
      return `
        <li class="player-item">
          <button class="player-btn ${isYou ? "" : "secondary"}" data-id="${player.id}" ${disabled ? "disabled" : ""}>
            ${player.name || "Player"}
          </button>
          ${pillHtml}
        </li>
      `;
    })
    .join("");
}

async function loadTopics() {
  try {
    const response = await fetch("./chameleon_topics.json");
    const data = await response.json();
    topics = Array.isArray(data) ? data : [];
  } catch (error) {
    topics = [];
  }
}

async function ensureRoom() {
  const snap = await getDoc(roomRef);
  if (snap.exists()) return;
  await setDoc(roomRef, {
    status: "waiting",
    round: 0,
    resetCounter: 0,
    topicBag: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

function subscribeRoom() {
  onSnapshot(roomRef, (snap) => {
    room = snap.exists() ? snap.data() : { status: "waiting", round: 0, resetCounter: 0 };
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
    const joinedPlayer = getCurrentJoinedPlayer();
    if (joinedPlayer && !nameDraft) {
      nameDraft = joinedPlayer.name || "";
    }
    render();
  });
}

async function joinRoom() {
  if (!currentUser || !room) return;
  const name = nameDraft.trim();
  if (!name) {
    setStatus("Enter a name to join.");
    return;
  }

  const playerRef = doc(playersCol, currentUser.uid);
  const snap = await getDoc(playerRef);
  const resetCounter = getResetCounter();

  if (snap.exists()) {
    const existing = snap.data() || {};
    const isCurrentReset = (existing.joinedReset ?? -1) === resetCounter;
    if (isCurrentReset) {
      await updateDoc(playerRef, {
        lastSeen: serverTimestamp()
      });
    } else {
      await updateDoc(playerRef, {
        name,
        joinedReset: resetCounter,
        joinedAt: serverTimestamp(),
        lastSeen: serverTimestamp()
      });
    }
  } else {
    await setDoc(playerRef, {
      name,
      joinedReset: resetCounter,
      joinedAt: serverTimestamp(),
      lastSeen: serverTimestamp()
    });
  }

  await updateDoc(roomRef, {
    updatedAt: serverTimestamp()
  });
  localStorage.setItem(NAME_KEY, name);
}

async function leaveRoom() {
  if (!currentUser) return;
  const playerRef = doc(playersCol, currentUser.uid);
  await deleteDoc(playerRef);
  nameDraft = localStorage.getItem(NAME_KEY) || "";
}

async function resetGame() {
  if (!room) return;
  const shouldReset = window.confirm("Reset this table for everyone and remove all players?");
  if (!shouldReset) return;

  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    const roomData = roomSnap.exists() ? roomSnap.data() : {};
    const nextResetCounter = (roomData.resetCounter || 0) + 1;
    tx.set(roomRef, {
      status: "waiting",
      round: 0,
      resetCounter: nextResetCounter,
      topic: deleteField(),
      topicIndex: deleteField(),
      word: deleteField(),
      chameleonId: deleteField(),
      roundPlayerIds: deleteField(),
      topicBag: [],
      voteStatus: "inactive",
      votes: {},
      voteResults: deleteField(),
      startedAt: deleteField(),
      voteStartedAt: deleteField(),
      updatedAt: serverTimestamp()
    }, { merge: true });
  });

  let snap = await getDocs(playersCol);
  while (!snap.empty) {
    const batch = writeBatch(db);
    snap.forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });
    await batch.commit();
    snap = await getDocs(playersCol);
  }

  gameView = "list";
  revealPlayerId = null;
  currentPlayer = null;
  players = [];
  nameDraft = "";
  localStorage.removeItem(NAME_KEY);
  render();
}

async function startRound() {
  if (!room) return;

  const joinedPlayer = getCurrentJoinedPlayer();
  if (!joinedPlayer) {
    setStatus("Join this table to start a round.");
    return;
  }

  const activePlayers = getActivePlayers();
  if (!activePlayers.length) {
    setStatus("Add at least one player.");
    return;
  }

  if (!topics.length) {
    setStatus("No topics available.");
    return;
  }

  const roundPlayerIds = activePlayers.map((player) => player.id);

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef);
      if (!snap.exists()) {
        throw new Error("missing-room");
      }

      const data = snap.data() || {};
      let topicBag = sanitizeTopicBag(data.topicBag);
      if (!topicBag.length) {
        topicBag = shuffleArray([...Array(topics.length).keys()]);
      }

      const topicIndex = topicBag.pop();
      const topic = topics[topicIndex] || { topic: "Topic", options: [] };
      const options = Array.isArray(topic.options)
        ? topic.options.filter(Boolean)
        : [];
      const word = options.length
        ? options[Math.floor(Math.random() * options.length)]
        : "";
      const chameleonId = roundPlayerIds[Math.floor(Math.random() * roundPlayerIds.length)];

      tx.set(
        roomRef,
        {
          status: "in_progress",
          round: (data.round || 0) + 1,
          topic: topic.topic || "Topic",
          topicIndex,
          word,
          chameleonId,
          roundPlayerIds,
          topicBag,
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
    setStatus("Could not start round.");
  }
}

async function callVote() {
  if (!room || room.status !== "in_progress") return;
  if (!getCurrentJoinedPlayer() || !isCurrentUserInRound()) return;
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
  if (!isCurrentUserInRound()) return;

  const roundIds = getRoundPlayerIds();
  if (!roundIds.includes(targetId)) return;
  if (targetId === currentUser.uid) return;

  await updateDoc(roomRef, {
    [`votes.${currentUser.uid}`]: targetId,
    updatedAt: serverTimestamp()
  });
}

async function cancelVote() {
  if (!room || room.status !== "in_progress") return;
  if (room.voteStatus !== "open") return;

  await updateDoc(roomRef, {
    voteStatus: "inactive",
    votes: {},
    voteResults: deleteField(),
    updatedAt: serverTimestamp()
  });
}

async function finalizeVoteIfReady() {
  if (voteFinalizeInProgress) return;
  if (!room || room.status !== "in_progress") return;
  if (room.voteStatus !== "open") return;

  const roundIds = getRoundPlayerIds();
  if (!roundIds.length) return;

  const votes = room.votes || {};
  const roundVotes = {};
  roundIds.forEach((playerId) => {
    if (votes[playerId]) {
      roundVotes[playerId] = votes[playerId];
    }
  });

  if (Object.keys(roundVotes).length < roundIds.length) return;

  const tally = {};
  Object.values(roundVotes).forEach((targetId) => {
    if (!targetId || !roundIds.includes(targetId)) return;
    tally[targetId] = (tally[targetId] || 0) + 1;
  });

  const results = roundIds
    .map((playerId) => {
      const player = players.find((item) => item.id === playerId);
      return {
        id: playerId,
        name: player?.name || "Player",
        count: tally[playerId] || 0
      };
    })
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

function renderWaiting() {
  const activePlayers = getActivePlayers();
  const joinedPlayer = getCurrentJoinedPlayer();
  const roundIds = [];
  const playerRows = buildPlayerRows(activePlayers, roundIds);

  screenEl.innerHTML = `
    <section class="card">
      ${
        joinedPlayer
          ? `<div class="row"><span class="notice">Joined as ${joinedPlayer.name || "Player"}.</span><button id="leave-room" class="btn ghost" type="button">Leave</button></div>`
          : `<div class="row"><input id="player-input" class="input" type="text" placeholder="Your name" value="${nameDraft}" /><button id="join-button" class="btn primary" type="button">Join Game</button></div>`
      }
      <div class="board">
        <h2 class="topic">Ready to Play</h2>
        <p class="notice">Start a round when your group is ready.</p>
      </div>
      <ul id="player-buttons" class="player-list">${playerRows || '<li class="notice">No players yet.</li>'}</ul>
      <div class="row action-row">
        <button id="start-round" class="btn primary" type="button" ${activePlayers.length && topics.length ? "" : "disabled"}>Start Round</button>
        <button id="reset-game" class="btn warn" type="button">Reset Game</button>
      </div>
    </section>
  `;

  const input = document.getElementById("player-input");
  if (input) {
    input.addEventListener("input", (event) => {
      nameDraft = event.target.value;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        joinRoom();
      }
    });
  }

  const joinBtn = document.getElementById("join-button");
  if (joinBtn) joinBtn.addEventListener("click", joinRoom);

  const leaveBtn = document.getElementById("leave-room");
  if (leaveBtn) leaveBtn.addEventListener("click", leaveRoom);

  const startBtn = document.getElementById("start-round");
  if (startBtn) startBtn.addEventListener("click", startRound);

  const resetBtn = document.getElementById("reset-game");
  if (resetBtn) resetBtn.addEventListener("click", resetGame);
}

function renderGame() {
  if (!room) return;

  const activePlayers = getActivePlayers();
  const joinedPlayer = getCurrentJoinedPlayer();
  const roundIds = getRoundPlayerIds();
  const roundPlayers = activePlayers.filter((player) => roundIds.includes(player.id));
  const waitingPlayers = activePlayers.filter((player) => !roundIds.includes(player.id));
  const inRound = isCurrentUserInRound();

  const joinNotice = !joinedPlayer
    ? "You are spectating. Join now to enter the next round."
    : !inRound
      ? "You joined mid-round. You are queued for the next round."
      : "";

  const options = getCurrentOptions();
  const optionsHtml = options.length
    ? options.map((option) => `<div class="option-card">${option}</div>`).join("")
    : `<div class="notice">No options available.</div>`;

  const playerRows = buildPlayerRows(activePlayers, roundIds);

  let voteHtml = "";

  if (room.voteStatus === "open") {
    const voteList = roundPlayers
      .filter((player) => player.id !== currentUser?.uid)
      .map((player) => {
        const yourVote = room.votes ? room.votes[currentUser?.uid] : null;
        const selected = yourVote === player.id;
        return `
          <li class="player-item">
            <button class="player-btn ${selected ? "" : "secondary"}" data-id="${player.id}" ${inRound ? "" : "disabled"}>${player.name || "Player"}</button>
          </li>
        `;
      })
      .join("");

    voteHtml = `
      <div class="vote-title">Voting (${Object.keys(room.votes || {}).length}/${roundIds.length})</div>
      <p class="notice">Tap another player to vote.</p>
      <ul class="player-list" id="vote-buttons">${voteList || '<li class="notice">No other players.</li>'}</ul>
      <div class="row action-row"><button id="cancel-vote" class="btn secondary" type="button">Cancel Vote</button></div>
    `;
  } else if (room.voteStatus === "complete") {
    const results = Array.isArray(room.voteResults) ? room.voteResults : [];
    const resultRows = results
      .map((result) => `
        <li class="player-item">
          <span>${result.name}</span>
          <span class="pill you">${result.count}</span>
        </li>
      `)
      .join("");

    voteHtml = `
      <div class="vote-title">Vote Results</div>
      <ul class="player-list">${resultRows || '<li class="notice">No votes recorded.</li>'}</ul>
    `;
  }

  screenEl.innerHTML = `
    <section class="card">
      <div class="row" style="justify-content:flex-end;">
        ${
          joinedPlayer
            ? `<span class="notice">Joined as ${joinedPlayer.name || "Player"}.</span><button id="leave-room" class="btn ghost" type="button">Leave</button>`
            : `<input id="player-input" class="input" type="text" placeholder="Your name" value="${nameDraft}" /><button id="join-button" class="btn primary" type="button">Join Game</button>`
        }
      </div>
      ${joinNotice ? `<p class="notice">${joinNotice}</p>` : ""}
      <div class="board">
        <h2 class="topic">${room.topic || "Topic"}</h2>
        <div class="options-grid">${optionsHtml}</div>
      </div>
      <p class="notice">Tap your name to reveal your role.</p>
      <ul id="player-buttons" class="player-list">${playerRows || '<li class="notice">No players yet.</li>'}</ul>
      ${waitingPlayers.length ? `<p class="notice">${waitingPlayers.length} player${waitingPlayers.length === 1 ? "" : "s"} queued for next round.</p>` : ""}
      ${voteHtml ? `<div class="vote-block">${voteHtml}</div>` : ""}
      <div class="row action-row">
        <button id="call-vote" class="btn secondary action-left" type="button" ${inRound && room.voteStatus !== "open" ? "" : "disabled"}>Call Vote</button>
        <button id="new-round" class="btn primary" type="button">New Round</button>
        <button id="reset-game" class="btn warn" type="button">Reset Game</button>
      </div>
    </section>
  `;

  const input = document.getElementById("player-input");
  if (input) {
    input.addEventListener("input", (event) => {
      nameDraft = event.target.value;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        joinRoom();
      }
    });
  }

  const joinBtn = document.getElementById("join-button");
  if (joinBtn) joinBtn.addEventListener("click", joinRoom);

  const leaveBtn = document.getElementById("leave-room");
  if (leaveBtn) leaveBtn.addEventListener("click", leaveRoom);

  const newRoundBtn = document.getElementById("new-round");
  if (newRoundBtn) newRoundBtn.addEventListener("click", startRound);

  const callVoteBtn = document.getElementById("call-vote");
  if (callVoteBtn) callVoteBtn.addEventListener("click", callVote);

  const cancelVoteBtn = document.getElementById("cancel-vote");
  if (cancelVoteBtn) cancelVoteBtn.addEventListener("click", cancelVote);

  const resetBtn = document.getElementById("reset-game");
  if (resetBtn) resetBtn.addEventListener("click", resetGame);

  const listEl = document.getElementById("player-buttons");
  if (listEl) {
    listEl.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button || button.disabled) return;
      const targetId = button.dataset.id || null;
      if (!targetId || targetId !== currentUser?.uid) return;
      revealPlayerId = targetId;
      gameView = "reveal";
      render();
    });
  }

  const voteListEl = document.getElementById("vote-buttons");
  if (voteListEl) {
    voteListEl.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button || button.disabled) return;
      const targetId = button.dataset.id;
      if (targetId) {
        castVote(targetId);
      }
    });
  }
}

function renderReveal() {
  if (!room) return;
  const isChameleon = revealPlayerId === room.chameleonId;
  const text = isChameleon ? "You are the Chameleon" : (room.word || "No word available");

  screenEl.innerHTML = `
    <section class="card reveal">
      <div class="reveal-text ${isChameleon ? "chameleon" : "word"}">${text}</div>
      <button id="done" class="btn primary" type="button">Done</button>
    </section>
  `;

  const doneBtn = document.getElementById("done");
  if (doneBtn) {
    doneBtn.addEventListener("click", () => {
      gameView = "list";
      revealPlayerId = null;
      render();
    });
  }
}

function render() {
  if (!currentUser || !room) {
    setStatus("Connecting...");
    screenEl.innerHTML = `
      <section class="card">
        <p class="notice">Syncing table state...</p>
      </section>
    `;
    return;
  }

  if (room.status === "waiting") {
    const activeCount = getActivePlayers().length;
    setStatus(`Waiting • ${activeCount} player${activeCount === 1 ? "" : "s"}`);
    renderWaiting();
    return;
  }

  if (room.status === "in_progress") {
    const activeCount = getActivePlayers().length;
    setStatus(`Round in progress • ${activeCount} player${activeCount === 1 ? "" : "s"}`);
    finalizeVoteIfReady();
    if (gameView === "reveal") {
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
    }
    render();
  });
}

init();
