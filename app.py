# app.py (production-ready for Render with all security fixes)
from flask import Flask, request, jsonify, render_template, send_from_directory
from flasgger import Swagger
import hashlib, os, json, time, uuid, logging, re
from datetime import datetime
from werkzeug.utils import secure_filename
from web3 import Web3
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# ============================================
# LOAD ENVIRONMENT VARIABLES
# ============================================

# Load .env file for local development
try:
    from dotenv import load_dotenv
    load_dotenv()
    print("✅ Environment variables loaded from .env")
except ImportError:
    print("⚠️  python-dotenv not installed. Using system environment variables only.")

# ============================================
# CONFIGURATION & SECURITY
# ============================================

# Blockchain Configuration (SECURE - No hardcoded defaults)
INFURA_URL = os.environ.get("INFURA_URL")
CONTRACT_ADDRESS_RAW = os.environ.get("CONTRACT_ADDRESS")
ACCOUNT_ADDRESS_RAW = os.environ.get("ACCOUNT_ADDRESS")

# Validate required environment variables
if not INFURA_URL:
    raise ValueError("❌ INFURA_URL environment variable is required. Please set it in your Render dashboard.")
if not CONTRACT_ADDRESS_RAW:
    raise ValueError("❌ CONTRACT_ADDRESS environment variable is required.")
if not ACCOUNT_ADDRESS_RAW:
    raise ValueError("❌ ACCOUNT_ADDRESS environment variable is required.")

# Initialize Web3
try:
    w3 = Web3(Web3.HTTPProvider(INFURA_URL))
    if not w3.is_connected():
        raise ConnectionError("Cannot connect to Ethereum network")
    CONTRACT_ADDRESS = Web3.to_checksum_address(CONTRACT_ADDRESS_RAW)
    ACCOUNT_ADDRESS = Web3.to_checksum_address(ACCOUNT_ADDRESS_RAW)
    print("✅ Web3 connected successfully")
except Exception as e:
    raise ConnectionError(f"❌ Web3 initialization failed: {str(e)}")

# Load ABI
ABI_FILE = "contract_abi.json"
CONTRACT_ABI = None
if os.path.exists(ABI_FILE):
    try:
        with open(ABI_FILE, "r") as f:
            CONTRACT_ABI = json.load(f)
        print("✅ Contract ABI loaded")
    except Exception as e:
        print(f"⚠️  Failed to load contract ABI: {e}")
        CONTRACT_ABI = None

# ============================================
# FLASK APP SETUP
# ============================================

app = Flask(__name__, template_folder="frontend", static_folder="frontend", static_url_path='')

# Security Configuration
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB max file size
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', os.urandom(32).hex())

# Swagger API Documentation
swagger = Swagger(app)

# Rate Limiting
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

# CORS Configuration
CORS(app, resources={
    r"/*": {
        "origins": "*",
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

# File Configuration
UPLOAD_FOLDER = "uploads"
DB_FILE = "hash_db.json"
HISTORY_FILE = "history_db.json"
ALLOWED_EXTENSIONS = {'pdf', 'png', 'jpg', 'jpeg', 'txt', 'doc', 'docx', 'zip'}

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs("temp", exist_ok=True)

# Logging Configuration
logging.basicConfig(
    level=logging.INFO, 
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('app.log') if os.environ.get('FLASK_ENV') == 'production' else logging.NullHandler()
    ]
)
logger = logging.getLogger(__name__)

# ============================================
# SECURITY HEADERS & MIDDLEWARE
# ============================================

@app.after_request
def add_security_headers(response):
    """Add comprehensive security headers"""
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    
    # Content Security Policy (optimized for Web3)
    csp = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.ethers.io https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' https://unpkg.com; "
        "img-src 'self' data: blob: https:; "
        "font-src 'self' https://unpkg.com data:; "
        "connect-src 'self' https: wss: https://*.infura.io https://sepolia.etherscan.io; "
        "frame-src 'self' blob:; "
        "object-src 'none'; "
        "base-uri 'self'"
    )
    response.headers["Content-Security-Policy"] = csp
    
    return response

@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle file too large errors"""
    return jsonify({"error": "File too large. Maximum size is 16 MB"}), 413

@app.errorhandler(429)
def ratelimit_handler(e):
    """Handle rate limit errors"""
    return jsonify({"error": "Rate limit exceeded. Please try again later."}), 429

# ============================================
# VALIDATION FUNCTIONS
# ============================================

def validate_owner_name(owner):
    """Validate owner name to prevent XSS"""
    if not owner:
        return "anonymous"
    
    # Allow only alphanumeric, spaces, hyphens, underscores (max 50 chars)
    if not re.match(r'^[a-zA-Z0-9\s\-_]{1,50}$', owner):
        raise ValueError("Invalid owner name. Use only letters, numbers, spaces, hyphens, and underscores (max 50 chars)")
    
    return owner.strip()

def validate_document_id(doc_id):
    """Validate document ID format (UUID)"""
    if not re.match(r'^[a-f0-9\-]{36}$', doc_id):
        raise ValueError("Invalid document ID format")
    return doc_id

def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# ============================================
# DATABASE FUNCTIONS (JSON - For backward compatibility)
# ============================================

def init_db():
    """Initialize JSON database file"""
    if not os.path.exists(DB_FILE):
        with open(DB_FILE, "w") as f:
            json.dump({}, f)
        logger.info("Initialized hash_db.json")

def load_db():
    """Load database from JSON file"""
    init_db()
    try:
        with open(DB_FILE, "r") as f:
            return json.load(f)
    except json.JSONDecodeError:
        logger.warning("Failed to decode DB file, returning empty dict")
        return {}

def save_db(db):
    """Save database to JSON file"""
    with open(DB_FILE, "w") as f:
        json.dump(db, f, indent=2)

def generate_chunk_hash(file_path, chunk_size=8192):
    """Generate SHA-256 hash of file using chunked reading"""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            sha256_hash.update(chunk)
    return sha256_hash.hexdigest()

# ============================================
# HISTORY FUNCTIONS
# ============================================

def init_history():
    """Initialize history JSON file"""
    if not os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "w") as f:
            json.dump([], f)
        logger.info("Initialized history_db.json")

def load_history():
    """Load history from JSON file"""
    init_history()
    try:
        with open(HISTORY_FILE, "r") as f:
            return json.load(f)
    except json.JSONDecodeError:
        logger.warning("Failed to decode history file, returning empty list")
        return []

def save_history(history):
    """Save history to JSON file"""
    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2)

def append_history(event: dict):
    """Append event to history"""
    history = load_history()
    history.append(event)
    # Keep only last 1000 events to prevent unbounded growth
    if len(history) > 1000:
        history = history[-1000:]
    save_history(history)

# ============================================
# STATIC FILE ROUTES
# ============================================

@app.route('/style.css')
def serve_css():
    """Serve CSS file with correct MIME type"""
    return send_from_directory('frontend', 'style.css', mimetype='text/css')

@app.route('/script.js')
def serve_js():
    """Serve JavaScript file with correct MIME type"""
    return send_from_directory('frontend', 'script.js', mimetype='application/javascript')

# ============================================
# PAGE ROUTES
# ============================================

@app.route("/")
def home():
    """Home page - verify mode"""
    return render_template("index.html", active_page="workflow", default_mode="verify")

@app.route("/verify")
def verify_page():
    """Verify page"""
    return render_template("index.html", active_page="workflow", default_mode="verify")

@app.route("/register")
def register_page():
    """Register page"""
    return render_template("index.html", active_page="workflow", default_mode="register")

@app.route("/history")
def history_page():
    """History page"""
    return render_template("index.html", active_page="history", default_mode="verify")

@app.route("/registry")
def registry_page():
    """Registry page"""
    return render_template("index.html", active_page="registry", default_mode="verify")

# ============================================
# API ROUTES
# ============================================

@app.route("/api/upload", methods=["POST"])
@limiter.limit("10 per hour")
def upload_document():
    """Upload and register a document"""
    try:
        if "file" not in request.files:
            return jsonify({"error": "No file provided"}), 400

        file = request.files["file"]
        if file.filename == "":
            return jsonify({"error": "Empty filename"}), 400

        if not allowed_file(file.filename):
            return jsonify({
                "error": f"File type not allowed. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}"
            }), 400

        filename = secure_filename(file.filename)
        document_id = str(uuid.uuid4())
        file_path = os.path.join(UPLOAD_FOLDER, f"{document_id}_{filename}")
        file.save(file_path)

        file_hash = generate_chunk_hash(file_path)
        
        try:
            os.remove(file_path)
            logger.info(f"Deleted temporary file: {file_path}")
        except Exception as e:
            logger.warning(f"Failed to delete file: {e}")

        owner = request.form.get("owner", "anonymous")
        owner = validate_owner_name(owner)
        
        ts_now = int(time.time())

        db = load_db()
        db[document_id] = {
            "fileName": filename,
            "fileHash": file_hash,
            "owner": owner,
            "timestamp": ts_now,
            "blockchainTx": None,
            "blockNumber": None,
            "registered": False,
            "registeredAt": None
        }
        save_db(db)

        append_history({
            "timestamp": ts_now,
            "action": "upload_prepared",
            "fileName": filename,
            "documentID": document_id,
            "fileHash": file_hash,
            "owner": owner,
            "success": True,
            "blockchainTx": None,
        })

        logger.info(f"✅ Document uploaded and prepared: {document_id}")

        return jsonify({
            "success": True,
            "documentID": document_id,
            "fileName": filename,
            "fileHash": file_hash,
            "owner": owner,
            "timestamp": ts_now,
            "instruction": "CALL_CONTRACT_WITH_METAMASK",
            "contract_address": CONTRACT_ADDRESS,
            "contract_abi_available": CONTRACT_ABI is not None,
            "message": "File uploaded. Please complete blockchain registration via MetaMask."
        }), 200

    except ValueError as e:
        logger.warning(f"Validation error in upload: {str(e)}")
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Upload error: {str(e)}", exc_info=True)
        return jsonify({"error": "An internal server error occurred during upload"}), 500

@app.route("/api/confirm_register", methods=["POST"])
@limiter.limit("20 per hour")
def confirm_register():
    """Confirm blockchain registration"""
    try:
        data = request.get_json(force=True)
        document_id = data.get("documentID")
        blockchain_tx = data.get("blockchainTx")
        block_number = data.get("blockNumber")

        if not document_id or not blockchain_tx:
            return jsonify({"error": "documentID and blockchainTx are required"}), 400

        document_id = validate_document_id(document_id)

        db = load_db()
        meta = db.get(document_id)
        
        if not meta:
            return jsonify({"error": "Document not found in registry"}), 404

        meta["blockchainTx"] = blockchain_tx
        meta["blockNumber"] = block_number
        meta["registered"] = True
        meta["registeredAt"] = int(time.time())
        db[document_id] = meta
        save_db(db)

        append_history({
            "timestamp": int(time.time()),
            "action": "blockchain_confirmed",
            "fileName": meta.get("fileName"),
            "documentID": document_id,
            "fileHash": meta.get("fileHash"),
            "success": True,
            "blockchainTx": blockchain_tx,
            "blockNumber": block_number
        })

        logger.info(f"✅ Blockchain registration confirmed: {document_id} -> {blockchain_tx}")

        return jsonify({
            "success": True,
            "documentID": document_id,
            "blockchainTx": blockchain_tx,
            "blockNumber": block_number,
            "message": "Blockchain registration confirmed successfully"
        }), 200

    except ValueError as e:
        logger.warning(f"Validation error in confirm_register: {str(e)}")
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Confirm register error: {str(e)}", exc_info=True)
        return jsonify({"error": "An internal server error occurred"}), 500

@app.route("/verify", methods=["POST"])
@limiter.limit("100 per hour")
def verify_document():
    """Verify document"""
    try:
        if "file" not in request.files:
            return jsonify({
                "verified": False, 
                "reason": "no_file", 
                "message": "No file uploaded"
            }), 400

        file = request.files["file"]
        if file.filename == "":
            return jsonify({
                "verified": False, 
                "reason": "empty_filename", 
                "message": "Empty filename"
            }), 400

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

        document_id = (request.form.get("documentID") or 
                      request.form.get("documentId") or 
                      request.form.get("document_id"))

        if document_id:
            try:
                document_id = validate_document_id(document_id)
            except ValueError:
                return jsonify({
                    "verified": False,
                    "reason": "invalid_document_id",
                    "message": "Invalid document ID format"
                }), 400

            meta = db.get(document_id)
            if not meta:
                append_history({
                    "timestamp": ts_now,
                    "action": "verify_failed",
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
                    "action": "verify_success",
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
                    "owner": meta.get("owner"),
                    "timestamp": meta.get("timestamp"),
                    "blockchain_tx": blockchain_tx,
                    "blockNumber": meta.get("blockNumber"),
                    "message": "✅ Document verified successfully. Hashes match."
                }), 200
            else:
                append_history({
                    "timestamp": ts_now,
                    "action": "verify_failed",
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
                    "message": "⚠️ Document has been tampered with. Hash mismatch detected."
                }), 200

        for doc_id, meta in db.items():
            if (meta.get("fileHash") or "").replace("0x", "").lower() == provided_hash_norm:
                append_history({
                    "timestamp": ts_now,
                    "action": "verify_success",
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
                    "owner": meta.get("owner"),
                    "timestamp": meta.get("timestamp"),
                    "blockchain_tx": meta.get("blockchainTx"),
                    "blockNumber": meta.get("blockNumber"),
                    "message": "✅ Document found and verified by hash"
                }), 200

        append_history({
            "timestamp": ts_now,
            "action": "verify_failed",
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
            "message": "❌ Document not found in registry. Hash not recognized."
        }), 200

    except ValueError as e:
        logger.warning(f"Validation error in verify: {str(e)}")
        return jsonify({
            "verified": False, 
            "reason": "validation_error", 
            "message": str(e)
        }), 400
    except Exception as e:
        logger.error(f"Verify error: {str(e)}", exc_info=True)
        return jsonify({
            "verified": False, 
            "reason": "server_error", 
            "message": "An internal server error occurred"
        }), 500

@app.route("/api/documents", methods=["GET"])
def list_documents():
    """List all documents"""
    try:
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
                "blockNumber": meta.get("blockNumber"),
                "registered": meta.get("registered", False),
                "registeredAt": meta.get("registeredAt")
            })
        docs_sorted = sorted(docs, key=lambda d: d.get("timestamp", 0), reverse=True)
        return jsonify(docs_sorted)
    except Exception as e:
        logger.error(f"List documents error: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to retrieve documents"}), 500

@app.route("/api/history", methods=["GET"])
def api_history():
    """Get history"""
    try:
        history = load_history()
        history_sorted = sorted(history, key=lambda h: h.get("timestamp", 0), reverse=True)
        return jsonify(history_sorted)
    except Exception as e:
        logger.error(f"History error: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to retrieve history"}), 500

@app.route("/api/stats", methods=["GET"])
def stats():
    """Get stats"""
    try:
        db = load_db()
        history = load_history()
        
        total_docs = len(db)
        registered_docs = sum(1 for meta in db.values() if meta.get("registered", False))
        total_verifications = sum(1 for h in history if h.get("action") in ["verify_success", "verify_failed"])
        successful_verifications = sum(1 for h in history if h.get("action") == "verify_success")
        
        return jsonify({
            "total_documents": total_docs,
            "registered_documents": registered_docs,
            "pending_documents": total_docs - registered_docs,
            "total_verifications": total_verifications,
            "successful_verifications": successful_verifications,
            "failed_verifications": total_verifications - successful_verifications
        })
    except Exception as e:
        logger.error(f"Stats error: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to retrieve statistics"}), 500

@app.route("/api/contract", methods=["GET"])
def api_contract():
    """Get contract details"""
    return jsonify({
        "contract_address": CONTRACT_ADDRESS,
        "contract_abi": CONTRACT_ABI,
        "network": "Sepolia Testnet",
        "explorer": f"https://sepolia.etherscan.io/address/{CONTRACT_ADDRESS}"
    })

@app.route("/health", methods=["GET"])
def health():
    """Health check"""
    try:
        is_connected = w3.is_connected()
        db_accessible = os.path.exists(DB_FILE)
        
        return jsonify({
            "status": "healthy" if is_connected and db_accessible else "degraded",
            "timestamp": int(time.time()),
            "web3_connected": is_connected,
            "database_accessible": db_accessible,
            "version": "2.0.0"
        }), 200
    except Exception as e:
        return jsonify({
            "status": "unhealthy",
            "error": str(e),
            "timestamp": int(time.time())
        }), 500

@app.route("/<path:path>", methods=["OPTIONS"])
def handle_options(path):
    """Handle CORS preflight"""
    return jsonify({"status": "ok"}), 200

# ============================================
# MAIN
# ============================================

if __name__ == "__main__":
    print("=" * 50)
    print("🚀 DocChain Backend Starting...")
    print("=" * 50)
    
    print(f"✅ INFURA_URL configured")
    print(f"✅ CONTRACT_ADDRESS: {CONTRACT_ADDRESS}")
    print(f"✅ ACCOUNT_ADDRESS: {ACCOUNT_ADDRESS}")
    print(f"✅ Web3 connected: {w3.is_connected()}")
    print(f"✅ Contract ABI loaded: {CONTRACT_ABI is not None}")
    
    port = int(os.environ.get("PORT", 5000))
    debug_mode = os.environ.get("FLASK_ENV", "production") != "production"
    
    print(f"✅ Server starting on port {port}")
    print(f"✅ Debug mode: {debug_mode}")
    print(f"✅ API Documentation: http://localhost:{port}/apidocs")
    print("=" * 50)
    
    app.run(debug=debug_mode, host="0.0.0.0", port=port)
