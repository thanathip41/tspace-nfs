#!/bin/bash

IMAGE="example-nfs-server:develop"

echo "Do you want to build the Docker image: $IMAGE?"
read -p "Enter y (yes) or n (no): " build_choice

if [[ "$build_choice" == "y" || "$build_choice" == "Y" || "$build_choice" == "yes" ]]; then
  echo "Rebuilding Docker image..."

  docker-compose down

  kubectl delete -f nfs-log-reader.yaml
  kubectl delete -f nfs-deployment.yaml
  kubectl delete -f nfs-service.yaml

  sleep 3

  docker rmi $IMAGE
  docker build --no-cache -t $IMAGE .
else
  echo "Skipping image build."
fi

echo ""
echo "Choose the environment to deployment:"
echo "1) Docker"
echo "2) Kubernetes"
read -p "Enter 1 or 2: " choice

if [[ "$choice" == "1" ]]; then
  echo "Restarting Docker Compose..."
  docker-compose up -d
elif [[ "$choice" == "2" ]]; then
  echo "Restarting Kubernetes NFS deployment and service..."
  kubectl apply -f nfs-log-reader.yaml
  kubectl apply -f nfs-deployment.yaml
  kubectl apply -f nfs-service.yaml
else
  echo "Invalid choice. Please run the script again and choose 1 or 2."
fi
