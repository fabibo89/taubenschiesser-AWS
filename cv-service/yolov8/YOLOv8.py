import time
import cv2
import numpy as np
import onnxruntime

from yolov8.utils import xywh2xyxy, nms, draw_detections


class YOLOv8:

    def __init__(self, path, conf_thres=0.7, iou_thres=0.5):
        self.conf_threshold = conf_thres
        self.iou_threshold = iou_thres

        # Initialize model
        self.initialize_model(path)

    def __call__(self, image):
        return self.detect_objects(image)

    def initialize_model(self, path):
        self.session = onnxruntime.InferenceSession(path,
                                                    providers=['CUDAExecutionProvider',
                                                               'CPUExecutionProvider'])
        # Get model info
        self.get_input_details()
        self.get_output_details()
        print("Used device: {}".format(onnxruntime.get_device()))

    def detect_objects(self, image):
        input_tensor = self.prepare_input(image)

        # Perform inference on the image
        outputs = self.inference(input_tensor)

        self.boxes, self.scores, self.class_ids = self.process_output(outputs)

        return self.boxes, self.scores, self.class_ids

    def prepare_input(self, image):
        self.img_height, self.img_width = image.shape[:2]

        input_img = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        # Resize input image
        input_img = cv2.resize(input_img, (self.input_width, self.input_height))

        # Scale input pixel values to 0 to 1
        input_img = input_img / 255.0
        input_img = input_img.transpose(2, 0, 1)
        input_tensor = input_img[np.newaxis, :, :, :].astype(np.float32)

        return input_tensor

    def inference(self, input_tensor):
        start = time.perf_counter()
        outputs = self.session.run(self.output_names, {self.input_names[0]: input_tensor})

        print(f"Inference time: {(time.perf_counter() - start) * 1000:.2f} ms")
        return outputs

    def process_output(self, output):
        raw = np.squeeze(output[0])

        if self.is_yolo26_format:
            # YOLO26: shape (300, 6) per detection: x1, y1, x2, y2, score, class_id (xyxy in input size)
            predictions = raw if raw.ndim == 2 else raw.reshape(-1, 6)
            scores = predictions[:, 4].astype(np.float32)
            mask = scores > self.conf_threshold
            predictions = predictions[mask]
            scores = scores[mask]
            if len(scores) == 0:
                return [], [], []
            class_ids = predictions[:, 5].astype(np.int32)
            boxes = self.rescale_boxes_xyxy(predictions[:, :4])
            indices = nms(boxes, scores, self.iou_threshold)
            return boxes[indices], scores[indices], class_ids[indices]
        else:
            # YOLOv8: shape (84, 8400) -> (8400, 84) with xywh + class scores
            predictions = raw.T
            scores = np.max(predictions[:, 4:], axis=1)
            predictions = predictions[scores > self.conf_threshold, :]
            scores = scores[scores > self.conf_threshold]
            if len(scores) == 0:
                return [], [], []
            class_ids = np.argmax(predictions[:, 4:], axis=1)
            boxes = self.extract_boxes(predictions)
            indices = nms(boxes, scores, self.iou_threshold)
            return boxes[indices], scores[indices], class_ids[indices]

    def extract_boxes(self, predictions):
        # Extract boxes from predictions
        boxes = predictions[:, :4]

        # Scale boxes to original image dimensions
        boxes = self.rescale_boxes(boxes)

        # Convert boxes to xyxy format
        boxes = xywh2xyxy(boxes)

        return boxes

    def rescale_boxes(self, boxes):
        # Rescale boxes (xywh) to original image dimensions
        input_shape = np.array([self.input_width, self.input_height, self.input_width, self.input_height])
        boxes = np.divide(boxes, input_shape, dtype=np.float32)
        boxes *= np.array([self.img_width, self.img_height, self.img_width, self.img_height])
        return boxes

    def rescale_boxes_xyxy(self, boxes):
        # Rescale boxes (xyxy, in input size) to original image dimensions
        scale_x = self.img_width / self.input_width
        scale_y = self.img_height / self.input_height
        boxes = boxes.astype(np.float32)
        boxes[:, [0, 2]] *= scale_x
        boxes[:, [1, 3]] *= scale_y
        return boxes

    def draw_detections(self, image, draw_scores=True, mask_alpha=0.4):
        return draw_detections(image, self.boxes, self.scores,
                               self.class_ids, mask_alpha)

    def get_input_details(self):
        model_inputs = self.session.get_inputs()
        self.input_names = [model_inputs[i].name for i in range(len(model_inputs))]

        self.input_shape = model_inputs[0].shape
        self.input_height = self.input_shape[2]
        self.input_width = self.input_shape[3]

    def get_output_details(self):
        model_outputs = self.session.get_outputs()
        self.output_names = [model_outputs[i].name for i in range(len(model_outputs))]
        # Detect format: YOLO26 has shape (1, 300, 6) = (batch, num_detections, 6) with x1,y1,x2,y2,score,class_id
        self.output_shape = getattr(model_outputs[0], 'shape', ())
        try:
            last_dim = self.output_shape[-1] if self.output_shape else 0
            last_dim = int(last_dim) if isinstance(last_dim, (str, np.generic)) else last_dim
        except (ValueError, TypeError):
            last_dim = 0
        self.is_yolo26_format = (
            len(self.output_shape) == 3 and last_dim == 6
        )


if __name__ == '__main__':
    from imread_from_url import imread_from_url

    model_path = "../models/yolov8m.onnx"

    # Initialize YOLOv7 object detector
    yolov7_detector = YOLOv8(model_path, conf_thres=0.3, iou_thres=0.5)

    img_url = "https://live.staticflickr.com/13/19041780_d6fd803de0_3k.jpg"
    img = imread_from_url(img_url)

    # Detect Objects
    yolov7_detector(img)

    # Draw detections
    combined_img, _ = yolov7_detector.draw_detections(img)
    cv2.namedWindow("Output", cv2.WINDOW_NORMAL)
    cv2.imshow("Output", combined_img)
    cv2.waitKey(0)
