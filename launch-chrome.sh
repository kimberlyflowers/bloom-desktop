#!/bin/bash
# Launch Chrome with CDP enabled for BLOOM Desktop

echo "Launching Chrome with remote debugging on port 9222..."

if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
    --remote-debugging-port=9222 \
    --user-data-dir="$HOME/.bloom-chrome-profile" \
    &
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  # Linux
  google-chrome \
    --remote-debugging-port=9222 \
    --user-data-dir="$HOME/.bloom-chrome-profile" \
    &
fi

echo "Chrome launched. CDP available at http://localhost:9222"
echo "You can now connect BLOOM Desktop with browser_connect"
echo ""
echo "To test the connection:"
echo "curl http://localhost:9222/json/version"