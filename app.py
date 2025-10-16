#!/usr/bin/env python3
"""
Bioacoustics Training GUI - NiceGUI Implementation
Main application entry point
"""

import os
import sys
import json
import asyncio
from pathlib import Path
from typing import Optional, List, Dict, Any

from nicegui import ui, app, events
import numpy as np
import pandas as pd

# Add backend scripts to path
backend_scripts_path = Path(__file__).parent / "backend" / "scripts"
sys.path.insert(0, str(backend_scripts_path))

# Import tabs
from tabs.inference_tab import InferenceTab
from tabs.training_tab import TrainingTab
from tabs.extraction_tab import ExtractionTab
from tabs.explore_tab import ExploreTab
from tabs.review_tab import ReviewTab
from tabs.help_tab import HelpTab


class BioacousticsApp:
    """Main application class"""

    def __init__(self):
        self.current_tab = "inference"
        self.tabs = {}

    def setup_ui(self):
        """Setup the main user interface"""
        # Use default theme (not dark mode for better compatibility)
        # ui.dark_mode().enable()

        # Main page title
        # with ui.header(elevated=True).classes("items-center justify-between"):
        #     ui.label("Bioacoustics Training GUI").classes("text-h5")
        #     ui.space()
        #     ui.label("NiceGUI Version").classes("text-caption")

        # Create tabs
        with ui.tabs().classes("w-full") as tabs:
            inference_tab = ui.tab("inference", label="Inference", icon="play_arrow")
            training_tab = ui.tab("training", label="Training", icon="school")
            extraction_tab = ui.tab("extraction", label="Extraction", icon="colorize")
            explore_tab = ui.tab("explore", label="Explore", icon="explore")
            review_tab = ui.tab("review", label="Review", icon="rule")
            help_tab = ui.tab("help", label="Help", icon="help")

        # Tab panels
        with ui.tab_panels(tabs, value="inference").classes("w-full"):
            # Inference Tab
            with ui.tab_panel("inference"):
                self.tabs["inference"] = InferenceTab()
                self.tabs["inference"].render()

            # Training Tab
            with ui.tab_panel("training"):
                self.tabs["training"] = TrainingTab()
                self.tabs["training"].render()

            # Extraction Tab
            with ui.tab_panel("extraction"):
                self.tabs["extraction"] = ExtractionTab()
                self.tabs["extraction"].render()

            # Explore Tab
            with ui.tab_panel("explore"):
                self.tabs["explore"] = ExploreTab()
                self.tabs["explore"].render()

            # Review Tab
            with ui.tab_panel("review"):
                self.tabs["review"] = ReviewTab()
                self.tabs["review"].render()

            # Help Tab
            with ui.tab_panel("help"):
                self.tabs["help"] = HelpTab()
                self.tabs["help"].render()


# Create and run the application
@ui.page("/")
def index():
    """Main page route"""
    app_instance = BioacousticsApp()
    app_instance.setup_ui()


if __name__ in {"__main__", "__mp_main__"}:
    # Run the app
    ui.run(
        title="Bioacoustics Training GUI",
        port=8080,
        reload=False,
        native=True,
        show=False,  # Don't auto-open browser in headless env
    )
