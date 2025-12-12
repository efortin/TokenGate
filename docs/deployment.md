# Deployment Guide

This guide covers deploying Token Gate locally, with Docker, and on Kubernetes.

## Local Development

### Prerequisites

- Node.js 22+
- npm

### Installation

```bash
git clone https://github.com/efortin/token-gate.git
cd token-gate
npm install
```

### Running

```bash
# Development with hot reload
VLLM_URL=http://localhost:8000 \
VLLM_MODEL=qwen \
npm run dev

# Production
npm run build
VLLM_URL=http://localhost:8000 \
VLLM_MODEL=qwen \
npm start
```

### Environment Variables

Create a `.env` file (optional):

```bash
PORT=3456
HOST=0.0.0.0
API_KEY=your-secret-key
VLLM_URL=http://localhost:8000
VLLM_MODEL=qwen
LOG_LEVEL=info
```

## Docker

### Build

```bash
docker build -t token-gate .
```

### Run

```bash
docker run -d \
  --name token-gate \
  -p 3456:3456 \
  -e VLLM_URL=http://your-vllm-server:8000 \
  -e VLLM_MODEL=qwen \
  -e API_KEY=your-secret-key \
  token-gate
```

### With Vision Backend

```bash
docker run -d \
  --name token-gate \
  -p 3456:3456 \
  -e VLLM_URL=http://inference:8000 \
  -e VLLM_MODEL=qwen \
  -e VISION_URL=http://vision:11434 \
  -e VISION_MODEL=llava \
  -e API_KEY=your-secret-key \
  token-gate
```

### Docker Compose

```yaml
version: '3.8'

services:
  token-gate:
    build: .
    ports:
      - "3456:3456"
    environment:
      - VLLM_URL=http://vllm:8000
      - VLLM_MODEL=qwen
      - API_KEY=${API_KEY}
    depends_on:
      - vllm

  vllm:
    image: vllm/vllm-openai:latest
    # ... vLLM configuration
```

### Container Management

```bash
docker logs -f token-gate    # View logs
docker stop token-gate       # Stop
docker start token-gate      # Start
docker rm token-gate         # Remove
```

### Using GHCR Image

```bash
docker pull ghcr.io/efortin/token-gate:latest

docker run -d \
  --name token-gate \
  -p 3456:3456 \
  -e VLLM_URL=http://your-vllm-server:8000 \
  -e VLLM_MODEL=qwen \
  ghcr.io/efortin/token-gate:latest
```

## Kubernetes

### Prerequisites

- kubectl configured
- Kubernetes cluster (k3s, EKS, GKE, etc.)

### Namespace

```bash
kubectl create namespace vllm
```

### Secrets

```bash
kubectl create secret generic anthropic-router-secret \
  --namespace vllm \
  --from-literal=api-key=your-secret-key

kubectl create secret generic vllm-secret \
  --namespace vllm \
  --from-literal=api-key=your-vllm-api-key
```

### Deployment

Apply the manifests from `assets/k8s/`:

```bash
kubectl apply -f assets/k8s/deployment.yaml
```

Or create manually:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: token-gate
  namespace: vllm
spec:
  replicas: 1
  selector:
    matchLabels:
      app: token-gate
  template:
    metadata:
      labels:
        app: token-gate
    spec:
      containers:
        - name: token-gate
          image: ghcr.io/efortin/token-gate:latest
          ports:
            - containerPort: 3456
          env:
            - name: PORT
              value: "3456"
            - name: VLLM_URL
              value: "http://vllm-api.vllm.svc.cluster.local:8000"
            - name: VLLM_MODEL
              value: "qwen"
            - name: API_KEY
              valueFrom:
                secretKeyRef:
                  name: anthropic-router-secret
                  key: api-key
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /health
              port: 3456
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health
              port: 3456
            initialDelaySeconds: 5
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: token-gate
  namespace: vllm
spec:
  selector:
    app: token-gate
  ports:
    - port: 3456
      targetPort: 3456
```

### Verify Deployment

```bash
kubectl get pods -n vllm
kubectl logs -n vllm -l app=token-gate
kubectl port-forward -n vllm svc/token-gate 3456:3456
curl http://localhost:3456/health
```

### Ingress (Optional)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: token-gate
  namespace: vllm
spec:
  rules:
    - host: token-gate.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: token-gate
                port:
                  number: 3456
```

### Scaling

```bash
kubectl scale deployment token-gate -n vllm --replicas=3
```

### Horizontal Pod Autoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: token-gate
  namespace: vllm
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: token-gate
  minReplicas: 1
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

## Health Checks

Token Gate exposes health endpoints:

- `GET /health` - Returns `{"status": "ok"}` when healthy
- `GET /stats` - Returns token usage statistics

Use these for load balancer health checks and Kubernetes probes.

## Troubleshooting

### Backend Unreachable

```
Backend vllm unreachable at http://localhost:8000 - check VLLM_URL
```

Verify the backend URL is correct and accessible from Token Gate.

### Port Already in Use

```
listen EADDRINUSE: address already in use 0.0.0.0:3456
```

Change the `PORT` environment variable or stop the conflicting process.

### Authentication Errors

Verify `API_KEY` matches what clients are sending in `Authorization` header or `x-api-key`.
