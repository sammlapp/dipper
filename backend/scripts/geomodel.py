"""
Example Usage:
geo = BirdNETGeomodel()
local_sp = geo(40.7128, -74.0060, 20) # Example for New York City, week 20
subset_classifier_labels("HawkEars", local_sp)
"""

import os
import sys
import numpy as np
import onnxruntime as ort
import pandas as pd
import huggingface_hub

# In a PyInstaller frozen build sys._MEIPASS is the extraction root;
# in development __file__ is backend/scripts/geomodel.py so data is one level up.
_BASE = getattr(sys, "_MEIPASS", os.path.join(os.path.dirname(__file__), ".."))
_CLASS_TABLES_DIR = os.path.join(_BASE, "data", "class_names")


def load_labels(labels_path):
    """Load species labels from labels.txt."""
    labels = []
    with open(labels_path) as f:
        for line in f:
            parts = line.strip().split("\t")
            labels.append({"code": parts[0], "sci": parts[1], "common": parts[2]})
    return labels


def get_class_table(classifier_name):
    """Return the full class name table for a classifier as a DataFrame.

    The first column is the model's native class label (the value the model
    actually outputs). Remaining columns are scientific_name, common_name,
    ebird_code, alpha — with NaN where a mapping is unavailable.
    """
    csv_path = os.path.join(_CLASS_TABLES_DIR, f"{classifier_name}.csv")
    if not os.path.exists(csv_path):
        raise ValueError(f"No class table found for classifier: {classifier_name}")
    return pd.read_csv(csv_path, dtype=str).fillna("")


def get_classifier_labels(classifier_name):
    """Return the list of native class labels for a classifier (first CSV column)."""
    df = get_class_table(classifier_name)
    return df.iloc[:, 0].tolist()


MODEL_CLASS_COL = {
    "BirdNET_V3.0.3": "scientific_name",
    "Perch2": "scientific_name",
    "Perch2LiteRT": "scientific_name",
    "Perch2ONNX": "scientific_name",
    "Perch": "ebird_code",
    "BirdSetConvNeXT": "ebird_code",
    "BirdSetEfficientNetB1": "ebird_code",
    "HawkEars_v010": "common_name",
    "HawkEars": "common_name",
    "BirdNET": "composite",
}


def subset_classifier_labels(classifier_name, geo_df):
    """Subset the class table to species present in the geomodel result.

    The geomodel always produces scientific_name, so we join on that column
    regardless of which column is the model's native class label.  The returned
    DataFrame contains all class-table columns (native label, scientific_name,
    common_name, ebird_code, alpha) plus the geomodel probability, sorted by
    probability descending.
    """
    class_df = get_class_table(classifier_name)

    # Join class table onto geomodel result via scientific_name
    merged = class_df.merge(
        geo_df[["scientific_name", "probability"]],
        on="scientific_name",
        how="inner",
    )
    return merged.sort_values("probability", ascending=False)


class BirdNETGeomodel:
    def __init__(self, version="3.0.3"):
        labels_path = huggingface_hub.hf_hub_download(
            repo_id="sammlapp/BirdNET_GeoModel",
            filename=f"BirdNET+_Geomodel_V{version}_Global_12K_Labels.txt",
        )
        onnx_path = huggingface_hub.hf_hub_download(
            repo_id="sammlapp/BirdNET_GeoModel",
            filename=f"BirdNET+_Geomodel_V{version}_Global_12K_FP32.onnx",
        )

        self.session = ort.InferenceSession(onnx_path)
        self.labels = load_labels(labels_path)

    def __call__(self, lat, lon, week, min_probability=0.05):
        """Generate species presence probabilities for a single lat/lon/week

        See also: self.batched_predict for batch processing.

        """
        inputs = np.array([[lat, lon, week]], dtype=np.float32)

        probs = self.session.run(None, {"input": inputs})[
            0
        ]  # batch size 1, get first element

        probs_df = pd.DataFrame(
            {
                "ebird_code": [label["code"] for label in self.labels],
                "scientific_name": [label["sci"] for label in self.labels],
                "common_name": [label["common"] for label in self.labels],
                "probability": probs[0],
            }
        )

        if min_probability is not None:
            probs_df = probs_df[probs_df["probability"] >= min_probability]

        return probs_df.sort_values(by="probability", ascending=False)

    def batched_predict(self, lat_lon_week_array, min_probability=0.05):
        """Generate species presence probabilities for a batch of lat/lon/week inputs.

        lat_lon_week_array: numpy array of shape (N, 3) where each row is [lat, lon, week]

        Returns a list of dictionaries:
            {
                "latitude":,
                "longitude":,
                "week":,
                "probabilities": [
                    {
                        "ebird_code":,
                        "scientific_name":,
                        "common_name":,
                        "probability":
                    },
                    ...
                ]
            }
        """
        probs = self.session.run(
            None, {"input": lat_lon_week_array.astype(np.float32)}
        )[0]

        results = []
        if min_probability is None:
            min_probability = -1
        for i, probs_i in enumerate(probs):
            filtered = [
                {
                    "ebird_code": label["code"],
                    "scientific_name": label["sci"],
                    "common_name": label["common"],
                    "probability": prob,
                }
                for label, prob in zip(self.labels, probs_i)
                if prob >= min_probability
            ]

            results.append(
                {
                    "latitude": lat_lon_week_array[i, 0],
                    "longitude": lat_lon_week_array[i, 1],
                    "week": lat_lon_week_array[i, 2],
                    "probabilities": filtered,
                }
            )
        return results
