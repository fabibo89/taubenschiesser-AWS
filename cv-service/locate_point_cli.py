#!/usr/bin/env python3
"""CLI for FOV calibration image matching. stdin JSON -> stdout JSON.
Needs only opencv-python + numpy (no FastAPI/boto3).
"""
import sys
import json
import base64
from typing import Optional, Tuple

import cv2
import numpy as np


def decode_b64(image_b64: str) -> Optional[np.ndarray]:
    if not image_b64:
        return None
    raw = image_b64
    if "," in raw and raw.strip().startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        data = base64.b64decode(raw)
        arr = np.frombuffer(data, np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except Exception:
        return None


def locate_orb(ref, live, px, py):
    gray_r = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY)
    gray_l = cv2.cvtColor(live, cv2.COLOR_BGR2GRAY)
    orb = cv2.ORB_create(2500)
    kp1, des1 = orb.detectAndCompute(gray_r, None)
    kp2, des2 = orb.detectAndCompute(gray_l, None)
    if des1 is None or des2 is None or len(kp1) < 12 or len(kp2) < 12:
        return None
    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
    knn = bf.knnMatch(des1, des2, k=2)
    good = []
    for pair in knn:
        if len(pair) != 2:
            continue
        m, n = pair
        if m.distance < 0.75 * n.distance:
            good.append(m)
    if len(good) < 12:
        return None
    src = np.float32([kp1[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kp2[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    aff, inliers = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=3.0)
    if aff is None:
        H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
        if H is None:
            return None
        pt = cv2.perspectiveTransform(np.float32([[[px, py]]]), H)[0][0]
        inl = int(np.sum(mask)) if mask is not None else 0
        return float(pt[0]), float(pt[1]), float(inl / max(1, len(good))), "orb-homography", len(good)
    pt = aff @ np.array([px, py, 1.0], dtype=np.float64)
    inl = int(np.sum(inliers)) if inliers is not None else 0
    return float(pt[0]), float(pt[1]), float(inl / max(1, len(good))), "orb-affine", len(good)


def locate_template(ref, live, px, py):
    h, w = ref.shape[:2]
    lh, lw = live.shape[:2]
    side = max(64, int(min(w, h, 220)))
    half = side // 2
    cx, cy = int(round(px)), int(round(py))
    x0 = max(0, min(w - side, cx - half))
    y0 = max(0, min(h - side, cy - half))
    patch = ref[y0:y0 + side, x0:x0 + side]
    if patch.size == 0 or lh < side or lw < side:
        return None
    live_r = live if (lh, lw) == (h, w) else cv2.resize(live, (w, h), interpolation=cv2.INTER_AREA)
    res = cv2.matchTemplate(
        cv2.cvtColor(live_r, cv2.COLOR_BGR2GRAY),
        cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY),
        cv2.TM_CCOEFF_NORMED,
    )
    _, max_val, _, max_loc = cv2.minMaxLoc(res)
    live_x = max_loc[0] + (cx - x0)
    live_y = max_loc[1] + (cy - y0)
    if (lh, lw) != (h, w):
        live_x *= lw / w
        live_y *= lh / h
    return float(live_x), float(live_y), float(max_val), "template", 1


def main():
    req = json.load(sys.stdin)
    ref = decode_b64(req.get("referenceImage") or req.get("reference_image") or "")
    live = decode_b64(req.get("liveImage") or req.get("live_image") or "")
    point = req.get("point") or {}
    px = float(point.get("x"))
    py = float(point.get("y"))
    if ref is None or live is None:
        json.dump({"success": False, "error": "referenceImage und liveImage erforderlich", "confidence": 0}, sys.stdout)
        return
    rh, rw = ref.shape[:2]
    lh, lw = live.shape[:2]
    live_for_orb = live if (lh, lw) == (rh, rw) else cv2.resize(live, (rw, rh), interpolation=cv2.INTER_AREA)
    result = locate_orb(ref, live_for_orb, px, py)
    tmpl = locate_template(ref, live, px, py)
    # Prefer the higher-confidence method; template is often more stable for small aim residuals
    if tmpl is not None and (result is None or tmpl[2] >= (result[2] if result else 0)):
        result = tmpl
    elif result is not None and result[2] < 0.2:
        result = tmpl if tmpl is not None else result
    if result is None:
        json.dump({"success": False, "error": "Kein zuverlässiger Bildabgleich", "confidence": 0}, sys.stdout)
        return
    live_x, live_y, conf, method, match_count = result
    if method.startswith("orb") and (lh, lw) != (rh, rw):
        live_x *= lw / rw
        live_y *= lh / rh
    live_x = float(np.clip(live_x, 0, lw - 1))
    live_y = float(np.clip(live_y, 0, lh - 1))
    cx, cy = lw / 2.0, lh / 2.0
    json.dump({
        "success": True,
        "method": method,
        "confidence": conf,
        "matchCount": match_count,
        "referencePoint": {"x": px, "y": py},
        "livePoint": {"x": live_x, "y": live_y},
        "liveSize": {"width": lw, "height": lh},
        "referenceSize": {"width": rw, "height": rh},
        "residualPx": {"x": live_x - cx, "y": live_y - cy},
        "residualNorm": {"x": (live_x - cx) / lw, "y": (live_y - cy) / lh},
        "normLive": {"x": live_x / lw, "y": live_y / lh},
    }, sys.stdout)


if __name__ == "__main__":
    main()
