#!/bin/bash

echo "========================================"
echo "ParkTayo Backend API Testing Script"
echo "========================================"
echo ""

BASE_URL="http://192.168.88.254:5000"
API_URL="$BASE_URL/api/v1"

echo "Testing server health..."
curl -X GET $BASE_URL/health
echo -e "\n"

echo "========================================"
echo "Authentication Tests"
echo "========================================"
echo ""

echo "1. Testing test account login..."
curl -X POST $API_URL/auth/test-login \
  -H "Content-Type: application/json"
echo -e "\n"

echo "2. Testing user signup..."
curl -X POST $API_URL/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Test","lastName":"User","email":"test@example.com","password":"TestPassword123","role":"client"}'
echo -e "\n"

echo "3. Testing user login..."
curl -X POST $API_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPassword123"}'
echo -e "\n"

echo "4. Testing logout..."
curl -X POST $API_URL/auth/logout
echo -e "\n"

echo "========================================"
echo "Parking Spaces Tests (No Auth Required)"
echo "========================================"
echo ""

echo "1. Getting all parking spaces..."
curl -X GET "$API_URL/parking-spaces"
echo -e "\n"

echo "2. Searching parking spaces..."
curl -X GET "$API_URL/parking-spaces/search?q=test"
echo -e "\n"

echo "3. Getting nearby parking spaces..."
curl -X GET "$API_URL/parking-spaces/nearby?latitude=14.5997&longitude=120.9827&radius=5"
echo -e "\n"

echo "4. Getting nearby universities..."
curl -X GET "$API_URL/parking-spaces/universities/nearby?latitude=14.5997&longitude=120.9827"
echo -e "\n"

echo "5. Creating seed data (development only)..."
curl -X POST $API_URL/parking-spaces/seed
echo -e "\n"

echo "========================================"
echo "Testing Complete!"
echo "========================================" 