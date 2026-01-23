#!/usr/bin/env python3
"""Prüfe OpenCV Version und verfügbare Module"""

import cv2

print(f"OpenCV Version: {cv2.__version__}")
print(f"\nVerfügbare Module:")
print(f"  - cv2.Stitcher: {hasattr(cv2, 'Stitcher')}")
print(f"  - cv2.detail: {hasattr(cv2, 'detail')}")

if hasattr(cv2, 'detail'):
    print(f"  - cv2.detail.Stitcher: {hasattr(cv2.detail, 'Stitcher')}")
    print(f"  - cv2.detail.PlaneWarper: {hasattr(cv2.detail, 'PlaneWarper')}")
    print(f"  - cv2.detail.SphericalWarper: {hasattr(cv2.detail, 'SphericalWarper')}")

print(f"\nBuild Information:")
build_info = cv2.getBuildInformation()
# Zeige nur relevante Teile
lines = build_info.split('\n')
for i, line in enumerate(lines):
    if 'Version' in line or 'contrib' in line.lower() or 'modules' in line.lower():
        print(f"  {line}")
    if i > 50:  # Erste 50 Zeilen
        break



