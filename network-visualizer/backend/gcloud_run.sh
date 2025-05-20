gcloud run deploy network-visualizer-backend \
  --image gcr.io/network-visualizer-36300/network-visualizer-backend \
  --platform managed \
  --region us-east4 \
  --allow-unauthenticated \
  --set-env-vars FLASK_SECRET_KEY=-Ovjjk3O_P2zgDdwgzyAYbrZMtcF4bjsVsKY-IPvFx8,GCS_BUCKET_NAME=network-visualizer-36300_cloudbuild