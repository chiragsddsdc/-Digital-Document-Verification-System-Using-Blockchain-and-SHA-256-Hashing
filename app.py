# app.py (production-ready for Render)
from flask import Flask, request, jsonify, render_template, send_from_directory
from flasgger import Swagger
import hashlib, os, json, time, uuid, logging
from datetime import datetime
from werkzeug.utils import secure_filename
from web3 import Web3
from flask_cors import CORS

# Blockchain Configuration
INFURA_URL = os.environ.get("INFURA_URL", "https://sepolia.infura.io/v3/ed3f3c74898d44e68271420d800d9709")
CONTRACT_ADDRESS_RAW = os.environ.get("CONTRACT_ADDRESS", "0x30bF45869588B6C3f10320C1C1D0db41D29e17BD")
ACCOUNT_ADDRESS_RAW = os.environ.get("ACCOUNT_ADDRESS", "0x076db2ab3a15368e1692711715c956f0aaebd223")

w3 = Web3(Web3.HTTPProvider(INFURA_URL))
CONTRACT_ADDRESS = Web3.to_checksum_address(CONTRACT_ADDRESS_RAW)
ACCOUNT_ADDRESS = Web3.to_checksum_address(ACCOUNT_ADDRESS_RAW)

# Load ABI
ABI_FILE = "contract_abi.json"
CONTRACT_ABI = None
if os.path.exists(ABI_FILE):
    try:
        with open(ABI_FILE, "r") as f:
            CONTRACT_ABI = json.load(f)
    except Exception as e:
        CONTRACT_ABI = None

# Flask App Setup
app = Flask(__name__, template_folder="frontend", static_folder="frontend", static_url_path='')
swagger = Swagger(app)

# CORS Configuration
CORS(app, resources={
    r"/*": {
        "origins": "*",
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

UPLOAD_FOLDER = "uploads"
DB_FILE = "hash_db.json"
HISTORY_FILE = "history_db.json"

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs("temp", exist_ok=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Security Headers
@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    
    # Relaxed CSP for Web3 compatibility
    csp = (
        "default-src 'self' 'unsafe-inline' 'unsafe-eval'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.ethers.io https://*.infura.io; "
        "style-src 'self' 'unsafe-inline' https://unpkg.com; "
        "img-src 'self' data: blob: https:; "
        "font-src 'self' https://unpkg.com data:; "
        "connect-src 'self' https: wss: ws: https://*.infura.io https://sepolia.infura.io; "
        "frame-src 'self' blob:; "
    )
    response.headers["Content-Security-Policy"] = csp
    
    return response

# Serve static files explicitly
@app.route('/style.css')
def serve_css():
    return send_from_directory('frontend', 'style.css', mimetype='text/css')

@app.route('/script.js')
def serve_js():
    return send_from_directory('frontend', 'script.js', mimetype='application/javascript')

# OPTIONS handler for CORS preflight
@app.route("/<path:path>", methods=["OPTIONS"])
def handle_options(path):
    return jsonify({"status": "ok"}), 200

# Database functions
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

# History functions
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

# PAGE ROUTES
@app.route("/")
def home():
    return render_template("index.html", active_page="workflow", default_mode="verify")

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

# API ROUTES
@app.route("/api/upload", methods=["POST"])
def upload_document():
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

        file_hash = generate_chunk_hash(file_path)
        owner = request.form.get("owner", "anonymous")
        ts_now = int(time.time())

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

        append_history({
            "timestamp": ts_now,
            "action": "register_prepare",
            "fileName": filename,
            "documentID": document_id,
            "fileHash": file_hash,
            "success": True,
            "blockchainTx": None,
        })

        logger.info(f"Uploaded & prepared: {document_id}")

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
            "message": "Frontend must call registerDocument using MetaMask"
        }), 200

    except Exception as e:
        logger.error(f"Upload error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/confirm_register", methods=["POST"])
def confirm_register():
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
        return jsonify({"error": str(e)}), 500

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
                    "message": "Hashes match"
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
                    "message": "Document tampered"
                }), 200

        # Fallback: search by hash
        for doc_id, meta in db.items():
            if (meta.get("fileHash") or "").replace("0x", "").lower() == provided_hash_norm:
                append_history({
                    "timestamp": ts_now,
                    "action": "verify",
                    "fileName": meta.get("fileName"),
                    "documentID": doc_id,
                    "fileHash": provided_hash,
                    "success": True,
                    "blockchainTx": meta.get("blockchainTx"),
                })
                return jsonify({
                    "verified": True,
                    "reason": "verified",
                    "computed_hash": provided_hash,
                    "documentID": doc_id,
                    "fileName": meta.get("fileName"),
                    "blockchain_tx": meta.get("blockchainTx"),
                    "message": "Document hash found"
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
            "message": "Hash not found"
        }), 200

    except Exception as e:
        logger.error(f"Verify error: {e}")
        return jsonify({"verified": False, "reason": "server_error", "message": str(e)}), 500

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

@app.route("/api/history", methods=["GET"])
def api_history():
    history = load_history()
    history_sorted = sorted(history, key=lambda h: h.get("timestamp", 0), reverse=True)
    return jsonify(history_sorted)

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

@app.route("/api/contract", methods=["GET"])
def api_contract():
    return jsonify({
        "contract_address": CONTRACT_ADDRESS,
        "contract_abi": CONTRACT_ABI
    })

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy", "timestamp": int(time.time())}), 200

if __name__ == "__main__":
    print("Starting Flask server")
    port = int(os.environ.get("PORT", 5000))
    debug_mode = os.environ.get("FLASK_DEBUG", "false").lower() in ("1", "true", "yes")
    app.run(debug=debug_mode, host="0.0.0.0", port=port)
