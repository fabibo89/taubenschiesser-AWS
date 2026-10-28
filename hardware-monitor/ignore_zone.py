"""Ignore zones on route points — drop detections whose center falls inside."""

from typing import Any, Dict, List, Optional, Tuple

from laser_zone import (
    bbox_center_to_normalized,
    is_point_in_polygon,
    normalize_laser_zone,
)


def normalize_ignore_zone(zone: Optional[Dict]) -> Optional[Dict[str, Any]]:
    """Reuse laser-zone normalization (polygon points 0–1); ignore laser flags."""
    if not zone or not isinstance(zone, dict):
        return None
    if zone.get("enabled") is False:
        return None
    # Shape as laser zone so normalize_laser_zone accepts points / rect
    shaped = {
        "enabled": True,
        "laserEnabled": True,
        "points": zone.get("points"),
        "x": zone.get("x"),
        "y": zone.get("y"),
        "width": zone.get("width"),
        "height": zone.get("height"),
    }
    normalized = normalize_laser_zone(shaped)
    if not normalized:
        return None
    return {
        "enabled": True,
        "shape": "polygon",
        "points": normalized["points"],
    }


def normalize_ignore_zones(zones: Optional[List]) -> List[Dict[str, Any]]:
    if not isinstance(zones, list):
        return []
    out: List[Dict[str, Any]] = []
    for z in zones:
        n = normalize_ignore_zone(z if isinstance(z, dict) else None)
        if n:
            out.append(n)
    return out


def _detection_center_norm(
    detection: Dict[str, Any],
    zoom_factor: float,
    original_width: float,
    original_height: float,
) -> Optional[Tuple[float, float]]:
    if not isinstance(detection, dict):
        return None
    bbox = detection.get("bbox")
    if bbox:
        return bbox_center_to_normalized(bbox, zoom_factor, original_width, original_height)
    pos = detection.get("position")
    if isinstance(pos, dict) and original_width and original_height:
        try:
            cx = float(pos.get("center_x", 0)) / float(original_width)
            cy = float(pos.get("center_y", 0)) / float(original_height)
            return cx, cy
        except (TypeError, ValueError):
            return None
    return None


def is_detection_in_ignore_zones(
    detection: Dict[str, Any],
    zones: List[Dict[str, Any]],
    zoom_factor: float,
    original_width: float,
    original_height: float,
) -> bool:
    if not zones:
        return False
    center = _detection_center_norm(detection, zoom_factor, original_width, original_height)
    if not center:
        return False
    nx, ny = center
    return any(is_point_in_polygon(nx, ny, z["points"]) for z in zones)


def filter_detections_by_ignore_zones(
    detections: Optional[List],
    route_coordinate: Optional[Dict],
    zoom_factor: float,
    image_info: Optional[Dict],
) -> Tuple[List[Dict[str, Any]], int]:
    """
    Drop bird detections whose center is inside any ignore zone on the route point.
    Non-bird entries are kept. Returns (kept, dropped_count).
    """
    dets = [d for d in (detections or []) if isinstance(d, dict)]
    zones = normalize_ignore_zones(
        route_coordinate.get("ignoreZones") if isinstance(route_coordinate, dict) else None
    )
    if not zones:
        return dets, 0

    info = image_info if isinstance(image_info, dict) else {}
    orig = info.get("original_size") or info.get("originalSize") or {}
    try:
        orig_w = float(orig.get("width") or 0)
        orig_h = float(orig.get("height") or 0)
    except (TypeError, ValueError):
        orig_w, orig_h = 0.0, 0.0
    if not orig_w or not orig_h:
        # Fall back to zoomed size if original missing
        zoomed = info.get("zoomed_size") or info.get("zoomedSize") or {}
        try:
            orig_w = float(zoomed.get("width") or 0)
            orig_h = float(zoomed.get("height") or 0)
        except (TypeError, ValueError):
            return dets, 0
    if not orig_w or not orig_h:
        return dets, 0

    kept: List[Dict[str, Any]] = []
    dropped = 0
    for d in dets:
        if d.get("class") == "bird" and is_detection_in_ignore_zones(
            d, zones, zoom_factor, orig_w, orig_h
        ):
            dropped += 1
            continue
        kept.append(d)
    return kept, dropped


def get_route_coordinate_for_device(
    device: Optional[Dict],
    route_index: int,
) -> Optional[Dict]:
    if not isinstance(device, dict):
        return None
    actions = device.get("actions") or {}
    coords = (actions.get("route") or {}).get("coordinates") or []
    if not isinstance(coords, list) or route_index < 0 or route_index >= len(coords):
        return None
    c = coords[route_index]
    return c if isinstance(c, dict) else None
