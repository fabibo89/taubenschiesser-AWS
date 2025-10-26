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
    model_path = os.getenv('MODEL_PATH', '../models/yolov8l.onnx')
    
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
                "name": "YOLOv8",
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
            "service": "YOLOv8"
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
            "service": "YOLOv8-Optimized",
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)