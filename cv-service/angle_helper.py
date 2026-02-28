"""
ESP angle computation: same logic as hardware-monitor calculate_angle_adjustment.
Used by POST /compute-esp-angles so the UI uses the exact same formula as the shoot.
"""
import math
from typing import Dict, List, Optional, Tuple, Any


def _diagonal_fov_to_horizontal_vertical(
    diagonal_fov_deg: float, image_width: int, image_height: int
) -> Tuple[float, float]:
    """Convert diagonal FOV (degrees) to horizontal and vertical FOV using image aspect ratio."""
    if image_width <= 0 or image_height <= 0 or diagonal_fov_deg <= 0:
        return 0.0, 0.0
    d_rad = math.radians(diagonal_fov_deg)
    diag = math.sqrt(image_width ** 2 + image_height ** 2)
    half_d = math.tan(d_rad / 2)
    half_h_rad = math.atan((image_width / diag) * half_d)
    horizontal_fov_deg = math.degrees(2 * half_h_rad)
    half_v_rad = math.atan((image_height / diag) * half_d)
    vertical_fov_deg = math.degrees(2 * half_v_rad)
    return horizontal_fov_deg, vertical_fov_deg


def calculate_angle_adjustment(
    bbox: Dict,
    image_width: int,
    image_height: int,
    zoom_factor: float = 1.0,
    camera_config: Optional[Dict] = None,
    camera_source: Optional[str] = None,
) -> Tuple[float, float]:
    """
    Same logic as hardware-monitor HardwareMonitor.calculate_angle_adjustment.
    Returns (rotation_adjustment, tilt_adjustment) in degrees.
    """
    if not bbox or not camera_config:
        return 0.0, 0.0
    bbox_center_x = bbox.get('x', 0) + bbox.get('width', 0) / 2
    bbox_center_y = bbox.get('y', 0) + bbox.get('height', 0) / 2
    image_center_x = image_width / 2
    image_center_y = image_height / 2
    offset_x = bbox_center_x - image_center_x
    offset_y = bbox_center_y - image_center_y

    diagonal_fov_deg = None
    if camera_source == 'raspberry-pi':
        diagonal_fov_deg = (camera_config.get('raspberryPi') or {}).get('fov')
    if diagonal_fov_deg is None:
        diagonal_fov_deg = (camera_config.get('tapo') or {}).get('fov')
    if diagonal_fov_deg is None or diagonal_fov_deg <= 0:
        return 0.0, 0.0

    horizontal_fov, vertical_fov = _diagonal_fov_to_horizontal_vertical(
        diagonal_fov_deg, image_width, image_height
    )
    zoom = max(0.1, float(zoom_factor) or 1.0)
    horizontal_fov = horizontal_fov / zoom
    vertical_fov = vertical_fov / zoom
    degrees_per_pixel_x = horizontal_fov / image_width
    degrees_per_pixel_y = vertical_fov / image_height
    rotation_adjustment = offset_x * degrees_per_pixel_x
    tilt_adjustment = -offset_y * degrees_per_pixel_y
    return rotation_adjustment, tilt_adjustment


def _bbox_match(a: Optional[Dict], b: Optional[Dict]) -> bool:
    """True if both have same bbox (x,y) or same position center."""
    if not a or not b:
        return False
    if a.get('bbox') and b.get('bbox'):
        return (
            a['bbox'].get('x') == b['bbox'].get('x')
            and a['bbox'].get('y') == b['bbox'].get('y')
        )
    if a.get('position') and b.get('position'):
        return (
            a['position'].get('center_x') == b['position'].get('center_x')
            and a['position'].get('center_y') == b['position'].get('center_y')
        )
    return False


def enrich_detections_esp_angles(
    detections: List[Dict],
    target_bird: Optional[Dict],
    camera_position: Dict,
    image_info: Dict,
    zoom_factor: float,
    camera_config: Dict,
    camera_source: Optional[str] = None,
    raspberry_pi_image_info: Optional[Dict] = None,
) -> None:
    """
    Mutates detections and target_bird in place: adds esp_rot, esp_tilt, is_target_bird.
    Single source of truth for esp_rot/esp_tilt (used by cv-service endpoint, hardware-monitor, and Node via HTTP).
    """
    if not detections or not camera_position or camera_position.get('rotation') is None or camera_position.get('tilt') is None:
        return
    current_rotation = float(camera_position.get('rotation', 0))
    current_tilt = float(camera_position.get('tilt', 0))

    def get_info(det: Dict) -> Optional[Dict]:
        zoomed = None
        if det.get('camera_source') == 'raspberry-pi' and raspberry_pi_image_info:
            zoomed = (raspberry_pi_image_info.get('zoomed_size') or raspberry_pi_image_info.get('original_size')) or {}
        if not zoomed:
            zoomed = (image_info.get('zoomed_size') or image_info.get('original_size')) or {}
        return zoomed if zoomed else None

    primary_zoomed = image_info.get('zoomed_size') or image_info.get('original_size') or {}
    img_width_primary = primary_zoomed.get('width') or 0
    img_height_primary = primary_zoomed.get('height') or 0

    for det in detections:
        bbox = det.get('bbox') or (
            (det.get('position') and {
                'x': (det['position'].get('center_x') or 0) - (det['position'].get('width') or 0) / 2,
                'y': (det['position'].get('center_y') or 0) - (det['position'].get('height') or 0) / 2,
                'width': det['position'].get('width') or 0,
                'height': det['position'].get('height') or 0,
            })
        )
        if not bbox:
            continue
        info = get_info(det)
        if not info:
            w, h = img_width_primary, img_height_primary
        else:
            w = info.get('width') or 0
            h = info.get('height') or 0
        if not w or not h:
            w, h = img_width_primary, img_height_primary
        if not w or not h:
            continue
        cam_src = det.get('camera_source') or camera_source
        rot_adj, tilt_adj = calculate_angle_adjustment(
            bbox, w, h, zoom_factor, camera_config, cam_src
        )
        det['esp_rot'] = int(round(current_rotation + rot_adj))
        det['esp_tilt'] = int(round(current_tilt + tilt_adj))
        det['is_target_bird'] = target_bird is not None and _bbox_match(det, target_bird)

    if target_bird and (target_bird.get('bbox') or target_bird.get('position')):
        bbox = target_bird.get('bbox') or (
            (target_bird.get('position') and {
                'x': (target_bird['position'].get('center_x') or 0) - (target_bird['position'].get('width') or 0) / 2,
                'y': (target_bird['position'].get('center_y') or 0) - (target_bird['position'].get('height') or 0) / 2,
                'width': target_bird['position'].get('width') or 0,
                'height': target_bird['position'].get('height') or 0,
            })
        )
        if bbox:
            info = get_info(target_bird)
            w = (info.get('width') or img_width_primary) if info else img_width_primary
            h = (info.get('height') or img_height_primary) if info else img_height_primary
            if w and h:
                cam_src = target_bird.get('camera_source') or camera_source
                rot_adj, tilt_adj = calculate_angle_adjustment(
                    bbox, w, h, zoom_factor, camera_config, cam_src
                )
                target_bird['esp_rot'] = int(round(current_rotation + rot_adj))
                target_bird['esp_tilt'] = int(round(current_tilt + tilt_adj))
        target_bird['is_target_bird'] = True
