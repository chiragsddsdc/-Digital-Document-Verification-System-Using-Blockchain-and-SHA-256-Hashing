from flask import Flask, request, jsonify, render_template, redirect, url_for, send_file
from flasgger import Swagger
import hashlib, os, json, time, uuid, logging
from datetime import datetime
from werkzeug.utils import secure_filename
from web3 import Web3
from flask_cors import CORS

# ------------------------------
# Blockchain Configuration (use ENV variables)
# ------------------------------
INFURA_URL = os.environ.get("INFURA_URL", "https://sepolia.infura.io/v3/ed3f3c74898d44e68271420d800d9709")
CONTRACT_ADDRESS_RAW = os.environ.get("CONTRACT_ADDRESS", "0x30bF45869588B6C3f10320C1C1D0db41D29e17BD")
ACCOUNT_ADDRESS_RAW = os.environ.get("ACCOUNT_ADDRESS", "0x076db2ab3a15368e1692711715c956f0aaebd223")

# NOTE: no PRIVATE_KEY used on server anymore
w3 = Web3(Web3.HTTPProvider(INFURA_URL))

CONTRACT_ADDRESS = Web3.to_checksum_address(CONTRACT_ADDRESS_RAW)
ACCOUNT_ADDRESS = Web3.to_checksum_address(ACCOUNT_ADDRESS_RAW)

# load ABI from file if present (used by /api/contract to return to frontend)
ABI_FILE = "contract_abi.json"
CONTRACT_ABI = None
if os.path.exists(ABI_FILE):
    try:
        with open(ABI_FILE, "r") as f:
            CONTRACT_ABI = json.load(f)
    except Exception as e:
        CONTRACT_ABI = None

# ------------------------------
# Flask App Setup
# ------------------------------
app = Flask(__name__, template_folder="frontend", static_folder="frontend")
swagger = Swagger(app)
CORS(app)  # allow cross-origin requests from frontend

UPLOAD_FOLDER = "uploads"
DB_FILE = "hash_db.json"
HISTORY_FILE = "history_db.json"

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs("temp", exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# ------------------------------
# Local Registry (Documents DB)
# ------------------------------

def init_db():
    if not os.path.exists(DB_FILE):
        with open(DB_FILE, "w") as f:
            json.dump({}, f)

def load_db():
    init_db()
    with open(DB_FILE, "r") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return {}

def save_db(db):
    with open(DB_FILE, "w") as f:
        json.dump(db, f, indent=2)

def generate_chunk_hash(file_path, chunk_size=8192):
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            sha256_hash.update(chunk)
    return sha256_hash.hexdigest()

# ------------------------------
# Persistent History (JSON list)
# ------------------------------

def init_history():
    if not os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "w") as f:
            json.dump([], f)

def load_history():
    init_history()
    with open(HISTORY_FILE, "r") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return []

def save_history(history):
    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2)

def append_history(event: dict):
    history = load_history()
    history.append(event)
    save_history(history)

# ------------------------------
# PAGE ROUTES (separate URLs)
# ------------------------------

@app.route("/")
def home():
    return redirect(url_for("verify_page"))

@app.route("/verify")
def verify_page():
    return render_template("index.html", active_page="workflow", default_mode="verify")

@app.route("/register")
def register_page():
    return render_template("index.html", active_page="workflow", default_mode="register")

@app.route("/history")
def history_page():
    return render_template("index.html", active_page="history", default_mode="verify")

@app.route("/registry")
def registry_page():
    return render_template("index.html", active_page="registry", default_mode="verify")

# ------------------------------
# API ROUTES
# ------------------------------

# ====== UPLOAD (Compute & store metadata; client will sign & send tx via MetaMask) ======

@app.route("/api/upload", methods=["POST"])
def upload_document():
    """
    Upload endpoint changed: server computes file hash and stores metadata locally.
    The client (browser) must perform the on-chain register transaction using MetaMask.
    """
    try:
        if "file" not in request.files:
            return jsonify({"error": "No file provided"}), 400

        file = request.files["file"]
        if file.filename == "":
            return jsonify({"error": "Empty filename"}), 400

        filename = secure_filename(file.filename)
        document_id = str(uuid.uuid4())
        file_path = os.path.join(UPLOAD_FOLDER, f"{document_id}_{filename}")
        file.save(file_path)

        # Compute file hash
        file_hash = generate_chunk_hash(file_path)
        owner = request.form.get("owner", "anonymous")
        ts_now = int(time.time())

        # Save to local document registry (NOT yet on blockchain)
        db = load_db()
        db[document_id] = {
            "fileName": filename,
            "fileHash": file_hash,
            "owner": owner,
            "timestamp": ts_now,
            "blockchainTx": None,
            "registered": False
        }
        save_db(db)

        # Save to persistent history (local)
        append_history({
            "timestamp": ts_now,
            "action": "register_prepare",
            "fileName": filename,
            "documentID": document_id,
            "fileHash": file_hash,
            "success": True,
            "blockchainTx": None,
        })

        logger.info(f"Uploaded & prepared for on-chain registration: {document_id}")

        # Return the data the frontend needs to call contract via MetaMask
        return jsonify({
            "success": True,
            "documentID": document_id,
            "fileName": filename,
            "fileHash": file_hash,
            "owner": owner,
            "timestamp": ts_now,
            "instruction": "CALL_CONTRACT_WITH_METAMASK",
            "contract_address": CONTRACT_ADDRESS,
            "contract_abi_path": "/api/contract" if CONTRACT_ABI else None,
            "message": "Frontend must call registerDocument(documentID, fileName, fileHash) using MetaMask and then call /api/confirm_register with the returned transaction hash."
        }), 200

    except Exception as e:
        logger.error(f"Upload error: {e}")
        append_history({
            "timestamp": int(time.time()),
            "action": "register_prepare",
            "fileName": request.files.get("file").filename if "file" in request.files else None,
            "documentID": None,
            "fileHash": None,
            "success": False,
            "blockchainTx": None,
            "reason": str(e),
        })
        return jsonify({"error": str(e)}), 500

# ====== Confirm register (frontend calls after MetaMask tx) ======

@app.route("/api/confirm_register", methods=["POST"])
def confirm_register():
    """
    After the frontend submits the transaction using MetaMask, it can call this endpoint
    to mark the local registry entry as registered and store the blockchain tx hash.
    Expected JSON body: { "documentID": "...", "blockchainTx": "0x..." }
    """
    try:
        data = request.get_json(force=True)
        document_id = data.get("documentID")
        blockchain_tx = data.get("blockchainTx")

        if not document_id or not blockchain_tx:
            return jsonify({"error": "documentID and blockchainTx required"}), 400

        db = load_db()
        meta = db.get(document_id)
        if not meta:
            return jsonify({"error": "documentID not found"}), 404

        meta["blockchainTx"] = blockchain_tx
        meta["registered"] = True
        db[document_id] = meta
        save_db(db)

        append_history({
            "timestamp": int(time.time()),
            "action": "register_confirm",
            "fileName": meta.get("fileName"),
            "documentID": document_id,
            "fileHash": meta.get("fileHash"),
            "success": True,
            "blockchainTx": blockchain_tx,
        })

        return jsonify({"success": True, "documentID": document_id, "blockchainTx": blockchain_tx}), 200

    except Exception as e:
        logger.error(f"confirm_register error: {e}")
        append_history({
            "timestamp": int(time.time()),
            "action": "register_confirm",
            "fileName": None,
            "documentID": None,
            "fileHash": None,
            "success": False,
            "blockchainTx": None,
            "reason": str(e),
        })
        return jsonify({"error": str(e)}), 500

# ====== VERIFY (HASH vs REGISTRY) ======

@app.route("/verify", methods=["POST"])
def verify_document():
    try:
        if "file" not in request.files:
            return jsonify({"verified": False, "reason": "no_file", "message": "No file uploaded"}), 400

        file = request.files["file"]
        if file.filename == "":
            return jsonify({"verified": False, "reason": "empty_filename", "message": "Empty filename"}), 400

        temp_path = os.path.join("temp", str(uuid.uuid4()))
        file.save(temp_path)
        provided_hash = generate_chunk_hash(temp_path)
        try:
            os.remove(temp_path)
        except Exception:
            pass

        provided_hash_norm = provided_hash.replace("0x", "").lower()
        db = load_db()
        ts_now = int(time.time())

        document_id = request.form.get("documentID") or request.form.get("documentId") or request.form.get("document_id")

        if document_id:
            meta = db.get(document_id)
            if not meta:
                append_history({
                    "timestamp": ts_now,
                    "action": "verify",
                    "fileName": file.filename,
                    "documentID": document_id,
                    "fileHash": provided_hash,
                    "success": False,
                    "blockchainTx": None,
                    "reason": "not_registered"
                })
                return jsonify({
                    "verified": False,
                    "reason": "not_registered",
                    "computed_hash": provided_hash,
                    "documentID": document_id,
                    "message": "Document ID not found in registry"
                }), 200

            stored_hash = (meta.get("fileHash") or "").replace("0x", "").lower()
            blockchain_tx = meta.get("blockchainTx")

            if stored_hash == provided_hash_norm:
                append_history({
                    "timestamp": ts_now,
                    "action": "verify",
                    "fileName": meta.get("fileName"),
                    "documentID": document_id,
                    "fileHash": provided_hash,
                    "success": True,
                    "blockchainTx": blockchain_tx,
                })
                return jsonify({
                    "verified": True,
                    "reason": "verified",
                    "computed_hash": provided_hash,
                    "stored_hash": meta.get("fileHash"),
                    "documentID": document_id,
                    "fileName": meta.get("fileName"),
                    "blockchain_tx": blockchain_tx,
                    "message": "Hashes match for given document ID"
                }), 200
            else:
                append_history({
                    "timestamp": ts_now,
                    "action": "verify",
                    "fileName": meta.get("fileName"),
                    "documentID": document_id,
                    "fileHash": provided_hash,
                    "success": False,
                    "blockchainTx": blockchain_tx,
                    "reason": "tampered"
                })
                return jsonify({
                    "verified": False,
                    "reason": "tampered",
                    "computed_hash": provided_hash,
                    "stored_hash": meta.get("fileHash"),
                    "documentID": document_id,
                    "fileName": meta.get("fileName"),
                    "blockchain_tx": blockchain_tx,
                    "message": "Document ID found but hash does not match (tampering detected)"
                }), 200

        # fallback: search for matching hash in registry
        matched_doc_id = None
        matched_meta = None

        for doc_id, meta in db.items():
            if (meta.get("fileHash") or "").replace("0x", "").lower() == provided_hash_norm:
                matched_doc_id = doc_id
                matched_meta = meta
                break

        if matched_doc_id:
            append_history({
                "timestamp": ts_now,
                "action": "verify",
                "fileName": matched_meta.get("fileName"),
                "documentID": matched_doc_id,
                "fileHash": provided_hash,
                "success": True,
                "blockchainTx": matched_meta.get("blockchainTx"),
            })
            return jsonify({
                "verified": True,
                "reason": "verified",
                "computed_hash": provided_hash,
                "documentID": matched_doc_id,
                "fileName": matched_meta.get("fileName"),
                "blockchain_tx": matched_meta.get("blockchainTx"),
                "message": "Document hash found in registry"
            }), 200

        append_history({
            "timestamp": ts_now,
            "action": "verify",
            "fileName": file.filename,
            "documentID": None,
            "fileHash": provided_hash,
            "success": False,
            "blockchainTx": None,
            "reason": "not_registered"
        })

        return jsonify({
            "verified": False,
            "reason": "not_registered",
            "computed_hash": provided_hash,
            "message": "Hash not found in registry"
        }), 200

    except Exception as e:
        logger.error(f"Verify error: {e}")
        append_history({
            "timestamp": int(time.time()),
            "action": "verify",
            "fileName": request.files.get("file").filename if "file" in request.files else None,
            "documentID": None,
            "fileHash": None,
            "success": False,
            "blockchainTx": None,
            "reason": str(e),
        })
        return jsonify({"verified": False, "reason": "server_error", "message": str(e)}), 500

# ====== REGISTRY LIST (for table) ======

@app.route("/api/documents", methods=["GET"])
def list_documents():
    db = load_db()
    docs = []
    for doc_id, meta in db.items():
        docs.append({
            "documentID": doc_id,
            "fileName": meta.get("fileName"),
            "fileHash": meta.get("fileHash"),
            "owner": meta.get("owner"),
            "timestamp": meta.get("timestamp"),
            "blockchainTx": meta.get("blockchainTx"),
            "registered": meta.get("registered", False)
        })
    return jsonify(docs)

# ====== HISTORY API ======

@app.route("/api/history", methods=["GET"])
def api_history():
    history = load_history()
    history_sorted = sorted(history, key=lambda h: h.get("timestamp", 0), reverse=True)
    return jsonify(history_sorted)

# ====== STATS ======

@app.route("/api/stats", methods=["GET"])
def stats():
    db = load_db()
    history = load_history()
    total_docs = len(db)
    total_verifications = sum(1 for h in history if h.get("action") == "verify")
    return jsonify({
        "total_documents": total_docs,
        "total_verifications": total_verifications,
    })

# ====== CONTRACT ABI endpoint ======
@app.route("/api/contract", methods=["GET"])
def api_contract():
    """
    Returns contract address and ABI for the frontend to use with web3/MetaMask.
    """
    return jsonify({
        "contract_address": CONTRACT_ADDRESS,
        "contract_abi": CONTRACT_ABI
    })

if __name__ == "__main__":
    print("Starting DocChain (prepare-only backend). No server-side signing.")
    port = int(os.environ.get("PORT", 5000))
    debug_mode = os.environ.get("FLASK_DEBUG", "false").lower() in ("1", "true", "yes")
    app.run(debug=debug_mode, host="0.0.0.0", port=port)
