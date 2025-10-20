# ParkTayo Map API Documentation

## Overview
The ParkTayo Map API provides enhanced endpoints for displaying parking spaces on maps with area-based filtering, clustering, and optimized performance for mobile applications.

## New Endpoints

### 1. GET /api/v1/parking-spaces/map
**Purpose**: Get parking spaces optimized for map display within specific bounds

**Parameters**:
- `northEast` (required): JSON string `{"lat": number, "lng": number}` - Northeast corner of map bounds
- `southWest` (required): JSON string `{"lat": number, "lng": number}` - Southwest corner of map bounds
- `zoom` (optional): Zoom level (default: 15)
- `limit` (optional): Maximum number of results (default: 100)
- `minPrice` (optional): Minimum price per hour filter
- `maxPrice` (optional): Maximum price per hour filter
- `amenities` (optional): Array of amenity filters
- `vehicleType` (optional): Vehicle type filter
- `includePending` (optional): Include pending spaces (admin only)

**Example Request**:
```bash
GET /api/v1/parking-spaces/map?northEast={"lat":14.7,"lng":121.1}&southWest={"lat":14.5,"lng":120.9}&zoom=15&minPrice=15&maxPrice=30
```

**Response Format**:
```json
{
  "status": "success",
  "results": 25,
  "data": {
    "parkingSpaces": [
      {
        "id": "60f7b1234567890abcdef123",
        "name": "UE Large Parking Lot",
        "address": "Near UE, C.M. Recto Ave, Manila",
        "position": {
          "lat": 14.5997,
          "lng": 120.9827
        },
        "pricing": {
          "hourly": 20.0,
          "daily": 150.0
        },
        "availability": {
          "available": 45,
          "total": 50,
          "isAvailable": true
        },
        "amenities": ["CCTV", "Security Guard", "24/7 Access"],
        "rating": 4.2,
        "totalReviews": 128,
        "type": "Open Lot",
        "status": "active",
        "isVerified": true,
        "imageUrl": "https://example.com/image.jpg",
        "landlord": {
          "name": "John Doe",
          "rating": 4.5,
          "totalReviews": 89
        }
      }
    ],
    "bounds": {
      "northEast": {"lat": 14.7, "lng": 121.1},
      "southWest": {"lat": 14.5, "lng": 120.9}
    },
    "clustering": {
      "enabled": true,
      "zoom": 15
    },
    "filters": {
      "minPrice": 15,
      "maxPrice": 30,
      "amenities": ["CCTV"],
      "vehicleType": "car"
    }
  }
}
```

### 2. GET /api/v1/parking-spaces/clusters
**Purpose**: Get parking space clusters for map optimization

**Parameters**:
- `northEast` (required): JSON string `{"lat": number, "lng": number}`
- `southWest` (required): JSON string `{"lat": number, "lng": number}`
- `zoom` (optional): Zoom level for clustering (default: 15)
- `clusterRadius` (optional): Cluster radius in pixels (default: 50)

**Example Request**:
```bash
GET /api/v1/parking-spaces/clusters?northEast={"lat":14.7,"lng":121.1}&southWest={"lat":14.5,"lng":120.9}&zoom=12
```

**Response Format**:
```json
{
  "status": "success",
  "results": 8,
  "data": {
    "clusters": [
      {
        "position": {
          "lat": 14.6022,
          "lng": 120.9897
        },
        "count": 12,
        "avgPrice": 22,
        "avgRating": 4.3,
        "totalSpots": 180,
        "spaces": [
          {
            "id": "60f7b1234567890abcdef123",
            "name": "UE Large Parking Lot",
            "price": 20,
            "rating": 4.2,
            "available": 45
          }
        ]
      }
    ],
    "bounds": {
      "northEast": {"lat": 14.7, "lng": 121.1},
      "southWest": {"lat": 14.5, "lng": 120.9}
    },
    "zoom": 12
  }
}
```

## Integration Examples

### Flutter Integration
```dart
// Get parking spaces for map
final response = await ApiService().getParkingSpacesForMap(
  northEastLat: 14.7,
  northEastLng: 121.1,
  southWestLat: 14.5,
  southWestLng: 120.9,
  zoom: 15,
  minPrice: 15.0,
  maxPrice: 30.0,
  amenities: ['CCTV', 'Security Guard'],
  vehicleType: 'car',
);

if (response.success) {
  final parkingSpaces = response.data!;
  // Update map markers
  updateMapMarkers(parkingSpaces);
}
```

### JavaScript Integration
```javascript
// Get parking spaces for map
const response = await fetch(`${API_BASE_URL}/parking-spaces/map?${new URLSearchParams({
  northEast: JSON.stringify({lat: 14.7, lng: 121.1}),
  southWest: JSON.stringify({lat: 14.5, lng: 120.9}),
  zoom: '15',
  minPrice: '15',
  maxPrice: '30'
})}`);

const data = await response.json();
if (data.status === 'success') {
  const parkingSpaces = data.data.parkingSpaces;
  // Update map markers
  updateMapMarkers(parkingSpaces);
}
```

## Performance Considerations

### Optimizations Implemented
1. **Geospatial Indexing**: Uses MongoDB 2dsphere index for efficient location queries
2. **Lean Queries**: Uses `.lean()` for better performance on large datasets
3. **Field Selection**: Only returns necessary fields for map display
4. **Clustering**: Automatic clustering for zoom levels < 16
5. **Bounds Filtering**: Efficient $geoWithin queries for map bounds

### Best Practices
1. **Limit Results**: Use appropriate `limit` values (recommended: 50-100)
2. **Zoom-based Loading**: Load different detail levels based on zoom
3. **Debounce Requests**: Debounce map movement to avoid excessive API calls
4. **Cache Results**: Cache results for recently viewed areas
5. **Progressive Loading**: Load basic info first, details on demand

## Error Handling

### Common Errors
- `400 Bad Request`: Invalid bounds format or missing required parameters
- `404 Not Found`: No parking spaces found in the specified area
- `500 Internal Server Error`: Database or server issues

### Error Response Format
```json
{
  "status": "error",
  "message": "Invalid bounds format. Expected: {lat: number, lng: number}",
  "statusCode": 400
}
```

## Rate Limiting
- **Map API**: 100 requests per minute per IP
- **Cluster API**: 50 requests per minute per IP
- **Authenticated Users**: 200 requests per minute

## Testing

### Test Script
Run the test script to verify all endpoints:
```bash
node test-map-api.js
```

### Manual Testing
1. **Basic Map Query**:
   ```bash
   curl "http://192.168.88.254:5000/api/v1/parking-spaces/map?northEast={\"lat\":14.7,\"lng\":121.1}&southWest={\"lat\":14.5,\"lng\":120.9}"
   ```

2. **Filtered Query**:
   ```bash
   curl "http://192.168.88.254:5000/api/v1/parking-spaces/map?northEast={\"lat\":14.7,\"lng\":121.1}&southWest={\"lat\":14.5,\"lng\":120.9}&minPrice=15&maxPrice=30&amenities=CCTV"
   ```

3. **Cluster Query**:
   ```bash
   curl "http://192.168.88.254:5000/api/v1/parking-spaces/clusters?northEast={\"lat\":14.7,\"lng\":121.1}&southWest={\"lat\":14.5,\"lng\":120.9}&zoom=12"
   ```

## Migration from Existing APIs

### From `/parking-spaces/nearby`
```dart
// Old way
final response = await ApiService().getNearbyParkingSpaces(
  latitude: 14.6,
  longitude: 121.0,
  radius: 5.0,
);

// New way (more efficient for map display)
final response = await ApiService().getParkingSpacesForMap(
  northEastLat: 14.65,
  northEastLng: 121.05,
  southWestLat: 14.55,
  southWestLng: 120.95,
  zoom: 15,
);
```

### Benefits of New API
1. **Better Performance**: Bounds-based queries are more efficient than radius queries
2. **Map Optimization**: Response format optimized for map display
3. **Clustering Support**: Built-in clustering for better UX
4. **Enhanced Filtering**: More granular filter options
5. **Consistent Format**: Standardized response format across all map operations

## Future Enhancements
1. **Real-time Updates**: WebSocket support for live availability updates
2. **Predictive Loading**: Load adjacent areas based on user movement patterns
3. **Offline Support**: Cache frequently accessed areas for offline use
4. **Advanced Clustering**: Dynamic clustering based on screen size and density
5. **Heatmaps**: Parking availability heatmap overlays 