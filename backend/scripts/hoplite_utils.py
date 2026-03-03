from pathlib import Path

try:
    import perch_hoplite.db.sqlite_usearch_impl
except Exception as e:
    raise ImportError(
        "perch-hoplite package is required for this action, but failed to import"
    ) from e


def load_or_create_db(config_data, embedding_dim=None, logger=None):
    ## set up model and databse
    # specify a folder to contain the db files
    # can specify an existing folder to connect to an existing db
    db_path = Path(config_data["hoplite_db_path"])

    # create db:
    if db_path.exists():
        if logger:
            logger.info(f"Connecting to existing db at {db_path}")
        db = perch_hoplite.db.sqlite_usearch_impl.SQLiteUsearchDB.create(db_path)
        # check that the embedding dimension of the model matches that expected by the db
        assert (
            db.embedding_dim == embedding_dim
        ), f"Embedding dimension of existing db ({db.embedding_dim}) does not match model embedding dimension ({embedding_dim})."

        if logger:
            logger.info(
                f"Connected database has {db.count_embeddings():,} embeddings from {len(db.get_dataset_names())} dataset{'' if len(db.get_dataset_names()) == 1 else 's'}."
            )
    else:
        assert (
            embedding_dim is not None
        ), "You must specify embedding dim when creating a new database"
        if logger:
            logger.info(f"Creating new db at {db_path}")
        usearch_cfg = perch_hoplite.db.sqlite_usearch_impl.get_default_usearch_config(
            embedding_dim
        )
        db = perch_hoplite.db.sqlite_usearch_impl.SQLiteUsearchDB.create(
            db_path, usearch_cfg
        )
    return db
