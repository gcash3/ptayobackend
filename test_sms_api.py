#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SMS API Tester - Test the ParkTayo SMS API directly
Based on the provided documentation
"""

import requests
from urllib.parse import urlencode
import json
import sys

# Configuration from the provided URL
SERVER = "https://sms.parktayo.com"
API_KEY = "3347205ca1a5deeb578ad3b24e79705cfcda38ff"
DEFAULT_DEVICE = 2
DEFAULT_SIM_SLOT = 1  # 0-indexed (0 = SIM 1, 1 = SIM 2)

def print_header(text):
    print("\n" + "="*60)
    print(text)
    print("="*60 + "\n")

def print_success(text):
    print(f"[OK] {text}")

def print_error(text):
    print(f"[ERROR] {text}")

def print_info(text):
    print(f"[INFO] {text}")

def test_get_devices():
    """Get all available devices from the SMS server"""
    print_header("TEST 1: GET AVAILABLE DEVICES")
    
    try:
        url = f"{SERVER}/services/get-devices.php"
        payload = {
            'key': API_KEY
        }
        
        print_info(f"Requesting: {url}")
        print_info(f"API Key: {API_KEY[:15]}...{API_KEY[-10:]}")
        
        response = requests.post(
            url,
            data=payload,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
            timeout=15
        )
        
        print_info(f"Response Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            
            if data.get('success'):
                print_success("Successfully retrieved devices!")
                
                devices = data.get('data', {}).get('devices', [])
                print(f"\nTotal Devices: {len(devices)}")
                
                for device in devices:
                    print(f"\n{'='*40}")
                    print(f"Device ID: {device.get('id')}")
                    print(f"Name: {device.get('name')}")
                    print(f"Model: {device.get('model')}")
                    print(f"Enabled: {device.get('enabled')}")
                    print(f"Priority: {device.get('priority')}")
                    
                    # SIM information
                    sim1 = device.get('sim1', {})
                    sim2 = device.get('sim2', {})
                    
                    if sim1:
                        print(f"\nSIM Slot 0 (First SIM):")
                        print(f"  Number: {sim1.get('number', 'N/A')}")
                        print(f"  Operator: {sim1.get('operator', 'N/A')}")
                    
                    if sim2:
                        print(f"\nSIM Slot 1 (Second SIM):")
                        print(f"  Number: {sim2.get('number', 'N/A')}")
                        print(f"  Operator: {sim2.get('operator', 'N/A')}")
                
                # Check if our configured device exists
                print(f"\n{'='*60}")
                print("CONFIGURATION CHECK:")
                device_ids = [d.get('id') for d in devices]
                
                if DEFAULT_DEVICE in device_ids:
                    print_success(f"Device ID {DEFAULT_DEVICE} EXISTS in the SMS server!")
                    
                    # Get the specific device
                    target_device = next((d for d in devices if d.get('id') == DEFAULT_DEVICE), None)
                    if target_device:
                        print(f"\nYour configured device:")
                        print(f"  Device ID: {DEFAULT_DEVICE}")
                        print(f"  SIM Slot: {DEFAULT_SIM_SLOT} (0=First, 1=Second)")
                        
                        if DEFAULT_SIM_SLOT == 0 and target_device.get('sim1'):
                            sim = target_device.get('sim1')
                            print(f"  SIM Number: {sim.get('number', 'N/A')}")
                            print(f"  SIM Operator: {sim.get('operator', 'N/A')}")
                        elif DEFAULT_SIM_SLOT == 1 and target_device.get('sim2'):
                            sim = target_device.get('sim2')
                            print(f"  SIM Number: {sim.get('number', 'N/A')}")
                            print(f"  SIM Operator: {sim.get('operator', 'N/A')}")
                        else:
                            print_error(f"SIM Slot {DEFAULT_SIM_SLOT} not found on this device!")
                else:
                    print_error(f"Device ID {DEFAULT_DEVICE} NOT FOUND!")
                    print(f"Available device IDs: {device_ids}")
                
                return devices
            else:
                print_error(f"API Error: {data.get('error', 'Unknown error')}")
                return None
        else:
            print_error(f"HTTP Error: {response.status_code}")
            print(f"Response: {response.text[:500]}")
            return None
            
    except requests.exceptions.ConnectionError as e:
        print_error(f"Connection failed to: {SERVER}")
        print_error("Make sure you have internet access and the SMS server is online")
        return None
    except requests.exceptions.Timeout:
        print_error("Request timed out (15 seconds)")
        return None
    except Exception as e:
        print_error(f"Unexpected error: {str(e)}")
        return None

def test_send_single_message(test_number="+639613085792", test_message="ParkTayo SMS Test - This is a test message"):
    """Send a single test SMS message"""
    print_header("TEST 2: SEND SINGLE SMS MESSAGE")
    
    try:
        url = f"{SERVER}/services/send.php"
        
        # Format: device|simslot (e.g., "2|1" for device 2, SIM slot 1)
        devices_param = f"{DEFAULT_DEVICE}|{DEFAULT_SIM_SLOT}"
        
        payload = {
            'key': API_KEY,
            'number': test_number,
            'message': test_message,
            'devices': devices_param,
            'type': 'sms',
            'prioritize': 1  # High priority for testing
        }
        
        print_info(f"Sending to: {test_number}")
        print_info(f"Message: {test_message}")
        print_info(f"Device Config: {devices_param} (Device {DEFAULT_DEVICE}, SIM Slot {DEFAULT_SIM_SLOT})")
        print_info(f"URL: {url}")
        print_info(f"Payload: {json.dumps(payload, indent=2)}")
        
        print("\n[CONFIRM] Do you want to send this test SMS? (y/n): ", end='')
        confirm = input().strip().lower()
        
        if confirm != 'y':
            print_info("Test cancelled by user")
            return None
        
        response = requests.post(
            url,
            data=payload,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
            timeout=30
        )
        
        print_info(f"Response Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            
            print("\nFull Response:")
            print(json.dumps(data, indent=2))
            
            if data.get('success'):
                print_success("Message sent successfully!")
                
                messages = data.get('data', {}).get('messages', [])
                if messages:
                    msg = messages[0]
                    print(f"\nMessage Details:")
                    print(f"  Message ID: {msg.get('ID')}")
                    print(f"  Number: {msg.get('number')}")
                    print(f"  Device ID: {msg.get('deviceID')}")
                    print(f"  SIM Slot: {msg.get('simSlot')}")
                    print(f"  Status: {msg.get('status')}")
                    print(f"  Type: {msg.get('type')}")
                    print(f"  Sent Date: {msg.get('sentDate')}")
                    print(f"  Group ID: {msg.get('groupID')}")
                
                return messages[0] if messages else None
            else:
                error_msg = data.get('error', {})
                if isinstance(error_msg, dict):
                    print_error(f"API Error: {error_msg.get('message', 'Unknown error')}")
                else:
                    print_error(f"API Error: {error_msg}")
                return None
        else:
            print_error(f"HTTP Error: {response.status_code}")
            print(f"Response: {response.text}")
            return None
            
    except Exception as e:
        print_error(f"Error sending message: {str(e)}")
        import traceback
        traceback.print_exc()
        return None

def test_get_balance():
    """Get remaining message credits"""
    print_header("TEST 3: GET MESSAGE CREDITS BALANCE")
    
    try:
        url = f"{SERVER}/services/send.php"
        payload = {
            'key': API_KEY
        }
        
        print_info(f"Requesting balance from: {url}")
        
        response = requests.post(
            url,
            data=payload,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
            timeout=15
        )
        
        if response.status_code == 200:
            data = response.json()
            
            if data.get('success'):
                credits = data.get('data', {}).get('credits')
                
                if credits is None:
                    print_success("Message Credits: UNLIMITED")
                else:
                    print_success(f"Message Credits Remaining: {credits}")
                
                return credits
            else:
                print_error(f"API Error: {data.get('error', 'Unknown error')}")
                return None
        else:
            print_error(f"HTTP Error: {response.status_code}")
            return None
            
    except Exception as e:
        print_error(f"Error getting balance: {str(e)}")
        return None

def verify_current_config():
    """Verify the current smsService.js configuration"""
    print_header("VERIFY CURRENT CODE CONFIGURATION")
    
    service_file = 'src/services/smsService.js'
    
    if not os.path.exists(service_file):
        print_error(f"smsService.js not found at: {service_file}")
        return
    
    with open(service_file, 'r', encoding='utf-8') as f:
        content = f.read()
        lines = content.split('\n')
    
    # Check constructor for env vars
    print_info("Checking environment variable configuration...")
    for i, line in enumerate(lines[:20], 1):
        if 'SMS_DEFAULT_DEVICE' in line:
            print(f"Line {i}: {line.strip()}")
        if 'SMS_DEFAULT_SIM_SLOT' in line:
            print(f"Line {i}: {line.strip()}")
    
    # Check for hardcoded values
    print("\nChecking for hardcoded device IDs...")
    found_hardcoded = False
    for i, line in enumerate(lines, 1):
        if "devices:" in line and ("'1|1'" in line or "'2|2'" in line or "'0|0'" in line):
            print_error(f"Line {i}: HARDCODED device found!")
            print(f"   {line.strip()}")
            found_hardcoded = True
        elif "devices:" in line and "${this.defaultDevice}" in line:
            print_success(f"Line {i}: Using environment variables correctly")
    
    if not found_hardcoded:
        print_success("No hardcoded device IDs found!")

def main():
    print("\n" + "="*60)
    print("      ParkTayo SMS API Direct Tester")
    print("="*60)
    print("\nConfiguration:")
    print(f"  Server: {SERVER}")
    print(f"  API Key: {API_KEY[:15]}...{API_KEY[-10:]}")
    print(f"  Device ID: {DEFAULT_DEVICE}")
    print(f"  SIM Slot: {DEFAULT_SIM_SLOT} (0=First SIM, 1=Second SIM)")
    print("="*60)
    
    # Test 1: Get available devices
    devices = test_get_devices()
    
    if not devices:
        print_error("\nCannot proceed without device information")
        return
    
    # Test 2: Get balance
    test_get_balance()
    
    # Test 3: Send test message (requires user confirmation)
    print("\n" + "-"*60)
    print("Ready to send test SMS")
    print("-"*60)
    test_send_single_message()
    
    # Summary
    print_header("SUMMARY & RECOMMENDATIONS")
    
    print("Based on the test results:")
    print("\n1. Update your .env file with:")
    print(f"   SMS_SERVER_URL={SERVER}")
    print(f"   SMS_API_KEY={API_KEY}")
    print(f"   SMS_DEFAULT_DEVICE={DEFAULT_DEVICE}")
    print(f"   SMS_DEFAULT_SIM_SLOT={DEFAULT_SIM_SLOT}")
    print("   SMS_ENABLE_NOTIFICATIONS=true")
    
    print("\n2. Verify smsService.js is using environment variables:")
    print("   Line 104 should be:")
    print("   devices: `${this.defaultDevice}|${this.defaultSimSlot}`,")
    
    print("\n3. Restart your backend server after updating .env")
    
    print("\n")

if __name__ == '__main__':
    import os
    
    # Try to change to backend directory
    if os.path.exists('parktayo-backend'):
        os.chdir('parktayo-backend')
    
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nTest interrupted by user")
        sys.exit(0)
    except Exception as e:
        print_error(f"Unexpected error: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)



