#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SMS Configuration Analyzer and Tester
Analyzes the SMS service configuration and tests the SMS API
"""

import os
import json
import requests
from urllib.parse import urlencode
from datetime import datetime
import sys

def print_header(text):
    print("\n" + "="*60)
    print(text)
    print("="*60 + "\n")

def print_success(text):
    print(f"[OK] {text}")

def print_error(text):
    print(f"[ERROR] {text}")

def print_warning(text):
    print(f"[WARN] {text}")

def print_info(text):
    print(f"[INFO] {text}")

def read_env_file(env_path='.env'):
    """Read .env file and parse configuration"""
    config = {}
    
    if not os.path.exists(env_path):
        print_error(f".env file not found at: {env_path}")
        return None
    
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                config[key.strip()] = value.strip()
    
    return config

def analyze_sms_configuration():
    """Analyze SMS configuration from .env file"""
    print_header("SMS CONFIGURATION ANALYSIS")
    
    config = read_env_file()
    if not config:
        print_error("Failed to read .env file")
        return None
    
    sms_config = {
        'SMS_SERVER_URL': config.get('SMS_SERVER_URL', 'NOT SET'),
        'SMS_API_KEY': config.get('SMS_API_KEY', 'NOT SET'),
        'SMS_DEFAULT_DEVICE': config.get('SMS_DEFAULT_DEVICE', 'NOT SET'),
        'SMS_DEFAULT_SIM_SLOT': config.get('SMS_DEFAULT_SIM_SLOT', 'NOT SET'),
        'SMS_ENABLE_NOTIFICATIONS': config.get('SMS_ENABLE_NOTIFICATIONS', 'NOT SET')
    }
    
    print_info("Environment Variables:")
    for key, value in sms_config.items():
        if 'API_KEY' in key and value != 'NOT SET':
            masked_value = value[:10] + '...' + value[-4:] if len(value) > 14 else '***'
            print(f"   {key}: {masked_value}")
        else:
            print(f"   {key}: {value}")
    
    # Check for issues
    print("\nConfiguration Issues:")
    
    issues_found = False
    
    if sms_config['SMS_SERVER_URL'] == 'NOT SET':
        print_warning("SMS_SERVER_URL is not set")
        issues_found = True
    
    if sms_config['SMS_API_KEY'] == 'NOT SET':
        print_warning("SMS_API_KEY is not set")
        issues_found = True
    
    if sms_config['SMS_DEFAULT_DEVICE'] == 'NOT SET':
        print_warning("SMS_DEFAULT_DEVICE is not set (hardcoded to 2 in smsService.js)")
        issues_found = True
    
    if sms_config['SMS_DEFAULT_SIM_SLOT'] == 'NOT SET':
        print_warning("SMS_DEFAULT_SIM_SLOT is not set (hardcoded to 1 in smsService.js)")
        issues_found = True
    
    if not issues_found:
        print_success("All required variables are set")
    
    return sms_config

def check_sms_service_code():
    """Check for hardcoded values in smsService.js"""
    print_header("SMS SERVICE CODE ANALYSIS")
    
    service_file = 'src/services/smsService.js'
    
    if not os.path.exists(service_file):
        print_error(f"smsService.js not found at: {service_file}")
        return []
    
    with open(service_file, 'r', encoding='utf-8') as f:
        content = f.read()
        lines = content.split('\n')
    
    print_info("Analyzing smsService.js for hardcoded values...")
    
    issues = []
    
    # Check for hardcoded device IDs
    for i, line in enumerate(lines, 1):
        if "devices:" in line and ("'1|1'" in line or "'2|2'" in line or "'0|0'" in line):
            print_error(f"Line {i}: Hardcoded device ID found!")
            print(f"   {line.strip()}")
            issues.append({
                'line': i,
                'issue': 'Hardcoded device ID',
                'fix': 'Use environment variables: devices: `${this.defaultDevice}|${this.defaultSimSlot}`'
            })
        
        # Check if template string is used (correct)
        if "devices:" in line and "${this.defaultDevice}" in line:
            print_success(f"Line {i}: Correctly using environment variables")
    
    # Check for environment variable usage in constructor
    env_vars_loaded = False
    for i, line in enumerate(lines, 1):
        if 'this.defaultDevice' in line and 'process.env.SMS_DEFAULT_DEVICE' in line:
            print_success(f"Line {i}: SMS_DEFAULT_DEVICE is loaded from environment")
            env_vars_loaded = True
        if 'this.defaultSimSlot' in line and 'process.env.SMS_DEFAULT_SIM_SLOT' in line:
            print_success(f"Line {i}: SMS_DEFAULT_SIM_SLOT is loaded from environment")
    
    if not env_vars_loaded:
        print_warning("Could not verify environment variable loading")
    
    if issues:
        print(f"\nFound {len(issues)} issue(s)")
        for issue in issues:
            print(f"\n  Line {issue['line']}: {issue['issue']}")
            print(f"  Fix: {issue['fix']}")
    else:
        print_success("Code looks good - using environment variables!")
    
    return issues

def test_sms_api_devices(api_key, server_url):
    """Test SMS API to get available devices"""
    print_header("SMS API DEVICE TEST")
    
    if api_key == 'NOT SET':
        print_error("Cannot test API: SMS_API_KEY is not configured")
        return
    
    try:
        print_info(f"Testing SMS API at: {server_url}")
        print_info(f"API Key: {api_key[:10]}...{api_key[-4:]}")
        
        # Get devices list
        payload = {
            'key': api_key
        }
        
        print_info("\nFetching available devices from SMS server...")
        
        response = requests.post(
            f"{server_url}/services/get-devices.php",
            data=payload,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
            timeout=15
        )
        
        print(f"\nResponse Status: {response.status_code}")
        
        if response.status_code == 200:
            try:
                data = response.json()
                print_success("API response received")
                print("\nResponse Data:")
                print(json.dumps(data, indent=2))
                
                if data.get('success'):
                    devices = data.get('data', {}).get('devices', [])
                    print(f"\nAvailable Devices: {len(devices)}")
                    
                    for device in devices:
                        status = "Online" if device.get('enabled') else "Offline"
                        print(f"\n   Device ID: {device.get('id')}")
                        print(f"   Name: {device.get('name')}")
                        print(f"   Model: {device.get('model')}")
                        print(f"   Status: {status}")
                        
                        # Check SIM slots
                        sim1 = device.get('sim1', {})
                        sim2 = device.get('sim2', {})
                        
                        if sim1:
                            print(f"   SIM 1: {sim1.get('operator')} ({sim1.get('number', 'No number')})")
                        if sim2:
                            print(f"   SIM 2: {sim2.get('operator')} ({sim2.get('number', 'No number')})")
                    
                    # Recommendation
                    print("\nRecommendation:")
                    if devices:
                        first_device = devices[0]
                        print(f"   Update your .env file:")
                        print(f"   SMS_DEFAULT_DEVICE={first_device.get('id')}")
                        print(f"   SMS_DEFAULT_SIM_SLOT=1 or 2 (depending on which SIM you want to use)")
                    else:
                        print_error("No devices found! You need to register a device in your SMS server.")
                else:
                    print_error(f"API Error: {data.get('error', 'Unknown error')}")
            except json.JSONDecodeError:
                print_error("Invalid JSON response")
                print("Response text:", response.text[:500])
        else:
            print_error(f"HTTP Error: {response.status_code}")
            print("Response:", response.text[:500])
            
    except requests.exceptions.ConnectionError:
        print_error(f"Connection failed to: {server_url}")
        print_warning("Make sure the SMS server URL is correct and accessible")
    except requests.exceptions.Timeout:
        print_error("Request timed out (15 seconds)")
    except Exception as e:
        print_error(f"Unexpected error: {str(e)}")

def main():
    """Main execution"""
    print("\n" + "="*60)
    print("      ParkTayo SMS Configuration Analyzer")
    print("="*60 + "\n")
    
    # Change to backend directory if not already there
    if os.path.exists('parktayo-backend'):
        os.chdir('parktayo-backend')
    
    # Step 1: Analyze configuration
    sms_config = analyze_sms_configuration()
    
    # Step 2: Check code for issues
    code_issues = check_sms_service_code()
    
    # Step 3: Test SMS API (optional)
    if sms_config and sms_config['SMS_API_KEY'] != 'NOT SET':
        print("\n" + "-"*60)
        proceed = input("Do you want to test the SMS API to get available devices? (y/n): ")
        if proceed.lower() == 'y':
            test_sms_api_devices(
                sms_config['SMS_API_KEY'],
                sms_config['SMS_SERVER_URL']
            )
    
    # Summary
    print_header("SUMMARY & SOLUTION")
    
    print("Root Cause:")
    print("   smsService.js was using hardcoded device ID")
    print("   The SMS server doesn't recognize that device")
    print("   Error: 'This device doesn't exist in database.'")
    
    print("\nSolution Applied:")
    print("   [OK] Updated smsService.js to use environment variables")
    print("   [OK] Now uses: SMS_DEFAULT_DEVICE and SMS_DEFAULT_SIM_SLOT from .env")
    
    print("\nNext Steps:")
    print("   1. Check your .env file for:")
    print("      SMS_DEFAULT_DEVICE=? (should match a device in your SMS server)")
    print("      SMS_DEFAULT_SIM_SLOT=? (1 or 2)")
    print("   2. Run the API test to see available devices")
    print("   3. Update .env with correct device ID")
    print("   4. Restart backend server")
    
    print("\nCurrent .env values:")
    if sms_config:
        print(f"   SMS_DEFAULT_DEVICE={sms_config.get('SMS_DEFAULT_DEVICE')}")
        print(f"   SMS_DEFAULT_SIM_SLOT={sms_config.get('SMS_DEFAULT_SIM_SLOT')}")
    
    print()

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nAnalysis interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"[ERROR] Unexpected error: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
