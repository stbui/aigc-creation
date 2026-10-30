CANVAS_RELEASE=v1.7.3.2
curl -fsSL "https://raw.githubusercontent.com/ddcat-ai/open-ai-canvas/${CANVAS_RELEASE}/scripts/install-server-image.sh" \
  | sudo env CANVAS_IMAGE_TAG="${CANVAS_RELEASE}" REPOSITORY_REF="${CANVAS_RELEASE}" bash