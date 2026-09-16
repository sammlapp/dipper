import json


def load_config_file(config_path, logger=None):
    """Load inference configuration from YAML or JSON file"""
    try:
        import yaml

        with open(config_path, "r") as f:
            if config_path.endswith(".yml") or config_path.endswith(".yaml"):
                config = yaml.safe_load(f)
            else:
                config = json.load(f)
        return config
    except ImportError:
        # Fallback to JSON if yaml not available
        with open(config_path, "r") as f:
            config = json.load(f)
        return config
    except Exception as e:
        if logger:
            logger.error(f"Failed to load config file {config_path}: {e}")
        raise
