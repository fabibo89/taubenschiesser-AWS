#!/usr/bin/env python3
"""
Run Ultralytics YOLO / ESPDet validation and print a single JSON metrics line to stdout.

ESPDet checkpoints need the esp-detection repo on PYTHONPATH (local ``nn`` package)
and ``custom_parse_model`` patched into ultralytics — same as esp-detection/val.py.

Usage:
  ULTRALYTICS_PYTHON=.../python \\
    $ULTRALYTICS_PYTHON server/scripts/yolo_val.py \\
      --weights path/to/best.pt --data path/to/data.yaml --imgsz 224

Logs go to stderr; stdout is only the JSON result line.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from pathlib import Path

DEFAULT_ESP_DETECTION_ROOT = "/Users/fabianbosch/Documents/GitHub/esp-detection"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Ultralytics YOLO val → JSON metrics")
    p.add_argument("--weights", required=True, help="Path to .pt weights")
    p.add_argument("--data", required=True, help="Path to data.yaml")
    p.add_argument("--imgsz", type=int, default=224)
    p.add_argument(
        "--device",
        default=os.environ.get("HOST_VAL_DEVICE", "cpu"),
        help="Device (default: cpu, or HOST_VAL_DEVICE)",
    )
    p.add_argument("--project", default=None, help="Ultralytics project dir")
    p.add_argument("--name", default="host-val", help="Ultralytics run name")
    p.add_argument("--batch", type=int, default=1)
    p.add_argument(
        "--esp-detection-root",
        default=os.environ.get("ESP_DETECTION_ROOT", DEFAULT_ESP_DETECTION_ROOT),
        help="Path to esp-detection repo (provides nn.esp_tasks)",
    )
    return p.parse_args()


def _float(value, default=None):
    try:
        if value is None:
            return default
        f = float(value)
        if f != f:  # NaN
            return default
        return f
    except (TypeError, ValueError):
        return default


def ensure_espdet_path(root: str | None) -> str | None:
    """Prepend esp-detection root so local ``nn`` wins over any PyPI ``nn`` package."""
    if not root:
        return None
    root_path = Path(root).expanduser().resolve()
    if not root_path.is_dir():
        return None
    nn_dir = root_path / "nn"
    if not nn_dir.is_dir():
        return None
    root_str = str(root_path)
    if root_str in sys.path:
        sys.path.remove(root_str)
    sys.path.insert(0, root_str)
    return root_str


def patch_espdet_parse_model() -> bool:
    """Apply ESPDet custom_parse_model (required to unpickle ESPDet .pt)."""
    try:
        from nn.esp_tasks import custom_parse_model
        import ultralytics.nn.tasks as tasks

        tasks.parse_model = custom_parse_model
        return True
    except Exception as exc:
        print(f"ESPDet parse_model patch skipped: {exc}", file=sys.stderr)
        return False


def metrics_to_dict(results) -> dict:
    box = getattr(results, "box", None)
    map50 = None
    map50_95 = None
    precision = None
    recall = None
    if box is not None:
        map50 = _float(getattr(box, "map50", None))
        map50_95 = _float(getattr(box, "map", None))
        precision = _float(getattr(box, "mp", None))
        recall = _float(getattr(box, "mr", None))

    fitness = _float(getattr(results, "fitness", None))
    speed = getattr(results, "speed", None) or {}
    infer_ms = _float(speed.get("inference"))
    pre_ms = _float(speed.get("preprocess"), 0.0) or 0.0
    post_ms = _float(speed.get("postprocess"), 0.0) or 0.0
    ms_per_img = None
    if infer_ms is not None:
        ms_per_img = infer_ms + pre_ms + post_ms

    images = None
    try:
        validator = getattr(results, "validator", None)
        if validator is not None and hasattr(validator, "dataloader"):
            dataset = getattr(validator.dataloader, "dataset", None)
            if dataset is not None and hasattr(dataset, "__len__"):
                images = int(len(dataset))
    except Exception:
        images = None

    return {
        "map50": map50,
        "map50_95": map50_95,
        "precision": precision,
        "recall": recall,
        "fitness": fitness,
        "images": images,
        "speed": {
            "preprocess_ms": pre_ms if infer_ms is not None else None,
            "inference_ms": infer_ms,
            "postprocess_ms": post_ms if infer_ms is not None else None,
            "ms_per_img": ms_per_img,
        },
        "raw": {
            "map50": map50,
            "map": map50_95,
            "mp": precision,
            "mr": recall,
            "fitness": fitness,
        },
    }


def main() -> int:
    # Prevent Ultralytics from pip-installing a PyPI package named ``nn``
    # (wrong; shadows esp-detection's local nn namespace package).
    os.environ["YOLO_AUTOINSTALL"] = "False"

    args = parse_args()
    weights = os.path.abspath(args.weights)
    data = os.path.abspath(args.data)

    if not os.path.isfile(weights):
        print(f"Weights not found: {weights}", file=sys.stderr)
        return 2
    if not os.path.isfile(data):
        print(f"data.yaml not found: {data}", file=sys.stderr)
        return 2

    esp_root = ensure_espdet_path(args.esp_detection_root)
    if esp_root:
        print(f"Using esp-detection root: {esp_root}", file=sys.stderr)
        # Bind namespace package early so torch unpickle finds esp-detection/nn
        # (esp-detection/nn has no __init__.py — PEP 420 namespace).
        try:
            import nn  # noqa: F401
            import nn.esp_tasks  # noqa: F401
        except Exception as exc:
            print(f"Warn: could not pre-import esp-detection nn: {exc}", file=sys.stderr)
    else:
        print(
            "Warn: esp-detection root nicht gefunden — "
            "ESPDet-.pt braucht ESP_DETECTION_ROOT (nn.esp_tasks).",
            file=sys.stderr,
        )

    try:
        from ultralytics import YOLO
    except ImportError:
        print(
            "ultralytics nicht installiert. "
            "ULTRALYTICS_PYTHON auf ein venv mit ultralytics setzen "
            "(z.B. esp-detection/.venv/bin/python).",
            file=sys.stderr,
        )
        return 3

    patched = patch_espdet_parse_model()
    if not patched and esp_root is None:
        print(
            "Hinweis: Ohne esp-detection-Patch schlagen ESPDet-Checkpoints fehl.",
            file=sys.stderr,
        )

    project = args.project
    if project is None:
        project = os.path.join(os.path.dirname(data), "ultralytics-runs")

    try:
        # Keep stdout clean for the JSON result line (Ultralytics logs → stderr).
        result_stream = sys.stdout
        sys.stdout = sys.stderr
        try:
            model = YOLO(weights)
            # workers=0 + plots=False: avoid macOS libc++ recursive_mutex crash
            # during DataLoader teardown after val completes (seen on Apple Silicon).
            results = model.val(
                data=data,
                imgsz=int(args.imgsz),
                device=args.device,
                batch=int(args.batch),
                workers=0,
                plots=False,
                save_json=False,
                project=project,
                name=args.name,
                exist_ok=True,
                # Keep tqdm on stderr so the Node host can parse n/total progress.
                verbose=True,
            )
            payload = metrics_to_dict(results)
            payload["imgsz"] = int(args.imgsz)
            payload["device"] = str(args.device)
            payload["weights"] = weights
            payload["espdet_patched"] = patched
            # Drop validator/dataloader refs before interpreter shutdown.
            del results
            del model
        finally:
            sys.stdout = result_stream

        print(json.dumps(payload, allow_nan=False), file=result_stream, flush=True)
        result_stream.flush()
        sys.stderr.flush()
        # Hard-exit: PyTorch/OpenMP destructor on macOS can still abort after
        # successful val (mutex lock failed) and would lose a 0 exit code.
        os._exit(0)
    except ModuleNotFoundError as exc:
        print(f"YOLO val failed (missing module): {exc}", file=sys.stderr)
        if "nn" in str(exc) or "esp" in str(exc).lower():
            print(
                "ESPDet-Weights brauchen das esp-detection-Repo. "
                "ESP_DETECTION_ROOT setzen und ULTRALYTICS_PYTHON auf "
                "esp-detection/.venv/bin/python zeigen.",
                file=sys.stderr,
            )
        traceback.print_exc(file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"YOLO val failed: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
