import psycopg2
from psycopg2.extras import RealDictCursor
import os
import logging

logger = logging.getLogger(__name__)

def get_db_connection():
    """Create database connection using DATABASE_URL from environment"""
    database_url = os.environ.get('DATABASE_URL')
    
    if not database_url:
        raise ValueError("DATABASE_URL environment variable not set")
    
    # Render uses postgres:// but psycopg2 needs postgresql://
    if database_url.startswith('postgres://'):
        database_url = database_url.replace('postgres://', 'postgresql://', 1)
    
    return psycopg2.connect(database_url, cursor_factory=RealDictCursor)

def init_db():
    """Initialize database tables"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    # Create documents table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            document_id VARCHAR(255) PRIMARY KEY,
            file_name VARCHAR(500) NOT NULL,
            file_hash VARCHAR(64) NOT NULL,
            owner VARCHAR(255) DEFAULT 'anonymous',
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            blockchain_tx VARCHAR(66),
            block_number INTEGER,
            registered BOOLEAN DEFAULT FALSE,
            registered_at TIMESTAMP
        )
    """)
    
    # Create history table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS history (
            id SERIAL PRIMARY KEY,
            action VARCHAR(50) NOT NULL,
            document_id VARCHAR(255),
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            details JSONB
        )
    """)
    
    # Create index on file_hash for faster verification
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_file_hash ON documents(file_hash)
    """)
    
    conn.commit()
    cur.close()
    conn.close()
    
    logger.info("Database initialized successfully")

# Database helper functions
def save_document(doc_id, file_name, file_hash, owner="anonymous"):
    """Save document to database"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute("""
        INSERT INTO documents (document_id, file_name, file_hash, owner)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (document_id) DO UPDATE
        SET file_name = EXCLUDED.file_name,
            file_hash = EXCLUDED.file_hash,
            owner = EXCLUDED.owner
    """, (doc_id, file_name, file_hash, owner))
    
    conn.commit()
    cur.close()
    conn.close()

def get_document(doc_id):
    """Retrieve document by ID"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute("SELECT * FROM documents WHERE document_id = %s", (doc_id,))
    doc = cur.fetchone()
    
    cur.close()
    conn.close()
    
    return dict(doc) if doc else None

def get_document_by_hash(file_hash):
    """Retrieve document by hash"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute("SELECT * FROM documents WHERE file_hash = %s", (file_hash,))
    doc = cur.fetchone()
    
    cur.close()
    conn.close()
    
    return dict(doc) if doc else None

def get_all_documents():
    """Retrieve all documents"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute("SELECT * FROM documents ORDER BY uploaded_at DESC")
    docs = cur.fetchall()
    
    cur.close()
    conn.close()
    
    return [dict(doc) for doc in docs]

def update_blockchain_tx(doc_id, tx_hash, block_number):
    """Update document with blockchain transaction details"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute("""
        UPDATE documents
        SET blockchain_tx = %s,
            block_number = %s,
            registered = TRUE,
            registered_at = CURRENT_TIMESTAMP
        WHERE document_id = %s
    """, (tx_hash, block_number, doc_id))
    
    conn.commit()
    cur.close()
    conn.close()

def log_history(action, doc_id=None, details=None):
    """Log action to history table"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    import json
    cur.execute("""
        INSERT INTO history (action, document_id, details)
        VALUES (%s, %s, %s)
    """, (action, doc_id, json.dumps(details) if details else None))
    
    conn.commit()
    cur.close()
    conn.close()

def get_history(limit=50):
    """Retrieve recent history"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute("""
        SELECT * FROM history
        ORDER BY timestamp DESC
        LIMIT %s
    """, (limit,))
    
    history = cur.fetchall()
    
    cur.close()
    conn.close()
    
    return [dict(h) for h in history]

def get_stats():
    """Get statistics"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute("""
        SELECT
            COUNT(*) as total_documents,
            COUNT(CASE WHEN registered = TRUE THEN 1 END) as registered_count,
            COUNT(CASE WHEN registered = FALSE THEN 1 END) as pending_count
        FROM documents
    """)
    
    stats = cur.fetchone()
    
    cur.close()
    conn.close()
    
    return dict(stats) if stats else {}
