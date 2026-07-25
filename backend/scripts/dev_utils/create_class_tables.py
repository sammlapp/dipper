import birdnames
import bioacoustics_model_zoo as bmz
import pandas as pd
from pathlib import Path

overwrite_existing = False  # skip existing files if they already exist
models = {
    "Perch": bmz.Perch,
    "Perch2": bmz.Perch2,
    "Perch2LiteRT": bmz.Perch2LiteRT,
    "Perch2ONNX": bmz.Perch2ONNX,
    "BirdNET": bmz.BirdNET,
    "BirdSetEfficientNetB1": bmz.BirdSetEfficientNetB1,
    "BirdSetConvNeXT": bmz.BirdSetConvNeXT,
    "HawkEars": bmz.HawkEars,
    "HawkEars_Low_Band": bmz.HawkEars_Low_Band,
}

MODEL_CLASS_COL = {
    "BirdNET": "composite",  # Abroscopus albogularis_Rufous-faced Warbler
    "Perch": "ebird_code",
    "Perch2": "scientific_name",
    "Perch2LiteRT": "scientific_name",
    "Perch2ONNX": "scientific_name",
    "BirdSetConvNeXT": "ebird_code",
    "BirdSetEfficientNetB1": "ebird_code",
    "HawkEars": "common_name",
    "HawkEars_Low_Band": "common_name",
}

# name conversion is currently only for birds; perch uses a global iNaturalist taxonomy
# and we could use it to get common names for other species

# we could get specific here about the exact taxonomies used by each model
# (authority and year), with major authorities and years back to 2024 supported in birdnames
# if this becomes necessary
converters = {
    "scientific_name": {
        "common_name": birdnames.Converter("scientific_name", "common_name"),
        "ebird_code": birdnames.Converter(
            "scientific_name", "ebird_code", to_authority="ebird"
        ),
        "alpha": birdnames.Converter("scientific_name", "alpha", to_authority="ibp"),
    },
    "ebird_code": {
        "scientific_name": birdnames.Converter(
            "ebird_code", "scientific_name", from_authority="ebird"
        ),
        "common_name": birdnames.Converter(
            "ebird_code", "common_name", from_authority="ebird"
        ),
        "alpha": birdnames.Converter(
            "ebird_code", "alpha", from_authority="ebird", to_authority="ibp"
        ),
    },
    "common_name": {
        "scientific_name": birdnames.Converter("common_name", "scientific_name"),
        "ebird_code": birdnames.Converter(
            "common_name", "ebird_code", to_authority="ebird"
        ),
        "alpha": birdnames.Converter("common_name", "alpha", to_authority="ibp"),
    },
}

script_dir = Path(__file__).parent
save_dir = script_dir.parent.parent / "data" / "class_names"
Path(save_dir).mkdir(parents=True, exist_ok=True)
for model_name, model_cls in models.items():
    save_path = save_dir / f"{model_name}.csv"
    if save_path.exists() and not overwrite_existing:
        print(f"Skipping {model_name} because {save_path} already exists.")
        continue
    print(f"Creating class table for {model_name}...")
    m = model_cls()
    model_class_col = MODEL_CLASS_COL[model_name]
    if model_name == "Perch2LiteRT":
        classes = bmz.Perch2ONNX().classes
        class_df = pd.DataFrame({model_class_col: classes})
    elif model_class_col == "composite":
        # convert sci_common composite format to sci
        classes = [c.split("_")[0] for c in m.classes]
        class_df = pd.DataFrame({"composite": m.classes})
        class_df["scientific_name"] = classes
        # for getting the other names, use the parsed scientific name
        model_class_col = "scientific_name"
    else:
        classes = m.classes
        class_df = pd.DataFrame({model_class_col: classes})

    if model_class_col != "scientific_name":
        class_df["scientific_name"] = converters[model_class_col]["scientific_name"](
            classes
        )
    if model_class_col != "ebird_code":
        class_df["ebird_code"] = converters[model_class_col]["ebird_code"](classes)
    if model_class_col != "common_name":
        class_df["common_name"] = converters[model_class_col]["common_name"](classes)
    if model_class_col != "alpha":
        class_df["alpha"] = converters[model_class_col]["alpha"](classes)
    class_df.to_csv(save_dir / f"{model_name}.csv", index=False)
