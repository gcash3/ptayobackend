#!/usr/bin/env python3
"""
Simple Google Places tester (direct Google API or via backend proxy).

Usage examples:
  python test_places_api.py --query "University" --mode both
  python test_places_api.py --query "University of" --mode autocomplete
  python test_places_api.py --query "University Manila" --mode textsearch
  python test_places_api.py --query "UST" --backend https://api.parktayo.com/api/v1 --mode both

API key resolution order:
  1) --key argument
  2) Environment variable GOOGLE_MAPS_API_KEY
  3) .env file (use --env to specify path, defaults to ./.env)
"""

from __future__ import annotations

import os
import json
import argparse
import urllib.parse
import urllib.request
from typing import Dict, Any, Tuple


def read_env_file(env_path: str = '.env') -> Dict[str, str]:
    config: Dict[str, str] = {}
    try:
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    config[key.strip()] = value.strip()
    except FileNotFoundError:
        pass
    return config


def resolve_api_key(cli_key: str | None, env_path: str) -> str:
    if cli_key:
        return cli_key
    if os.getenv('GOOGLE_MAPS_API_KEY'):
        return os.getenv('GOOGLE_MAPS_API_KEY')  # type: ignore
    env = read_env_file(env_path)
    key = env.get('GOOGLE_MAPS_API_KEY')
    if not key:
        raise SystemExit('GOOGLE_MAPS_API_KEY not found. Provide --key, set env var, or put it in .env')
    return key


def http_get(url: str) -> Tuple[int, Dict[str, Any]]:
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=10) as resp:
        status = resp.getcode()
        body = resp.read().decode('utf-8')
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            data = {'raw': body}
        return status, data


def http_post_json(url: str, payload: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=10) as resp:
        status = resp.getcode()
        body = resp.read().decode('utf-8')
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            data = {'raw': body}
        return status, data


def do_google_autocomplete(key: str, query: str, sessiontoken: str | None, lat: float, lng: float, radius: int) -> Tuple[int, Dict[str, Any]]:
    params = {
        'input': query,
        'key': key,
        'language': 'en',
        'components': 'country:ph',
        'types': 'establishment',
        'location': f'{lat},{lng}',
        'radius': str(radius),
        'strictbounds': 'true',
    }
    if sessiontoken:
        params['sessiontoken'] = sessiontoken
    url = 'https://maps.googleapis.com/maps/api/place/autocomplete/json?' + urllib.parse.urlencode(params)
    print(f'GET {url}')
    return http_get(url)


def do_google_textsearch(key: str, query: str, lat: float, lng: float, radius: int) -> Tuple[int, Dict[str, Any]]:
    params = {
        'query': query,
        'key': key,
        'language': 'en',
        'location': f'{lat},{lng}',
        'radius': str(radius),
    }
    url = 'https://maps.googleapis.com/maps/api/place/textsearch/json?' + urllib.parse.urlencode(params)
    print(f'GET {url}')
    return http_get(url)


def do_backend_autocomplete(backend: str, query: str, sessiontoken: str | None, lat: float, lng: float, radius: int) -> Tuple[int, Dict[str, Any]]:
    url = backend.rstrip('/') + '/places/autocomplete'
    payload = {
        'query': query,
        'language': 'en',
        'components': 'country:ph',
        'location': {'lat': lat, 'lng': lng},
        'radius': radius,
    }
    if sessiontoken:
        payload['sessionToken'] = sessiontoken
    print(f'POST {url} payload={payload}')
    return http_post_json(url, payload)


def do_backend_textsearch(backend: str, query: str, lat: float, lng: float, radius: int) -> Tuple[int, Dict[str, Any]]:
    url = backend.rstrip('/') + '/places/textsearch'
    payload = {
        'query': query,
        'language': 'en',
        'location': {'lat': lat, 'lng': lng},
        'radius': radius,
    }
    print(f'POST {url} payload={payload}')
    return http_post_json(url, payload)


def summarize(title: str, status: int, data: Dict[str, Any]) -> None:
    print(f'\n=== {title} ===')
    print(f'Status: {status}')
    if 'predictions' in data:
        items = data.get('predictions', [])
    elif 'results' in data:
        items = data.get('results', [])
    elif isinstance(data.get('data'), dict):
        d = data['data']
        items = d.get('predictions') or d.get('results') or []
    else:
        items = []
    print(f'Items: {len(items)}')
    for i, item in enumerate(items[:5]):
        desc = item.get('description') or f"{item.get('mainText','')} - {item.get('secondaryText','')}"
        print(f'{i+1}. {desc} | placeId={item.get("place_id") or item.get("placeId")}')


def parse_location(loc: str) -> Tuple[float, float]:
    try:
        lat_str, lng_str = loc.split(',')
        return float(lat_str), float(lng_str)
    except Exception:
        raise SystemExit('Invalid --location format. Use "lat,lng" e.g. 14.5995,120.9842')


def main() -> None:
    parser = argparse.ArgumentParser(description='Test Google Places (direct or via backend)')
    parser.add_argument('-q', '--query', required=True, help='Search query (e.g., "University")')
    parser.add_argument('--mode', choices=['autocomplete', 'textsearch', 'both'], default='autocomplete')
    parser.add_argument('--key', help='Google Maps API key (optional)')
    parser.add_argument('--env', default='.env', help='Path to .env file for GOOGLE_MAPS_API_KEY lookup')
    parser.add_argument('--backend', help='Backend base URL, e.g., http://localhost:5000/api/v1')
    parser.add_argument('--location', default='14.5995,120.9842', help='lat,lng (default Manila City Hall)')
    parser.add_argument('--radius', type=int, default=30000, help='Search radius in meters')
    parser.add_argument('--session', default=None, help='Optional Places session token')

    args = parser.parse_args()
    lat, lng = parse_location(args.location)

    if args.backend:
        # Test via backend
        if args.mode in ('autocomplete', 'both'):
            s, d = do_backend_autocomplete(args.backend, args.query, args.session, lat, lng, args.radius)
            summarize('Backend Autocomplete', s, d)
        if args.mode in ('textsearch', 'both'):
            s, d = do_backend_textsearch(args.backend, args.query, lat, lng, args.radius)
            summarize('Backend TextSearch', s, d)
    else:
        # Test direct Google API
        key = resolve_api_key(args.key, args.env)
        if args.mode in ('autocomplete', 'both'):
            s, d = do_google_autocomplete(key, args.query, args.session, lat, lng, args.radius)
            summarize('Google Autocomplete', s, d)
        if args.mode in ('textsearch', 'both'):
            s, d = do_google_textsearch(key, args.query, lat, lng, args.radius)
            summarize('Google TextSearch', s, d)


if __name__ == '__main__':
    main()


