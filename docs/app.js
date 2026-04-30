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
let nameDraft = localStorage.getItem("chameleon_name") || "";
let gameView = "list"; // list | reveal
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

function sanitizeTopicBag(topicBag) {
  if (!Array.isArray(topicBag)) return [];
  return topicBag.filter(
    (value) => Number.isInteger(value) && value >= 0 && value < topics.length
  );
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
  if (snap.exists()) return;
  await setDoc(roomRef, {
    status: "waiting",
    round: 0,
    topicBag: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

function subscribeRoom() {
  onSnapshot(roomRef, (snap) => {
    room = snap.exists() ? snap.data() : { status: "waiting", round: 0 };
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

  await updateDoc(roomRef, {
    updatedAt: serverTimestamp()
  });
  localStorage.setItem("chameleon_name", name);
}

async function leaveRoom() {
  if (!currentUser) return;
  const playerRef = doc(playersCol, currentUser.uid);
  await deleteDoc(playerRef);
  nameDraft = localStorage.getItem("chameleon_name") || "";
}

async function clearPlayers() {
  if (!room || room.status !== "waiting") return;
  const snap = await getDocs(playersCol);
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.forEach((docSnap) => {
    batch.delete(docSnap.ref);
  });
  batch.update(roomRef, {
    updatedAt: serverTimestamp()
  });
  await batch.commit();
}

async function startRound() {
  if (!room) return;
  if (!currentPlayer) {
    setStatus("Join the room to start a round.");
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
    setStatus("Unable to start round.");
  }
}

async function endRound() {
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
  if (!currentPlayer || !isCurrentUserInRound()) return;
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

function renderHeaderActions() {
  if (!headerActionsEl) return;
  headerActionsEl.innerHTML = "";
}

function renderWaiting() {
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
      <div class="row">
        <input id="player-input" class="input" type="text" placeholder="Your name" value="${nameDraft}" />
        <button id="join-button" class="button">${currentPlayer ? "Update Name" : "Join Game"}</button>
      </div>
      <div class="row">
        <button id="start-round" class="button" ${players.length && topics.length ? "" : "disabled"}>Start Round</button>
        <button id="clear-players" class="button secondary" ${players.length ? "" : "disabled"}>Clear Players</button>
        ${currentPlayer ? '<button id="leave-room" class="button ghost">Leave</button>' : ""}
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

  const leaveBtn = document.getElementById("leave-room");
  if (leaveBtn) {
    leaveBtn.addEventListener("click", leaveRoom);
  }
}

function renderGame() {
  if (!room) return;

  const roundNumber = room.round || 0;
  const roundIds = getRoundPlayerIds();
  const roundPlayers = players.filter((player) => roundIds.includes(player.id));
  const waitingPlayers = players.filter((player) => !roundIds.includes(player.id));
  const inRound = isCurrentUserInRound();

  const joinNotice = !currentPlayer
    ? "You are spectating. Join now to play next round."
    : !inRound
      ? "You joined during this round. You are queued for next round."
      : "";

  const options = getCurrentOptions();
  const optionsHtml = options.length
    ? options.map((option) => `<div class="option-card">${option}</div>`).join("")
    : `<div class="notice">No options available.</div>`;

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
      <button id="call-vote" class="button" ${inRound ? "" : "disabled"}>Call Vote</button>
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
            <button class="${buttonClass}" data-id="${player.id}" style="width: 100%;" ${inRound ? "" : "disabled"}>
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
        <button id="call-vote" class="button" ${inRound ? "" : "disabled"}>Call Vote</button>
      </div>
    `;
  }

  screenEl.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content: space-between; align-items: center; flex-wrap: wrap;">
        <div>
          <div class="eyebrow">Round ${roundNumber}</div>
          <div class="title">Live Board</div>
        </div>
        <div class="row">
          <input id="player-input" class="input" type="text" placeholder="Your name" value="${nameDraft}" />
          <button id="join-button" class="button">${currentPlayer ? "Update Name" : "Join Game"}</button>
          ${currentPlayer ? '<button id="leave-room" class="button ghost">Leave</button>' : ""}
        </div>
      </div>
      ${joinNotice ? `<p class="notice">${joinNotice}</p>` : ""}
      <div class="board">
        <div class="topic">Topic: ${room.topic || "Topic"}</div>
        <div class="options-grid board-grid">${optionsHtml}</div>
      </div>
      <div class="row">
        <button id="new-round" class="button">New Round</button>
        <button id="end-round" class="button secondary">End Round</button>
      </div>
      <p class="notice">Tap your name to reveal your role.</p>
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

  const leaveBtn = document.getElementById("leave-room");
  if (leaveBtn) {
    leaveBtn.addEventListener("click", leaveRoom);
  }

  const newRoundBtn = document.getElementById("new-round");
  if (newRoundBtn) {
    newRoundBtn.addEventListener("click", startRound);
  }

  const endRoundBtn = document.getElementById("end-round");
  if (endRoundBtn) {
    endRoundBtn.addEventListener("click", endRound);
  }

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
  const isInRound = isCurrentUserInRound();
  const player = players.find((item) => item.id === revealPlayerId);
  const playerName = player?.name || "Player";
  const isChameleon = revealPlayerId === room.chameleonId;

  screenEl.innerHTML = `
    <div class="card">
      <h2>Player: ${playerName}</h2>
      <div class="topic">Topic: ${room.topic || "Topic"}</div>
      ${
        !isInRound
          ? `<div class="notice">You are queued for the next round.</div>`
          : isChameleon
            ? `<div class="role">You are the Chameleon</div>`
            : `<div class="role">Your word</div><div class="word">${room.word || "No word available"}</div>`
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
  if (!currentUser || !room) {
    setStatus("Connecting...");
    renderHeaderActions();
    screenEl.innerHTML = `
      <div class="card">
        <div class="full-message">Connecting...</div>
        <p class="notice">Syncing room state.</p>
      </div>
    `;
    return;
  }

  renderHeaderActions();

  if (room.status === "waiting") {
    setStatus(`Waiting room • ${players.length} player${players.length === 1 ? "" : "s"}`);
    renderWaiting();
    return;
  }

  if (room.status === "in_progress") {
    setStatus(`Round in progress • ${players.length} player${players.length === 1 ? "" : "s"}`);
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
