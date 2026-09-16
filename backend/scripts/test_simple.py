#!/usr/bin/env python3
"""Simple test script to verify PyInstaller works."""

import sys
import os
import json
import argparse


def main():
    parser = argparse.ArgumentParser(description="Simple test server")
    parser.add_argument("--port", type=int, default=8000, help="Port to run on")
    parser.add_argument("--test", action="store_true", help="Run test")

    args = parser.parse_args()

    if args.test:
        print("Test successful!")
        print(f"Python version: {sys.version}")
        print(f"OS: {os.name}")
        return 0

    print(f"Would start server on port {args.port}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
