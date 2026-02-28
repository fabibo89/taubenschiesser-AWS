from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import cv2
import numpy as np
import time
import os
from typing import List, Dict, Any, Optional
import base64
from yolov8 import YOLOv8, utils
import boto3
from botocore.exceptions import ClientError
import json
from dotenv import load_dotenv
import requests
from io import BytesIO
from PIL import Image
import logging
import copy

from angle_helper import enrich_detections_esp_angles as cv_enrich_detections_esp_angles

# Load environment variables from .env file
load_dotenv()

app = FastAPI(title="Taubenschiesser CV Service", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables for model and configuration
yolov8_detector = None
rekognition_client = None
cv_service_config = {
    "service": os.getenv('CV_SERVICE', 'yolov8'),  # 'yolov8' or 'rekognition'
    "aws_region": os.getenv('AWS_REGION', 'eu-central-1'),
    "aws_access_key": os.getenv('AWS_ACCESS_KEY_ID'),
    "aws_secret_key": os.getenv('AWS_SECRET_ACCESS_KEY')
}

# Optimize YOLOv8 for bird detection
YOLO_CONFIDENCE_THRESHOLD = float(os.getenv('YOLO_CONFIDENCE', '0.25'))
YOLO_IOU_THRESHOLD = float(os.getenv('YOLO_IOU', '0.45'))

def load_model():
    """Load the appropriate model based on configuration"""
    global yolov8_detector, rekognition_client
    
    if cv_service_config["service"] == "yolov8":
        load_yolov8_model()
    elif cv_service_config["service"] == "rekognition":
        load_rekognition_client()
    else:
        raise ValueError(f"Unknown CV service: {cv_service_config['service']}")

def load_yolov8_model():
    """Load the YOLOv8 model using the working repository approach"""
    global yolov8_detector
    
    # Use local models directory - resolve relative path from this file's directory
    model_path = os.getenv('MODEL_PATH', '../models/yolo26m.onnx')
    
    # Convert to absolute path if it's relative
    if not os.path.isabs(model_path):
        # Get the directory where this script is located
        script_dir = os.path.dirname(os.path.abspath(__file__))
        model_path = os.path.abspath(os.path.join(script_dir, model_path))
    
    try:
        # Initialize YOLOv8 detector with configurable thresholds
        yolov8_detector = YOLOv8(model_path, conf_thres=YOLO_CONFIDENCE_THRESHOLD, iou_thres=YOLO_IOU_THRESHOLD)
        
        print(f"YOLOv8 model loaded successfully: {model_path}")
        print(f"Confidence threshold: {yolov8_detector.conf_threshold}")
        print(f"IoU threshold: {yolov8_detector.iou_threshold}")
        
    except Exception as e:
        print(f"Error loading YOLOv8 model: {e}")
        raise e

def get_yolo_model_display_name():
    """Return display name for the loaded YOLO model (e.g. YOLO26, YOLOv8)."""
    if yolov8_detector is None:
        return "YOLO"
    return "YOLO26" if getattr(yolov8_detector, "is_yolo26_format", False) else "YOLOv8"

def load_rekognition_client():
    """Initialize AWS Rekognition client"""
    global rekognition_client
    
    try:
        # Initialize Rekognition client
        if cv_service_config["aws_access_key"] and cv_service_config["aws_secret_key"]:
            rekognition_client = boto3.client(
                'rekognition',
                region_name=cv_service_config["aws_region"],
                aws_access_key_id=cv_service_config["aws_access_key"],
                aws_secret_access_key=cv_service_config["aws_secret_key"]
            )
        else:
            # Use default AWS credentials (from environment, IAM role, etc.)
            rekognition_client = boto3.client(
                'rekognition',
                region_name=cv_service_config["aws_region"]
            )
        
        print(f"AWS Rekognition client initialized for region: {cv_service_config['aws_region']}")
        
    except Exception as e:
        print(f"Error initializing AWS Rekognition client: {e}")
        raise e

# All the complex preprocessing, postprocessing, and drawing functions are now handled by the YOLOv8 class from the repository

@app.on_event("startup")
async def startup_event():
    """Load model on startup"""
    load_model()

@app.get("/")
async def root():
    """Health check endpoint"""
    model_loaded = yolov8_detector is not None or rekognition_client is not None
    return {
        "message": "Taubenschiesser CV Service is running", 
        "model_loaded": model_loaded,
        "service": cv_service_config["service"]
    }

@app.get("/health")
async def health():
    """Health check endpoint for Docker healthcheck"""
    model_loaded = yolov8_detector is not None or rekognition_client is not None
    return {
        "status": "healthy",
        "message": "Taubenschiesser CV Service is running", 
        "model_loaded": model_loaded,
        "service": cv_service_config["service"]
    }

@app.get("/config")
async def get_config():
    """Get current configuration"""
    return {
        "service": cv_service_config["service"],
        "aws_region": cv_service_config["aws_region"],
        "aws_configured": bool(cv_service_config["aws_access_key"] and cv_service_config["aws_secret_key"])
    }

@app.post("/config")
async def update_config(config: Dict[str, Any]):
    """Update configuration and reload model"""
    global cv_service_config
    
    if "service" in config:
        if config["service"] not in ["yolov8", "rekognition"]:
            raise HTTPException(status_code=400, detail="Service must be 'yolov8' or 'rekognition'")
        cv_service_config["service"] = config["service"]
    
    if "aws_region" in config:
        cv_service_config["aws_region"] = config["aws_region"]
    
    if "aws_access_key" in config:
        cv_service_config["aws_access_key"] = config["aws_access_key"]
    
    if "aws_secret_key" in config:
        cv_service_config["aws_secret_key"] = config["aws_secret_key"]
    
    # Reload model with new configuration
    try:
        load_model()
        return {"message": "Configuration updated successfully", "config": cv_service_config}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reload model: {str(e)}")

def load_image_from_file(file):
    """Load image from uploaded file - BASED ON WORKING REPOSITORY"""
    contents = file.file.read()
    nparr = np.frombuffer(contents, np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)

def detect_with_rekognition(image_bytes):
    """Detect objects using AWS Rekognition"""
    global rekognition_client
    
    if rekognition_client is None:
        raise HTTPException(status_code=500, detail="Rekognition client not initialized")
    
    try:
        # Call AWS Rekognition
        response = rekognition_client.detect_labels(
            Image={'Bytes': image_bytes},
            MaxLabels=10,
            MinConfidence=0.5
        )
        
        # Process response
        detections = []
        for label in response['Labels']:
            # Check if it's a bird-related label
            if any(bird_word in label['Name'].lower() for bird_word in ['bird', 'vogel', 'avian']):
                for instance in label.get('Instances', []):
                    bbox = instance['BoundingBox']
                    detection = {
                        "class": label['Name'],
                        "confidence": float(instance['Confidence']),
                        "bbox": {
                            "x": float(bbox['Left']),
                            "y": float(bbox['Top']),
                            "width": float(bbox['Width']),
                            "height": float(bbox['Height'])
                        },
                        "bbox_original": {
                            "x": float(bbox['Left'] + bbox['Width'] / 2),
                            "y": float(bbox['Top'] + bbox['Height'] / 2),
                            "width": float(bbox['Width']),
                            "height": float(bbox['Height'])
                        }
                    }
                    detections.append(detection)
        
        return detections, response
        
    except ClientError as e:
        print(f"AWS Rekognition error: {e}")
        raise HTTPException(status_code=500, detail=f"AWS Rekognition error: {str(e)}")
    except Exception as e:
        print(f"Error in detect_with_rekognition: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def detect_birds_with_rekognition(image_bytes):
    """Detect only birds using AWS Rekognition"""
    global rekognition_client
    
    if rekognition_client is None:
        raise HTTPException(status_code=500, detail="Rekognition client not initialized")
    
    try:
        # Call AWS Rekognition
        response = rekognition_client.detect_labels(
            Image={'Bytes': image_bytes},
            MaxLabels=20,
            MinConfidence=0.3
        )
        
        # Filter for bird-related labels
        bird_detections = []
        for label in response['Labels']:
            # Check if it's a bird-related label
            if any(bird_word in label['Name'].lower() for bird_word in ['bird', 'vogel', 'avian', 'pigeon', 'dove', 'sparrow', 'crow', 'raven']):
                for instance in label.get('Instances', []):
                    bbox = instance['BoundingBox']
                    detection = {
                        "class": label['Name'],
                        "confidence": float(instance['Confidence']),
                        "position": {
                            "center_x": float(bbox['Left'] + bbox['Width'] / 2),
                            "center_y": float(bbox['Top'] + bbox['Height'] / 2),
                            "width": float(bbox['Width']),
                            "height": float(bbox['Height'])
                        },
                        "bbox": {
                            "x": float(bbox['Left']),
                            "y": float(bbox['Top']),
                            "width": float(bbox['Width']),
                            "height": float(bbox['Height'])
                        }
                    }
                    bird_detections.append(detection)
        
        return bird_detections
        
    except ClientError as e:
        print(f"AWS Rekognition error: {e}")
        raise HTTPException(status_code=500, detail=f"AWS Rekognition error: {str(e)}")
    except Exception as e:
        print(f"Error in detect_birds_with_rekognition: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/detect")
async def detect_objects(file: UploadFile = File(...)):
    """Detect objects in uploaded image using configured service"""
    if cv_service_config["service"] == "yolov8":
        return await detect_objects_yolov8(file)
    elif cv_service_config["service"] == "rekognition":
        return await detect_objects_rekognition(file)
    else:
        raise HTTPException(status_code=500, detail="No valid CV service configured")

async def detect_objects_yolov8(file: UploadFile):
    """Detect objects using YOLOv8"""
    if yolov8_detector is None:
        raise HTTPException(status_code=500, detail="YOLOv8 model not loaded")
    
    try:
        # Load image using working repository method
        image = load_image_from_file(file)
        
        if image is None:
            raise HTTPException(status_code=400, detail="Invalid image format")
        
        start_time = time.time()
        
        # Detect objects using working repository method
        boxes, scores, class_ids = yolov8_detector(image)
        
        # Convert to our format
        detections = []
        for box, score, class_id in zip(boxes, scores, class_ids):
            x1, y1, x2, y2 = box.astype(int)
            class_name = utils.class_names[class_id] if class_id < len(utils.class_names) else f"class_{class_id}"
            
            detection = {
                "class": class_name,
                "confidence": float(score),
                "bbox": {
                    "x": float(x1),
                    "y": float(y1),
                    "width": float(x2 - x1),
                    "height": float(y2 - y1)
                },
                "bbox_original": {
                    "x": float((x1 + x2) / 2),
                    "y": float((y1 + y2) / 2),
                    "width": float(x2 - x1),
                    "height": float(y2 - y1)
                }
            }
            detections.append(detection)
        
        # Draw detections on image using working repository method
        annotated_image, results = yolov8_detector.draw_detections(image)
        
        processing_time = time.time() - start_time
        
        # Encode annotated image
        success, buffer = cv2.imencode('.jpg', annotated_image, [cv2.IMWRITE_JPEG_QUALITY, 95])
        if not success:
            print("[ERROR] Failed to encode image")
            # Fallback: return original image
            _, buffer = cv2.imencode('.jpg', image)
        image_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return {
            "success": True,
            "detections": detections,
            "processing_time": processing_time,
            "model": {
                "name": get_yolo_model_display_name(),
                "version": "1.0.0"
            },
            "image_url": f"data:image/jpeg;base64,{image_base64}",
            "detection_count": len(detections),
            "image_info": {
                "original_size": {
                    "width": image.shape[1],
                    "height": image.shape[0]
                },
                "model_input_size": {
                    "width": 640,
                    "height": 640
                }
            }
        }
        
    except Exception as e:
        print(f"Error in detect_objects_yolov8: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def detect_objects_rekognition(file: UploadFile):
    """Detect objects using AWS Rekognition"""
    if rekognition_client is None:
        raise HTTPException(status_code=500, detail="Rekognition client not loaded")
    
    try:
        # Read image bytes
        image_bytes = await file.read()
        
        start_time = time.time()
        
        # Detect objects using AWS Rekognition
        detections, response = detect_with_rekognition(image_bytes)
        
        processing_time = time.time() - start_time
        
        # For Rekognition, we don't have annotated images, so return original
        image_base64 = base64.b64encode(image_bytes).decode('utf-8')
        
        return {
            "success": True,
            "detections": detections,
            "processing_time": processing_time,
            "model": {
                "name": "AWS Rekognition",
                "version": "1.0.0"
            },
            "image_url": f"data:image/jpeg;base64,{image_base64}",
            "detection_count": len(detections),
            "image_info": {
                "original_size": "unknown",  # Rekognition doesn't return image dimensions
                "model_input_size": "cloud_processed"
            }
        }
        
    except Exception as e:
        print(f"Error in detect_objects_rekognition: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/detect_birds_only")
async def detect_birds_only(file: UploadFile = File(...)):
    """Detect only birds in uploaded image using configured service"""
    if cv_service_config["service"] == "yolov8":
        return await detect_birds_only_yolov8(file)
    elif cv_service_config["service"] == "rekognition":
        return await detect_birds_only_rekognition(file)
    else:
        raise HTTPException(status_code=500, detail="No valid CV service configured")

async def detect_birds_only_yolov8(file: UploadFile):
    """Detect only birds using YOLOv8"""
    if yolov8_detector is None:
        raise HTTPException(status_code=500, detail="YOLOv8 model not loaded")
    
    try:
        # Load image using working repository method
        image = load_image_from_file(file)
        
        if image is None:
            raise HTTPException(status_code=400, detail="Invalid image format")
        
        # Detect objects using working repository method
        boxes, scores, class_ids = yolov8_detector(image)
        
        # Filter only birds
        bird_detections = []
        for box, score, class_id in zip(boxes, scores, class_ids):
            class_name = utils.class_names[class_id] if class_id < len(utils.class_names) else f"class_{class_id}"
            
            # Only process birds
            if class_name.lower() in ['bird', 'birds', 'vogel', 'vögel']:
                x1, y1, x2, y2 = box.astype(int)
                
                detection = {
                    "class": class_name,
                    "confidence": float(score),
                    "position": {
                        "center_x": float((x1 + x2) / 2),
                        "center_y": float((y1 + y2) / 2),
                        "width": float(x2 - x1),
                        "height": float(y2 - y1)
                    },
                    "bbox": {
                        "x": float(x1),
                        "y": float(y1),
                        "width": float(x2 - x1),
                        "height": float(y2 - y1)
                    }
                }
                bird_detections.append(detection)
        
        return {
            "success": True,
            "birds_found": len(bird_detections) > 0,
            "bird_count": len(bird_detections),
            "detections": bird_detections,
            "timestamp": time.time(),
            "service": get_yolo_model_display_name()
        }
        
    except Exception as e:
        print(f"Error in detect_birds_only_yolov8: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def detect_birds_only_rekognition(file: UploadFile):
    """Detect only birds using AWS Rekognition"""
    if rekognition_client is None:
        raise HTTPException(status_code=500, detail="Rekognition client not loaded")
    
    try:
        # Read image bytes
        image_bytes = await file.read()
        
        # Detect birds using AWS Rekognition
        bird_detections = detect_birds_with_rekognition(image_bytes)
        
        return {
            "success": True,
            "birds_found": len(bird_detections) > 0,
            "bird_count": len(bird_detections),
            "detections": bird_detections,
            "timestamp": time.time(),
            "service": "AWS Rekognition"
        }
        
    except Exception as e:
        print(f"Error in detect_birds_only_rekognition: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/detect_birds_optimized")
async def detect_birds_optimized(file: UploadFile = File(...)):
    """Optimized bird detection with YOLOv8 - best for Taubenschiesser"""
    if yolov8_detector is None:
        raise HTTPException(status_code=500, detail="YOLOv8 model not loaded")
    
    try:
        # Load image
        image = load_image_from_file(file)
        
        if image is None:
            raise HTTPException(status_code=400, detail="Invalid image format")
        
        start_time = time.time()
        
        # Detect objects
        boxes, scores, class_ids = yolov8_detector(image)
        
        # Filter and optimize for birds
        bird_detections = []
        for box, score, class_id in zip(boxes, scores, class_ids):
            class_name = utils.class_names[class_id] if class_id < len(utils.class_names) else f"class_{class_id}"
            
            # Enhanced bird detection - check for various bird-related terms
            bird_keywords = ['bird', 'birds', 'vogel', 'vögel', 'pigeon', 'dove', 'sparrow', 'crow', 'raven', 'eagle', 'hawk']
            is_bird = any(keyword in class_name.lower() for keyword in bird_keywords)
            
            if is_bird and score > YOLO_CONFIDENCE_THRESHOLD:
                x1, y1, x2, y2 = box.astype(int)
                
                # Calculate center and dimensions
                center_x = (x1 + x2) / 2
                center_y = (y1 + y2) / 2
                width = x2 - x1
                height = y2 - y1
                
                detection = {
                    "class": class_name,
                    "confidence": float(score),
                    "position": {
                        "center_x": float(center_x),
                        "center_y": float(center_y),
                        "width": float(width),
                        "height": float(height)
                    },
                    "bbox": {
                        "x": float(x1),
                        "y": float(y1),
                        "width": float(width),
                        "height": float(height)
                    },
                    "size_category": "large" if width * height > 10000 else "small",
                    "detection_quality": "high" if score > 0.7 else "medium" if score > 0.5 else "low"
                }
                bird_detections.append(detection)
        
        processing_time = time.time() - start_time
        
        # Determine if action should be taken
        should_activate = len(bird_detections) > 0
        confidence_level = max([d["confidence"] for d in bird_detections]) if bird_detections else 0.0
        
        return {
            "success": True,
            "birds_found": len(bird_detections) > 0,
            "bird_count": len(bird_detections),
            "should_activate_taubenschiesser": should_activate,
            "confidence_level": confidence_level,
            "detections": bird_detections,
            "processing_time": processing_time,
            "timestamp": time.time(),
            "service": get_yolo_model_display_name() + "-Optimized",
            "model_info": {
                "confidence_threshold": YOLO_CONFIDENCE_THRESHOLD,
                "iou_threshold": YOLO_IOU_THRESHOLD
            }
        }
        
    except Exception as e:
        print(f"Error in detect_birds_optimized: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Request models
class CaptureFrameRequest(BaseModel):
    rtsp_url: str
    timeout: Optional[int] = 10

class ApplyZoomRequest(BaseModel):
    image: str  # Base64 encoded image
    zoom: float

class StitchPanoramaRequest(BaseModel):
    image_urls: Optional[List[str]] = None
    image_base64_list: Optional[List[str]] = None
    show_borders: Optional[bool] = False

@app.post("/capture_frame")
async def capture_frame(request: CaptureFrameRequest):
    """Capture a frame from RTSP stream"""
    try:
        rtsp_url = request.rtsp_url
        timeout = request.timeout
        
        # Open RTSP stream
        cap = cv2.VideoCapture(rtsp_url)
        
        if not cap.isOpened():
            raise HTTPException(status_code=400, detail="Could not open RTSP stream")
        
        # Set timeout
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout * 1000)
        
        # Read frame
        ret, frame = cap.read()
        cap.release()
        
        if not ret or frame is None:
            raise HTTPException(status_code=400, detail="Could not read frame from RTSP stream")
        
        # Encode frame to JPEG
        success, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to encode frame")
        
        # Convert to base64
        image_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return {
            "success": True,
            "image": image_base64,
            "width": frame.shape[1],
            "height": frame.shape[0]
        }
        
    except Exception as e:
        print(f"Error capturing frame: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/apply_zoom")
async def apply_zoom(request: ApplyZoomRequest):
    """Apply zoom (center crop) to an image"""
    try:
        # Decode base64 image
        image_data = base64.b64decode(request.image)
        nparr = np.frombuffer(image_data, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if image is None:
            raise HTTPException(status_code=400, detail="Invalid image data")
        
        zoom_factor = request.zoom
        
        # If zoom is 1.0 or less, return original image
        if zoom_factor <= 1.0:
            return {
                "success": True,
                "image": request.image,
                "zoom": zoom_factor,
                "width": image.shape[1],
                "height": image.shape[0]
            }
        
        # Calculate new dimensions
        height, width = image.shape[:2]
        new_width = int(width / zoom_factor)
        new_height = int(height / zoom_factor)
        
        # Calculate center crop coordinates
        start_x = (width - new_width) // 2
        start_y = (height - new_height) // 2
        end_x = start_x + new_width
        end_y = start_y + new_height
        
        # Crop the image
        cropped_image = image[start_y:end_y, start_x:end_x]
        
        # Encode cropped image to JPEG
        success, buffer = cv2.imencode('.jpg', cropped_image, [cv2.IMWRITE_JPEG_QUALITY, 95])
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to encode zoomed image")
        
        # Convert to base64
        image_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return {
            "success": True,
            "image": image_base64,
            "zoom": zoom_factor,
            "original_size": {
                "width": width,
                "height": height
            },
            "zoomed_size": {
                "width": new_width,
                "height": new_height
            }
        }
        
    except Exception as e:
        print(f"Error applying zoom: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/stitch-panorama")
async def stitch_panorama(request: StitchPanoramaRequest):
    """Stitch multiple images into a panorama"""
    try:
        # Support both URLs and base64 data
        image_urls = request.image_urls or []
        image_base64_list = request.image_base64_list or []
        
        if (not image_urls and not image_base64_list) or (len(image_urls) + len(image_base64_list) < 2):
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "Mindestens 2 Bilder werden für Panorama benötigt",
                    "error_code": "INSUFFICIENT_IMAGES"
                }
            )
        
        # 1. Bilder laden
        images = []
        image_sizes = []  # Speichere Größen der Originalbilder
        failed_items = []
        total_images = len(image_urls) + len(image_base64_list)
        
        # Process URLs
        for i, url in enumerate(image_urls):
            try:
                print(f"Lade Bild {i+1}/{total_images} (URL): {url[:50]}...")
                response = requests.get(url, timeout=10)
                response.raise_for_status()
                
                img = Image.open(BytesIO(response.content))
                img_array = np.array(img)
                
                # Konvertiere RGB zu BGR für OpenCV
                if len(img_array.shape) == 3:
                    img_bgr = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
                else:
                    img_bgr = cv2.cvtColor(img_array, cv2.COLOR_GRAY2BGR)
                
                images.append(img_bgr)
                # Speichere Originalgröße (height, width)
                image_sizes.append({
                    "width": img_bgr.shape[1],
                    "height": img_bgr.shape[0]
                })
                print(f"Bild {i+1} erfolgreich geladen: {img_bgr.shape}")
                
            except requests.RequestException as e:
                print(f"Fehler beim Laden von Bild {i+1} ({url}): {e}")
                failed_items.append({'index': i, 'type': 'url', 'url': url, 'error': str(e)})
            except Exception as e:
                print(f"Unerwarteter Fehler beim Verarbeiten von Bild {i+1}: {e}")
                failed_items.append({'index': i, 'type': 'url', 'url': url, 'error': str(e)})
        
        # Process base64 images
        for i, base64_data in enumerate(image_base64_list):
            try:
                img_index = len(image_urls) + i + 1
                print(f"Lade Bild {img_index}/{total_images} (base64)")
                
                # Remove data URL prefix if present
                if base64_data.startswith('data:image'):
                    base64_data = base64_data.split(',')[1]
                
                # Decode base64
                image_data = base64.b64decode(base64_data)
                img = Image.open(BytesIO(image_data))
                img_array = np.array(img)
                
                # Konvertiere RGB zu BGR für OpenCV
                if len(img_array.shape) == 3:
                    img_bgr = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
                else:
                    img_bgr = cv2.cvtColor(img_array, cv2.COLOR_GRAY2BGR)
                
                images.append(img_bgr)
                # Speichere Originalgröße (height, width)
                image_sizes.append({
                    "width": img_bgr.shape[1],
                    "height": img_bgr.shape[0]
                })
                print(f"Bild {img_index} erfolgreich geladen: {img_bgr.shape}")
                
            except Exception as e:
                print(f"Fehler beim Verarbeiten von base64 Bild {img_index}: {e}")
                failed_items.append({'index': img_index, 'type': 'base64', 'error': str(e)})
        
        if len(images) < 2:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": f"Nur {len(images)} von {total_images} Bildern konnten geladen werden",
                    "error_code": "LOAD_FAILED",
                    "failed_items": failed_items
                }
            )
        
        if failed_items:
            print(f"Warnung: {len(failed_items)} Bilder konnten nicht geladen werden, versuche mit {len(images)} Bildern")
        
        # 2. Stitching durchführen
        print(f"Starte Stitching mit {len(images)} Bildern...")
        
        # Versuche cv2.detail.Stitcher mit Plane Warper zu verwenden (weniger Verzerrung)
        # Falls das nicht funktioniert, verwende normalen Stitcher
        try:
            # Verwende detail.Stitcher für mehr Kontrolle
            stitcher = cv2.detail.Stitcher.create()
            stitcher.setPanoConfidenceThresh(0.5)  # Niedrigere Schwelle für bessere Ergebnisse
            
            # Plane Warper = weniger Verzerrung (planare Projektion statt sphärisch)
            # Das sollte Feature-Matching zwischen Originalbildern und Panorama verbessern
            try:
                warper = cv2.detail.PlaneWarper()
                stitcher.setWarper(warper)
                print("Verwende Plane Warper für weniger Verzerrung")
            except Exception as e:
                print(f"Plane Warper nicht verfügbar: {e}, verwende Standard-Warper")
            
            # Führe Stitching durch
            status, panorama = stitcher.stitch(images)
            
        except Exception as e:
            print(f"cv2.detail.Stitcher nicht verfügbar oder Fehler: {e}")
            print("Verwende normalen cv2.Stitcher...")
            stitcher = cv2.Stitcher.create()
            status, panorama = stitcher.stitch(images)
        
        # 3. Status-Codes interpretieren
        # OpenCV Stitcher Status Codes (numerische Werte)
        STITCHER_OK = 0
        STITCHER_ERR_NEED_MORE_IMGS = 1
        STITCHER_ERR_HOMOGRAFY_EST_FAIL = 2
        STITCHER_ERR_CAMERA_PARAMS_ADJUST_FAIL = 3
        STITCHER_ERR_MATCH_CONFIDENCE_FAIL = 4
        STITCHER_ERR_PANO_INPUT_SIZE_FAIL = 5
        
        status_messages = {
            STITCHER_OK: "Erfolgreich",
            STITCHER_ERR_NEED_MORE_IMGS: "Nicht genug Bilder (mindestens 2 benötigt)",
            STITCHER_ERR_HOMOGRAFY_EST_FAIL: "Homographie-Schätzung fehlgeschlagen - Bilder überlappen nicht genug",
            STITCHER_ERR_CAMERA_PARAMS_ADJUST_FAIL: "Kamera-Parameter-Anpassung fehlgeschlagen",
            STITCHER_ERR_MATCH_CONFIDENCE_FAIL: "Feature-Matching-Konfidenz zu niedrig",
            STITCHER_ERR_PANO_INPUT_SIZE_FAIL: "Eingabebilder zu groß oder zu klein"
        }
        
        if status == STITCHER_OK:
            print(f"Stitching erfolgreich! Panorama-Größe: {panorama.shape}")
            
            # Statistiken berechnen
            total_requested = len(image_urls) + len(image_base64_list)
            total_loaded = len(images)
            total_failed = len(failed_items)
            
            # Matrizen werden für das ORIGINAL-Panorama berechnet (vor Komprimierung)
            # Keine Skalierung - kommt später wieder rein
            homographies = []
            transformation_matrices = []
            
            # Helper function für Template-Matching
            def find_image_position_with_template_matching(panorama, original_image, roi_x_start, roi_x_end, scale=0.3):
                """Finde Position des Originalbildes im Panorama mit Template-Matching"""
                try:
                    # Extrahiere ROI aus Panorama
                    roi = panorama[:, roi_x_start:roi_x_end]
                    
                    # Prüfe VOR dem Resize, ob ROI groß genug für Template ist
                    # Berechne benötigte Größe nach Skalierung
                    img_width_scaled = int(original_image.shape[1] * scale)
                    img_height_scaled = int(original_image.shape[0] * scale)
                    roi_width_scaled = int(roi.shape[1] * scale)
                    roi_height_scaled = int(roi.shape[0] * scale)
                    
                    # Wenn ROI nach Skalierung kleiner als Template wäre, passe Skalierung an
                    if roi_width_scaled < img_width_scaled or roi_height_scaled < img_height_scaled:
                        # Berechne maximale Skalierung, die noch passt
                        max_scale_x = (roi.shape[1] / original_image.shape[1]) * 0.95
                        max_scale_y = (roi.shape[0] / original_image.shape[0]) * 0.95
                        scale = min(scale, max_scale_x, max_scale_y)
                        
                        if scale < 0.1:  # Zu klein, skip Template-Matching
                            return None, None, 0.0
                    
                    # Reduziere Größe für Template-Matching (schneller und robuster)
                    roi_small = cv2.resize(roi, (int(roi.shape[1] * scale), int(roi.shape[0] * scale)))
                    img_small = cv2.resize(original_image, (int(original_image.shape[1] * scale), int(original_image.shape[0] * scale)))
                    
                    # Finale Prüfe (sollte jetzt immer passen)
                    if roi_small.shape[0] < img_small.shape[0] or roi_small.shape[1] < img_small.shape[1]:
                        return None, None, 0.0
                    
                    # Template-Matching mit mehreren Methoden
                    # TM_CCOEFF_NORMED ist am robustesten
                    result = cv2.matchTemplate(roi_small, img_small, cv2.TM_CCOEFF_NORMED)
                    min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)
                    
                    # Position zurück auf Original-Skala
                    match_x = (max_loc[0] / scale) + roi_x_start
                    match_y = max_loc[1] / scale
                    
                    return match_x, match_y, max_val
                except Exception as e:
                    print(f"  Template-Matching Fehler: {e}")
                    return None, None, 0.0
            
            # Helper function to calculate transformation matrices
            def calculate_transformation_matrices(panorama_img, original_images):
                """Berechne Transformations-Matrizen für das gegebene Panorama"""
                matrices = []
                if len(original_images) < 2:
                    return matrices
                
                print(f"Berechne Transformations-Matrizen basierend auf Panorama (Größe: {panorama_img.shape[1]}x{panorama_img.shape[0]})...")
                print("Verwende Template-Matching + Feature-Matching Hybrid-Ansatz...")
                
                # Feature Detector für Matching zwischen Originalbildern und Panorama
                # Versuche SIFT (genauer), dann AKAZE, dann ORB als Fallback
                try:
                    detector = cv2.SIFT_create(nfeatures=8000)
                    use_sift = True
                    print("Verwende SIFT für Feature Detection (8000 Features)")
                except:
                    try:
                        detector = cv2.AKAZE_create()
                        use_sift = False
                        print("SIFT nicht verfügbar, verwende AKAZE")
                    except:
                        detector = cv2.ORB_create(nfeatures=8000)
                        use_sift = False
                        print("Verwende ORB für Feature Detection (8000 Features)")
                
                # Feature Detection auf Panorama (einmal für alle Bilder)
                kp_pano, des_pano = detector.detectAndCompute(panorama_img, None)
                print(f"Panorama Features: {len(kp_pano) if kp_pano else 0}")
                
                h_pano, w_pano = panorama_img.shape[:2]
                
                # Für jedes Originalbild: Finde Homographie direkt zum Panorama
                for i, img in enumerate(original_images):
                    try:
                        print(f"Berechne Matrix für Bild {i+1}/{len(original_images)}...")
                        
                        # ROI-basierte Suche für bessere Performance und Genauigkeit
                        # Schätze ungefähre Position des Bildes im Panorama
                        estimated_x = (w_pano / len(original_images)) * i
                        roi_width = int(w_pano / len(original_images) * 2.5)  # 2.5x Breite für Puffer
                        roi_x_start = max(0, int(estimated_x - roi_width // 2))
                        roi_x_end = min(w_pano, int(estimated_x + roi_width // 2))
                        
                        # Versuche zuerst Template-Matching für bessere ROI-Schätzung
                        template_match_x, template_match_y, template_confidence = find_image_position_with_template_matching(
                            panorama_img, img, roi_x_start, roi_x_end, scale=0.3
                        )
                        
                        if template_match_x is not None and template_confidence > 0.3:  # Reduziert von 0.4 auf 0.3 für verzerrte Bilder
                            # Verwende Template-Matching Position für bessere ROI
                            print(f"  Template-Matching: Position gefunden bei x={template_match_x:.1f}, y={template_match_y:.1f}, Confidence={template_confidence:.2f}")
                            # Verfeinere ROI um Template-Match Position
                            refined_roi_width = int(img.shape[1] * 1.5)  # 1.5x Bildbreite
                            roi_x_start = max(0, int(template_match_x - refined_roi_width // 2))
                            roi_x_end = min(w_pano, int(template_match_x + refined_roi_width // 2))
                        else:
                            print(f"  Template-Matching: Keine gute Übereinstimmung (Confidence={template_confidence:.2f}), verwende geschätzte ROI")
                        
                        # Extrahiere ROI aus Panorama
                        roi_panorama = panorama_img[:, roi_x_start:roi_x_end]
                        kp_roi, des_roi = detector.detectAndCompute(roi_panorama, None)
                        
                        # Feature Detection auf Originalbild
                        kp_img, des_img = detector.detectAndCompute(img, None)
                        
                        if des_img is not None and des_roi is not None and len(des_img) > 10 and len(des_roi) > 10:
                            # Matcher - unterschiedlich für SIFT/AKAZE vs ORB
                            if use_sift:
                                # SIFT verwendet L2_NORM
                                bf = cv2.BFMatcher(cv2.NORM_L2, crossCheck=False)
                            else:
                                # AKAZE/ORB verwenden HAMMING
                                bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
                            
                            matches = bf.knnMatch(des_img, des_roi, k=2)
                            
                            # Lowe's ratio test - strenger für bessere Qualität
                            good_matches = []
                            for match_pair in matches:
                                if len(match_pair) == 2:
                                    m, n = match_pair
                                    if m.distance < 0.7 * n.distance:  # Strenger: 0.7 statt 0.75
                                        good_matches.append(m)
                            
                            print(f"  Bild {i+1}: {len(good_matches)} gute Matches gefunden (ROI: x={roi_x_start}-{roi_x_end})")
                            
                            if len(good_matches) > 10:  # Reduziert von 20 auf 10, da wir mehr Matrizen akzeptieren wollen
                                # Extrahiere matched points
                                # src_pts: Punkte im Originalbild
                                # dst_pts: Punkte im ROI (müssen x-Koordinaten anpassen)
                                src_pts = np.float32([kp_img[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
                                dst_pts_roi = np.float32([kp_roi[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)
                                
                                # Passe x-Koordinaten an (ROI-Offset hinzufügen)
                                dst_pts = dst_pts_roi.copy()
                                dst_pts[:, 0, 0] += roi_x_start
                                
                                # Finde Homographie vom Originalbild ins Panorama
                                # cv2.findHomography(src, dst) findet Transformation von src zu dst
                                # RANSAC Threshold: 3.0 ist robuster als 5.0
                                M, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 3.0)
                                
                                if M is not None:
                                    # Prüfe Qualität der Homographie
                                    inlier_count = np.sum(mask) if mask is not None else len(good_matches)
                                    inlier_ratio = inlier_count / len(good_matches) if len(good_matches) > 0 else 0
                                    print(f"  Inlier-Ratio: {inlier_ratio:.2%} ({inlier_count}/{len(good_matches)})")
                                    
                                    # Prüfe, ob die Homographie plausibel ist
                                    # Negative Determinante der ersten 2x2 Matrix deutet auf Spiegelung hin (oft falsch)
                                    det = M[0,0] * M[1,1] - M[0,1] * M[1,0]
                                    
                                    # Prüfe auf extrem große Matrix-Werte (deuten auf falsche Homographie hin)
                                    max_value = max(abs(M[0,0]), abs(M[0,1]), abs(M[1,0]), abs(M[1,1]))
                                    
                                    # Ablehnen wenn:
                                    # 1. Negative Determinante (Spiegelung)
                                    # 2. Extrem große Werte (> 5 deutet auf falsche Homographie hin)
                                    # 3. Inlier-Ratio zu niedrig
                                    use_fallback = False
                                    if det < 0:
                                        print(f"  ⚠️  Negative Determinante ({det:.4f}) - Homographie abgelehnt, verwende Fallback")
                                        use_fallback = True
                                    elif max_value > 10:  # Erhöht von 5 auf 10, da Panorama groß ist
                                        print(f"  ⚠️  Extrem große Matrix-Werte (max: {max_value:.2f}) - Homographie abgelehnt, verwende Fallback")
                                        use_fallback = True
                                    elif inlier_ratio < 0.10:  # Reduziert von 30% auf 10%, da verzerrte Bilder schwieriger sind
                                        print(f"  ⚠️  Inlier-Ratio sehr niedrig ({inlier_ratio:.2%} < 10%), verwende Fallback")
                                        use_fallback = True
                                    elif inlier_ratio < 0.20:
                                        print(f"  ⚠️  Inlier-Ratio niedrig ({inlier_ratio:.2%} < 20%), verwende Matrix trotzdem (Stitcher war erfolgreich)")
                                    
                                    if use_fallback:
                                        # Fallback: Geschätzte Transformation
                                        h_img, w_img = img.shape[:2]
                                        h_pano, w_pano = panorama_img.shape[:2]
                                        estimated_x = (w_pano / len(original_images)) * i
                                        M_estimated = np.array([
                                            [1, 0, estimated_x],
                                            [0, 1, 0],
                                            [0, 0, 1]
                                        ], dtype=np.float32)
                                        matrices.append(M_estimated)
                                    else:
                                        matrices.append(M)
                                        print(f"  Bild {i+1}: Homographie erfolgreich berechnet")
                                    # Debug: Zeige vollständige Matrix
                                    print(f"    Vollständige Matrix:")
                                    print(f"      [{M[0,0]:.6f}, {M[0,1]:.6f}, {M[0,2]:.6f}]")
                                    print(f"      [{M[1,0]:.6f}, {M[1,1]:.6f}, {M[1,2]:.6f}]")
                                    print(f"      [{M[2,0]:.6f}, {M[2,1]:.6f}, {M[2,2]:.6f}]")
                                    print(f"    Kurzform: tx={M[0,2]:.2f}, ty={M[1,2]:.2f}, px={M[2,0]:.6f}, py={M[2,1]:.6f}, w={M[2,2]:.2f}")
                                else:
                                    print(f"  Bild {i+1}: Homographie-Berechnung fehlgeschlagen, verwende Fallback")
                                    # Fallback: Geschätzte Transformation
                                    h_img, w_img = img.shape[:2]
                                    h_pano, w_pano = panorama_img.shape[:2]
                                    # Grobe Schätzung: Bilder sind horizontal angeordnet
                                    estimated_x = (w_pano / len(original_images)) * i
                                    M_estimated = np.array([
                                        [1, 0, estimated_x],
                                        [0, 1, 0],
                                        [0, 0, 1]
                                    ], dtype=np.float32)
                                    matrices.append(M_estimated)
                            else:
                                print(f"  Bild {i+1}: Zu wenige Matches ({len(good_matches)}), verwende Fallback")
                                # Fallback: Geschätzte Transformation
                                h_img, w_img = img.shape[:2]
                                h_pano, w_pano = panorama_img.shape[:2]
                                estimated_x = (w_pano / len(original_images)) * i
                                M_estimated = np.array([
                                    [1, 0, estimated_x],
                                    [0, 1, 0],
                                    [0, 0, 1]
                                ], dtype=np.float32)
                                matrices.append(M_estimated)
                        else:
                            print(f"  Bild {i+1}: Zu wenige Features, verwende Fallback")
                            # Fallback: Geschätzte Transformation
                            h_img, w_img = img.shape[:2]
                            h_pano, w_pano = panorama_img.shape[:2]
                            estimated_x = (w_pano / len(original_images)) * i
                            M_estimated = np.array([
                                [1, 0, estimated_x],
                                [0, 1, 0],
                                [0, 0, 1]
                            ], dtype=np.float32)
                            matrices.append(M_estimated)
                    except Exception as e:
                        print(f"Fehler beim Berechnen der Homographie für Bild {i}: {e}")
                        import traceback
                        traceback.print_exc()
                        # Fallback: Geschätzte Transformation
                        h_img, w_img = img.shape[:2]
                        h_pano, w_pano = panorama_img.shape[:2]
                        estimated_x = (w_pano / len(original_images)) * i
                        M_estimated = np.array([
                            [1, 0, estimated_x],
                            [0, 1, 0],
                            [0, 0, 1]
                        ], dtype=np.float32)
                        matrices.append(M_estimated)
                
                print(f"Transformations-Matrizen berechnet: {len(matrices)} Matrizen")
                return matrices
            
            if len(images) >= 2:
                print(f"Berechne Transformations-Matrizen basierend auf finalem Panorama...")
                
                # Feature Detector für Matching zwischen Originalbildern und Panorama
                orb = cv2.ORB_create(nfeatures=5000)
                
                # Feature Detection auf Panorama (einmal für alle Bilder)
                kp_pano, des_pano = orb.detectAndCompute(panorama, None)
                print(f"Panorama Features: {len(kp_pano) if kp_pano else 0}")
                
                # Für jedes Originalbild: Finde Homographie direkt zum finalen Panorama
                h_pano, w_pano = panorama.shape[:2]
                for i, img in enumerate(images):
                    try:
                        print(f"Berechne Matrix für Bild {i+1}/{len(images)}...")
                        
                        # ROI-basierte Suche: Schätze ungefähre Position des Bildes im Panorama
                        estimated_x = (w_pano / len(images)) * i
                        roi_width = int(w_pano / len(images) * 3.0)  # 3x Breite für Puffer
                        roi_x_start = max(0, int(estimated_x - roi_width // 2))
                        roi_x_end = min(w_pano, int(estimated_x + roi_width // 2))
                        
                        # Extrahiere ROI aus Panorama
                        roi_panorama = panorama[:, roi_x_start:roi_x_end]
                        kp_roi, des_roi = orb.detectAndCompute(roi_panorama, None)
                        print(f"  ROI: x={roi_x_start}-{roi_x_end} (Breite: {roi_width}), Features: {len(kp_roi) if kp_roi else 0}")
                        
                        # Feature Detection auf Originalbild
                        kp_img, des_img = orb.detectAndCompute(img, None)
                        
                        if des_img is not None and des_roi is not None and len(des_img) > 10 and len(des_roi) > 10:
                            # Matcher
                            bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
                            matches = bf.knnMatch(des_img, des_roi, k=2)
                            
                            # Lowe's ratio test - strenger für bessere Qualität
                            good_matches = []
                            for match_pair in matches:
                                if len(match_pair) == 2:
                                    m, n = match_pair
                                    if m.distance < 0.7 * n.distance:  # Strenger: 0.7 statt 0.75
                                        good_matches.append(m)
                            
                            print(f"  Bild {i+1}: {len(good_matches)} gute Matches gefunden (ROI: x={roi_x_start}-{roi_x_end})")
                            
                            if len(good_matches) > 10:  # Reduziert von 20 auf 10, da wir mehr Matrizen akzeptieren wollen
                                # Extrahiere matched points
                                # src_pts: Punkte im Originalbild
                                # dst_pts: Punkte im ROI (müssen x-Koordinaten anpassen)
                                src_pts = np.float32([kp_img[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
                                dst_pts_roi = np.float32([kp_roi[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)
                                
                                # Passe x-Koordinaten an (ROI-Offset hinzufügen)
                                dst_pts = dst_pts_roi.copy()
                                dst_pts[:, 0, 0] += roi_x_start
                                
                                # Finde Homographie vom Originalbild ins Panorama
                                # cv2.findHomography(src, dst) findet Transformation von src zu dst
                                # RANSAC Threshold: 3.0 ist robuster als 5.0
                                M, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 3.0)
                                
                                if M is not None:
                                    # Prüfe Qualität der Homographie
                                    inlier_count = np.sum(mask) if mask is not None else len(good_matches)
                                    inlier_ratio = inlier_count / len(good_matches) if len(good_matches) > 0 else 0
                                    print(f"  Inlier-Ratio: {inlier_ratio:.2%} ({inlier_count}/{len(good_matches)})")
                                    
                                    # Prüfe, ob die Homographie plausibel ist
                                    # Negative Determinante der ersten 2x2 Matrix deutet auf Spiegelung hin (oft falsch)
                                    det = M[0,0] * M[1,1] - M[0,1] * M[1,0]
                                    
                                    # Prüfe auf extrem große Matrix-Werte (deuten auf falsche Homographie hin)
                                    max_value = max(abs(M[0,0]), abs(M[0,1]), abs(M[1,0]), abs(M[1,1]))
                                    
                                    # Ablehnen wenn:
                                    # 1. Negative Determinante (Spiegelung)
                                    # 2. Extrem große Werte (> 5 deutet auf falsche Homographie hin)
                                    # 3. Inlier-Ratio zu niedrig
                                    use_fallback = False
                                    if det < 0:
                                        print(f"  ⚠️  Negative Determinante ({det:.4f}) - Homographie abgelehnt, verwende Fallback")
                                        use_fallback = True
                                    elif max_value > 10:  # Erhöht von 5 auf 10, da Panorama groß ist
                                        print(f"  ⚠️  Extrem große Matrix-Werte (max: {max_value:.2f}) - Homographie abgelehnt, verwende Fallback")
                                        use_fallback = True
                                    elif inlier_ratio < 0.10:  # Reduziert von 30% auf 10%, da verzerrte Bilder schwieriger sind
                                        print(f"  ⚠️  Inlier-Ratio sehr niedrig ({inlier_ratio:.2%} < 10%), verwende Fallback")
                                        use_fallback = True
                                    elif inlier_ratio < 0.20:
                                        print(f"  ⚠️  Inlier-Ratio niedrig ({inlier_ratio:.2%} < 20%), verwende Matrix trotzdem (Stitcher war erfolgreich)")
                                    
                                    if use_fallback:
                                        # Fallback: Geschätzte Transformation
                                        h_img, w_img = img.shape[:2]
                                        h_pano, w_pano = panorama.shape[:2]
                                        estimated_x = (w_pano / len(images)) * i
                                        M_estimated = np.array([
                                            [1, 0, estimated_x],
                                            [0, 1, 0],
                                            [0, 0, 1]
                                        ], dtype=np.float32)
                                        homographies.append(M_estimated)
                                    else:
                                        homographies.append(M)
                                        print(f"  Bild {i+1}: Homographie erfolgreich berechnet")
                                else:
                                    print(f"  Bild {i+1}: Homographie-Berechnung fehlgeschlagen, verwende Fallback")
                                    # Fallback: Geschätzte Transformation
                                    h_img, w_img = img.shape[:2]
                                    h_pano, w_pano = panorama.shape[:2]
                                    # Grobe Schätzung: Bilder sind horizontal angeordnet
                                    estimated_x = (w_pano / len(images)) * i
                                    M_estimated = np.array([
                                        [1, 0, estimated_x],
                                        [0, 1, 0],
                                        [0, 0, 1]
                                    ], dtype=np.float32)
                                    homographies.append(M_estimated)
                            else:
                                print(f"  Bild {i+1}: Zu wenige Matches ({len(good_matches)}), verwende Fallback")
                                # Fallback: Geschätzte Transformation
                                h_img, w_img = img.shape[:2]
                                h_pano, w_pano = panorama.shape[:2]
                                estimated_x = (w_pano / len(images)) * i
                                M_estimated = np.array([
                                    [1, 0, estimated_x],
                                    [0, 1, 0],
                                    [0, 0, 1]
                                ], dtype=np.float32)
                                homographies.append(M_estimated)
                        else:
                            print(f"  Bild {i+1}: Zu wenige Features, verwende Fallback")
                            # Fallback: Geschätzte Transformation
                            h_img, w_img = img.shape[:2]
                            h_pano, w_pano = panorama.shape[:2]
                            estimated_x = (w_pano / len(images)) * i
                            M_estimated = np.array([
                                [1, 0, estimated_x],
                                [0, 1, 0],
                                [0, 0, 1]
                            ], dtype=np.float32)
                            homographies.append(M_estimated)
                    except Exception as e:
                        print(f"Fehler beim Berechnen der Homographie für Bild {i}: {e}")
                        import traceback
                        traceback.print_exc()
                        # Fallback: Geschätzte Transformation
                        h_img, w_img = img.shape[:2]
                        h_pano, w_pano = panorama.shape[:2]
                        estimated_x = (w_pano / len(images)) * i
                        M_estimated = np.array([
                            [1, 0, estimated_x],
                            [0, 1, 0],
                            [0, 0, 1]
                        ], dtype=np.float32)
                        homographies.append(M_estimated)
                
                # Matrizen werden später nach der Komprimierung berechnet
                pass
            
            # Rahmen werden später nach der Komprimierung gezeichnet
            if False:  # Temporär deaktiviert, wird nach Komprimierung aktiviert
                h_pano_orig, w_pano_orig = panorama.shape[:2]
                print(f"Zeichne Rahmen auf Panorama (Größe: {w_pano_orig}x{h_pano_orig})...")
                panorama_with_borders = panorama.copy()
                
                # Farben für verschiedene Bilder
                colors = [
                    (255, 0, 0),    # Rot
                    (0, 255, 0),    # Grün
                    (0, 0, 255),    # Blau
                    (255, 255, 0),  # Cyan
                    (255, 0, 255),  # Magenta
                    (0, 255, 255),  # Gelb
                    (128, 0, 128),  # Lila
                    (255, 165, 0),  # Orange
                ]
                
                try:
                    # Zeichne Rahmen für jedes Bild mit den bereits berechneten Homographien
                    for i, (img, H) in enumerate(zip(images, homographies)):
                        try:
                            h_img, w_img = img.shape[:2]
                            # Ecken des Originalbildes
                            corners = np.float32([
                                [0, 0],
                                [w_img, 0],
                                [w_img, h_img],
                                [0, h_img]
                            ]).reshape(-1, 1, 2)
                            
                            # Debug: Zeige Matrix-Werte
                            print(f"  Bild {i+1} Matrix (Original-Bild {w_img}x{h_img}):")
                            print(f"    H[0,2]={H[0,2]:.2f}, H[1,2]={H[1,2]:.2f}, H[2,0]={H[2,0]:.6f}, H[2,1]={H[2,1]:.6f}")
                            
                            # Transformiere Ecken ins Panorama-Koordinatensystem
                            corners_transformed = cv2.perspectiveTransform(corners, H)
                            
                            # Debug: Zeige transformierte Ecken
                            print(f"  Bild {i+1} Rahmen-Ecken auf Panorama ({w_pano_orig}x{h_pano_orig}):")
                            for j, corner in enumerate(corners_transformed.reshape(-1, 2)):
                                print(f"    Ecke {j+1}: ({corner[0]:.2f}, {corner[1]:.2f})")
                            
                            # Prüfe, ob Ecken innerhalb des Panoramas liegen
                            corners_int = corners_transformed.astype(np.int32).reshape(-1, 2)
                            for j, corner in enumerate(corners_int):
                                if corner[0] < 0 or corner[0] >= w_pano_orig or corner[1] < 0 or corner[1] >= h_pano_orig:
                                    print(f"    ⚠️  Ecke {j+1} außerhalb des Panoramas!")
                            
                            # Zeichne Rahmen - dickere Linien für bessere Sichtbarkeit
                            cv2.polylines(panorama_with_borders, [corners_transformed.astype(np.int32)], True, colors[i % len(colors)], 5, cv2.LINE_AA)
                            
                            # Optional: Zeichne Bildnummer
                            center = np.mean(corners_transformed, axis=0).astype(np.int32)[0]
                            cv2.putText(panorama_with_borders, f"#{i+1}", tuple(center), 
                                      cv2.FONT_HERSHEY_SIMPLEX, 1, colors[i % len(colors)], 2)
                        except Exception as e:
                            print(f"Fehler beim Zeichnen des Rahmens für Bild {i}: {e}")
                    
                    panorama = panorama_with_borders
                except Exception as e:
                    print(f"Fehler beim Zeichnen der Rahmen: {e}")
                    import traceback
                    traceback.print_exc()
                    # Falls Fehler, verwende Original-Panorama
                    panorama = panorama.copy()
            
            # Berechne Matrizen für das ORIGINAL-Panorama
            # Keine Skalierung - kommt später wieder rein
            original_panorama = panorama.copy()  # Speichere Original-Panorama
            if len(images) >= 2:
                print(f"Berechne Matrizen für Original-Panorama ({panorama.shape[1]}x{panorama.shape[0]})...")
                homographies = calculate_transformation_matrices(panorama, images)
                # Konvertiere Matrizen zu Listen für JSON-Serialisierung
                transformation_matrices = []
                for H in homographies:
                    transformation_matrices.append(H.tolist())
            
            # Wenn show_borders aktiviert ist, zeichne die Rahmen der Originalbilder auf das ORIGINAL-Panorama
            if request.show_borders and len(homographies) > 0:
                h_pano_orig, w_pano_orig = original_panorama.shape[:2]
                print(f"Zeichne Rahmen auf Original-Panorama (Größe: {w_pano_orig}x{h_pano_orig})...")
                panorama_with_borders = original_panorama.copy()
                
                # Farben für verschiedene Bilder
                colors = [
                    (255, 0, 0),    # Rot
                    (0, 255, 0),    # Grün
                    (0, 0, 255),    # Blau
                    (255, 255, 0),  # Cyan
                    (255, 0, 255),  # Magenta
                    (0, 255, 255),  # Gelb
                    (128, 0, 128),  # Lila
                    (255, 165, 0),  # Orange
                ]
                
                try:
                    # Zeichne Rahmen für jedes Bild mit den berechneten Homographien
                    for i, (img, H) in enumerate(zip(images, homographies)):
                        try:
                            h_img, w_img = img.shape[:2]
                            # Ecken des Originalbildes
                            corners = np.float32([
                                [0, 0],
                                [w_img, 0],
                                [w_img, h_img],
                                [0, h_img]
                            ]).reshape(-1, 1, 2)
                            
                            # Debug: Zeige vollständige Matrix
                            print(f"  Bild {i+1} Matrix (Original-Bild {w_img}x{h_img}):")
                            print(f"    Vollständige Matrix:")
                            print(f"      [{H[0,0]:.6f}, {H[0,1]:.6f}, {H[0,2]:.6f}]")
                            print(f"      [{H[1,0]:.6f}, {H[1,1]:.6f}, {H[1,2]:.6f}]")
                            print(f"      [{H[2,0]:.6f}, {H[2,1]:.6f}, {H[2,2]:.6f}]")
                            print(f"    Kurzform: tx={H[0,2]:.2f}, ty={H[1,2]:.2f}, px={H[2,0]:.6f}, py={H[2,1]:.6f}, w={H[2,2]:.2f}")
                            
                            # Transformiere Ecken ins Panorama-Koordinatensystem
                            corners_transformed = cv2.perspectiveTransform(corners, H)
                            
                            # Debug: Zeige transformierte Ecken
                            print(f"  Bild {i+1} Rahmen-Ecken auf Panorama ({w_pano_orig}x{h_pano_orig}):")
                            for j, corner in enumerate(corners_transformed.reshape(-1, 2)):
                                print(f"    Ecke {j+1}: ({corner[0]:.2f}, {corner[1]:.2f})")
                            
                            # Prüfe, ob Ecken innerhalb des Panoramas liegen
                            corners_int = corners_transformed.astype(np.int32).reshape(-1, 2)
                            for j, corner in enumerate(corners_int):
                                if corner[0] < 0 or corner[0] >= w_pano_orig or corner[1] < 0 or corner[1] >= h_pano_orig:
                                    print(f"    ⚠️  Ecke {j+1} außerhalb des Panoramas!")
                            
                            # Zeichne Rahmen - dickere Linien für bessere Sichtbarkeit
                            cv2.polylines(panorama_with_borders, [corners_transformed.astype(np.int32)], True, colors[i % len(colors)], 5, cv2.LINE_AA)
                            
                            # Optional: Zeichne Bildnummer
                            center = np.mean(corners_transformed, axis=0).astype(np.int32)[0]
                            cv2.putText(panorama_with_borders, f"#{i+1}", tuple(center), 
                                      cv2.FONT_HERSHEY_SIMPLEX, 1, colors[i % len(colors)], 2)
                        except Exception as e:
                            print(f"Fehler beim Zeichnen des Rahmens für Bild {i}: {e}")
                    
                    original_panorama = panorama_with_borders
                    panorama = panorama_with_borders  # Verwende Panorama mit Rahmen
                except Exception as e:
                    print(f"Fehler beim Zeichnen der Rahmen: {e}")
                    import traceback
                    traceback.print_exc()
                    # Falls Fehler, verwende Panorama ohne Rahmen
            
            # Panorama zu JPEG encodieren - OHNE Komprimierung, Original-Größe und Qualität
            original_height, original_width = panorama.shape[:2]
            print(f"Encodiere Panorama in Original-Größe: {original_width}x{original_height}")
            
            # Encodiere mit hoher Qualität (95) ohne Größenreduzierung
            success, buffer = cv2.imencode('.jpg', panorama, [cv2.IMWRITE_JPEG_QUALITY, 95])
            if not success:
                raise HTTPException(status_code=500, detail="Fehler beim Encodieren des Panoramas")
            
            panorama_base64 = base64.b64encode(buffer).decode('utf-8')
            base64_size = len(panorama_base64)
            print(f"✓ Panorama erfolgreich encodiert, Größe: {base64_size / 1024 / 1024:.2f} MB")
            
            return {
                "success": True,
                "panorama_base64": panorama_base64,
                "status_message": status_messages[status],
                "panorama_size": {
                    "width": panorama.shape[1],
                    "height": panorama.shape[0]
                },
                "statistics": {
                    "total_requested": total_requested,
                    "total_loaded": total_loaded,
                    "total_failed": total_failed,
                    "total_used": total_loaded  # Alle geladenen Bilder wurden verwendet
                },
                "transformation_matrices": transformation_matrices,  # Liste von 3x3 Homographie-Matrizen
                "image_sizes": image_sizes,  # Liste von {width, height} für jedes Originalbild
                "warnings": failed_items if failed_items else None
            }
        else:
            error_msg = status_messages.get(status, f"Unbekannter Fehler (Status: {status})")
            print(f"Stitching fehlgeschlagen: {error_msg}")
            raise HTTPException(
                status_code=500,
                detail={
                    "error": error_msg,
                    "error_code": f"STITCH_STATUS_{status}",
                    "status_code": status,
                    "loaded_images": len(images),
                    "failed_items": failed_items
                }
            )
            
    except HTTPException:
        raise
    except cv2.error as e:
        print(f"OpenCV Fehler: {e}")
        raise HTTPException(
            status_code=500,
            detail={
                "error": f"OpenCV Fehler: {str(e)}",
                "error_code": "OPENCV_ERROR"
            }
        )
    except Exception as e:
        print(f"Unerwarteter Fehler beim Stitching: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail={
                "error": f"Unerwarteter Fehler: {str(e)}",
                "error_code": "UNEXPECTED_ERROR"
            }
        )


@app.post("/compute-esp-angles")
async def compute_esp_angles(request: Dict[str, Any]):
    """
    Enrich detections and target_bird with esp_rot, esp_tilt, is_target_bird.
    Same formula as hardware-monitor (shoot). Called by Node when returning detections for the UI.
    Body: { detections, target_bird, camera_position, image_info, zoom_factor, camera_config, camera_source }
    Returns the same object with detections/target_bird mutated (esp_rot, esp_tilt, is_target_bird added).
    """
    try:
        detections = request.get("detections") or []
        target_bird = request.get("target_bird")
        camera_position = request.get("camera_position") or {}
        image_info = request.get("image_info") or {}
        zoom_factor = float(request.get("zoom_factor") or 1.0)
        camera_config = request.get("camera_config") or {}
        camera_source = request.get("camera_source")
        raspberry_pi_image_info = (image_info.get("raspberry_pi") if isinstance(image_info.get("raspberry_pi"), dict) else None)
        if not camera_position or camera_position.get("rotation") is None or camera_position.get("tilt") is None or not image_info:
            return request
        detections = copy.deepcopy(detections)
        target_bird = copy.deepcopy(target_bird) if target_bird else None
        cv_enrich_detections_esp_angles(
            detections,
            target_bird,
            camera_position,
            image_info,
            zoom_factor,
            camera_config,
            camera_source,
            raspberry_pi_image_info,
        )
        return {"detections": detections, "target_bird": target_bird}
    except Exception as e:
        logging.exception("compute_esp_angles error")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)