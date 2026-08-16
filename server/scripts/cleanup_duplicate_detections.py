#!/usr/bin/env python3
"""
One-shot cleanup: remove duplicate bird detections from MongoDB.

A later detection is considered a duplicate of an earlier kept one when:
  - same device
  - same camera_position (rotation + tilt)
  - processedAt within WINDOW minutes
  - at least one bird bounding box overlaps (intersection area > 0)

Keeps the earliest detection in each chain; deletes later duplicates.
Does not change how new detections are created.

Usage:
  MONGODB_URI='mongodb://...' \\
    python3 server/scripts/cleanup_duplicate_detections.py --dry-run

  MONGODB_URI='...' \\
    python3 server/scripts/cleanup_duplicate_detections.py --execute

Options:
  --dry-run           print only (default if neither flag set)
  --execute           delete duplicates
  --window-minutes N  default 5
  --device-id ID      only one device (ObjectId string)
  --limit N           stop after N deletes (0 = all)
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from bson import ObjectId
from pymongo import ASCENDING, MongoClient
from pymongo.collection import Collection

PROJECTION = {
    "_id": 1,
    "device": 1,
    "processedAt": 1,
    "camera_position": 1,
    "detections": 1,
    "target_bird": 1,
    "classification_status": 1,
    "shotFired": 1,
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--uri", default=os.environ.get("MONGODB_URI"), help="MongoDB URI")
    p.add_argument("--dry-run", action="store_true", help="Do not delete (default)")
    p.add_argument("--execute", action="store_true", help="Actually delete duplicates")
    p.add_argument("--window-minutes", type=float, default=5.0)
    p.add_argument("--device-id", default=None, help="Limit to one device ObjectId")
    p.add_argument("--limit", type=int, default=0, help="Max deletes (0 = unlimited)")
    return p.parse_args()


def to_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    return None


def position_key(doc: Dict[str, Any]) -> Optional[Tuple[int, int]]:
    cp = doc.get("camera_position") or {}
    rot = cp.get("rotation")
    tilt = cp.get("tilt")
    if rot is None or tilt is None:
        return None
    try:
        return (int(round(float(rot))), int(round(float(tilt))))
    except (TypeError, ValueError):
        return None


def bbox_dict_to_xyxy(bbox: Dict[str, Any]) -> Optional[Tuple[float, float, float, float]]:
    if not bbox or not isinstance(bbox, dict):
        return None
    try:
        x = float(bbox.get("x", 0))
        y = float(bbox.get("y", 0))
        w = float(bbox.get("width", 0))
        h = float(bbox.get("height", 0))
    except (TypeError, ValueError):
        return None
    if w <= 0 or h <= 0:
        return None
    return (x, y, x + w, y + h)


def position_to_xyxy(pos: Dict[str, Any]) -> Optional[Tuple[float, float, float, float]]:
    if not pos or not isinstance(pos, dict):
        return None
    try:
        cx = float(pos.get("center_x", 0))
        cy = float(pos.get("center_y", 0))
        w = float(pos.get("width", 0))
        h = float(pos.get("height", 0))
    except (TypeError, ValueError):
        return None
    if w <= 0 or h <= 0:
        return None
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def bird_boxes(doc: Dict[str, Any]) -> List[Tuple[float, float, float, float]]:
    boxes: List[Tuple[float, float, float, float]] = []
    tb = doc.get("target_bird")
    if isinstance(tb, dict):
        b = bbox_dict_to_xyxy(tb.get("bbox") or {}) or position_to_xyxy(tb.get("position") or {})
        if b:
            boxes.append(b)
    for d in doc.get("detections") or []:
        if not isinstance(d, dict):
            continue
        cls = (d.get("class") or "").lower()
        if cls and cls not in ("bird", "birds", "vogel", "vögel", "pigeon", "dove"):
            continue
        b = bbox_dict_to_xyxy(d.get("bbox") or {}) or position_to_xyxy(d.get("position") or {})
        if b:
            boxes.append(b)
    # de-dupe exact duplicates
    uniq = []
    seen = set()
    for b in boxes:
        key = tuple(round(v, 3) for v in b)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(b)
    return uniq


def boxes_overlap(a: Tuple[float, float, float, float], b: Tuple[float, float, float, float]) -> bool:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    return ix2 > ix1 and iy2 > iy1


def any_bird_overlap(a_boxes: List[Tuple], b_boxes: List[Tuple]) -> bool:
    for a in a_boxes:
        for b in b_boxes:
            if boxes_overlap(a, b):
                return True
    return False


def find_duplicate_ids(
    coll: Collection,
    window_sec: float,
    device_id: Optional[str],
) -> Tuple[List[ObjectId], int, int]:
    """Return (ids_to_delete, scanned_count, group_count)."""
    query: Dict[str, Any] = {
        "camera_position.rotation": {"$exists": True, "$ne": None},
        "camera_position.tilt": {"$exists": True, "$ne": None},
    }
    if device_id:
        query["device"] = ObjectId(device_id)

    cursor = coll.find(query, PROJECTION).sort(
        [("device", ASCENDING), ("processedAt", ASCENDING)]
    )

    # kept per (device, rot, tilt): list of {t, boxes, id}
    kept_by_group: Dict[Tuple[Any, int, int], List[Dict[str, Any]]] = {}
    to_delete: List[ObjectId] = []
    scanned = 0
    groups_seen = set()

    for doc in cursor:
        scanned += 1
        t = to_dt(doc.get("processedAt") or doc.get("createdAt"))
        if t is None:
            continue
        pos = position_key(doc)
        if pos is None:
            continue
        boxes = bird_boxes(doc)
        if not boxes:
            continue

        device = doc.get("device")
        group = (device, pos[0], pos[1])
        groups_seen.add(group)
        kept = kept_by_group.setdefault(group, [])

        is_dup = False
        for prev in kept:
            dt = (t - prev["t"]).total_seconds()
            if dt < 0:
                continue
            if dt > window_sec:
                continue
            if any_bird_overlap(boxes, prev["boxes"]):
                is_dup = True
                break

        if is_dup:
            to_delete.append(doc["_id"])
        else:
            kept.append({"t": t, "boxes": boxes, "id": doc["_id"]})

    return to_delete, scanned, len(groups_seen)


def main() -> int:
    args = parse_args()
    if not args.uri:
        print("MONGODB_URI / --uri required", file=sys.stderr)
        return 1
    if args.execute and args.dry_run:
        print("Use either --dry-run or --execute, not both", file=sys.stderr)
        return 1
    do_execute = bool(args.execute)
    if not do_execute:
        print("Mode: dry-run (pass --execute to delete)\n")

    window_sec = max(0.0, float(args.window_minutes) * 60.0)
    client = MongoClient(args.uri)
    # DB name from URI path, fallback
    db = client.get_default_database()
    if db is None:
        db = client["taubenschiesser"]
    coll = db["detections"]

    print(
        f"Scanning detections (window={args.window_minutes} min, "
        f"device={args.device_id or 'all'})…"
    )
    to_delete, scanned, groups = find_duplicate_ids(coll, window_sec, args.device_id)
    if args.limit and args.limit > 0:
        to_delete = to_delete[: args.limit]

    print(f"Scanned: {scanned}")
    print(f"Position groups: {groups}")
    print(f"Duplicates to remove: {len(to_delete)}")

    if not to_delete:
        print("Nothing to do.")
        return 0

    # Sample a few ids
    sample = to_delete[:10]
    print("Sample ids:", ", ".join(str(i) for i in sample))
    if len(to_delete) > 10:
        print(f"  … and {len(to_delete) - 10} more")

    if not do_execute:
        print("\nDry-run only. Re-run with --execute to delete.")
        return 0

    deleted = 0
    batch = 200
    for i in range(0, len(to_delete), batch):
        chunk = to_delete[i : i + batch]
        result = coll.delete_many({"_id": {"$in": chunk}})
        deleted += result.deleted_count
        print(f"Deleted {deleted}/{len(to_delete)}…")

    print(f"Done. Deleted {deleted} duplicate detections.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
