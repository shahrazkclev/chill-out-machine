# Simple build script for local testing
# This uses Vite's dev mode which doesn't require pre-building packages

Write-Host "Starting local dev server..."
Write-Host "The app should be available at http://localhost:3000"
Write-Host ""
Write-Host "Press Ctrl+C to stop the server"
Write-Host ""

cd excalidraw-app
yarn vite --host

