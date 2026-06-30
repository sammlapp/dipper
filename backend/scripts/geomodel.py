"""
Example Usage:
geo = BirdNETGeomodel()
local_sp = geo(40.7128, -74.0060, 20) # Example for New York City, week 20
subset_classifier_labels("HawkEars", local_sp)
"""

import numpy as np
import onnxruntime as ort
import pandas as pd
import huggingface_hub

# import birdnames


def load_labels(labels_path):
    """Load species labels from labels.txt."""
    labels = []
    with open(labels_path) as f:
        for line in f:
            parts = line.strip().split("\t")
            labels.append({"code": parts[0], "sci": parts[1], "common": parts[2]})
    return labels


def get_classifier_labels(classifier_name):
    """Get species labels for a given classifier"""
    if classifier_name == "BirdNET":
        labels_path = huggingface_hub.hf_hub_download(
            repo_id="sammlapp/BirdNET_v2.4",
            filename="V2.4/BirdNET_GLOBAL_6K_V2.4_Labels.txt",
        )
        with open(labels_path) as f:
            labels = []
            for line in f:  # format is sci name_common name
                parts = line.strip().split("_")
                labels.append(parts[0])  # scientific name
    if classifier_name == "BirdNET_V3.0.3":
        labels_path = huggingface_hub.hf_hub_download(
            repo_id="sammlapp/BirdNET_GeoModel",
            filename="BirdNET+_Geomodel_V3.0.3_Global_12K_Labels.txt",
        )
        with open(labels_path) as f:
            labels = []
            for line in f:
                parts = line.strip().split("\t")
                labels.append(parts[1])  # scientific name
                # labels.append({"code": parts[0], "sci": parts[1], "common": parts[2]})
    elif classifier_name in ("Perch2", "Perch2LiteRT", "Perch2ONNX"):
        labels_path = huggingface_hub.hf_hub_download(
            repo_id="sammlapp/perch2-tflite",
            filename="perch2_class_labels.txt",
        )
        with open(labels_path) as f:
            labels = [line.strip() for line in f]

    elif classifier_name == "Perch":
        # ebird codes!
        labels_path = huggingface_hub.hf_hub_download(
            repo_id="sammlapp/Perch_V1",
            filename="8/assets/label.csv",
        )
        with open(labels_path) as f:
            # skip first line (header)
            next(f)
            labels = [line.strip() for line in f]
    elif classifier_name in ("BirdSetConvNeXT", "BirdSetEfficientNetB1"):
        # ebird codes!
        labels_path = huggingface_hub.hf_hub_download(
            repo_id="DBD-research-group/ConvNeXT-Base-BirdSet-XCL",
            filename="config.json",
        )
        import json

        with open(labels_path) as f:
            config = json.load(f)
            labels_dict = config["label2id"]
            id2label = {v: k for k, v in labels_dict.items()}
            labels = [id2label[i] for i in range(len(id2label))]

    elif classifier_name == "HawkEars_v010":
        # common names!
        labels_path = huggingface_hub.hf_hub_download(
            repo_id="sammlapp/HawkEars_v0.1.0",
            filename="HawkEars_v0.1.0_class_labels.txt",
        )
        with open(labels_path) as f:
            labels = [line.strip() for line in f]
    elif classifier_name == "HawkEars":
        # common names!
        labels_path = huggingface_hub.hf_hub_download(
            repo_id="sammlapp/HawkEars_v1.0.8",
            filename="HawkEars_v1.0.8_classes.txt",
        )
        with open(labels_path) as f:
            labels = [line.strip() for line in f]
    else:
        raise ValueError(f"Unknown classifier: {classifier_name}")

    return labels


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
}


def subset_classifier_labels(classifier_name, class_table):
    """Subset the labels for a given classifier to only include the specified scientific names"""
    classifier_classes = get_classifier_labels(classifier_name)
    column = MODEL_CLASS_COL.get(classifier_name)
    return class_table[class_table[column].isin(classifier_classes)]


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
