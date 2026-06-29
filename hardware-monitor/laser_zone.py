"""Shoot zone helpers – laser uses a free polygon; audio is per route point."""

from typing import Any, Dict, List, Optional, Tuple


DEFAULT_POLYGON_POINTS: List[Dict[str, float]] = [
    {"x": 0.25, "y": 0.25},
    {"x": 0.75, "y": 0.25},
    {"x": 0.75, "y": 0.75},
    {"x": 0.25, "y": 0.75},
]

MIN_POLYGON_POINTS = 3
MAX_POLYGON_POINTS = 24


def _clamp_point(point: Dict[str, Any]) -> Dict[str, float]:
    return {
        "x": max(0.0, min(1.0, float(point.get("x", 0)))),
        "y": max(0.0, min(1.0, float(point.get("y", 0)))),
    }


def _clamp_polygon_points(points: Optional[List[Dict[str, Any]]]) -> List[Dict[str, float]]:
    if not isinstance(points, list) or len(points) < MIN_POLYGON_POINTS:
        return [dict(p) for p in DEFAULT_POLYGON_POINTS]
    return [_clamp_point(p if isinstance(p, dict) else {}) for p in points[:MAX_POLYGON_POINTS]]


def _rect_to_polygon_points(x: float, y: float, width: float, height: float) -> List[Dict[str, float]]:
    return _clamp_polygon_points([
        {"x": x, "y": y},
        {"x": x + width, "y": y},
        {"x": x + width, "y": y + height},
        {"x": x, "y": y + height},
    ])


def _is_laser_restriction_active(zone: Dict[str, Any]) -> bool:
    if "laserEnabled" in zone:
        return bool(zone.get("laserEnabled"))
    return zone.get("enabled", True) is not False


def normalize_laser_zone(zone: Optional[Dict]) -> Optional[Dict[str, Any]]:
    if not zone or not isinstance(zone, dict):
        return None

    laser_enabled = zone.get("laserEnabled") if "laserEnabled" in zone else zone.get("enabled", True)
    laser_enabled = laser_enabled is not False
    points: Optional[List[Dict[str, float]]] = None

    raw_points = zone.get("points")
    if isinstance(raw_points, list) and len(raw_points) >= MIN_POLYGON_POINTS:
        try:
            parsed = [{"x": float(p.get("x")), "y": float(p.get("y"))} for p in raw_points if isinstance(p, dict)]
            if len(parsed) >= MIN_POLYGON_POINTS:
                points = _clamp_polygon_points(parsed)
        except (TypeError, ValueError):
            points = None

    if not points:
        try:
            x = float(zone.get("x", 0))
            y = float(zone.get("y", 0))
            width = float(zone.get("width", 0))
            height = float(zone.get("height", 0))
        except (TypeError, ValueError):
            return None
        if not all(map(lambda v: v == v, (x, y, width, height))):
            return None
        points = _rect_to_polygon_points(
            max(0.0, min(1.0, x)),
            max(0.0, min(1.0, y)),
            max(0.01, min(1.0, width)),
            max(0.01, min(1.0, height)),
        )

    return {
        "enabled": laser_enabled,
        "laserEnabled": laser_enabled,
        "shape": "polygon",
        "points": points,
    }


def is_point_in_polygon(norm_x: float, norm_y: float, points: List[Dict[str, float]]) -> bool:
    polygon = _clamp_polygon_points(points)
    inside = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        yi = polygon[i]["y"]
        yj = polygon[j]["y"]
        xi = polygon[i]["x"]
        xj = polygon[j]["x"]
        intersects = (yi > norm_y) != (yj > norm_y) and norm_x < (
            (xj - xi) * (norm_y - yi) / (yj - yi + 1e-7) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def bbox_center_to_normalized(
    bbox: Dict[str, Any],
    zoom_factor: float,
    original_width: float,
    original_height: float,
) -> Optional[Tuple[float, float]]:
    if not bbox or not original_width or not original_height:
        return None
    zoom = max(1.0, float(zoom_factor or 1.0))
    w = float(original_width)
    h = float(original_height)
    wz = w / zoom
    hz = h / zoom
    start_x = (w - wz) / 2.0
    start_y = (h - hz) / 2.0
    cx = start_x + float(bbox.get("x", 0)) + float(bbox.get("width", 0)) / 2.0
    cy = start_y + float(bbox.get("y", 0)) + float(bbox.get("height", 0)) / 2.0
    return cx / w, cy / h


def is_bird_in_zone(
    target_bird: Optional[Dict],
    zone: Dict[str, Any],
    zoom_factor: float,
    original_width: float,
    original_height: float,
) -> bool:
    bbox = target_bird.get("bbox") if isinstance(target_bird, dict) else None
    if not bbox:
        return False
    center = bbox_center_to_normalized(bbox, zoom_factor, original_width, original_height)
    if not center:
        return False
    return is_point_in_polygon(center[0], center[1], zone["points"])


def _get_original_dimensions(image_info: Optional[Dict]) -> Tuple[Optional[float], Optional[float]]:
    info = image_info if isinstance(image_info, dict) else {}
    orig_size = info.get("original_size") or info.get("originalSize") or {}
    orig_w = orig_size.get("width")
    orig_h = orig_size.get("height")
    return orig_w, orig_h


def resolve_shoot_use_laser(
    taubenschiesser: Optional[Dict],
    route_coordinate: Optional[Dict],
    target_bird: Optional[Dict],
    zoom_factor: float,
    image_info: Optional[Dict],
) -> bool:
    config = taubenschiesser if isinstance(taubenschiesser, dict) else {}
    global_laser = config.get("shootUseLaser", True)
    if global_laser is None:
        global_laser = True
    if not global_laser:
        return False

    laser_zone = route_coordinate.get("laserZone") if isinstance(route_coordinate, dict) else None
    zone = normalize_laser_zone(laser_zone)
    if not zone or not _is_laser_restriction_active(zone):
        return True

    orig_w, orig_h = _get_original_dimensions(image_info)
    if not orig_w or not orig_h:
        return False

    return is_bird_in_zone(target_bird, zone, zoom_factor, float(orig_w), float(orig_h))


def resolve_shoot_use_audio(
    taubenschiesser: Optional[Dict],
    route_coordinate: Optional[Dict],
) -> bool:
    config = taubenschiesser if isinstance(taubenschiesser, dict) else {}
    if not bool(config.get("shootUseAudio", False)):
        return False
    return resolve_route_point_audio_enabled(route_coordinate)


def resolve_shoot_actions_for_detection(
    taubenschiesser: Optional[Dict],
    route_coordinate: Optional[Dict],
    target_bird: Optional[Dict],
    shot_fired: bool,
    image_info: Optional[Dict],
    zoom_factor: float,
) -> Dict[str, bool]:
    """Water/laser/audio flags as they would be sent on shoot for this detection."""
    if not shot_fired:
        return {"water": False, "laser": False, "audio": False}
    use_laser = resolve_shoot_use_laser(
        taubenschiesser, route_coordinate, target_bird, zoom_factor, image_info
    )
    use_audio = resolve_shoot_use_audio(taubenschiesser, route_coordinate)
    return {"water": True, "laser": use_laser, "audio": use_audio}


def resolve_route_point_audio_enabled(route_coordinate: Optional[Dict]) -> bool:
    if not isinstance(route_coordinate, dict):
        return False
    if route_coordinate.get("audioEnabled") is True:
        return True
    laser_zone = route_coordinate.get("laserZone")
    if isinstance(laser_zone, dict) and laser_zone.get("audioEnabled") is True:
        return True
    return False
