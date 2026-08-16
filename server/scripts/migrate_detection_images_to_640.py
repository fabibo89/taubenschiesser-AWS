#!/usr/bin/env python3
"""
Migrate old Detection documents to the 640×zoom / 640 pipeline.

For each detection:
  - original image  → square center-crop, resize to (640 * zoom)²
  - zoomed image    → square center-crop, resize to 640²
  - bbox / position → same crop+scale transform (coords are on the zoomed image)
  - image_info      → updated sizes

Also handles tapo_* / raspberry_pi_* image fields when present.

Usage (on prod host):
  pip3 install --user pymongo opencv-python-headless
  # dry-run first:
  MONGODB_URI='mongodb://USER:PASS@127.0.0.1:27017/taubenschiesser?authSource=admin' \\
    python3 server/scripts/migrate_detection_images_to_640.py --dry-run --limit 5

  # then for real:
  MONGODB_URI='...' python3 server/scripts/migrate_detection_images_to_640.py

Options:
  --dry-run     no writes
  --limit N     process at most N docs
  --skip-ok     skip docs already at target size (default on)
  --jpeg-quality Q   default 85
"""

from __future__ import annotations

import argparse
import base64
import os
import re
import sys
from typing import Any, Dict, Optional, Tuple

import cv2
import numpy as np
from pymongo import MongoClient
from pymongo.collection import Collection

DETECTION_INPUT_SIZE = 640
DATA_URL_RE = re.compile(r"^data:(image/[^;]+);base64,(.+)$", re.DOTALL | re.IGNORECASE)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--uri", default=os.environ.get("MONGODB_URI"), help="MongoDB URI")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--limit", type=int, default=0, help="0 = all")
    p.add_argument("--jpeg-quality", type=int, default=85)
    p.add_argument("--no-skip-ok", action="store_true", help="Reprocess even if already 640")
    return p.parse_args()


def decode_image(data_url: Optional[str]) -> Optional[np.ndarray]:
    if not data_url or not isinstance(data_url, str):
        return None
    m = DATA_URL_RE.match(data_url.strip())
    raw_b64 = m.group(2) if m else data_url
    try:
        raw = base64.b64decode(raw_b64, validate=False)
    except Exception:
        return None
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def encode_jpeg_data_url(img: np.ndarray, quality: int) -> Tuple[str, int]:
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
    if not ok:
        raise RuntimeError("JPEG encode failed")
    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    url = f"data:image/jpeg;base64,{b64}"
    return url, len(buf)


def center_square_crop(img: np.ndarray) -> Tuple[np.ndarray, int, int, int]:
    h, w = img.shape[:2]
    side = min(h, w)
    x0 = (w - side) // 2
    y0 = (h - side) // 2
    return img[y0 : y0 + side, x0 : x0 + side], x0, y0, side


def resize_square(img: np.ndarray, side: int) -> np.ndarray:
    if img.shape[0] == side and img.shape[1] == side:
        return img
    interp = cv2.INTER_AREA if min(img.shape[0], img.shape[1]) > side else cv2.INTER_LINEAR
    return cv2.resize(img, (side, side), interpolation=interp)


def prepare_square(img: np.ndarray, target_side: int) -> Tuple[np.ndarray, int, int, int]:
    cropped, x0, y0, side = center_square_crop(img)
    out = resize_square(cropped, target_side)
    return out, x0, y0, side


def transform_bbox(
    bbox: Optional[Dict[str, Any]],
    x0: int,
    y0: int,
    old_side: int,
    new_side: int,
) -> Optional[Dict[str, Any]]:
    if not bbox or not isinstance(bbox, dict):
        return bbox
    scale = new_side / float(old_side)
    out = dict(bbox)
    if out.get("x") is not None:
        out["x"] = max(0.0, min(float(new_side), (float(out["x"]) - x0) * scale))
    if out.get("y") is not None:
        out["y"] = max(0.0, min(float(new_side), (float(out["y"]) - y0) * scale))
    if out.get("width") is not None:
        out["width"] = float(out["width"]) * scale
    if out.get("height") is not None:
        out["height"] = float(out["height"]) * scale
    return out


def transform_position(
    pos: Optional[Dict[str, Any]],
    x0: int,
    y0: int,
    old_side: int,
    new_side: int,
) -> Optional[Dict[str, Any]]:
    if not pos or not isinstance(pos, dict):
        return pos
    scale = new_side / float(old_side)
    out = dict(pos)
    if out.get("center_x") is not None:
        out["center_x"] = (float(out["center_x"]) - x0) * scale
    if out.get("center_y") is not None:
        out["center_y"] = (float(out["center_y"]) - y0) * scale
    if out.get("width") is not None:
        out["width"] = float(out["width"]) * scale
    if out.get("height") is not None:
        out["height"] = float(out["height"]) * scale
    return out


def transform_detection_list(items, x0, y0, old_side, new_side):
    if not items:
        return items
    out = []
    for d in items:
        if not isinstance(d, dict):
            out.append(d)
            continue
        nd = dict(d)
        nd["bbox"] = transform_bbox(nd.get("bbox"), x0, y0, old_side, new_side)
        nd["position"] = transform_position(nd.get("position"), x0, y0, old_side, new_side)
        out.append(nd)
    return out


def already_ok(w: int, h: int, target: int) -> bool:
    return abs(w - target) <= 1 and abs(h - target) <= 1


def migrate_image_field(
    doc: Dict[str, Any],
    field: str,
    target_side: int,
    quality: int,
    skip_ok: bool,
) -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[int, int]], bool]:
    """Returns (new_image_obj_or_None, (old_w, old_h)_or_None, changed)."""
    obj = doc.get(field)
    if not obj or not isinstance(obj, dict) or not obj.get("url"):
        return None, None, False
    img = decode_image(obj["url"])
    if img is None:
        return None, None, False
    h, w = img.shape[:2]
    if skip_ok and already_ok(w, h, target_side):
        return None, (w, h), False
    out_img, _x0, _y0, _side = prepare_square(img, target_side)
    url, nbytes = encode_jpeg_data_url(out_img, quality)
    new_obj = {
        "url": url,
        "filename": obj.get("filename") or f"{field}.jpg",
        "size": nbytes,
    }
    return new_obj, (w, h), True


def process_doc(doc: Dict[str, Any], quality: int, skip_ok: bool) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Return (update_fields, stats)."""
    zoom = float(doc.get("zoom_factor") or 1.0)
    zoom = max(1.0, zoom)
    working_side = max(DETECTION_INPUT_SIZE, int(round(DETECTION_INPUT_SIZE * zoom)))
    zoomed_side = DETECTION_INPUT_SIZE

    updates: Dict[str, Any] = {}
    stats = {
        "id": str(doc.get("_id")),
        "zoom": zoom,
        "working_side": working_side,
        "changed_images": [],
        "scaled_boxes": False,
        "skipped": False,
    }

    zoomed_old_size = None
    zoomed_resized = False

    for field, side, is_zoomed in (
        ("zoomed_image", zoomed_side, True),
        ("image", working_side, False),
        ("tapo_zoomed_image", zoomed_side, True),
        ("tapo_image", working_side, False),
        ("raspberry_pi_zoomed_image", zoomed_side, True),
        ("raspberry_pi_image", working_side, False),
    ):
        new_obj, old_size, changed = migrate_image_field(doc, field, side, quality, skip_ok)
        if old_size and is_zoomed and zoomed_old_size is None:
            zoomed_old_size = old_size
        if changed and new_obj is not None:
            updates[field] = new_obj
            stats["changed_images"].append(f"{field}:{side}")
            if is_zoomed:
                zoomed_resized = True

    # Fallback: boxes live on `image` when no zoomed_image
    if zoomed_old_size is None and (doc.get("image") or {}).get("url"):
        img = decode_image(doc["image"]["url"])
        if img is not None:
            zoomed_old_size = (img.shape[1], img.shape[0])
            if "image" in updates:
                zoomed_resized = True

    if not updates:
        stats["skipped"] = True
        return updates, stats

    if zoomed_resized and zoomed_old_size:
        old_w, old_h = zoomed_old_size
        if not already_ok(old_w, old_h, zoomed_side):
            x0 = (old_w - min(old_w, old_h)) // 2
            y0 = (old_h - min(old_w, old_h)) // 2
            old_side = min(old_w, old_h)
            if "detections" in doc:
                updates["detections"] = transform_detection_list(
                    doc.get("detections"), x0, y0, old_side, zoomed_side
                )
                stats["scaled_boxes"] = True
            if doc.get("target_bird"):
                tb = dict(doc["target_bird"])
                tb["bbox"] = transform_bbox(tb.get("bbox"), x0, y0, old_side, zoomed_side)
                tb["position"] = transform_position(tb.get("position"), x0, y0, old_side, zoomed_side)
                updates["target_bird"] = tb
                stats["scaled_boxes"] = True

    info = dict(doc.get("image_info") or {})
    info["original_size"] = {"width": working_side, "height": working_side}
    info["zoomed_size"] = {"width": zoomed_side, "height": zoomed_side}
    updates["image_info"] = info

    return updates, stats


def main() -> int:
    args = parse_args()
    if not args.uri:
        print("MONGODB_URI / --uri required", file=sys.stderr)
        return 1

    # host.docker.internal → 127.0.0.1 when running on the host
    uri = args.uri.replace("host.docker.internal", "127.0.0.1")
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    db = client.get_default_database()
    if db is None or db.name == "test":
        # URI path may be missing; force taubenschiesser
        db = client["taubenschiesser"]
    col: Collection = db["detections"]

    # Candidates: anything whose zoomed or original reports large size, or missing size
    query: Dict[str, Any] = {
        "$or": [
            {"image_info.zoomed_size.width": {"$gt": DETECTION_INPUT_SIZE + 1}},
            {"image_info.original_size.width": {"$gt": DETECTION_INPUT_SIZE + 1}},
            {"image_info.zoomed_size.width": {"$exists": False}},
            {"zoomed_image.url": {"$exists": True}},
            {"image.url": {"$exists": True}},
        ]
    }

    cursor = col.find(query).sort("processedAt", -1)
    if args.limit and args.limit > 0:
        cursor = cursor.limit(args.limit)

    processed = 0
    updated = 0
    skipped = 0
    errors = 0
    bytes_before = 0
    bytes_after = 0

    print(f"DB={db.name} dry_run={args.dry_run} limit={args.limit or 'all'}")

    for doc in cursor:
        processed += 1
        try:
            # rough size before
            for f in ("image", "zoomed_image", "tapo_image", "tapo_zoomed_image",
                      "raspberry_pi_image", "raspberry_pi_zoomed_image"):
                obj = doc.get(f) or {}
                if isinstance(obj.get("size"), (int, float)):
                    bytes_before += int(obj["size"])

            updates, stats = process_doc(doc, args.jpeg_quality, skip_ok=not args.no_skip_ok)
            if stats["skipped"] or not updates:
                skipped += 1
                if processed <= 5 or processed % 50 == 0:
                    print(f"[{processed}] skip {stats['id']}")
                continue

            for f in ("image", "zoomed_image", "tapo_image", "tapo_zoomed_image",
                      "raspberry_pi_image", "raspberry_pi_zoomed_image"):
                if f in updates and isinstance(updates[f].get("size"), (int, float)):
                    bytes_after += int(updates[f]["size"])

            print(
                f"[{processed}] {'DRY ' if args.dry_run else ''}update {stats['id']} "
                f"zoom={stats['zoom']:g} images={stats['changed_images']} "
                f"boxes={stats['scaled_boxes']}"
            )

            if not args.dry_run:
                col.update_one({"_id": doc["_id"]}, {"$set": updates})
            updated += 1
        except Exception as e:
            errors += 1
            print(f"[{processed}] ERROR {doc.get('_id')}: {e}", file=sys.stderr)

    print(
        f"Done. processed={processed} updated={updated} skipped={skipped} errors={errors} "
        f"bytes_meta_before≈{bytes_before/1e6:.1f}MB bytes_meta_after≈{bytes_after/1e6:.1f}MB"
    )
    if args.dry_run:
        print("Dry-run only — no changes written.")
    return 0 if errors == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
