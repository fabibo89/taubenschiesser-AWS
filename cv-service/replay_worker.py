#!/usr/bin/env python3
"""Side-model worker. Loads one ONNX, reads JSON jobs on stdin, writes boxes on stdout.

The production CV service is a different process and keeps its own model.
"""
import json
import os
import sys

import cv2
import numpy as np
import onnxruntime as ort

# Library prints ("Used device", inference time) must not break the JSON protocol.
protocol = sys.stdout
sys.stdout = sys.stderr

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from yolov8 import YOLOv8
from yolov8.utils import class_names


def decode_image(payload):
    if not payload or not isinstance(payload, str):
        return None
    raw_b64 = payload.split(',', 1)[1] if payload.startswith('data:') and ',' in payload else payload
    try:
        raw = np.frombuffer(
            __import__('base64').b64decode(raw_b64, validate=False),
            dtype=np.uint8,
        )
    except Exception:
        return None
    return cv2.imdecode(raw, cv2.IMREAD_COLOR)


def bird_boxes(detector):
    boxes, scores, class_ids = detector.boxes, detector.scores, detector.class_ids
    found = []
    for box, score, class_id in zip(boxes, scores, class_ids):
        class_id = int(class_id)
        name = class_names[class_id] if 0 <= class_id < len(class_names) else str(class_id)
        if name != 'bird':
            continue
        x1, y1, x2, y2 = [float(v) for v in box]
        found.append({
            'class': 'bird',
            'confidence': float(score),
            'bbox': {
                'x': x1,
                'y': y1,
                'width': max(0.0, x2 - x1),
                'height': max(0.0, y2 - y1),
            },
        })
    return found


def respond(payload):
    protocol.write(json.dumps(payload) + '\n')
    protocol.flush()


def main():
    if len(sys.argv) < 2:
        respond({'ready': False, 'error': 'model path required'})
        return 1
    model_path = sys.argv[1]
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    detector = YOLOv8(
        model_path,
        conf_thres=0.25,
        iou_thres=0.45,
        providers=['CPUExecutionProvider'],
        sess_options=options,
    )
    respond({'ready': True, 'model': os.path.basename(model_path)})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            job = json.loads(line)
        except json.JSONDecodeError as exc:
            respond({'error': f'invalid json: {exc}'})
            continue
        if job.get('cmd') == 'stop':
            break
        image = decode_image(job.get('image'))
        if image is None:
            respond({'id': job.get('id'), 'error': 'invalid image'})
            continue
        try:
            detector(image)
            respond({'id': job.get('id'), 'boxes': bird_boxes(detector)})
        except Exception as exc:
            respond({'id': job.get('id'), 'error': str(exc)})
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
