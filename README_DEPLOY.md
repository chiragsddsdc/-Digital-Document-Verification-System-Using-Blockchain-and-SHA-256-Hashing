# Deploy Guide — digital-document-verification

Project path (local): /mnt/data/project/digital-document-verification

## Quick local run
1. Create venv and install:
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt

2. Set env vars for local testing (example):
   export INFURA_URL="https://sepolia.infura.io/v3/<YOUR_KEY>"
   export CONTRACT_ADDRESS="0x30bF45869588B6C3f10320C1C1D0db41D29e17BD"
   export ACCOUNT_ADDRESS="0x076db2ab3a15368e1692711715c956f0aaebd223"
   # OPTIONAL (test only): export PRIVATE_KEY="<your_test_private_key>"

3. Run:
   python app.py
   # or
   gunicorn app:app

## Deploy backend to Render (free)
1. Push repo to GitHub.
2. On render.com: New → Web Service → Connect repo.
3. Build Command: (leave blank)
4. Start Command: gunicorn app:app
5. Set Environment Variables on Render:
   - INFURA_URL
   - CONTRACT_ADDRESS
   - ACCOUNT_ADDRESS
   - PRIVATE_KEY (only if absolutely needed; use test account)
6. Deploy and note the HTTPS URL (e.g. https://your-app.onrender.com).

## Deploy frontend to Netlify (free)
1. If frontend is static (html/js/css), in Netlify choose "Import from Git" and select the repo.
2. Set publish directory to 'frontend' (or 'frontend/build' if you run a build step).
3. Add any build environment variables if your frontend reads them at build time:
   - REACT_APP_API_URL (if your frontend is React)
4. Deploy.

## Notes / Gotchas
- File-based DBs (hash_db.json, history_db.json) are ephemeral on many hosts. Use a DB if persistence required.
- Avoid storing production private keys on server.
- CORS: app uses flask-cors to allow cross origin requests. Ensure proper origins in production.
- Local path of this project on host where files were extracted: /mnt/data/project/digital-document-verification

