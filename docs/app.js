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
let nameDraft = "";
let gameView = "list"; // list | reveal
let revealPlayerId = null;
let voteFinalizeInProgress = false;
let optionFitRafId = 0;
let renameUnjoinInProgress = false;
const textMeasureCanvas = document.createElement("canvas");
const textMeasureCtx = textMeasureCanvas.getContext("2d");

try {
  localStorage.removeItem("chameleon_name");
} catch (error) {
  // Ignore storage access issues.
}

function setStatus(text) {
  statusEl.textContent = text;
}

function wireNameInput(input) {
  if (!input) return;
  input.setAttribute("autocomplete", "one-time-code");
  input.setAttribute("autofill", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("autocapitalize", "none");
  input.setAttribute("spellcheck", "false");
  input.setAttribute("aria-autocomplete", "none");
  input.setAttribute("inputmode", "text");
  input.setAttribute("enterkeyhint", "done");
  input.setAttribute("name", `nickname_${Date.now()}`);
  input.setAttribute("data-lpignore", "true");
  input.setAttribute("data-1p-ignore", "true");
  input.setAttribute("data-bwignore", "true");
  input.readOnly = true;
  input.removeAttribute("aria-disabled");
  const unlock = () => {
    input.readOnly = false;
  };
  input.addEventListener("focus", unlock, { once: true });
  input.addEventListener("touchstart", unlock, { once: true });
  input.addEventListener("input", (event) => {
    nameDraft = event.target.value;
  });
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
  if (room && Array.isArray(room.roundPlayerIds) && room.roundPlayerIds.length) {
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

function fitOptionText() {
  const labels = document.querySelectorAll(".option-card .option-text");
  labels.forEach((label) => {
    const card = label.parentElement;
    if (!card) return;
    const maxSize = 22;
    const minSize = 10;
    const maxWidth = Math.max(1, card.clientWidth - 14);
    const maxHeight = Math.max(1, card.clientHeight - 10);
    const rawText = (label.textContent || "").trim();
    const words = rawText.length ? rawText.split(/\s+/) : [];

    let size = maxSize;
    label.style.fontSize = `${size}px`;
    while (size > minSize) {
      const tooTall = label.scrollHeight > maxHeight;
      let tooWideWord = false;

      if (textMeasureCtx && words.length) {
        const style = window.getComputedStyle(label);
        textMeasureCtx.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
        let widestWord = 0;
        words.forEach((word) => {
          widestWord = Math.max(widestWord, textMeasureCtx.measureText(word).width);
        });
        tooWideWord = widestWord > maxWidth;
      } else {
        tooWideWord = label.scrollWidth > maxWidth;
      }

      if (!tooTall && !tooWideWord) break;
      size -= 1;
      label.style.fontSize = `${size}px`;
    }
  });
}

function queueOptionFit() {
  if (optionFitRafId) {
    cancelAnimationFrame(optionFitRafId);
  }
  optionFitRafId = requestAnimationFrame(() => {
    optionFitRafId = 0;
    fitOptionText();
  });
}

window.addEventListener("resize", () => {
  if (room?.status === "in_progress" && gameView === "list") {
    queueOptionFit();
  }
});

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
    resetCounter: 0,
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
    if (currentPlayer && !nameDraft && (currentPlayer.joinedReset ?? -1) === getResetCounter()) {
      nameDraft = currentPlayer.name || "";
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
        name,
        lastSeen: serverTimestamp()
      });
    } else {
      await updateDoc(playerRef, {
        name,
        joinedReset: resetCounter,
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
}

async function leaveRoom({ clearDraft = true } = {}) {
  if (!currentUser) return;
  const leavingUserId = currentUser.uid;
  players = players.filter((player) => player.id !== leavingUserId);
  currentPlayer = null;
  if (clearDraft) {
    nameDraft = "";
  }
  render();

  const playerRef = doc(playersCol, currentUser.uid);
  await deleteDoc(playerRef);
}

async function resetGame() {
  if (!room) return;
  const shouldReset = window.confirm("Reset the game and remove all players?");
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
  render();
}

async function startRound() {
  if (!room) return;
  const joinedPlayer = getCurrentJoinedPlayer();
  if (!joinedPlayer) {
    setStatus("Join the room to start a round.");
    return;
  }
  const activePlayers = getActivePlayers();
  if (activePlayers.length === 0) {
    setStatus("Add at least one player.");
    return;
  }
  if (topics.length === 0) {
    setStatus("No topics available.");
    return;
  }

  const roundPlayerIds = activePlayers.map((player) => player.id);
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
  const activePlayers = getActivePlayers();
  const joinedPlayer = getCurrentJoinedPlayer();
  const joinUrl = window.location.href;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=1200x1200&margin=8&data=${encodeURIComponent(joinUrl)}`;
  const playerList = activePlayers
    .map((player) => `
      <li class="list-item">
        <span>${player.name || "Player"}</span>
      </li>
    `)
    .join("");

  screenEl.innerHTML = `
    <div class="card action-shell">
      <div class="row action-row home-center-row">
        <button id="start-round" class="button home-equal-btn" ${activePlayers.length && topics.length ? "" : "disabled"}>Start Round</button>
      </div>
    </div>
    <div class="card">
      <form id="join-form" class="row join-row" autocomplete="off" novalidate>
        <input class="autofill-decoy" type="text" autocomplete="username" tabindex="-1" aria-hidden="true" />
        <input class="autofill-decoy" type="password" autocomplete="new-password" tabindex="-1" aria-hidden="true" />
        <input id="player-input" class="input join-input ${joinedPlayer ? "joined" : ""}" type="search" placeholder="Your name" value="${nameDraft}" />
        <button id="join-button" class="button join-submit ${joinedPlayer ? "join-joined" : "join-ready"}" type="submit">Join</button>
      </form>
      <ul class="list">${playerList || '<li class="notice">No players yet.</li>'}</ul>
      <div class="home-qr-wrap">
        <img class="home-qr" src="${qrUrl}" alt="QR code to join the game" loading="lazy" />
      </div>
    </div>
    <div class="card action-shell home-reset-row">
      <div class="row action-row home-center-row">
        <button id="reset-game" class="button ghost home-equal-btn">Reset Game</button>
      </div>
    </div>
  `;

  const input = document.getElementById("player-input");
  wireNameInput(input);
  if (input && joinedPlayer) {
    let handled = false;
    const startRename = async (event) => {
      if (handled || renameUnjoinInProgress) return;
      handled = true;
      event.preventDefault();
      const currentValue = input.value;
      renameUnjoinInProgress = true;
      try {
        nameDraft = currentValue;
        await leaveRoom({ clearDraft: false });
        requestAnimationFrame(() => {
          const freshInput = document.getElementById("player-input");
          if (!freshInput) return;
          freshInput.focus();
          const cursorPos = freshInput.value.length;
          if (typeof freshInput.setSelectionRange === "function") {
            freshInput.setSelectionRange(cursorPos, cursorPos);
          }
        });
      } finally {
        renameUnjoinInProgress = false;
      }
    };
    input.addEventListener("pointerdown", startRename, { once: true });
    input.addEventListener("focus", startRename, { once: true });
  }

  const joinForm = document.getElementById("join-form");
  if (joinForm) {
    joinForm.addEventListener("submit", (event) => {
      event.preventDefault();
      joinRoom();
    });
  }

  const joinBtn = document.getElementById("join-button");
  if (joinBtn && !joinForm) {
    joinBtn.addEventListener("click", joinRoom);
  }

  const startBtn = document.getElementById("start-round");
  if (startBtn) {
    startBtn.addEventListener("click", startRound);
  }

  const resetBtn = document.getElementById("reset-game");
  if (resetBtn) {
    resetBtn.addEventListener("click", resetGame);
  }
}

function renderGame() {
  if (!room) return;

  const activePlayers = getActivePlayers();
  const joinedPlayer = getCurrentJoinedPlayer();
  const roundIds = getRoundPlayerIds();
  const roundPlayers = activePlayers.filter((player) => roundIds.includes(player.id));
  const inRound = isCurrentUserInRound();

  const joinNotice = !joinedPlayer
    ? "You are spectating. Join now to play next round."
    : !inRound
      ? "You joined during this round. You are queued for next round."
      : "";

  const options = getCurrentOptions();
  const optionsHtml = options.length
    ? options.map((option) => `<div class="option-card"><span class="option-text">${option}</span></div>`).join("")
    : `<div class="notice">No options available.</div>`;

  const playerList = activePlayers
    .map((player) => {
      const isYou = player.id === currentUser?.uid;
      const isActive = roundIds.includes(player.id);
      const pills = [];
      if (!isActive) {
        pills.push('<span class="pill muted">Next</span>');
      }
      const pillHtml = pills.length ? `<span class="pill-group">${pills.join("")}</span>` : "";
      const disabled = !isYou || !isActive;
      const playerButtonStyle = isYou ? "ghost" : "secondary";
      return `
        <li class="list-item">
          <button class="button ${playerButtonStyle}" data-id="${player.id}" style="width: 100%;" ${disabled ? "disabled" : ""}>
            ${player.name || "Player"}
          </button>
          ${pillHtml}
        </li>
      `;
    })
    .join("");

  let voteHtml = "";

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
    `;
  }

  screenEl.innerHTML = `
    <div class="card">
      ${joinedPlayer ? "" : `<form id="join-form" class="row join-row" autocomplete="off" novalidate><input class="autofill-decoy" type="text" autocomplete="username" tabindex="-1" aria-hidden="true" /><input class="autofill-decoy" type="password" autocomplete="new-password" tabindex="-1" aria-hidden="true" /><input id="player-input" class="input" type="search" placeholder="Your name" value="${nameDraft}" /><button id="join-button" class="button secondary" type="submit">Join</button></form>`}
      ${joinNotice ? `<p class="notice">${joinNotice}</p>` : ""}
      <ul class="list" id="player-buttons">${playerList || '<li class="notice">No players yet.</li>'}</ul>
      ${voteHtml ? `<div class="vote-block">${voteHtml}</div>` : ""}
      <div class="row action-row game-actions player-card-actions">
        <button id="call-vote" class="button action-left" ${inRound && room.voteStatus !== "open" ? "" : "disabled"}>Call Vote</button>
        <button id="new-round" class="button">New Round</button>
      </div>
    </div>
    <div class="card board-card">
      <div class="topic">${room.topic || "Topic"}</div>
      <div class="options-grid board-grid">${optionsHtml}</div>
    </div>
    <div class="card controls-bubble">
      <div class="row split-row control-secondary">
        ${joinedPlayer ? '<button id="leave-room" class="button secondary">Leave Game</button>' : "<span></span>"}
        <button id="reset-game" class="button ghost">Reset Game</button>
      </div>
    </div>
  `;

  const input = document.getElementById("player-input");
  wireNameInput(input);

  const joinForm = document.getElementById("join-form");
  if (joinForm) {
    joinForm.addEventListener("submit", (event) => {
      event.preventDefault();
      joinRoom();
    });
  }

  const joinBtn = document.getElementById("join-button");
  if (joinBtn && !joinForm) {
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

  const resetBtn = document.getElementById("reset-game");
  if (resetBtn) {
    resetBtn.addEventListener("click", resetGame);
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

  queueOptionFit();
}

function renderReveal() {
  if (!room) return;
  const isChameleon = revealPlayerId === room.chameleonId;
  const revealText = isChameleon ? "You are the Chameleon" : (room.word || "No word available");
  const revealClass = isChameleon ? "role" : "word";

  screenEl.innerHTML = `
    <div class="card">
      <div class="${revealClass}">${revealText}</div>
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
    setStatus("");
    renderWaiting();
    return;
  }

  if (room.status === "in_progress") {
    setStatus("");
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
