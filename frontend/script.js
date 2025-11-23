// ---------------- CONFIG ----------------
const BACKEND_URL = "https://digital-document-verification-system.onrender.com"; 
// <-- update this if your backend URL changes

// ---------------- DOM refs (kept from your original) ----------------
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

verifyBtn && (verifyBtn.disabled = true);
registerBtn && (registerBtn.disabled = true);

// ---------------- HELPERS ----------------
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
  loaderText.textContent = message || "Processing...";
  registerBtn.disabled = isLoading || !uploadedFile;
  verifyBtn.disabled = isLoading || !uploadedFile;
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

// ---------------- file input handlers ----------------
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

  fileInfo.innerHTML = `📄 <strong>${file.name}</strong> (${(file.size / 1024).toFixed(2)} KB)`;
  filePreview.innerHTML = "";
  hashValue.textContent = "Computing...";
  verifyBtn.disabled = true;
  registerBtn.disabled = true;
  resultDiv.innerHTML = "";
  resultDiv.className = "result-card";
  setBcStatus(false, null);

  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const generatedHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  hashValue.textContent = generatedHash;

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

  verifyBtn.disabled = false;
  registerBtn.disabled = false;
}

// ---------------- MetaMask / web3 helper ----------------
async function ensureWeb3() {
  if (!window.ethereum) {
    throw new Error("MetaMask (or another wallet) is required. Please install it and try again.");
  }
  // request access (will open MetaMask popup)
  await window.ethereum.request({ method: "eth_requestAccounts" });
  const web3 = new Web3(window.ethereum);
  const accounts = await web3.eth.getAccounts();
  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts found in MetaMask.");
  }
  return { web3, user: accounts[0] };
}

// ---------------- REGISTER DOCUMENT (refactored for MetaMask signing) ----------------
registerBtn && (registerBtn.onclick = async () => {
  if (!uploadedFile) {
    showToast("Upload a document first.", "error");
    return;
  }

  setLoading(true, "Preparing registration...");

  try {
    // 1) Upload to backend (backend computes fileHash + creates local registry entry with registered=false)
    const formData = new FormData();
    formData.append("file", uploadedFile);
    formData.append("owner", ownerInput.value || "anonymous");

    const uploadRes = await fetch(`${BACKEND_URL}/api/upload`, {
      method: "POST",
      body: formData
    });
    const uploadJson = await (async () => { try { return await uploadRes.json(); } catch (e) { return null; }})();

    if (!uploadRes.ok || !uploadJson || !uploadJson.success) {
      setLoading(false);
      resultDiv.className = "result-card result-fail";
      resultDiv.innerHTML = `❌ Upload failed: ${uploadJson?.error || uploadRes.statusText}`;
      showToast("Upload failed. See console.", "error");
      await loadHistory();
      return;
    }

    const { documentID, fileHash, fileName } = uploadJson;
    resultDiv.className = "result-card";
    resultDiv.innerHTML = `Uploaded and prepared. DocumentID: ${documentID}<br>Now open MetaMask to sign the registration transaction...`;

    // 2) Load contract ABI & address from backend
    const contractMetaRes = await fetch(`${BACKEND_URL}/api/contract`);
    const contractMeta = await (async () => { try { return await contractMetaRes.json(); } catch (e) { return null; }})();

    if (!contractMetaRes.ok || !contractMeta || !contractMeta.contract_abi || !contractMeta.contract_address) {
      setLoading(false);
      resultDiv.className = "result-card result-fail";
      resultDiv.innerHTML = `❌ Failed to load contract ABI/address from backend.`;
      showToast("Failed to load contract ABI/address.", "error");
      return;
    }

    // 3) Ensure MetaMask + create contract instance
    let web3, user;
    try {
      ({ web3, user } = await ensureWeb3());
    } catch (err) {
      setLoading(false);
      resultDiv.className = "result-card result-fail";
      resultDiv.innerHTML = `⚠️ MetaMask required: ${err.message}`;
      showToast(err.message, "error");
      return;
    }

    const contract = new web3.eth.Contract(contractMeta.contract_abi, contractMeta.contract_address);

    // Prepare the transaction method (adjust if solidity signature differs)
    const txMethod = contract.methods.registerDocument(documentID, fileName, fileHash);

    // Gas estimation (fallback if fails)
    let gasEstimate;
    try {
      gasEstimate = await txMethod.estimateGas({ from: user });
    } catch (estErr) {
      console.warn("Gas estimation failed; using fallback gas:", estErr);
      gasEstimate = 300000;
    }

    // Send tx using MetaMask provider (this triggers MetaMask UI)
    txMethod.send({ from: user, gas: gasEstimate })
      .on("transactionHash", txHash => {
        console.log("Transaction hash:", txHash);
        resultDiv.className = "result-card";
        resultDiv.innerHTML = `Transaction sent: <a class="tx-link" href="https://sepolia.etherscan.io/tx/${txHash}" target="_blank" rel="noopener noreferrer">${txHash}</a><br>Waiting for confirmation...`;
        setLoading(true, "Waiting for transaction to be mined...");
      })
      .on("receipt", async receipt => {
        console.log("Transaction mined:", receipt);
        const txHash = receipt.transactionHash;

        // 4) Inform backend to confirm register (store tx hash & mark registered=true)
        try {
          const confirmRes = await fetch(`${BACKEND_URL}/api/confirm_register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ documentID, blockchainTx: txHash })
          });
          const confirmJson = await (async () => { try { return await confirmRes.json(); } catch(e){ return null; }})();

          setLoading(false);

          if (confirmRes.ok && confirmJson && confirmJson.success) {
            resultDiv.className = "result-card result-success";
            resultDiv.innerHTML =
              `✅ Document registered on-chain!<br>ID: ${documentID}<br>Hash: ${fileHash}<br>` +
              `Tx: <a class="tx-link" href="https://sepolia.etherscan.io/tx/${txHash}" target="_blank" rel="noopener noreferrer">${txHash}</a>`;

            setBcStatus(true, txHash);
            showToast("Document registered on Ethereum.", "success");

            // show Registered ID UI
            if (registeredIdRow && registeredIdText) {
              registeredIdText.textContent = documentID;
              registeredIdRow.style.display = "block";
              if (registryIdInput) registryIdInput.value = documentID;
            }
            // wire copy/save/use buttons
            if (copyRegisteredIdBtn) copyRegisteredIdBtn.onclick = () => {
              navigator.clipboard.writeText(documentID).then(() => showToast("Registered ID copied to clipboard.", "success")).catch(()=>showToast("Copy failed", "error"));
            };
            if (saveRegisteredIdBtn) saveRegisteredIdBtn.onclick = () => { saveIdToLocal(documentID); showToast("Registered ID saved locally.", "success"); };
            if (useRegisteredIdBtn) useRegisteredIdBtn.onclick = () => { if (registryIdInput) registryIdInput.value = documentID; setActiveAction("verify"); showToast("Registered ID set in verify input.", "info"); };

            await loadRegistry();
            await loadStats();
            await loadHistory();
            return;
          } else {
            resultDiv.className = "result-card result-fail";
            resultDiv.innerHTML = `✅ Tx mined but backend confirm failed. Tx: ${txHash}`;
            setBcStatus(true, txHash);
            showToast("Transaction mined but backend confirm failed.", "warning");
            await loadRegistry();
            await loadHistory();
            return;
          }
        } catch (confirmErr) {
          console.error("confirm_register error", confirmErr);
          setLoading(false);
          resultDiv.className = "result-card result-fail";
          resultDiv.innerHTML = `Tx mined, but confirming with backend failed. Tx: ${txHash}`;
          setBcStatus(true, txHash);
          showToast("Confirm register failed.", "error");
          await loadRegistry();
          await loadHistory();
          return;
        }
      })
      .on("error", txErr => {
        console.error("Transaction error", txErr);
        setLoading(false);
        resultDiv.className = "result-card result-fail";
        resultDiv.innerHTML = `⚠️ Transaction failed or rejected by user.`;
        setBcStatus(false, null);
        showToast("Transaction failed or rejected.", "error");
      });

  } catch (err) {
    console.error("Register flow error:", err);
    setLoading(false);
    resultDiv.className = "result-card result-fail";
    resultDiv.innerHTML = `⚠️ Error: ${err.message || err}`;
    setBcStatus(false, null);
    showToast("Registration failed.", "error");
    await loadHistory();
  }
});

// ---------------- VERIFY ----------------
verifyBtn && (verifyBtn.onclick = async () => {
  if (!uploadedFile) {
    showToast("Upload a document first.", "error");
    return;
  }

  const computedHash = (hashValue.textContent || "").trim();
  if (!computedHash || computedHash === "Computing...") {
    showToast("Hash not ready yet. Wait a moment.", "warning");
    return;
  }

  setLoading(true, "Verifying document against registry...");
  resultDiv.className = "result-card";
  resultDiv.innerHTML = "⏳ Verifying against blockchain registry...";

  const formData = new FormData();
  formData.append("file", uploadedFile);
  formData.append("documentID", registryIdInput ? registryIdInput.value.trim() : "");

  try {
    const res = await fetch(`${BACKEND_URL}/verify`, {
      method: "POST",
      body: formData
    });

    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }

    if (data && data.verified) {
      setLoading(false);
      resultDiv.className = "result-card result-success";
      let html = `✅ Verified!<br>Hash: ${data.computed_hash || computedHash}`;
      if (data.documentID) html += `<br>ID: ${data.documentID}`;
      if (data.blockchain_tx) html += `<br>Tx: <a class="tx-link" href="https://sepolia.etherscan.io/tx/${data.blockchain_tx}" target="_blank" rel="noopener noreferrer">${data.blockchain_tx}</a>`;
      resultDiv.innerHTML = html;
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
        resultDiv.className = "result-card result-fail";
        resultDiv.innerHTML = `❌ Not registered — hash not found in registry.<br>Computed: ${computedHash}`;
        setBcStatus(false, null);
        showToast("Verification result: Not registered.", "error");
        await loadStats();
        await loadHistory();
        return;
      }
      if (reason.includes("tamper") || reason.includes("mismatch") || reason.includes("hash mismatch")) {
        setLoading(false);
        resultDiv.className = "result-card result-fail";
        let html = `⚠️ Tampered — document hash does not match stored record.<br>Computed: ${computedHash}`;
        if (data.stored_hash) html += `<br>Stored: ${data.stored_hash}`;
        if (data.documentID) html += `<br>ID: ${data.documentID}`;
        if (data.blockchain_tx) html += `<br>Tx: <a class="tx-link" href="https://sepolia.etherscan.io/tx/${data.blockchain_tx}" target="_blank" rel="noopener noreferrer">${data.blockchain_tx}</a>`;
        resultDiv.innerHTML = html;
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
        resultDiv.className = "result-card result-fail";
        let html = `⚠️ Tampered — document hash does not match stored record.<br>Computed: ${computedHash}<br>Stored: ${data.stored_hash}`;
        if (data.documentID) html += `<br>ID: ${data.documentID}`;
        if (data.blockchain_tx) html += `<br>Tx: <a class="tx-link" href="https://sepolia.etherscan.io/tx/${data.blockchain_tx}" target="_blank" rel="noopener noreferrer">${data.blockchain_tx}</a>`;
        resultDiv.innerHTML = html;
        setBcStatus(Boolean(data.blockchain_tx), data.blockchain_tx || null);
        showToast("Verification result: Tampered.", "error");
        await loadStats();
        await loadHistory();
        return;
      }
      if (stored && stored === comp) {
        setLoading(false);
        resultDiv.className = "result-card result-success";
        let html = `✅ Verified (by stored hash)!<br>Hash: ${computedHash}`;
        if (data.documentID) html += `<br>ID: ${data.documentID}`;
        if (data.blockchain_tx) html += `<br>Tx: <a class="tx-link" href="https://sepolia.etherscan.io/tx/${data.blockchain_tx}" target="_blank" rel="noopener noreferrer">${data.blockchain_tx}</a>`;
        resultDiv.innerHTML = html;
        setBcStatus(Boolean(data.blockchain_tx), data.blockchain_tx || null);
        showToast("Document verified successfully.", "success");
        await loadStats();
        await loadHistory();
        return;
      }
    }

    // fallback: client-side registry lookup
    try {
      const listRes = await fetch(`${BACKEND_URL}/api/documents`);
      const docs = await listRes.json();
      const match = Array.isArray(docs) && docs.find(d => {
        const fh = (d.fileHash || "").toString().replace(/^0x/, "").toLowerCase();
        return fh && fh === computedHash.replace(/^0x/, "").toLowerCase();
      });

      if (match) {
        setLoading(false);
        resultDiv.className = "result-card result-success";
        let html = `✅ Verified (found in registry)!<br>ID: ${match.documentID}<br>Hash: ${match.fileHash || computedHash}`;
        if (match.blockchainTx) html += `<br>Tx: <a class="tx-link" href="https://sepolia.etherscan.io/tx/${match.blockchainTx}" target="_blank" rel="noopener noreferrer">${match.blockchainTx}</a>`;
        resultDiv.innerHTML = html;
        setBcStatus(Boolean(match.blockchainTx), match.blockchainTx || null);
        showToast("Document verified (client registry lookup).", "success");
        await loadStats();
        await loadHistory();
        return;
      } else {
        setLoading(false);
        resultDiv.className = "result-card result-fail";
        resultDiv.innerHTML = `❌ Not registered — computed hash not found in registry.<br>Computed: ${computedHash}`;
        setBcStatus(false, null);
        showToast("Verification result: Not registered.", "error");
        await loadStats();
        await loadHistory();
        return;
      }
    } catch (lookupErr) {
      console.warn("Fallback registry lookup failed", lookupErr);
      setLoading(false);
      resultDiv.className = "result-card result-fail";
      resultDiv.innerHTML = `❌ Verification Failed!<br>${data?.reason || "Hash mismatch or not on chain"}`;
      setBcStatus(false, null);
      showToast(`Verification failed: ${data?.reason || "Unknown"}`, "error");
      await loadHistory();
      return;
    }

  } catch (err) {
    console.error(err);
    setLoading(false);
    resultDiv.className = "result-card result-fail";
    resultDiv.innerHTML = "⚠️ Server error!";
    setBcStatus(false, null);
    showToast("Server error while verifying.", "error");
    await loadHistory();
  }
});

// ---------------- COPY HASH ----------------
copyHashBtn && (copyHashBtn.onclick = () => {
  if (hashValue.textContent !== "N/A" && hashValue.textContent !== "Computing...") {
    navigator.clipboard.writeText(hashValue.textContent)
      .then(() => showToast("Hash copied to clipboard.", "success"))
      .catch(() => showToast("Failed to copy hash.", "error"));
  }
});

// ---------------- PREVIEW MODAL ----------------
filePreview && (filePreview.onclick = () => {
  if (!uploadedFile) return;
  modalContent.innerHTML = "";

  if (uploadedFile.type.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(uploadedFile);
    modalContent.appendChild(img);
  } else if (uploadedFile.type === "application/pdf") {
    const iframe = document.createElement("iframe");
    iframe.src = URL.createObjectURL(uploadedFile);
    modalContent.appendChild(iframe);
  }

  previewModal.style.display = "flex";
});
modalClose && (modalClose.onclick = () => previewModal.style.display = "none");
window.onclick = e => { if (e.target === previewModal) previewModal.style.display = "none"; };

// ---------------- THEME TOGGLE ----------------
themeToggle && (themeToggle.onclick = () => {
  document.body.classList.toggle("light");
  document.body.classList.toggle("dark");
  const isDark = document.body.classList.contains("dark");
  themeToggle.innerHTML = `<i data-lucide="${isDark ? "sun" : "moon"}"></i> Theme`;
  lucide.createIcons();
});

/* ---------------------------
   TABS + UI state
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
    registerBtn.style.display = "inline-flex";
    verifyBtn.style.display = "none";
    if (registryIdRow) registryIdRow.style.display = "none";
    if (registeredIdRow) registeredIdRow.style.display = "none";
  } else {
    registerBtn.style.display = "none";
    verifyBtn.style.display = "inline-flex";
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
   LOAD UI data: registry, history, stats (use BACKEND_URL)
--------------------------- */
async function loadRegistry() {
  if (!registryTableBody) return;
  try {
    const res = await fetch(`${BACKEND_URL}/api/documents`);
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
    const res = await fetch(`${BACKEND_URL}/api/history`);
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
    const res = await fetch(`${BACKEND_URL}/api/stats`);
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
