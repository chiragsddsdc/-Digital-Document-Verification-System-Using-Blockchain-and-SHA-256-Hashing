/* -------------------------
   script.js (updated)
   - uses API_BASE_URL injected by template (avoid relative-path mistakes)
   - helper `api()` wraps fetch calls
   - replaced lucide.createIcons() with lucide.replace()
   - small robustness fixes for clipboard & optional elements
------------------------- */

const fileInput = document.getElementById("fileInput");
const browse = document.getElementById("browse");
const uploadArea = document.getElementById("uploadArea");
const filePreview = document.getElementById("filePreview");
const fileInfo = document.getElementById("fileInfo");
const verifyBtn = document.getElementById("verifyBtn");
const registerBtn = document.getElementById("registerBtn");
const resultDiv = document.getElementById("result");
const historyList = document.getElementById("historyList");
const hashValue = document.getElementById("hashValue");
const copyHashBtn = document.getElementById("copyHashBtn");
const previewModal = document.getElementById("previewModal");
const modalContent = document.getElementById("modalContent");
const modalClose = document.querySelector(".modal .close");
const themeToggle = document.getElementById("themeToggle");
const ownerInput = document.getElementById("ownerInput");
const bcStatus = document.getElementById("bcStatus");
const registryTableBody = document.getElementById("registryTableBody");
const actionTabs = document.querySelectorAll(".action-tab");
const statsTotalDocs = document.getElementById("statTotalDocs");
const statsTotalVerifications = document.getElementById("statTotalVerifications");
const statsLastUpdated = document.getElementById("statLastUpdated");
const loader = document.getElementById("loader");
const loaderText = document.getElementById("loaderText");
const toastContainer = document.getElementById("toastContainer");

const registryIdRow = document.getElementById("registryIdRow"); // wrapper for verify input
const registryIdInput = document.getElementById("registryIdInput"); // verify-by-id input
const registeredIdRow = document.getElementById("registeredIdRow"); // UI shown after register
const registeredIdText = document.getElementById("registeredIdText");
const copyRegisteredIdBtn = document.getElementById("copyRegisteredIdBtn");
const saveRegisteredIdBtn = document.getElementById("saveRegisteredIdBtn");
const useRegisteredIdBtn = document.getElementById("useRegisteredIdBtn");

const defaultMode = document.body.dataset.defaultMode || "register";

let uploadedFile = null;

// API helper: API_BASE_URL is injected by the template (index.html)
const API_BASE = typeof API_BASE_URL !== "undefined" ? API_BASE_URL : "";
function api(path, opts = {}) {
  // ensure path begins with /
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_BASE}${p}`;
  return fetch(url, opts);
}

verifyBtn && (verifyBtn.disabled = true);
registerBtn && (registerBtn.disabled = true);

// HELPERS
function formatDate(ts) {
  if (!ts) return "-";
  if (typeof ts === "number") {
    const d = new Date(ts * 1000);
    return d.toLocaleString();
  }
  const d = new Date(ts);
  return isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
}

function setBcStatus(isOnChain, txHash) {
  if (!bcStatus) return;
  if (isOnChain) {
    let html = `Status: <span class="badge badge-onchain">Stored on Ethereum</span>`;
    if (txHash) {
      const safeTx = txHash.trim();
      html += ` <a class="tx-link" href="https://sepolia.etherscan.io/tx/${safeTx}" target="_blank" rel="noopener noreferrer">View tx</a>`;
    }
    bcStatus.innerHTML = html;
  } else {
    bcStatus.innerHTML = `Status: <span class="badge badge-offchain">Not stored on blockchain</span>`;
  }
}

function setLoading(isLoading, message) {
  if (!loader) return;
  loader.classList.toggle("hidden", !isLoading);
  loaderText && (loaderText.textContent = message || "Processing...");
  if (registerBtn) registerBtn.disabled = isLoading || !uploadedFile;
  if (verifyBtn) verifyBtn.disabled = isLoading || !uploadedFile;
}

function showToast(message, type = "info") {
  if (!toastContainer) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "toast-out 0.2s forwards";
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

// localStorage helpers for saved registered IDs
const SAVED_IDS_KEY = "docchain_saved_register_ids";
function loadSavedIds() {
  try {
    const raw = localStorage.getItem(SAVED_IDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}
function saveIdToLocal(id) {
  const list = loadSavedIds();
  if (!list.includes(id)) {
    list.push(id);
    localStorage.setItem(SAVED_IDS_KEY, JSON.stringify(list));
  }
}
function renderSavedIds() {
  return loadSavedIds();
}

// initial status
setBcStatus(false, null);

// file input handlers
browse && (browse.onclick = () => fileInput && fileInput.click());
fileInput && (fileInput.onchange = () => {
  if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
});
uploadArea && uploadArea.addEventListener("dragover", e => e.preventDefault());
uploadArea && uploadArea.addEventListener("drop", e => {
  e.preventDefault();
  if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

async function handleFile(file) {
  uploadedFile = file;
  if (!file) return;

  if (fileInfo) fileInfo.innerHTML = `📄 <strong>${file.name}</strong> (${(file.size / 1024).toFixed(2)} KB)`;
  if (filePreview) filePreview.innerHTML = "";
  if (hashValue) hashValue.textContent = "Computing...";
  verifyBtn && (verifyBtn.disabled = true);
  registerBtn && (registerBtn.disabled = true);
  if (resultDiv) {
    resultDiv.innerHTML = "";
    resultDiv.className = "result-card";
  }
  setBcStatus(false, null);

  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const generatedHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  if (hashValue) hashValue.textContent = generatedHash;

  if (filePreview) {
    if (file.type.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      filePreview.appendChild(img);
    } else if (file.type === "application/pdf") {
      const iframe = document.createElement("iframe");
      iframe.src = URL.createObjectURL(file);
      filePreview.appendChild(iframe);
    } else {
      filePreview.textContent = `Uploaded File: ${file.name}`;
    }
  }

  verifyBtn && (verifyBtn.disabled = false);
  registerBtn && (registerBtn.disabled = false);
}

/* ---------------------------
   REGISTER DOCUMENT
--------------------------- */
registerBtn && (registerBtn.onclick = async () => {
  if (!uploadedFile) {
    showToast("Upload a document first.", "error");
    return;
  }

  setLoading(true, "Registering document on blockchain...");
  if (resultDiv) {
    resultDiv.className = "result-card";
    resultDiv.innerHTML = "⏳ Registering document on blockchain...";
  }

  const formData = new FormData();
  formData.append("file", uploadedFile);
  formData.append("owner", ownerInput ? ownerInput.value || "anonymous" : "anonymous");

  try {
    const res = await api("/api/upload", {
      method: "POST",
      body: formData
    });

    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (res.ok && data.success) {
      if (resultDiv) {
        resultDiv.className = "result-card result-success";
        resultDiv.innerHTML =
          `✅ Document registered!<br>` +
          `ID: ${data.documentID}<br>` +
          `Hash: ${data.fileHash}<br>` +
          (data.blockchain_tx
            ? `Tx: <a class="tx-link" href="https://sepolia.etherscan.io/tx/${data.blockchain_tx}" target="_blank" rel="noopener noreferrer">${data.blockchain_tx}</a>`
            : "");
      }

      setBcStatus(true, data.blockchain_tx);
      showToast("Document registered on Ethereum.", "success");

      // show Registered ID UI and wire buttons
      if (registeredIdRow && registeredIdText) {
        registeredIdText.textContent = data.documentID || "";
        registeredIdRow.style.display = "block";
        if (registryIdInput) registryIdInput.value = data.documentID || "";
      }

      if (copyRegisteredIdBtn) {
        copyRegisteredIdBtn.onclick = () => {
          try {
            navigator.clipboard.writeText(data.documentID || "");
            showToast("Registered ID copied to clipboard.", "success");
          } catch (e) {
            showToast("Failed to copy Registered ID.", "error");
          }
        };
      }
      if (saveRegisteredIdBtn) {
        saveRegisteredIdBtn.onclick = () => {
          saveIdToLocal(data.documentID || "");
          showToast("Registered ID saved locally.", "success");
        };
      }
      if (useRegisteredIdBtn) {
        useRegisteredIdBtn.onclick = () => {
          if (registryIdInput) {
            registryIdInput.value = data.documentID || "";
            setActiveAction("verify");
            showToast("Registered ID set in verify input.", "info");
          }
        };
      }

      await loadRegistry();
      await loadStats();
      await loadHistory();
    } else {
      if (resultDiv) {
        resultDiv.className = "result-card result-fail";
        resultDiv.innerHTML =
          `❌ Registration failed!<br>${data.error || "Unknown error"}`;
      }
      setBcStatus(false, null);
      showToast(`Registration failed: ${data.error || "Unknown error"}`, "error");
      await loadHistory();
    }
  } catch (err) {
    console.error(err);
    setLoading(false);
    if (resultDiv) {
      resultDiv.className = "result-card result-fail";
      resultDiv.innerHTML = "⚠️ Server error while registering!";
    }
    setBcStatus(false, null);
    showToast("Server error while registering.", "error");
    await loadHistory();
  }
});

/* ---------------------------
   VERIFY DOCUMENT
--------------------------- */
verifyBtn && (verifyBtn.onclick = async () => {
  if (!uploadedFile) {
    showToast("Upload a document first.", "error");
    return;
  }

  const computedHash = (hashValue && hashValue.textContent || "").trim();
  if (!computedHash || computedHash === "Computing...") {
    showToast("Hash not ready yet. Wait a moment.", "warning");
    return;
  }

  setLoading(true, "Verifying document against registry...");
  if (resultDiv) {
    resultDiv.className = "result-card";
    resultDiv.innerHTML = "⏳ Verifying against blockchain registry...";
  }

  const formData = new FormData();
  formData.append("file", uploadedFile);
  formData.append("documentID", registryIdInput ? registryIdInput.value.trim() : "");

  try {
    const res = await api("/verify", {
      method: "POST",
      body: formData
    });

    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }

    if (data && data.verified) {
      setLoading(false);
      if (resultDiv) {
        resultDiv.className = "result-card result-success";
        let html = `✅ Verified!<br>Hash: ${data.computed_hash || computedHash}`;
        if (data.documentID) html += `<br>ID: ${data.documentID}`;
        if (data.blockchain_tx) html += `<br>Tx: <a class="tx-link" href="https://sepolia.etherscan.io/tx/${data.blockchain_tx}" target="_blank" rel="noopener noreferrer">${data.blockchain_tx}</a>`;
        resultDiv.innerHTML = html;
      }
      setBcStatus(Boolean(data.blockchain_tx), data.blockchain_tx || null);
      showToast("Document verified successfully.", "success");
      await loadStats();
      await loadHistory();
      return;
    }

    if (data && data.reason) {
      const reason = String(data.reason).toLowerCase();
      if (reason.includes("not") && (reason.includes("register") || reason.includes("found") || reason.includes("not on") || reason.includes("not_registered"))) {
        setLoading(false);
        if (resultDiv) {
          resultDiv.className = "result-card result-fail";
          resultDiv.innerHTML = `❌ Not registered — hash not found in registry.<br>Computed: ${computedHash}`;
        }
        setBcStatus(false, null);
        showToast("Verification result: Not registered.", "error");
        await loadStats();
        await loadHistory();
        return;
      }
      if (reason.includes("tamper") || reason.includes("mismatch") || reason.includes("hash mismatch")) {
        setLoading(false);
        if (resultDiv) {
          resultDiv.className = "result-card result-fail";
          let html = `⚠️ Tampered — document hash does not match stored record.<br>Computed: ${computedHash}`;
          if (data.stored_hash) html += `<br>Stored: ${data.stored_hash}`;
          if (data.documentID) html += `<br>ID: ${data.documentID}`;
          if (data.blockchain_tx) html += `<br>Tx: <a class="tx-link" href="https://sepolia.etherscan.io/tx/${data.blockchain_tx}" target="_blank" rel="noopener noreferrer">${data.blockchain_tx}</a>`;
          resultDiv.innerHTML = html;
        }
        setBcStatus(Boolean(data.blockchain_tx), data.blockchain_tx || null);
        showToast("Verification result: Tampered.", "error");
        await loadStats();
        await loadHistory();
        return;
      }
    }

    if (data && data.stored_hash) {
      const stored = String(data.stored_hash).replace(/^0x/, "").toLowerCase();
      const comp = computedHash.replace(/^0x/, "").toLowerCase();
      if (stored && stored !== comp) {
        setLoading(false);
        if (resultDiv) {
          resultDiv.className = "result-card result-fail";
          let html = `⚠️ Tampered — document hash does not match stored record.<br>Computed: ${computedHash}<br>Stored: ${data.stored_hash}`;
          if (data.documentID) html += `<br>ID: ${data.documentID}`;
          if (data.blockchain_tx) html += `<br>Tx: <a class="tx-link" href="https://sepolia.etherscan.io/tx/${data.blockchain_tx}" target="_blank" rel="noopener noreferrer">${data.blockchain_tx}</a>`;
          resultDiv.innerHTML = html;
        }
        setBcStatus(Boolean(data.blockchain_tx), data.blockchain_tx || null);
        showToast("Verification result: Tampered.", "error");
        await loadStats();
        await loadHistory();
        return;
      }
      if (stored && stored === comp) {
        setLoading(false);
        if (resultDiv) {
          resultDiv.className = "result-card result-success";
          let html = `✅ Verified (by stored hash)!<br>Hash: ${computedHash}`;
          if (data.documentID) html += `<br>ID: ${data.documentID}`;
          if (data.blockchain_tx) html += `<br>Tx: <a class="tx-link" href="https://sepolia.etherscan.io/tx/${data.blockchain_tx}" target="_blank" rel="noopener noreferrer">${data.blockchain_tx}</a>`;
          resultDiv.innerHTML = html;
        }
        setBcStatus(Boolean(data.blockchain_tx), data.blockchain_tx || null);
        showToast("Document verified successfully.", "success");
        await loadStats();
        await loadHistory();
        return;
      }
    }

    // fallback: client-side registry lookup
    try {
      const listRes = await api("/api/documents");
      const docs = await listRes.json();
      const match = Array.isArray(docs) && docs.find(d => {
        const fh = (d.fileHash || "").toString().replace(/^0x/, "").toLowerCase();
        return fh && fh === computedHash.replace(/^0x/, "").toLowerCase();
      });

      if (match) {
        setLoading(false);
        if (resultDiv) {
          resultDiv.className = "result-card result-success";
          let html = `✅ Verified (found in registry)!<br>ID: ${match.documentID}<br>Hash: ${match.fileHash || computedHash}`;
          if (match.blockchainTx) html += `<br>Tx: <a class="tx-link" href="https://sepolia.etherscan.io/tx/${match.blockchainTx}" target="_blank" rel="noopener noreferrer">${match.blockchainTx}</a>`;
          resultDiv.innerHTML = html;
        }
        setBcStatus(Boolean(match.blockchainTx), match.blockchainTx || null);
        showToast("Document verified (client registry lookup).", "success");
        await loadStats();
        await loadHistory();
        return;
      } else {
        setLoading(false);
        if (resultDiv) {
          resultDiv.className = "result-card result-fail";
          resultDiv.innerHTML = `❌ Not registered — computed hash not found in registry.<br>Computed: ${computedHash}`;
        }
        setBcStatus(false, null);
        showToast("Verification result: Not registered.", "error");
        await loadStats();
        await loadHistory();
        return;
      }
    } catch (lookupErr) {
      console.warn("Fallback registry lookup failed", lookupErr);
      setLoading(false);
      if (resultDiv) {
        resultDiv.className = "result-card result-fail";
        resultDiv.innerHTML = `❌ Verification Failed!<br>${data?.reason || "Hash mismatch or not on chain"}`;
      }
      setBcStatus(false, null);
      showToast(`Verification failed: ${data?.reason || "Unknown"}`, "error");
      await loadHistory();
      return;
    }

  } catch (err) {
    console.error(err);
    setLoading(false);
    if (resultDiv) {
      resultDiv.className = "result-card result-fail";
      resultDiv.innerHTML = "⚠️ Server error!";
    }
    setBcStatus(false, null);
    showToast("Server error while verifying.", "error");
    await loadHistory();
  }
});

// COPY HASH
copyHashBtn && (copyHashBtn.onclick = () => {
  if (hashValue && hashValue.textContent !== "N/A" && hashValue.textContent !== "Computing...") {
    navigator.clipboard.writeText(hashValue.textContent)
      .then(() => showToast("Hash copied to clipboard.", "success"))
      .catch(() => showToast("Failed to copy hash.", "error"));
  }
});

// PREVIEW MODAL
filePreview && (filePreview.onclick = () => {
  if (!uploadedFile) return;
  modalContent && (modalContent.innerHTML = "");

  if (uploadedFile.type.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(uploadedFile);
    modalContent && modalContent.appendChild(img);
  } else if (uploadedFile.type === "application/pdf") {
    const iframe = document.createElement("iframe");
    iframe.src = URL.createObjectURL(uploadedFile);
    modalContent && modalContent.appendChild(iframe);
  }

  if (previewModal) previewModal.style.display = "flex";
});
modalClose && (modalClose.onclick = () => previewModal.style.display = "none");
window.onclick = e => { if (e.target === previewModal) previewModal.style.display = "none"; };

// THEME TOGGLE
themeToggle && (themeToggle.onclick = () => {
  document.body.classList.toggle("light");
  document.body.classList.toggle("dark");
  const isDark = document.body.classList.contains("dark");
  // use lucide.replace() to re-render icons
  if (window.lucide && typeof window.lucide.replace === "function") {
    window.lucide.replace();
  }
  themeToggle.innerHTML = `<i data-lucide="${isDark ? "sun" : "moon"}"></i> Theme`;
});

/* ---------------------------
   TABS: single-tab-per-route support
--------------------------- */
function setActiveAction(target) {
  actionTabs.forEach(tab => {
    tab.classList.toggle("active", tab.dataset.target === target);
  });

  if (resultDiv) {
    resultDiv.innerHTML = "";
    resultDiv.className = "result-card";
  }

  if (target === "register") {
    if (registerBtn) registerBtn.style.display = "inline-flex";
    if (verifyBtn) verifyBtn.style.display = "none";
    if (registryIdRow) registryIdRow.style.display = "none";
    if (registeredIdRow) registeredIdRow.style.display = "none";
  } else {
    if (registerBtn) registerBtn.style.display = "none";
    if (verifyBtn) verifyBtn.style.display = "inline-flex";
    if (registryIdRow) registryIdRow.style.display = "block";
  }
}

if (actionTabs.length === 1) {
  setActiveAction(actionTabs[0].dataset.target);
} else {
  actionTabs.forEach(tab => {
    tab.addEventListener("click", () => setActiveAction(tab.dataset.target));
  });
}

setActiveAction(defaultMode);

/* ---------------------------
   LOAD UI data: registry, history, stats
--------------------------- */
async function loadRegistry() {
  if (!registryTableBody) return;
  try {
    const res = await api("/api/documents");
    const docs = await res.json();

    registryTableBody.innerHTML = "";
    docs.forEach(doc => {
      const tr = document.createElement("tr");

      const idCell = document.createElement("td");
      idCell.textContent = doc.documentID;

      const nameCell = document.createElement("td");
      nameCell.textContent = doc.fileName || "-";

      const hashCell = document.createElement("td");
      hashCell.textContent = doc.fileHash || "-";

      const txCell = document.createElement("td");
      if (doc.blockchainTx) {
        const a = document.createElement("a");
        a.href = `https://sepolia.etherscan.io/tx/${doc.blockchainTx}`;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className = "tx-link";
        a.textContent = doc.blockchainTx;
        txCell.appendChild(a);
      } else {
        txCell.textContent = "-";
      }

      const tsCell = document.createElement("td");
      tsCell.textContent = formatDate(doc.timestamp);

      tr.appendChild(idCell);
      tr.appendChild(nameCell);
      tr.appendChild(hashCell);
      tr.appendChild(txCell);
      tr.appendChild(tsCell);

      registryTableBody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load registry", err);
  }
}

async function loadHistory() {
  if (!historyList) return;
  try {
    const res = await api("/api/history");
    const events = await res.json();

    historyList.innerHTML = "";
    events.forEach(ev => {
      const div = document.createElement("div");
      const label = ev.action === "register" ? "Registered" : "Verified";
      const status = ev.success ? "✅ Success" : "❌ Failed";
      const timeStr = formatDate(ev.timestamp);
      const name = ev.fileName || "-";
      div.textContent = `${timeStr} — ${label} — ${name} → ${status}`;
      historyList.appendChild(div);
    });
  } catch (err) {
    console.error("Failed to load history", err);
  }
}

async function loadStats() {
  try {
    const res = await api("/api/stats");
    const data = await res.json();
    if (statsTotalDocs) statsTotalDocs.textContent = data.total_documents ?? "0";
    if (statsTotalVerifications) statsTotalVerifications.textContent = data.total_verifications ?? "0";
    if (statsLastUpdated) statsLastUpdated.textContent = new Date().toLocaleTimeString();
  } catch (err) {
    console.error("Failed to load stats", err);
  }
}

// initial load
window.addEventListener("DOMContentLoaded", () => {
  loadRegistry();
  loadHistory();
  loadStats();
});
