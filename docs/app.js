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
  writeBatch,
  increment
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

const roomsCol = collection(db, "rooms");

const statusEl = document.getElementById("status");
const screenEl = document.getElementById("screen");
const headerActionsEl = document.getElementById("header-actions");

let topics = [];
let lobbies = [];
let lobbyUnsub = null;
let roomUnsub = null;
let playersUnsub = null;
let currentPlayerUnsub = null;

let lobbyId = null;
let roomRef = null;
let playersCol = null;

let room = null;
let players = [];
let currentUser = null;
let currentPlayer = null;

let nameDraft = localStorage.getItem("chameleon_name") || "";
let lobbyNameDraft = "";
let lobbyCodeDraft = "";
let view = "lobbies"; // lobbies | lobby
let gameView = "list"; // list | options | reveal
let revealPlayerId = null;
let voteFinalizeInProgress = false;

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

function generateLobbyCode(length = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function normalizeCode(value) {
  return value.trim().toUpperCase();
}

function clearLobbySubscriptions() {
  if (roomUnsub) roomUnsub();
  if (playersUnsub) playersUnsub();
  if (currentPlayerUnsub) currentPlayerUnsub();
  roomUnsub = null;
  playersUnsub = null;
  currentPlayerUnsub = null;
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

function subscribeLobbies() {
  if (lobbyUnsub) lobbyUnsub();
  const q = query(roomsCol, orderBy("updatedAt", "desc"));
  lobbyUnsub = onSnapshot(q, (snap) => {
    lobbies = snap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));
    if (view === "lobbies") {
      render();
    }
  });
}

async function createLobby() {
  const lobbyName = lobbyNameDraft.trim();
  setStatus("Creating lobby...");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateLobbyCode();
    const ref = doc(roomsCol, code);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      continue;
    }
    await setDoc(ref, {
      name: lobbyName || `Lobby ${code}`,
      status: "waiting",
      playerCount: 0,
      round: 0,
      topicBag: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    lobbyNameDraft = "";
    await enterLobby(code);
    return;
  }
  setStatus("Unable to create a lobby. Try again.");
}

async function joinLobbyByCode(codeInput) {
  const code = normalizeCode(codeInput || lobbyCodeDraft);
  if (!code) {
    setStatus("Enter a lobby code.");
    return;
  }
  const ref = doc(roomsCol, code);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    setStatus("Lobby not found.");
    return;
  }
  lobbyCodeDraft = "";
  await enterLobby(code);
}

async function enterLobby(code) {
  clearLobbySubscriptions();
  lobbyId = code;
  roomRef = doc(roomsCol, code);
  playersCol = collection(roomRef, "players");
  view = "lobby";
  gameView = "list";
  revealPlayerId = null;
  localStorage.setItem("chameleon_last_lobby", code);
  subscribeRoom();
  subscribePlayers();
  subscribeCurrentPlayer();
  render();
}

function subscribeRoom() {
  if (!roomRef) return;
  roomUnsub = onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) {
      setStatus("Lobby no longer exists.");
      room = null;
      leaveLobby(false);
      return;
    }
    room = snap.data();
    if (room.status !== "in_progress") {
      gameView = "list";
      revealPlayerId = null;
    }
    render();
  });
}

function subscribePlayers() {
  if (!playersCol) return;
  const q = query(playersCol, orderBy("joinedAt", "asc"));
  playersUnsub = onSnapshot(q, (snap) => {
    players = snap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));
    render();
  });
}

function subscribeCurrentPlayer() {
  if (!currentUser || !playersCol) return;
  const playerRef = doc(playersCol, currentUser.uid);
  currentPlayerUnsub = onSnapshot(playerRef, (snap) => {
    currentPlayer = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    if (currentPlayer && !nameDraft) {
      nameDraft = currentPlayer.name || "";
    }
    render();
  });
}

async function joinRoom() {
  if (!currentUser || !roomRef || !playersCol) return;
  const name = nameDraft.trim();
  if (!name) {
    setStatus("Enter a name to join.");
    return;
  }

  const playerRef = doc(playersCol, currentUser.uid);
  try {
    await runTransaction(db, async (tx) => {
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists()) {
        throw new Error("missing-room");
      }
      const playerSnap = await tx.get(playerRef);
      if (playerSnap.exists()) {
        tx.update(playerRef, {
          name,
          lastSeen: serverTimestamp()
        });
      } else {
        tx.set(playerRef, {
          name,
          joinedAt: serverTimestamp(),
          lastSeen: serverTimestamp()
        });
        tx.update(roomRef, {
          playerCount: increment(1)
        });
      }
      tx.update(roomRef, {
        updatedAt: serverTimestamp()
      });
    });
    localStorage.setItem("chameleon_name", name);
  } catch (error) {
    setStatus("Unable to join lobby.");
  }
}

async function removeCurrentPlayer() {
  if (!currentUser || !roomRef || !playersCol) return;
  const playerRef = doc(playersCol, currentUser.uid);
  try {
    await runTransaction(db, async (tx) => {
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists()) return;
      const playerSnap = await tx.get(playerRef);
      if (!playerSnap.exists()) return;
      tx.delete(playerRef);
      tx.update(roomRef, {
        playerCount: increment(-1),
        updatedAt: serverTimestamp()
      });
    });
  } catch (error) {
    // ignore
  }
}

async function leaveLobby(shouldRemovePlayer = true) {
  if (shouldRemovePlayer) {
    await removeCurrentPlayer();
  }
  clearLobbySubscriptions();
  lobbyId = null;
  roomRef = null;
  playersCol = null;
  room = null;
  players = [];
  currentPlayer = null;
  view = "lobbies";
  gameView = "list";
  revealPlayerId = null;
  render();
}

async function clearPlayers() {
  if (!roomRef || !room || room.status !== "waiting") return;
  const snap = await getDocs(playersCol);
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.forEach((docSnap) => {
    batch.delete(docSnap.ref);
  });
  batch.update(roomRef, {
    playerCount: 0,
    updatedAt: serverTimestamp()
  });
  await batch.commit();
}

function getRoundPlayerIds() {
  let roundIds = [];
  if (room && Array.isArray(room.roundPlayerIds) && room.roundPlayerIds.length) {
    roundIds = room.roundPlayerIds.slice();
  } else {
    roundIds = players.map((player) => player.id);
  }
  if (!players.length) return roundIds;
  const activeSet = new Set(players.map((player) => player.id));
  return roundIds.filter((playerId) => activeSet.has(playerId));
}

function isCurrentUserInRound() {
  if (!currentUser) return false;
  const roundIds = getRoundPlayerIds();
  return roundIds.includes(currentUser.uid);
}

function sanitizeTopicBag(topicBag) {
  if (!Array.isArray(topicBag)) return [];
  return topicBag.filter(
    (value) => Number.isInteger(value) && value >= 0 && value < topics.length
  );
}

async function startRound() {
  if (!roomRef || !room) return;
  if (!currentPlayer) {
    setStatus("Join the lobby to start a round.");
    return;
  }
  if (players.length === 0) {
    setStatus("Add at least one player.");
    return;
  }
  if (topics.length === 0) {
    setStatus("No topics available.");
    return;
  }

  const roundPlayerIds = players.map((player) => player.id);
  if (roundPlayerIds.length === 0) {
    setStatus("No players available.");
    return;
  }

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef);
      if (!snap.exists()) {
        throw new Error("missing-room");
      }
      const data = snap.data() || {};
      let topicBag = sanitizeTopicBag(data.topicBag);
      if (topicBag.length === 0) {
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
      const round = (data.round || 0) + 1;

      tx.set(
        roomRef,
        {
          status: "in_progress",
          topic: topic.topic || "Topic",
          topicIndex,
          word,
          chameleonId,
          voteStatus: "inactive",
          votes: {},
          voteResults: deleteField(),
          startedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          round,
          roundPlayerIds,
          topicBag
        },
        { merge: true }
      );
    });
  } catch (error) {
    setStatus("Unable to start round.");
  }
}

async function endRound() {
  if (!roomRef || !room) return;
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
  const voteCount = Object.keys(roundVotes).length;
  if (voteCount < roundIds.length) return;

  const tally = {};
  Object.values(roundVotes).forEach((targetId) => {
    if (!targetId) return;
    if (!roundIds.includes(targetId)) return;
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
  if (view === "lobby") {
    headerActionsEl.innerHTML = `
      <button id="back-lobbies" class="button ghost">Lobby Directory</button>
    `;
    const backBtn = document.getElementById("back-lobbies");
    if (backBtn) {
      backBtn.addEventListener("click", () => leaveLobby(true));
    }
  }
}

function renderLobbyDirectory() {
  const lastLobby = localStorage.getItem("chameleon_last_lobby");
  const lobbiesHtml = lobbies.length
    ? lobbies
        .map((lobby) => {
          const lobbyName = lobby.name || `Lobby ${lobby.id}`;
          const statusLabel = lobby.status === "in_progress" ? "In progress" : "Waiting";
          const count = Number.isInteger(lobby.playerCount) ? lobby.playerCount : 0;
          return `
            <li class="list-item">
              <div>
                <div class="title">${lobbyName}</div>
                <div class="meta">Code: ${lobby.id} • ${count} player${count === 1 ? "" : "s"} • ${statusLabel}</div>
              </div>
              <button class="button secondary" data-lobby="${lobby.id}">Join</button>
            </li>
          `;
        })
        .join("")
    : `<li class="notice">No lobbies yet. Create one to get started.</li>`;

  screenEl.innerHTML = `
    <div class="card">
      <h2>Lobby Directory</h2>
      <p class="notice">Create a lobby or jump into one that is already running.</p>
      <div class="row">
        <input id="lobby-name" class="input" type="text" placeholder="Lobby name (optional)" value="${lobbyNameDraft}" />
        <button id="create-lobby" class="button">Create Lobby</button>
      </div>
      <div class="row">
        <input id="lobby-code" class="input" type="text" placeholder="Enter lobby code" value="${lobbyCodeDraft}" />
        <button id="join-lobby" class="button secondary">Join Lobby</button>
      </div>
      ${lastLobby ? `<div class="row"><button id="rejoin-last" class="button ghost">Rejoin ${lastLobby}</button></div>` : ""}
    </div>
    <div class="card">
      <h3 class="section-title">Active Lobbies</h3>
      <ul class="list" id="lobby-list">${lobbiesHtml}</ul>
    </div>
  `;

  const nameInput = document.getElementById("lobby-name");
  const codeInput = document.getElementById("lobby-code");
  if (nameInput) {
    nameInput.addEventListener("input", (event) => {
      lobbyNameDraft = event.target.value;
    });
  }
  if (codeInput) {
    codeInput.addEventListener("input", (event) => {
      lobbyCodeDraft = event.target.value;
    });
  }

  const createBtn = document.getElementById("create-lobby");
  if (createBtn) {
    createBtn.addEventListener("click", createLobby);
  }

  const joinBtn = document.getElementById("join-lobby");
  if (joinBtn) {
    joinBtn.addEventListener("click", () => joinLobbyByCode());
  }

  const rejoinBtn = document.getElementById("rejoin-last");
  if (rejoinBtn) {
    rejoinBtn.addEventListener("click", () => joinLobbyByCode(lastLobby));
  }

  const listEl = document.getElementById("lobby-list");
  if (listEl) {
    listEl.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      const code = button.dataset.lobby;
      if (code) {
        joinLobbyByCode(code);
      }
    });
  }
}

function renderLobbyWaiting() {
  const lobbyName = room?.name || `Lobby ${lobbyId}`;
  const count = Number.isInteger(room?.playerCount) ? room.playerCount : players.length;
  const canStart = players.length > 0 && topics.length > 0;
  const playerList = players
    .map((player) => {
      const isYou = player.id === currentUser?.uid;
      const pill = isYou ? '<span class="pill">You</span>' : "";
      return `
        <li class="list-item">
          <span>${player.name || "Player"}</span>
          ${pill}
        </li>
      `;
    })
    .join("");

  screenEl.innerHTML = `
    <div class="card">
      <div class="lobby-header">
        <div>
          <div class="eyebrow">Lobby</div>
          <h2>${lobbyName}</h2>
          <div class="lobby-meta">Code: <span class="code">${lobbyId}</span> • ${count} player${count === 1 ? "" : "s"}</div>
        </div>
        <div class="row">
          <button id="copy-code" class="button secondary">Copy Code</button>
          <button id="leave-lobby" class="button ghost">Leave Lobby</button>
        </div>
      </div>
      <div class="row">
        <input id="player-input" class="input" type="text" placeholder="Your name" value="${nameDraft}" />
        <button id="join-button" class="button">${currentPlayer ? "Update Name" : "Join Lobby"}</button>
      </div>
      <div class="row">
        <button id="start-round" class="button" ${canStart ? "" : "disabled"}>Start Round</button>
        <button id="clear-players" class="button secondary" ${players.length ? "" : "disabled"}>Clear Players</button>
      </div>
      <ul class="list">${playerList || '<li class="notice">No players yet.</li>'}</ul>
    </div>
  `;

  const input = document.getElementById("player-input");
  if (input) {
    input.addEventListener("input", (event) => {
      nameDraft = event.target.value;
    });
  }

  const joinBtn = document.getElementById("join-button");
  if (joinBtn) {
    joinBtn.addEventListener("click", joinRoom);
  }

  const startBtn = document.getElementById("start-round");
  if (startBtn) {
    startBtn.addEventListener("click", startRound);
  }

  const clearBtn = document.getElementById("clear-players");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearPlayers);
  }

  const leaveBtn = document.getElementById("leave-lobby");
  if (leaveBtn) {
    leaveBtn.addEventListener("click", () => leaveLobby(true));
  }

  const copyBtn = document.getElementById("copy-code");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(lobbyId);
        setStatus("Lobby code copied.");
      } catch (error) {
        setStatus("Unable to copy lobby code.");
      }
    });
  }
}

function renderLobbyGame() {
  const lobbyName = room?.name || `Lobby ${lobbyId}`;
  const count = Number.isInteger(room?.playerCount) ? room.playerCount : players.length;
  const roundNumber = room?.round || 0;
  const roundIds = getRoundPlayerIds();
  const inRound = isCurrentUserInRound();
  const roundPlayers = players.filter((player) => roundIds.includes(player.id));
  const waitingPlayers = players.filter((player) => !roundIds.includes(player.id));

  const joinNotice = !currentPlayer
    ? "Join the lobby to participate in this round."
    : !inRound
      ? "This round is already running. You'll join the next round."
      : "";

  const playerList = players
    .map((player) => {
      const isYou = player.id === currentUser?.uid;
      const isActive = roundIds.includes(player.id);
      const pills = [];
      if (isYou) pills.push('<span class="pill">You</span>');
      if (isActive) {
        pills.push('<span class="pill success">Round</span>');
      } else {
        pills.push('<span class="pill muted">Next</span>');
      }
      const pillHtml = `<span class="pill-group">${pills.join("")}</span>`;
      const disabled = !isYou || !isActive;
      return `
        <li class="list-item">
          <button class="button ${isYou ? "" : "secondary"}" data-id="${player.id}" style="width: 100%;" ${disabled ? "disabled" : ""}>
            ${player.name || "Player"}
          </button>
          ${pillHtml}
        </li>
      `;
    })
    .join("");

  let voteHtml = `
    <div class="row" style="justify-content: flex-end;">
      <button id="call-vote" class="button">Call Vote</button>
    </div>
  `;

  if (room.voteStatus === "open") {
    const voteList = roundPlayers
      .filter((player) => player.id !== currentUser?.uid)
      .map((player) => {
        const yourVote = room.votes ? room.votes[currentUser?.uid] : null;
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
        <div class="title">Voting (${Object.keys(room.votes || {}).length}/${roundIds.length})</div>
        <button id="cancel-vote" class="button secondary">Cancel Vote</button>
      </div>
      <p class="notice">Tap another player to vote.</p>
      <ul class="list" id="vote-buttons">
        ${voteList || '<li class="notice">No other players.</li>'}
      </ul>
    `;
  }

  if (room.voteStatus === "complete") {
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
      <div class="lobby-header">
        <div>
          <div class="eyebrow">Lobby</div>
          <h2>${lobbyName}</h2>
          <div class="lobby-meta">Code: <span class="code">${lobbyId}</span> • ${count} player${count === 1 ? "" : "s"} • Round ${roundNumber}</div>
        </div>
        <div class="row">
          <button id="copy-code" class="button secondary">Copy Code</button>
          <button id="leave-lobby" class="button ghost">Leave Lobby</button>
        </div>
      </div>
      <div class="row">
        <input id="player-input" class="input" type="text" placeholder="Your name" value="${nameDraft}" />
        <button id="join-button" class="button">${currentPlayer ? "Update Name" : "Join Lobby"}</button>
      </div>
      ${joinNotice ? `<p class="notice">${joinNotice}</p>` : ""}
      <div class="row">
        <button id="new-round" class="button">New Round</button>
        <button id="end-round" class="button secondary">End Round</button>
        <button id="show-options" class="button ghost">Show Options</button>
      </div>
      <div class="topic">Topic: ${room.topic || "Topic"}</div>
      <p class="notice">Click your name to reveal your role.</p>
      <ul class="list" id="player-buttons">${playerList || '<li class="notice">No players yet.</li>'}</ul>
      ${waitingPlayers.length ? `<p class="notice">${waitingPlayers.length} player${waitingPlayers.length === 1 ? "" : "s"} queued for next round.</p>` : ""}
      <div class="vote-block">
        ${voteHtml}
      </div>
    </div>
  `;

  const input = document.getElementById("player-input");
  if (input) {
    input.addEventListener("input", (event) => {
      nameDraft = event.target.value;
    });
  }

  const joinBtn = document.getElementById("join-button");
  if (joinBtn) {
    joinBtn.addEventListener("click", joinRoom);
  }

  const newRoundBtn = document.getElementById("new-round");
  if (newRoundBtn) {
    newRoundBtn.addEventListener("click", startRound);
  }

  const endRoundBtn = document.getElementById("end-round");
  if (endRoundBtn) {
    endRoundBtn.addEventListener("click", endRound);
  }

  const showOptionsBtn = document.getElementById("show-options");
  if (showOptionsBtn) {
    showOptionsBtn.addEventListener("click", () => {
      gameView = "options";
      render();
    });
  }

  const listEl = document.getElementById("player-buttons");
  if (listEl) {
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
  }

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

  const leaveBtn = document.getElementById("leave-lobby");
  if (leaveBtn) {
    leaveBtn.addEventListener("click", () => leaveLobby(true));
  }

  const copyBtn = document.getElementById("copy-code");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(lobbyId);
        setStatus("Lobby code copied.");
      } catch (error) {
        setStatus("Unable to copy lobby code.");
      }
    });
  }
}

function renderOptions() {
  const options = getCurrentOptions();
  const optionsHtml = options.length
    ? options.map((option) => `<div class="option-card">${option}</div>`).join("")
    : `<div class="notice">No options available.</div>`;

  screenEl.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content: space-between;">
        <button id="back-game" class="button secondary">Back to Game</button>
        <button id="new-round" class="button">New Round</button>
      </div>
      <div class="topic">Topic: ${room?.topic || "Topic"}</div>
      <div class="options-grid">${optionsHtml}</div>
    </div>
  `;

  const backBtn = document.getElementById("back-game");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      gameView = "list";
      render();
    });
  }

  const newRoundBtn = document.getElementById("new-round");
  if (newRoundBtn) {
    newRoundBtn.addEventListener("click", startRound);
  }
}

function renderReveal() {
  const roundIds = getRoundPlayerIds();
  const isInRound = currentUser ? roundIds.includes(currentUser.uid) : false;
  const player = players.find((item) => item.id === revealPlayerId);
  const playerName = player?.name || "Player";
  const isChameleon = revealPlayerId === room?.chameleonId;

  screenEl.innerHTML = `
    <div class="card">
      <h2>Player: ${playerName}</h2>
      <div class="topic">Topic: ${room?.topic || "Topic"}</div>
      ${
        !isInRound
          ? `<div class="notice">You are queued for the next round.</div>`
          : isChameleon
            ? `<div class="role">You are the Chameleon</div>`
            : `<div class="role">Your word</div><div class="word">${room?.word || "No word available"}</div>`
      }
      <button id="done" class="button">Done</button>
    </div>
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
  if (!currentUser) {
    setStatus("Connecting...");
    if (headerActionsEl) {
      headerActionsEl.innerHTML = "";
    }
    return;
  }

  renderHeaderActions();

  if (view === "lobbies") {
    setStatus("Lobby directory");
    renderLobbyDirectory();
    return;
  }

  if (!room) {
    setStatus("Connecting to lobby...");
    screenEl.innerHTML = `
      <div class="card">
        <div class="full-message">Connecting to lobby...</div>
        <p class="notice">Hang tight while we sync the room.</p>
      </div>
    `;
    return;
  }

  if (room.status === "waiting") {
    setStatus(`Waiting room • ${players.length} player${players.length === 1 ? "" : "s"}`);
    renderLobbyWaiting();
    return;
  }

  if (room.status === "in_progress") {
    setStatus(`Round in progress • ${players.length} player${players.length === 1 ? "" : "s"}`);
    finalizeVoteIfReady();
    if (gameView === "options") {
      renderOptions();
    } else if (gameView === "reveal") {
      renderReveal();
    } else {
      renderLobbyGame();
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
      subscribeLobbies();
      render();
    } else {
      render();
    }
  });
}

init();
