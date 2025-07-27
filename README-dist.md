# Dipper (Bioacoustics Training GUI) - Distribution Build

This is a standalone desktop application for bioacoustics machine learning inference and annotation review.

## Features

- **Species Detection Inference**: Run PyTorch-based bioacoustics models (HawkEars, RanaSierraeCNN) on audio files
- **Data Exploration**: Visualize and explore audio datasets with spectrograms
- **Annotation Review**: Review and annotate audio clips with binary or multi-class labels

## Supported Models

- **HawkEars**: Canadian bird classification CNN v0.1.0 (PyTorch)
- **RanaSierraeCNN**: CNN trained to detect Rana sierrae calls (PyTorch)

## System Requirements

- macOS 10.15 or later
- 4GB RAM minimum, 8GB recommended
- 2GB free disk space

## Installation

1. Download the `.dmg` file
2. Double-click to mount the disk image
3. Drag the application to your Applications folder
4. Launch the application from Applications

## Usage

1. **Inference**: Select a model, choose audio files, and run inference to detect species
2. **Explore**: Load CSV files with detection results to explore your data
3. **Review**: Load annotation tasks to review and label audio clips

## Notes

- This version includes only PyTorch-based models for better compatibility
- The application bundles its own Python environment for reliability
- First launch may take a moment as the application initializes

## Support

For issues or questions, please visit the project repository.