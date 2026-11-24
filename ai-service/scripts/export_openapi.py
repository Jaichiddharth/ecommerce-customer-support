"""Write the API contract to docs/openapi.json (import into Postman, Insomnia, Swagger UI or a client generator).

    python -m scripts.export_openapi
"""
import json
from pathlib import Path

from app.main import app

out = Path(__file__).resolve().parent.parent / "docs" / "openapi.json"
spec = app.openapi()
spec["components"]["securitySchemes"] = {"serviceToken": {"type": "http", "scheme": "bearer",
                                                          "description": "SERVICE_TOKEN shared with the Next.js app"}}
spec["security"] = [{"serviceToken": []}]
out.write_text(json.dumps(spec, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"wrote {out} ({len(spec['paths'])} paths, version {spec['info']['version']})")
