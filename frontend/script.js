/* -------------------------
   script.js (PRODUCTION-READY with Blockchain Integration)
   - Complete MetaMask/Web3 integration
   - Wallet connection management
   - Smart contract interaction
   - Network validation (Sepolia)
   - Enhanced error handling
   - Security improvements
   - All features from updated HTML
------------------------- */

// ============================================
// DOM ELEMENTS
// ============================================

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
const loader = document.getElementById("loader");
const loaderText = document.getElementById("loaderText");
const toastContainer = document.getElementById("toastContainer");

// Stats
const statsTotalDocs = document.getElementById("statTotalDocs");
const statsTotalVerifications = document.getElementById("statTotalVerifications");
const statsRegistered = document.getElementById("statRegistered");
const statsLastUpdated = document.getElementById("statLastUpdated");

// Registry/Verify IDs
const registryIdRow = document.getElementById("registryIdRow");
const registryIdInput = document.getElementById("registryIdInput");
const registeredIdRow = document.getElementById("registeredIdRow");
const registeredIdText = document.getElementById("registeredIdText");
const copyRegisteredIdBtn = document.getElementById("copyRegisteredIdBtn");
const saveRegisteredIdBtn = document.getElementById("saveRegisteredIdBtn");
const useRegisteredIdBtn = document.getElementById("useRegisteredIdBtn");

// Wallet Elements
const connectWalletBtn = document.getElementById("connectWalletBtn");
const walletConnected = document.getElementById("walletConnected");
const walletAddress = document.getElementById("walletAddress");
const networkBadge = document.getElementById("networkBadge");
const networkName = document.getElementById("networkName");

// Refresh Buttons
const refreshHistoryBtn = document.getElementById("refreshHistoryBtn");
const refreshRegistryBtn = document.getElementById("refreshRegistryBtn");

const defaultMode = document.body.dataset.defaultMode || "verify";

// ============================================
// STATE MANAGEMENT
// ============================================

let uploadedFile = null;
let ethersProvider = null;
let ethersContract = null;
let userWalletAddress = null;
let isWalletConnected = false;
let currentNetwork = null;

// ============================================
// CONFIGURATION
// ============================================

const SEPOLIA_CHAIN_ID = "0xaa36a7"; // 11155111 in decimal
const SEPOLIA_CHAIN_ID_DECIMAL = 11155111;
const EXPECTED_NETWORK = "Sepolia Testnet";

const API_BASE = typeof API_BASE_URL !== "undefined" ? API_BASE_URL : "";
const SAVED_IDS_KEY = "docchain_saved_register_ids";

// ============================================
// API HELPER
// ============================================

function api(path, opts = {}) {
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_BASE}${p}`;
  return fetch(url, opts);
}

// ============================================
// BLOCKCHAIN FUNCTIONS
// ============================================

/**
 * Check if MetaMask is installed
 */
function isMetaMaskInstalled() {
  return typeof window.ethereum !== "undefined";
}

/**
 * Connect to MetaMask wallet
 */
async function connectWallet() {
  if (!isMetaMaskInstalled()) {
    showToast("❌ MetaMask not detected. Please install MetaMask extension.", "error");
    window.open("https://metamask.io/download/", "_blank");
    return false;
  }

  try {
    setLoading(true, "Connecting to MetaMask...");

    // Request account access
    const accounts = await window.ethereum.request({ 
      method: "eth_requestAccounts" 
    });

    if (!accounts || accounts.length === 0) {
      throw new Error("No accounts found. Please unlock MetaMask.");
    }

    userWalletAddress = accounts[0];

    // Initialize ethers provider
    ethersProvider = new ethers.providers.Web3Provider(window.ethereum);
    
    // Check network
    const network = await ethersProvider.getNetwork();
    currentNetwork = network.chainId;

    if (network.chainId !== SEPOLIA_CHAIN_ID_DECIMAL) {
      showToast("⚠️ Wrong network. Please switch to Sepolia testnet.", "warning");
      await switchToSepolia();
    }

    // Get contract details from backend
    await initializeContract();

    // Update UI
    isWalletConnected = true;
    updateWalletUI();

    showToast(`✅ Wallet connected: ${formatAddress(userWalletAddress)}`, "success");
    console.info("✅ Wallet connected:", userWalletAddress);

    setLoading(false);
    return true;

  } catch (error) {
    console.error("Wallet connection error:", error);
    setLoading(false);

    if (error.code === 4001) {
      showToast("❌ Connection rejected by user", "error");
    } else if (error.code === -32002) {
      showToast("⚠️ Connection request pending. Please check MetaMask.", "warning");
    } else {
      showToast(`❌ Connection failed: ${error.message}`, "error");
    }

    return false;
  }
}

/**
 * Switch to Sepolia network
 */
async function switchToSepolia() {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_CHAIN_ID }],
    });
    showToast("✅ Switched to Sepolia testnet", "success");
    currentNetwork = SEPOLIA_CHAIN_ID_DECIMAL;
    if (networkName) networkName.textContent = EXPECTED_NETWORK;
  } catch (switchError) {
    if (switchError.code === 4902) {
      // Network not added to MetaMask
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: SEPOLIA_CHAIN_ID,
            chainName: "Sepolia Testnet",
            nativeCurrency: {
              name: "Sepolia ETH",
              symbol: "ETH",
              decimals: 18
            },
            rpcUrls: ["https://sepolia.infura.io/v3/"],
            blockExplorerUrls: ["https://sepolia.etherscan.io"]
          }],
        });
        showToast("✅ Sepolia testnet added to MetaMask", "success");
      } catch (addError) {
        showToast("❌ Failed to add Sepolia network", "error");
        throw addError;
      }
    } else {
      throw switchError;
    }
  }
}

/**
 * Initialize smart contract
 */
async function initializeContract() {
  try {
    // Get contract details from backend
    const response = await api("/api/contract");
    const contractData = await response.json();

    if (!contractData.contract_address || !contractData.contract_abi) {
      throw new Error("Contract configuration not available from backend");
    }

    // Initialize contract with signer
    const signer = ethersProvider.getSigner();
    ethersContract = new ethers.Contract(
      contractData.contract_address,
      contractData.contract_abi,
      signer
    );

    console.info("✅ Smart contract initialized:", contractData.contract_address);
    return true;

  } catch (error) {
    console.error("Contract initialization error:", error);
    showToast("⚠️ Failed to initialize smart contract", "warning");
    return false;
  }
}

/**
 * Register document on blockchain
 */
async function registerOnBlockchain(documentID, fileName, fileHash) {
  if (!isWalletConnected || !ethersContract) {
    throw new Error("Wallet not connected. Please connect MetaMask first.");
  }

  try {
    showToast("📝 Preparing blockchain transaction...", "info");
    setLoading(true, "Waiting for MetaMask confirmation...");

    // Call smart contract
    const tx = await ethersContract.registerDocument(
      documentID,
      fileName,
      fileHash
    );

    showToast("⏳ Transaction submitted. Waiting for confirmation...", "info");
    setLoading(true, "Transaction submitted. Waiting for confirmation...");

    // Wait for transaction to be mined
    const receipt = await tx.wait();

    console.info("✅ Transaction confirmed:", receipt.transactionHash);

    return {
      success: true,
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString()
    };

  } catch (error) {
    console.error("Blockchain registration error:", error);

    // Handle specific MetaMask errors
    if (error.code === 4001) {
      throw new Error("Transaction rejected by user");
    } else if (error.code === -32603) {
      throw new Error("Insufficient funds for gas");
    } else if (error.message && error.message.includes("gas")) {
      throw new Error("Gas estimation failed. Check wallet balance.");
    } else {
      throw new Error(error.message || "Blockchain transaction failed");
    }
  }
}

/**
 * Verify document on blockchain (optional - for enhanced verification)
 */
async function verifyOnBlockchain(documentID) {
  if (!ethersContract) {
    console.warn("Contract not initialized");
    return { exists: false, error: "Contract not initialized" };
  }

  try {
    // Query smart contract
    const docData = await ethersContract.getDocument(documentID);

    return {
      exists: docData.fileName !== "", // Empty string means not found
      fileName: docData.fileName,
      fileHash: docData.fileHash,
      timestamp: new Date(docData.timestamp.toNumber() * 1000).toISOString(),
      uploader: docData.uploader
    };
  } catch (error) {
    console.error("Blockchain verification error:", error);
    return { exists: false, error: error.message };
  }
}

/**
 * Update wallet UI
 */
function updateWalletUI() {
  if (isWalletConnected && userWalletAddress) {
    if (connectWalletBtn) connectWalletBtn.style.display = "none";
    if (walletConnected) {
      walletConnected.style.display = "flex";
      if (walletAddress) {
        walletAddress.textContent = formatAddress(userWalletAddress);
        walletAddress.title = userWalletAddress; // Full address on hover
      }
    }
    if (networkName && currentNetwork === SEPOLIA_CHAIN_ID_DECIMAL) {
      networkName.textContent = EXPECTED_NETWORK;
    }
  } else {
    if (connectWalletBtn) connectWalletBtn.style.display = "flex";
    if (walletConnected) walletConnected.style.display = "none";
  }
}

/**
 * Format wallet address (0x1234...5678)
 */
function formatAddress(address) {
  if (!address) return "Not Connected";
  return `${address.substring(0, 6)}...${address.substring(38)}`;
}

/**
 * Listen for account/network changes
 */
if (isMetaMaskInstalled()) {
  window.ethereum.on("accountsChanged", (accounts) => {
    if (accounts.length === 0) {
      // User disconnected wallet
      isWalletConnected = false;
      userWalletAddress = null;
      updateWalletUI();
      showToast("⚠️ Wallet disconnected", "warning");
    } else {
      // User switched accounts
      userWalletAddress = accounts[0];
      updateWalletUI();
      showToast(`🔄 Switched to ${formatAddress(accounts[0])}`, "info");
    }
  });

  window.ethereum.on("chainChanged", (chainId) => {
    // Reload page on network change (recommended by MetaMask)
    window.location.reload();
  });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

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
  if (isOnChain && txHash) {
    const safeTx = txHash.trim();
    bcStatus.innerHTML = `
      <div class="status-badge status-onchain">
        <i data-lucide="check-circle"></i>
        <span>Stored on Ethereum</span>
      </div>
      <a class="tx-link" 
         href="https://sepolia.etherscan.io/tx/${safeTx}" 
         target="_blank" 
         rel="noopener noreferrer">
        <i data-lucide="external-link"></i>
        View Transaction
      </a>
    `;
    if (window.lucide && typeof lucide.createIcons === "function") { lucide.createIcons(); }
  } else {
    bcStatus.innerHTML = `
      <div class="status-badge status-offchain">
        <i data-lucide="alert-circle"></i>
        <span>Not stored on blockchain</span>
      </div>
    `;
    if (window.lucide && typeof lucide.createIcons === "function") {
       lucide.createIcons();
     }
  }
}

function setLoading(isLoading, message) {
  if (!loader) return;
  loader.classList.toggle("hidden", !isLoading);
  if (loaderText) loaderText.textContent = message || "Processing...";
  
  // Disable buttons during loading
  if (registerBtn) registerBtn.disabled = isLoading || !uploadedFile;
  if (verifyBtn) verifyBtn.disabled = isLoading || !uploadedFile;
}

function showToast(message, type = "info") {
  if (!toastContainer) return;
  
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  // Add icon based on type
  const iconMap = {
    success: "check-circle",
    error: "x-circle",
    warning: "alert-triangle",
    info: "info"
  };
  
  toast.innerHTML = `
    <i data-lucide="${iconMap[type] || 'info'}"></i>
    <span>${message}</span>
  `;
  
  toastContainer.appendChild(toast);
  
  // Replace icons in toast
  if (window.lucide && typeof lucide.createIcons === "function") { lucide.createIcons(); }

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.style.animation = "toast-out 0.3s forwards";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// LocalStorage helpers
function loadSavedIds() {
  try {
    const raw = localStorage.getItem(SAVED_IDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn("Failed to load saved IDs:", e);
    return [];
  }
}

function saveIdToLocal(id) {
  try {
    const list = loadSavedIds();
    if (!list.includes(id)) {
      list.push(id);
      localStorage.setItem(SAVED_IDS_KEY, JSON.stringify(list));
    }
  } catch (e) {
    console.warn("Failed to save ID:", e);
  }
}

// ============================================
// FILE HANDLING
// ============================================

// Initial state
if (verifyBtn) verifyBtn.disabled = true;
if (registerBtn) registerBtn.disabled = true;
setBcStatus(false, null);

// File input handlers
if (browse) {
  browse.onclick = () => fileInput && fileInput.click();
}

if (fileInput) {
  fileInput.onchange = () => {
    if (fileInput.files && fileInput.files[0]) {
      handleFile(fileInput.files[0]);
    }
  };
}

if (uploadArea) {
  uploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadArea.classList.add("dragover");
  });

  uploadArea.addEventListener("dragleave", () => {
    uploadArea.classList.remove("dragover");
  });

  uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  });
}

/**
 * Handle file upload and hash computation
 */
async function handleFile(file) {
  uploadedFile = file;
  if (!file) return;

  // Update file info
  if (fileInfo) {
    const sizeKB = (file.size / 1024).toFixed(2);
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    const sizeStr = file.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;
    
    fileInfo.innerHTML = `
      <i data-lucide="file"></i>
      <strong>${file.name}</strong>
      <span class="file-size">(${sizeStr})</span>
    `;
    if (window.lucide && typeof lucide.createIcons === "function") { lucide.createIcons(); }
  }

  // Clear preview and result
  if (filePreview) filePreview.innerHTML = "";
  if (hashValue) hashValue.textContent = "Computing...";
  if (verifyBtn) verifyBtn.disabled = true;
  if (registerBtn) registerBtn.disabled = true;
  if (resultDiv) {
    resultDiv.innerHTML = "";
    resultDiv.className = "result-card";
  }
  setBcStatus(false, null);

  try {
    // Compute SHA-256 hash
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const generatedHash = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (hashValue) hashValue.textContent = generatedHash;

    // Generate file preview
    if (filePreview) {
      if (file.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.src = URL.createObjectURL(file);
        img.alt = "File preview";
        img.onclick = () => openPreviewModal();
        filePreview.appendChild(img);
      } else if (file.type === "application/pdf") {
        const iframe = document.createElement("iframe");
        iframe.src = URL.createObjectURL(file);
        iframe.title = "PDF preview";
        filePreview.appendChild(iframe);
      } else {
        filePreview.innerHTML = `
          <div class="file-placeholder">
            <i data-lucide="file-text"></i>
            <p>Preview not available for this file type</p>
          </div>
        `;
        if (window.lucide && typeof lucide.createIcons === "function") { lucide.createIcons(); }
      }
    }

    // Enable action buttons
    if (verifyBtn) verifyBtn.disabled = false;
    if (registerBtn) registerBtn.disabled = false;

    showToast("✅ File hash computed successfully", "success");

  } catch (error) {
    console.error("File processing error:", error);
    showToast("❌ Failed to process file", "error");
    if (hashValue) hashValue.textContent = "Error";
  }
}

// ============================================
// REGISTER DOCUMENT
// ============================================

if (registerBtn) {
  registerBtn.onclick = async () => {
    if (!uploadedFile) {
      showToast("❌ Please upload a document first", "error");
      return;
    }

    // Check wallet connection
    if (!isWalletConnected) {
      showToast("⚠️ Please connect your wallet first", "warning");
      const connected = await connectWallet();
      if (!connected) return;
    }

    setLoading(true, "Uploading document to server...");
    if (resultDiv) {
      resultDiv.className = "result-card";
      resultDiv.innerHTML = "⏳ Registering document...";
    }

    const owner = ownerInput ? ownerInput.value.trim() || "anonymous" : "anonymous";
    const formData = new FormData();
    formData.append("file", uploadedFile);
    formData.append("owner", owner);

    try {
      // Step 1: Upload to backend
      showToast("📤 Uploading to server...", "info");
      const uploadRes = await api("/api/upload", {
        method: "POST",
        body: formData,
      });

      const uploadData = await uploadRes.json();

      if (!uploadRes.ok || !uploadData.success) {
        throw new Error(uploadData.error || "Upload failed");
      }

      const { documentID, fileName, fileHash } = uploadData;
      showToast("✅ File uploaded. Preparing blockchain transaction...", "success");

      // Step 2: Register on blockchain
      setLoading(true, "Waiting for MetaMask confirmation...");
      const blockchainResult = await registerOnBlockchain(
        documentID,
        fileName,
        fileHash
      );

      // Step 3: Confirm with backend
      showToast("💾 Saving transaction to database...", "info");
      setLoading(true, "Confirming registration...");

      const confirmRes = await api("/api/confirm_register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentID: documentID,
          blockchainTx: blockchainResult.txHash,
          blockNumber: blockchainResult.blockNumber,
        }),
      });

      if (!confirmRes.ok) {
        throw new Error("Failed to confirm registration with backend");
      }

      // Step 4: Show success
      setLoading(false);
      if (resultDiv) {
        resultDiv.className = "result-card result-success";
        resultDiv.innerHTML = `
          <div class="result-header">
            <i data-lucide="check-circle"></i>
            <h3>Document Registered Successfully!</h3>
          </div>
          <div class="result-details">
            <div class="detail-row">
              <span class="label">Document ID:</span>
              <code>${documentID}</code>
            </div>
            <div class="detail-row">
              <span class="label">File Hash:</span>
              <code class="hash-display">${fileHash}</code>
            </div>
            <div class="detail-row">
              <span class="label">Transaction Hash:</span>
              <a href="https://sepolia.etherscan.io/tx/${blockchainResult.txHash}" 
                 target="_blank" 
                 rel="noopener noreferrer"
                 class="tx-link">
                ${blockchainResult.txHash}
                <i data-lucide="external-link"></i>
              </a>
            </div>
            <div class="detail-row">
              <span class="label">Block Number:</span>
              <span>${blockchainResult.blockNumber}</span>
            </div>
            <div class="detail-row">
              <span class="label">Gas Used:</span>
              <span>${blockchainResult.gasUsed}</span>
            </div>
            <div class="detail-row">
              <span class="label">Registered By:</span>
              <code>${formatAddress(userWalletAddress)}</code>
            </div>
          </div>
          <p class="note">⚠️ Save your Document ID - you'll need it to verify this document later!</p>
        `;
        if (window.lucide && typeof lucide.createIcons === "function") { lucide.createIcons(); }
      }

      // Update blockchain status
      setBcStatus(true, blockchainResult.txHash);

      // Show registered ID UI
      if (registeredIdRow && registeredIdText) {
        registeredIdText.textContent = documentID;
        registeredIdRow.style.display = "block";
      }

      // Wire up ID action buttons
      if (copyRegisteredIdBtn) {
        copyRegisteredIdBtn.onclick = () => {
          navigator.clipboard.writeText(documentID)
            .then(() => showToast("📋 Document ID copied!", "success"))
            .catch(() => showToast("❌ Failed to copy", "error"));
        };
      }

      if (saveRegisteredIdBtn) {
        saveRegisteredIdBtn.onclick = () => {
          saveIdToLocal(documentID);
          showToast("💾 Document ID saved locally", "success");
        };
      }

      if (useRegisteredIdBtn) {
        useRegisteredIdBtn.onclick = () => {
          if (registryIdInput) {
            registryIdInput.value = documentID;
            setActiveAction("verify");
            showToast("✅ ID set for verification", "info");
          }
        };
      }

      showToast("🎉 Document registered on blockchain successfully!", "success");

      // Reload data
      await Promise.all([loadRegistry(), loadStats(), loadHistory()]);

    } catch (error) {
      console.error("Registration error:", error);
      setLoading(false);

      if (resultDiv) {
        resultDiv.className = "result-card result-fail";
        resultDiv.innerHTML = `
          <div class="result-header">
            <i data-lucide="x-circle"></i>
            <h3>Registration Failed</h3>
          </div>
          <p>${error.message}</p>
          <p class="note">Please check your MetaMask connection and try again.</p>
        `;
        if (window.lucide && typeof lucide.createIcons === "function") { lucide.createIcons(); }
      }

      showToast(`❌ ${error.message}`, "error");
      await loadHistory();
    }
  };
}

// ============================================
// VERIFY DOCUMENT
// ============================================

if (verifyBtn) {
  verifyBtn.onclick = async () => {
    if (!uploadedFile) {
      showToast("❌ Please upload a document first", "error");
      return;
    }

    const computedHash = (hashValue && hashValue.textContent || "").trim();
    if (!computedHash || computedHash === "Computing..." || computedHash === "N/A") {
      showToast("⚠️ Hash not ready. Please wait.", "warning");
      return;
    }

    setLoading(true, "Verifying document...");
    if (resultDiv) {
      resultDiv.className = "result-card";
      resultDiv.innerHTML = "⏳ Verifying against blockchain registry...";
    }

    const docId = registryIdInput ? registryIdInput.value.trim() : "";
    const formData = new FormData();
    formData.append("file", uploadedFile);
    if (docId) formData.append("documentID", docId);

    try {
      const res = await api("/verify", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (data.verified) {
        // SUCCESS: Document verified
        setLoading(false);
        if (resultDiv) {
          resultDiv.className = "result-card result-success";
          resultDiv.innerHTML = `
            <div class="result-header">
              <i data-lucide="check-circle"></i>
              <h3>Document Verified Successfully!</h3>
            </div>
            <div class="result-details">
              <div class="detail-row">
                <span class="label">Status:</span>
                <span class="badge badge-success">✅ Verified</span>
              </div>
              ${data.documentID ? `
              <div class="detail-row">
                <span class="label">Document ID:</span>
                <code>${data.documentID}</code>
              </div>` : ""}
              <div class="detail-row">
                <span class="label">File Hash:</span>
                <code class="hash-display">${data.computed_hash || computedHash}</code>
              </div>
              ${data.fileName ? `
              <div class="detail-row">
                <span class="label">File Name:</span>
                <span>${data.fileName}</span>
              </div>` : ""}
              ${data.owner ? `
              <div class="detail-row">
                <span class="label">Owner:</span>
                <span>${data.owner}</span>
              </div>` : ""}
              ${data.blockchain_tx ? `
              <div class="detail-row">
                <span class="label">Blockchain Transaction:</span>
                <a href="https://sepolia.etherscan.io/tx/${data.blockchain_tx}" 
                   target="_blank" 
                   rel="noopener noreferrer"
                   class="tx-link">
                  ${data.blockchain_tx}
                  <i data-lucide="external-link"></i>
                </a>
              </div>` : ""}
              ${data.timestamp ? `
              <div class="detail-row">
                <span class="label">Registered:</span>
                <span>${formatDate(data.timestamp)}</span>
              </div>` : ""}
            </div>
            <p class="note">✅ This document's integrity has been verified against the blockchain registry.</p>
          `;
          if (window.lucide && typeof lucide.createIcons === "function") { lucide.createIcons(); }
        }

        setBcStatus(Boolean(data.blockchain_tx), data.blockchain_tx || null);
        showToast("✅ Document verified successfully", "success");

      } else {
        // FAILURE: Not verified
        setLoading(false);
        const reason = data.reason || "unknown";

        if (reason.includes("tamper") || reason.includes("mismatch")) {
          // Document tampered
          if (resultDiv) {
            resultDiv.className = "result-card result-fail";
            resultDiv.innerHTML = `
              <div class="result-header">
                <i data-lucide="alert-triangle"></i>
                <h3>Document Tampered!</h3>
              </div>
              <div class="result-details">
                <div class="detail-row">
                  <span class="label">Status:</span>
                  <span class="badge badge-error">⚠️ Tampered</span>
                </div>
                <div class="detail-row">
                  <span class="label">Computed Hash:</span>
                  <code class="hash-display">${computedHash}</code>
                </div>
                ${data.stored_hash ? `
                <div class="detail-row">
                  <span class="label">Stored Hash:</span>
                  <code class="hash-display">${data.stored_hash}</code>
                </div>` : ""}
              </div>
              <p class="note">⚠️ The document has been modified since registration. Hash mismatch detected.</p>
            `;
            if (window.lucide && typeof lucide.createIcons === "function") { lucide.createIcons(); }
          }
          showToast("⚠️ Document has been tampered with", "error");

        } else {
          // Document not registered
          if (resultDiv) {
            resultDiv.className = "result-card result-fail";
            resultDiv.innerHTML = `
              <div class="result-header">
                <i data-lucide="x-circle"></i>
                <h3>Document Not Registered</h3>
              </div>
              <div class="result-details">
                <div class="detail-row">
                  <span class="label">Status:</span>
                  <span class="badge badge-error">❌ Not Found</span>
                </div>
                <div class="detail-row">
                  <span class="label">Computed Hash:</span>
                  <code class="hash-display">${computedHash}</code>
                </div>
              </div>
              <p class="note">❌ This document is not registered in the blockchain registry.</p>
            `;
            if (window.lucide && typeof lucide.createIcons === "function") { lucide.createIcons(); }
          }
          showToast("❌ Document not registered", "error");
        }

        setBcStatus(false, null);
      }

      // Reload data
      await Promise.all([loadStats(), loadHistory()]);

    } catch (error) {
      console.error("Verification error:", error);
      setLoading(false);

      if (resultDiv) {
        resultDiv.className = "result-card result-fail";
        resultDiv.innerHTML = `
          <div class="result-header">
            <i data-lucide="alert-circle"></i>
            <h3>Verification Failed</h3>
          </div>
          <p>An error occurred during verification.</p>
          <p class="error-message">${error.message}</p>
        `;
        if (window.lucide && typeof lucide.createIcons === "function") { lucide.createIcons(); }
      }

      showToast(`❌ Verification failed: ${error.message}`, "error");
      await loadHistory();
    }
  };
}

// ============================================
// COPY HASH BUTTON
// ============================================

if (copyHashBtn) {
  copyHashBtn.onclick = () => {
    const hash = hashValue && hashValue.textContent;
    if (hash && hash !== "N/A" && hash !== "Computing...") {
      navigator.clipboard.writeText(hash)
        .then(() => showToast("📋 Hash copied to clipboard", "success"))
        .catch(() => showToast("❌ Failed to copy hash", "error"));
    }
  };
}

// ============================================
// PREVIEW MODAL
// ============================================

function openPreviewModal() {
  if (!uploadedFile || !previewModal || !modalContent) return;

  modalContent.innerHTML = "";

  if (uploadedFile.type.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(uploadedFile);
    img.alt = "File preview";
    modalContent.appendChild(img);
  } else if (uploadedFile.type === "application/pdf") {
    const iframe = document.createElement("iframe");
    iframe.src = URL.createObjectURL(uploadedFile);
    iframe.title = "PDF preview";
    modalContent.appendChild(iframe);
  }

  previewModal.style.display = "flex";
}

if (filePreview) {
  filePreview.onclick = openPreviewModal;
}

if (modalClose) {
  modalClose.onclick = () => {
    if (previewModal) previewModal.style.display = "none";
  };
}

window.onclick = (e) => {
  if (e.target === previewModal && previewModal) {
    previewModal.style.display = "none";
  }
};

// ============================================
// THEME TOGGLE
// ============================================

if (themeToggle) {
  themeToggle.onclick = () => {
    document.body.classList.toggle("light");
    document.body.classList.toggle("dark");
    const isDark = document.body.classList.contains("dark");

    themeToggle.innerHTML = `
      <i data-lucide="${isDark ? "sun" : "moon"}"></i>
      <span>Theme</span>
    `;

    if (window.lucide && typeof lucide.createIcons === "function") { lucide.createIcons(); }

    // Save preference
    localStorage.setItem("theme", isDark ? "dark" : "light");
    showToast(`🎨 ${isDark ? "Dark" : "Light"} theme activated`, "info");
  };

  // Load theme preference
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme) {
    document.body.classList.remove("dark", "light");
    document.body.classList.add(savedTheme);
  }
}

// ============================================
// ACTION TABS
// ============================================

function setActiveAction(target) {
  actionTabs.forEach((tab) => {
    const isActive = tab.dataset.target === target;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", isActive);
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
    if (registeredIdRow) registeredIdRow.style.display = "none";
  }
}

actionTabs.forEach((tab) => {
  tab.addEventListener("click", () => setActiveAction(tab.dataset.target));
});

// Set initial tab
setActiveAction(defaultMode);

// ============================================
// LOAD DATA FUNCTIONS
// ============================================

async function loadRegistry() {
  if (!registryTableBody) return;

  try {
    const res = await api("/api/documents");
    const docs = await res.json();

    registryTableBody.innerHTML = "";

    if (!Array.isArray(docs) || docs.length === 0) {
      registryTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-state">No documents registered yet</td>
        </tr>
      `;
      return;
    }

    docs.forEach((doc) => {
      const tr = document.createElement("tr");

      // Document ID
      const idCell = document.createElement("td");
      idCell.innerHTML = `<code class="doc-id">${doc.documentID || "-"}</code>`;

      // File Name
      const nameCell = document.createElement("td");
      nameCell.textContent = doc.fileName || "-";

      // Hash
      const hashCell = document.createElement("td");
      hashCell.innerHTML = `<code class="hash-display">${(doc.fileHash || "-").substring(0, 16)}...</code>`;
      hashCell.title = doc.fileHash || "";

      // Owner
      const ownerCell = document.createElement("td");
      ownerCell.textContent = doc.owner || "anonymous";

      // Blockchain Tx
      const txCell = document.createElement("td");
      if (doc.blockchainTx) {
        txCell.innerHTML = `
          <a href="https://sepolia.etherscan.io/tx/${doc.blockchainTx}" 
             target="_blank" 
             rel="noopener noreferrer"
             class="tx-link"
             title="${doc.blockchainTx}">
            ${doc.blockchainTx.substring(0, 10)}...
            <i data-lucide="external-link"></i>
          </a>
        `;
      } else {
        txCell.innerHTML = `<span class="badge badge-pending">Pending</span>`;
      }

      // Status
      const statusCell = document.createElement("td");
      if (doc.registered) {
        statusCell.innerHTML = `<span class="badge badge-success">✅ Registered</span>`;
      } else {
        statusCell.innerHTML = `<span class="badge badge-pending">⏳ Pending</span>`;
      }

      // Timestamp
      const tsCell = document.createElement("td");
      tsCell.textContent = formatDate(doc.timestamp);

      tr.appendChild(idCell);
      tr.appendChild(nameCell);
      tr.appendChild(hashCell);
      tr.appendChild(ownerCell);
      tr.appendChild(txCell);
      tr.appendChild(statusCell);
      tr.appendChild(tsCell);

      registryTableBody.appendChild(tr);
    });

    if (window.lucide && typeof lucide.createIcons === "function") { lucide.createIcons(); }

  } catch (error) {
    console.error("Failed to load registry:", error);
    if (registryTableBody) {
      registryTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="error-state">Failed to load registry</td>
        </tr>
      `;
    }
  }
}

async function loadHistory() {
  if (!historyList) return;

  try {
    const res = await api("/api/history");
    const events = await res.json();

    historyList.innerHTML = "";

    if (!Array.isArray(events) || events.length === 0) {
      historyList.innerHTML = `<p class="empty-state">No history yet</p>`;
      return;
    }

    events.forEach((ev) => {
      const div = document.createElement("div");
      div.className = "history-item";

      const actionLabel = ev.action === "upload_prepared" ? "Registered" :
                         ev.action === "blockchain_confirmed" ? "Confirmed" :
                         ev.action === "verify_success" ? "Verified" :
                         ev.action === "verify_failed" ? "Verification Failed" :
                         ev.action || "Action";

      const statusIcon = ev.success ? "✅" : "❌";
      const statusClass = ev.success ? "success" : "fail";

      div.innerHTML = `
        <div class="history-icon ${statusClass}">${statusIcon}</div>
        <div class="history-content">
          <div class="history-header">
            <strong>${actionLabel}</strong>
            <span class="history-time">${formatDate(ev.timestamp)}</span>
          </div>
          <div class="history-details">
            ${ev.fileName ? `<span>📄 ${ev.fileName}</span>` : ""}
            ${ev.documentID ? `<code class="doc-id">${ev.documentID.substring(0, 8)}...</code>` : ""}
          </div>
        </div>
      `;

      historyList.appendChild(div);
    });

  } catch (error) {
    console.error("Failed to load history:", error);
    if (historyList) {
      historyList.innerHTML = `<p class="error-state">Failed to load history</p>`;
    }
  }
}

async function loadStats() {
  try {
    const res = await api("/api/stats");
    const data = await res.json();

    if (statsTotalDocs) statsTotalDocs.textContent = data.total_documents ?? "0";
    if (statsTotalVerifications) statsTotalVerifications.textContent = data.total_verifications ?? "0";
    if (statsRegistered) statsRegistered.textContent = data.registered_documents ?? "0";
    if (statsLastUpdated) statsLastUpdated.textContent = new Date().toLocaleTimeString();

  } catch (error) {
    console.error("Failed to load stats:", error);
  }
}

// ============================================
// WALLET CONNECTION BUTTON
// ============================================

if (connectWalletBtn) {
  connectWalletBtn.onclick = async () => {
    await connectWallet();
  };
}

// ============================================
// REFRESH BUTTONS
// ============================================

if (refreshHistoryBtn) {
  refreshHistoryBtn.onclick = async () => {
    showToast("🔄 Refreshing history...", "info");
    await loadHistory();
    showToast("✅ History refreshed", "success");
  };
}

if (refreshRegistryBtn) {
  refreshRegistryBtn.onclick = async () => {
    showToast("🔄 Refreshing registry...", "info");
    await loadRegistry();
    showToast("✅ Registry refreshed", "success");
  };
}

// ============================================
// INITIALIZATION
// ============================================

window.addEventListener("DOMContentLoaded", async () => {
  console.info("🚀 DocChain Dashboard Initialized");

  // Load all data
  await Promise.all([
    loadRegistry(),
    loadHistory(),
    loadStats()
  ]);

  // Check for existing wallet connection
  if (isMetaMaskInstalled()) {
    try {
      const accounts = await window.ethereum.request({ 
        method: "eth_accounts" 
      });
      
      if (accounts && accounts.length > 0) {
        // Wallet already connected
        await connectWallet();
      }
    } catch (error) {
      console.warn("Could not check wallet connection:", error);
    }
  }

  // Initialize Lucide icons
  if (window.lucide) {
    try {
      if (typeof lucide.createIcons === "function") {
        lucide.createIcons();
      } else if (typeof lucide.replace === "function") {
        if (typeof lucide.createIcons === "function") {
        lucide.createIcons();
      } else if (typeof lucide.replace === "function") {
        lucide.replace();
      }
      }
    } catch (e) {
      console.warn("Lucide icon initialization failed:", e);
    }
  }

  console.info("✅ Dashboard ready");
});

// Auto-refresh stats every 30 seconds
setInterval(loadStats, 30000);
