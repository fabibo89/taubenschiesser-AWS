#!/bin/bash

# Taubenschiesser Cloud Platform AWS Deployment Script
# This script deploys the entire application to AWS using Terraform and ECS

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION="eu-central-1"
PROJECT_NAME="taubenschiesser"
ECR_REPOSITORY_NAME="taubenschiesser"

echo -e "${GREEN}🚀 Starting Taubenschiesser Cloud Platform Deployment${NC}"

# Check prerequisites
echo -e "${YELLOW}📋 Checking prerequisites...${NC}"

if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found. Please install AWS CLI.${NC}"
    exit 1
fi

if ! command -v terraform &> /dev/null; then
    echo -e "${RED}❌ Terraform not found. Please install Terraform.${NC}"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not found. Please install Docker.${NC}"
    exit 1
fi

# Check AWS credentials
echo -e "${YELLOW}🔐 Checking AWS credentials...${NC}"
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}❌ AWS credentials not configured. Please run 'aws configure'.${NC}"
    exit 1
fi

# Get AWS Account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPOSITORY_URL="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPOSITORY_NAME}"

echo -e "${GREEN}✅ Prerequisites check passed${NC}"

# Create ECR repository
echo -e "${YELLOW}📦 Creating ECR repository...${NC}"
aws ecr create-repository --repository-name $ECR_REPOSITORY_NAME --region $AWS_REGION 2>/dev/null || echo "Repository already exists"

# Login to ECR
echo -e "${YELLOW}🔑 Logging in to ECR...${NC}"
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REPOSITORY_URL

# Build and push Docker images
echo -e "${YELLOW}🏗️  Building and pushing Docker images...${NC}"

# Build API image
echo -e "${YELLOW}  📦 Building API image...${NC}"
cd server
docker build -t $ECR_REPOSITORY_URL:latest .
docker push $ECR_REPOSITORY_URL:latest
cd ..

# Build CV Service image
echo -e "${YELLOW}  📦 Building CV Service image...${NC}"
cd cv-service
docker build -t $ECR_REPOSITORY_URL:cv-latest .
docker push $ECR_REPOSITORY_URL:cv-latest
cd ..

# Build Frontend image
echo -e "${YELLOW}  📦 Building Frontend image...${NC}"
cd client
docker build -t $ECR_REPOSITORY_URL:frontend-latest .
docker push $ECR_REPOSITORY_URL:frontend-latest
cd ..

echo -e "${GREEN}✅ Docker images built and pushed${NC}"

# Deploy infrastructure with Terraform
echo -e "${YELLOW}🏗️  Deploying infrastructure with Terraform...${NC}"
cd aws/terraform

# Initialize Terraform
terraform init

# Create terraform.tfvars if it doesn't exist
if [ ! -f "terraform.tfvars" ]; then
    echo -e "${YELLOW}📝 Creating terraform.tfvars...${NC}"
    cp terraform.tfvars.example terraform.tfvars
    
    # Generate random secrets
    JWT_SECRET=$(openssl rand -base64 32)
    DOCDB_PASSWORD=$(openssl rand -base64 16)
    
    # Update terraform.tfvars with generated values
    sed -i.bak "s/your-super-secret-jwt-key-change-this/$JWT_SECRET/" terraform.tfvars
    sed -i.bak "s/your-docdb-password-change-this/$DOCDB_PASSWORD/" terraform.tfvars
    sed -i.bak "s/123456789012.dkr.ecr.eu-central-1.amazonaws.com\/taubenschiesser/$ECR_REPOSITORY_URL/" terraform.tfvars
    
    rm terraform.tfvars.bak
fi

# Plan and apply
terraform plan -out=tfplan
terraform apply tfplan

# Get outputs
LOAD_BALANCER_DNS=$(terraform output -raw load_balancer_dns)
VPC_ID=$(terraform output -raw vpc_id)
CLUSTER_NAME=$(terraform output -raw cluster_name)

echo -e "${GREEN}✅ Infrastructure deployed successfully${NC}"

# Deploy ECS services
echo -e "${YELLOW}🚀 Deploying ECS services...${NC}"

# Update ECS service to use the new image
aws ecs update-service \
    --cluster $CLUSTER_NAME \
    --service taubenschiesser-api \
    --force-new-deployment \
    --region $AWS_REGION

echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo -e "${GREEN}🌐 Application URL: http://$LOAD_BALANCER_DNS${NC}"
echo -e "${GREEN}📊 ECS Cluster: $CLUSTER_NAME${NC}"
echo -e "${GREEN}🔧 VPC ID: $VPC_ID${NC}"

echo -e "${YELLOW}📋 Next steps:${NC}"
echo -e "1. Configure your hardware devices to connect to the API"
echo -e "2. Set up RTSP streams for camera integration"
echo -e "3. Configure MQTT broker for hardware communication"
echo -e "4. Monitor the application using AWS CloudWatch"

cd ../..
