# Contributing

## Local Setup

Run the backend checks:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest
```

Run the frontend checks:

```bash
cd web
npm install
npm run build
```

## Pull Requests

- Keep geocoding algorithm changes separate from UI changes when possible.
- Do not commit virtualenvs, `node_modules`, build outputs, or generated reports.
- Document changes to CRS, grid versioning, boundary assumptions, or word-list behavior.
- Add tests for deterministic encode/decode behavior when touching the geocoding core.
