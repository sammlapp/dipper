#!/usr/bin/env python3
"""
Test script to verify the Python environment is set up correctly
"""

import sys
import json
import logging

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger(__name__)

def test_imports():
    """Test importing key libraries"""
    results = {}
    
    # Test basic imports
    try:
        import numpy as np
        results['numpy'] = f"✓ {np.__version__}"
        logger.info(f"NumPy: {np.__version__}")
    except ImportError as e:
        results['numpy'] = f"✗ {e}"
        logger.error(f"NumPy import failed: {e}")
    
    try:
        import pandas as pd
        results['pandas'] = f"✓ {pd.__version__}"
        logger.info(f"Pandas: {pd.__version__}")
    except ImportError as e:
        results['pandas'] = f"✗ {e}"
        logger.error(f"Pandas import failed: {e}")
    
    try:
        import torch
        results['torch'] = f"✓ {torch.__version__}"
        logger.info(f"PyTorch: {torch.__version__}")
    except ImportError as e:
        results['torch'] = f"✗ {e}"
        logger.error(f"PyTorch import failed: {e}")
    
    try:
        import opensoundscape
        results['opensoundscape'] = f"✓ {opensoundscape.__version__}"
        logger.info(f"OpenSoundscape: {opensoundscape.__version__}")
    except ImportError as e:
        results['opensoundscape'] = f"✗ {e}"
        logger.error(f"OpenSoundscape import failed: {e}")
    
    try:
        import bioacoustics_model_zoo as bmz
        results['bioacoustics_model_zoo'] = "✓ Available"
        logger.info("Bioacoustics Model Zoo: Available")
        
        # Test available models
        models = []
        for model_name in ['BirdNET', 'Perch', 'HawkEars', 'RanaSierraeCNN']:
            try:
                if hasattr(bmz, model_name):
                    models.append(model_name)
            except Exception:
                pass
        
        results['available_models'] = models
        logger.info(f"Available models: {models}")
        
    except ImportError as e:
        results['bioacoustics_model_zoo'] = f"✗ {e}"
        logger.error(f"Bioacoustics Model Zoo import failed: {e}")
        results['available_models'] = []
    
    # Test pydantic fix
    try:
        import pydantic.deprecated.decorator
        results['pydantic_fix'] = "✓ Available"
        logger.info("Pydantic deprecated decorator: Available")
    except ImportError as e:
        results['pydantic_fix'] = f"✗ {e}"
        logger.warning(f"Pydantic fix import failed: {e}")
    
    return results

def main():
    logger.info("Testing Python environment...")
    logger.info(f"Python version: {sys.version}")
    logger.info(f"Python executable: {sys.executable}")
    
    results = test_imports()
    
    # Output results as JSON for the GUI
    output = {
        'python_version': sys.version,
        'python_executable': sys.executable,
        'import_results': results,
        'status': 'success' if all('✓' in str(v) for k, v in results.items() if k != 'available_models') else 'partial'
    }
    
    print(json.dumps(output, indent=2))

if __name__ == "__main__":
    main()