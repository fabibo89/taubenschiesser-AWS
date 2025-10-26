# AWS IoT Core Configuration for Taubenschiesser

# IoT Thing Type for Taubenschiesser devices
resource "aws_iot_thing_type" "taubenschiesser" {
  name = "${var.project_name}-device"

  properties {
    description           = "Taubenschiesser Hardware Device"
    searchable_attributes = ["deviceId", "location", "version"]
  }

  tags = {
    Name    = "${var.project_name}-thing-type"
    Project = var.project_name
  }
}

# IoT Policy for MQTT communication
resource "aws_iot_policy" "device_policy" {
  name = "${var.project_name}-device-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "iot:Connect"
        ]
        Resource = [
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:client/$${iot:Connection.Thing.ThingName}"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "iot:Publish"
        ]
        Resource = [
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topic/taubenschiesser/+/status",
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topic/taubenschiesser/+/telemetry"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "iot:Subscribe"
        ]
        Resource = [
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topicfilter/taubenschiesser/+/commands",
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topicfilter/taubenschiesser/+/config"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "iot:Receive"
        ]
        Resource = [
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topic/taubenschiesser/+/commands",
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topic/taubenschiesser/+/config"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "iot:UpdateThingShadow",
          "iot:GetThingShadow"
        ]
        Resource = [
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:thing/*"
        ]
      }
    ]
  })
}

# IoT Topic Rule to forward messages to backend API
resource "aws_iot_topic_rule" "device_status" {
  name        = "${replace(var.project_name, "-", "_")}_device_status"
  description = "Forward device status updates to backend API"
  enabled     = true
  sql         = "SELECT * FROM 'taubenschiesser/+/status'"
  sql_version = "2016-03-23"

  http {
    url = "https://${aws_lb.main.dns_name}/api/iot/status"

    http_header {
      key   = "Content-Type"
      value = "application/json"
    }
  }

  error_action {
    cloudwatch_logs {
      log_group_name = aws_cloudwatch_log_group.iot.name
      role_arn       = aws_iam_role.iot_rule_role.arn
    }
  }
}

# IoT Topic Rule for telemetry data
resource "aws_iot_topic_rule" "device_telemetry" {
  name        = "${replace(var.project_name, "-", "_")}_device_telemetry"
  description = "Forward device telemetry to backend API"
  enabled     = true
  sql         = "SELECT * FROM 'taubenschiesser/+/telemetry'"
  sql_version = "2016-03-23"

  http {
    url = "https://${aws_lb.main.dns_name}/api/iot/telemetry"

    http_header {
      key   = "Content-Type"
      value = "application/json"
    }
  }

  error_action {
    cloudwatch_logs {
      log_group_name = aws_cloudwatch_log_group.iot.name
      role_arn       = aws_iam_role.iot_rule_role.arn
    }
  }
}

# CloudWatch Log Group for IoT
resource "aws_cloudwatch_log_group" "iot" {
  name              = "/aws/iot/${var.project_name}"
  retention_in_days = 7

  tags = {
    Name = "${var.project_name}-iot-logs"
  }
}

# IAM Role for IoT Rules Engine
resource "aws_iam_role" "iot_rule_role" {
  name = "${var.project_name}-iot-rule-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "iot.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-iot-rule-role"
  }
}

# IAM Policy for IoT Rules to write to CloudWatch Logs
resource "aws_iam_role_policy" "iot_rule_cloudwatch" {
  name = "${var.project_name}-iot-cloudwatch-policy"
  role = aws_iam_role.iot_rule_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.iot.arn}:*"
      }
    ]
  })
}

# Data source for AWS Account ID
data "aws_caller_identity" "current" {}

# Outputs for IoT configuration
output "iot_endpoint" {
  description = "AWS IoT Core MQTT endpoint"
  value       = data.aws_iot_endpoint.mqtt.endpoint_address
}

output "iot_thing_type" {
  description = "IoT Thing Type name"
  value       = aws_iot_thing_type.taubenschiesser.name
}

output "iot_policy_name" {
  description = "IoT Policy name for device authentication"
  value       = aws_iot_policy.device_policy.name
}

# Data source to get IoT endpoint
data "aws_iot_endpoint" "mqtt" {
  endpoint_type = "iot:Data-ATS"
}


