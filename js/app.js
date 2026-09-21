(() => {
  const DB_NAME = "puzzle-reveal-db";
  const DB_VER = 1;
  const STORE_IMGS = "images";
  const STORE_SETS = "sets";
  const $ = (id) => document.getElementById(id);
  const els = {
    viewSetup: $("view-setup"),
    viewGame: $("view-game"),
    setList: $("set-list"),
    setName: $("set-name"),
    imageList: $("image-list"),
    fileInput: $("file-input"),
    gridCustom: $("grid-custom"),
    timerSeconds: $("timer-seconds"),
    startHint: $("start-hint"),
    board: $("board"),
    gameSetName: $("game-set-name"),
    gameProgress: $("game-progress"),
    gameImageName: $("game-image-name"),
    revealCount: $("reveal-count"),
    timerBox: $("timer-box"),
    timerDisplay: $("timer-display"),
    thumbStrip: $("thumb-strip"),
    toast: $("toast"),
  };
  const state = {
    db: null,
    images: [],
    sets: [],
    currentSetId: null,
    grid: 3,
    timerMode: "off",
    shuffle: false,
    toggle: true,
    keyboard: true,
    play: { imageIds: [], index: 0, revealed: new Set(), labels: [], startedAt: 0, remain: 0, tick: null },
  };
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.add("hidden"), 2200);
  }
  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  }
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_IMGS)) db.createObjectStore(STORE_IMGS, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORE_SETS)) db.createObjectStore(STORE_SETS, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async function idbPut(store, value) {
    const tx = state.db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    await txDone(tx);
  }
  async function idbDel(store, id) {
    const tx = state.db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    await txDone(tx);
  }
  function idbGetAll(store) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(store, "readonly");
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  function revokeUrls() {
    state.images.forEach((img) => { if (img.url) URL.revokeObjectURL(img.url); });
  }
  async function loadAll() {
    const [imgs, sets] = await Promise.all([idbGetAll(STORE_IMGS), idbGetAll(STORE_SETS)]);
    revokeUrls();
    state.images = imgs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map((img) => ({ ...img, url: URL.createObjectURL(img.blob) }));
    state.sets = sets.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!state.currentSetId && state.sets[0]) state.currentSetId = state.sets[0].id;
  }
  function currentSet() { return state.sets.find((s) => s.id === state.currentSetId) || null; }
  function imageById(id) { return state.images.find((i) => i.id === id); }
  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function renderSets() {
    if (!state.sets.length) {
      els.setList.innerHTML = `<li class="hint" style="padding:8px">尚未儲存組合。加入圖片後按「儲存組合」。</li>`;
      return;
    }
    els.setList.innerHTML = state.sets.map((s) => {
      const n = (s.imageIds || []).length;
      const active = s.id === state.currentSetId ? "active" : "";
      return `<li class="set-item ${active}" data-id="${s.id}"><div><div><strong>${escapeHtml(s.name || "未命名組合")}</strong></div><div class="meta">${n} 張圖片 · ${s.grid || 3}×${s.grid || 3}</div></div><div class="row"><button class="btn sm ghost" data-act="dup" type="button">複製</button><button class="btn sm danger" data-act="del" type="button">刪</button></div></li>`;
    }).join("");
  }
  function renderImages() {
    const set = currentSet();
    if (!set && !state._draftIds) state._draftIds = [];
    const list = (set ? set.imageIds : state._draftIds).map(imageById).filter(Boolean);
    if (!list.length) {
      els.imageList.classList.add("empty");
      els.imageList.innerHTML = `<p class="empty-msg">尚未加入圖片。上載後可用拖曳調整出題次序。</p>`;
      return;
    }
    els.imageList.classList.remove("empty");
    els.imageList.innerHTML = list.map((img, i) => `<article class="img-card" draggable="true" data-id="${img.id}"><span class="ord">${i + 1}</span><img src="${img.url}" alt="${escapeHtml(img.name)}" /><div class="cap"><span>${escapeHtml(img.name)}</span></div><button class="x" type="button" data-act="rm" aria-label="移除">×</button></article>`).join("");
    bindDrag();
  }
  function workingIds() {
    const set = currentSet();
    if (set) return set.imageIds;
    if (!state._draftIds) state._draftIds = [];
    return state._draftIds;
  }
  function bindDrag() {
    let dragId = null;
    els.imageList.querySelectorAll(".img-card").forEach((card) => {
      card.addEventListener("dragstart", () => { dragId = card.dataset.id; card.classList.add("dragging"); });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
      card.addEventListener("dragover", (e) => e.preventDefault());
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        const targetId = card.dataset.id;
        if (!dragId || dragId === targetId) return;
        const ids = workingIds();
        const from = ids.indexOf(dragId);
        const to = ids.indexOf(targetId);
        if (from < 0 || to < 0) return;
        ids.splice(from, 1);
        ids.splice(to, 0, dragId);
        renderImages();
        persistCurrentSet(false);
      });
    });
  }
  async function persistCurrentSet(showToast) {
    let set = currentSet();
    if (!set) {
      set = { id: uid(), name: els.setName.value.trim() || "未命名組合", imageIds: (state._draftIds || []).slice(), createdAt: Date.now() };
      state.sets.unshift(set);
      state.currentSetId = set.id;
      state._draftIds = null;
    }
    set.name = els.setName.value.trim() || "未命名組合";
    set.grid = state.grid;
    set.timerMode = state.timerMode;
    set.timerSeconds = Number(els.timerSeconds.value) || 60;
    set.shuffle = $("opt-shuffle").checked;
    set.toggle = $("opt-toggle").checked;
    set.keyboard = $("opt-keyboard").checked;
    set.updatedAt = Date.now();
    await idbPut(STORE_SETS, set);
    if (showToast !== false) toast("已儲存組合");
    renderSets();
  }
  async function addFiles(files) {
    const list = Array.from(files || []).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return toast("請選擇圖片檔案");
    for (const file of list) {
      const rec = { id: uid(), name: file.name.replace(/\.[^.]+$/, ""), mime: file.type, blob: file, createdAt: Date.now() };
      await idbPut(STORE_IMGS, rec);
      rec.url = URL.createObjectURL(file);
      state.images.push(rec);
      workingIds().push(rec.id);
    }
    renderImages();
    if (currentSet()) await persistCurrentSet(false);
    toast(`已加入 ${list.length} 張圖片`);
  }
  function makeDemoBlob(label, c1, c2) {
    const canvas = document.createElement("canvas");
    canvas.width = 900; canvas.height = 900;
    const ctx = canvas.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 900, 900);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 900, 900);
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.06 + (i % 5) * 0.03})`;
      ctx.beginPath(); ctx.arc((i * 137) % 900, (i * 211) % 900, 40 + (i % 6) * 18, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "rgba(20,20,20,.35)"; ctx.fillRect(80, 360, 740, 180);
    ctx.fillStyle = "#fff8e8"; ctx.font = "bold 64px sans-serif"; ctx.textAlign = "center"; ctx.fillText(label, 450, 470);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }
  async function addDemos() {
    const specs = [["示範圖 · 山水", "#1a5c5e", "#c9862a"],["示範圖 · 夜空", "#1b2a4a", "#8b5cf6"],["示範圖 · 春日", "#2f6f4e", "#f2c14e"]];
    for (const [name, a, b] of specs) {
      const blob = await makeDemoBlob(name, a, b);
      const rec = { id: uid(), name, mime: "image/png", blob, createdAt: Date.now() };
      await idbPut(STORE_IMGS, rec);
      rec.url = URL.createObjectURL(blob);
      state.images.push(rec);
      workingIds().push(rec.id);
    }
    renderImages();
    if (currentSet()) await persistCurrentSet(false);
    toast("已加入 3 張示範圖");
  }
  function applySetToForm(set) {
    els.setName.value = set ? set.name : "";
    state.grid = set?.grid || 3;
    els.gridCustom.value = state.grid;
    document.querySelectorAll("#grid-presets .chip").forEach((c) => c.classList.toggle("active", Number(c.dataset.n) === state.grid));
    state.timerMode = set?.timerMode || "off";
    document.querySelectorAll('input[name="timer-mode"]').forEach((r) => { r.checked = r.value === state.timerMode; });
    els.timerSeconds.value = set?.timerSeconds || 60;
    $("opt-shuffle").checked = !!set?.shuffle;
    $("opt-toggle").checked = set?.toggle !== false;
    $("opt-keyboard").checked = set?.keyboard !== false;
  }
  async function selectSet(id) {
    state.currentSetId = id; state._draftIds = null;
    applySetToForm(currentSet()); renderSets(); renderImages();
  }
  async function newSet() {
    const set = { id: uid(), name: "新組合", imageIds: [], grid: state.grid, timerMode: state.timerMode, timerSeconds: Number(els.timerSeconds.value) || 60, shuffle: $("opt-shuffle").checked, toggle: $("opt-toggle").checked, keyboard: $("opt-keyboard").checked, createdAt: Date.now(), updatedAt: Date.now() };
    state.sets.unshift(set); await idbPut(STORE_SETS, set); await selectSet(set.id); els.setName.focus(); els.setName.select();
  }
  function readSettingsFromForm() {
    state.grid = Math.max(2, Math.min(10, Number(els.gridCustom.value) || 3));
    state.timerMode = document.querySelector('input[name="timer-mode"]:checked')?.value || "off";
    state.shuffle = $("opt-shuffle").checked; state.toggle = $("opt-toggle").checked; state.keyboard = $("opt-keyboard").checked;
  }
  function startGame() {
    readSettingsFromForm();
    const ids = workingIds().filter((id) => imageById(id));
    if (!ids.length) return toast("請先上載至少一張圖片");
    state.play.imageIds = ids.slice(); state.play.index = 0;
    els.viewSetup.classList.add("hidden"); els.viewGame.classList.remove("hidden");
    els.gameSetName.textContent = els.setName.value.trim() || currentSet()?.name || "即時遊戲";
    renderThumbs(); loadRound(0);
  }
  function renderThumbs() {
    els.thumbStrip.innerHTML = state.play.imageIds.map((id, i) => {
      const img = imageById(id);
      return `<li data-i="${i}" class="${i === state.play.index ? "active" : ""}"><img src="${img.url}" alt="" /><span>${i + 1}. ${escapeHtml(img.name)}</span></li>`;
    }).join("");
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function loadRound(index) {
    state.play.index = index;
    const img = imageById(state.play.imageIds[index]);
    if (!img) return;
    const n = state.grid; const total = n * n;
    const nums = Array.from({ length: total }, (_, i) => i + 1);
    state.play.labels = state.shuffle ? shuffle(nums) : nums;
    state.play.revealed = new Set();
    els.gameImageName.textContent = img.name;
    els.gameProgress.textContent = `${index + 1} / ${state.play.imageIds.length}`;
    els.board.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    els.board.style.gridTemplateRows = `repeat(${n}, 1fr)`;
    els.board.innerHTML = "";
    for (let i = 0; i < total; i++) {
      const r = Math.floor(i / n); const c = i % n;
      const cell = document.createElement("button");
      cell.type = "button"; cell.className = "cell"; cell.dataset.i = String(i);
      cell.setAttribute("aria-label", `格仔 ${state.play.labels[i]}`);
      const piece = document.createElement("div"); piece.className = "piece";
      piece.style.backgroundImage = `url("${img.url}")`;
      piece.style.backgroundSize = `${n * 100}% ${n * 100}%`;
      piece.style.backgroundPosition = `${(c / (n - 1 || 1)) * 100}% ${(r / (n - 1 || 1)) * 100}%`;
      const cover = document.createElement("div"); cover.className = "cover"; cover.textContent = String(state.play.labels[i]);
      cell.append(piece, cover);
      cell.addEventListener("click", () => toggleCell(i));
      els.board.appendChild(cell);
    }
    updateRevealCount(); renderThumbs(); resetTimer();
  }
  function toggleCell(i) {
    if (state.play.revealed.has(i)) { if (!state.toggle) return; state.play.revealed.delete(i); }
    else state.play.revealed.add(i);
    els.board.children[i].classList.toggle("revealed", state.play.revealed.has(i));
    updateRevealCount();
    if (state.play.revealed.size === state.grid * state.grid) toast("全部揭示！");
  }
  function updateRevealCount() {
    els.revealCount.textContent = `已揭示 ${state.play.revealed.size} / ${state.grid * state.grid}`;
  }
  function revealAll(show) {
    const total = state.grid * state.grid;
    state.play.revealed = show ? new Set(Array.from({ length: total }, (_, i) => i)) : new Set();
    Array.from(els.board.children).forEach((cell, i) => cell.classList.toggle("revealed", state.play.revealed.has(i)));
    updateRevealCount();
  }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  }
  function stopTimer() { if (state.play.tick) clearInterval(state.play.tick); state.play.tick = null; }
  function resetTimer() {
    stopTimer(); const mode = state.timerMode; els.timerBox.classList.remove("warn");
    if (mode === "off") { els.timerBox.classList.add("off"); els.timerDisplay.textContent = "—"; return; }
    els.timerBox.classList.remove("off");
    if (mode === "stopwatch") {
      state.play.startedAt = Date.now(); els.timerDisplay.textContent = "00:00";
      state.play.tick = setInterval(() => { els.timerDisplay.textContent = fmt((Date.now() - state.play.startedAt) / 1000); }, 250);
    } else {
      state.play.remain = Number(els.timerSeconds.value) || 60; els.timerDisplay.textContent = fmt(state.play.remain);
      state.play.tick = setInterval(() => {
        state.play.remain -= 0.25; els.timerDisplay.textContent = fmt(state.play.remain);
        if (state.play.remain <= 10) els.timerBox.classList.add("warn");
        if (state.play.remain <= 0) { stopTimer(); els.timerDisplay.textContent = "00:00"; toast("時間到！"); }
      }, 250);
    }
  }
  function exitGame() { stopTimer(); els.viewGame.classList.add("hidden"); els.viewSetup.classList.remove("hidden"); }
  function onKey(e) {
    if (els.viewGame.classList.contains("hidden") || !state.keyboard) return;
    if (e.target.matches("input, textarea")) return;
    if (e.key === "ArrowRight") { $("btn-next").click(); return; }
    if (e.key === "ArrowLeft") { $("btn-prev").click(); return; }
    if (!/^[1-9]$/.test(e.key)) return;
    const idx = state.play.labels.indexOf(Number(e.key));
    if (idx >= 0) toggleCell(idx);
  }
  function bindUi() {
    $("btn-new-set").addEventListener("click", newSet);
    $("btn-save-set").addEventListener("click", () => persistCurrentSet(true));
    $("btn-demo").addEventListener("click", addDemos);
    $("btn-start").addEventListener("click", startGame);
    $("btn-exit").addEventListener("click", exitGame);
    $("btn-reveal-all").addEventListener("click", () => revealAll(true));
    $("btn-hide-all").addEventListener("click", () => revealAll(false));
    $("btn-next").addEventListener("click", () => loadRound((state.play.index + 1) % state.play.imageIds.length));
    $("btn-prev").addEventListener("click", () => loadRound((state.play.index - 1 + state.play.imageIds.length) % state.play.imageIds.length));
    els.fileInput.addEventListener("change", async (e) => { await addFiles(e.target.files); e.target.value = ""; });
    document.querySelectorAll("#grid-presets .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.grid = Number(chip.dataset.n); els.gridCustom.value = state.grid;
        document.querySelectorAll("#grid-presets .chip").forEach((c) => c.classList.toggle("active", c === chip));
      });
    });
    els.gridCustom.addEventListener("change", () => {
      state.grid = Math.max(2, Math.min(10, Number(els.gridCustom.value) || 3)); els.gridCustom.value = state.grid;
      document.querySelectorAll("#grid-presets .chip").forEach((c) => c.classList.toggle("active", Number(c.dataset.n) === state.grid));
    });
    els.setList.addEventListener("click", async (e) => {
      const item = e.target.closest(".set-item"); if (!item) return;
      const id = item.dataset.id; const act = e.target.dataset.act;
      if (act === "del") {
        if (!confirm("刪除此組合？（圖片檔仍會保留在本機）")) return;
        await idbDel(STORE_SETS, id);
        state.sets = state.sets.filter((s) => s.id !== id);
        if (state.currentSetId === id) { state.currentSetId = state.sets[0]?.id || null; applySetToForm(currentSet()); }
        renderSets(); renderImages(); return;
      }
      if (act === "dup") {
        const src = state.sets.find((s) => s.id === id);
        const copy = { ...src, id: uid(), name: (src.name || "組合") + "（副本）", createdAt: Date.now(), updatedAt: Date.now(), imageIds: src.imageIds.slice() };
        state.sets.unshift(copy); await idbPut(STORE_SETS, copy); await selectSet(copy.id); toast("已複製組合"); return;
      }
      selectSet(id);
    });
    els.imageList.addEventListener("click", async (e) => {
      if (e.target.dataset.act !== "rm") return;
      const id = e.target.closest(".img-card").dataset.id;
      const ids = workingIds(); const i = ids.indexOf(id); if (i >= 0) ids.splice(i, 1);
      renderImages(); if (currentSet()) await persistCurrentSet(false);
    });
    els.thumbStrip.addEventListener("click", (e) => { const li = e.target.closest("li"); if (li) loadRound(Number(li.dataset.i)); });
    document.addEventListener("keydown", onKey);
    document.body.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
    document.body.addEventListener("drop", async (e) => {
      if (!e.dataTransfer?.files?.length || els.viewSetup.classList.contains("hidden") || e.target.closest(".img-card")) return;
      e.preventDefault(); await addFiles(e.dataTransfer.files);
    });
  }
  async function init() {
    bindUi();
    try { state.db = await openDb(); await loadAll(); }
    catch (err) { console.error(err); toast("本機儲存未能開啟，仍可即時遊玩"); }
    if (!state.sets.length) { els.setName.value = "我的第一組"; state._draftIds = []; }
    else applySetToForm(currentSet());
    renderSets(); renderImages();
  }
  init();
})();
