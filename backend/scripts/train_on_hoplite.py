import argparse
import logging
import sys
import numpy as np

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

random_state = 2025


def main():
    parser = argparse.ArgumentParser(
        description="Train classifier on Hoplite embeddings",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "config",
        type=str,
        help="Path to configuration file (YAML or JSON)",
    )

    args = parser.parse_args()

    train_hoplite(args.config)


if __name__ == "__main__":
    main()
